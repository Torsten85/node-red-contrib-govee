const z = require('zod')
const { getClient, releaseClient } = require('../lib/goveeClientManager')

const booleanInputSchema = z.boolean()

const objectInputSchema = z.object({
  power: z.boolean().optional(),
  rgb: z
    .union([
      z.string().regex(/^#[a-fA-F0-9]{6}$/),
      z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
    ])
    .optional(),
  hsl: z.tuple([z.number().int().min(0).max(360), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).optional(),
  kelvin: z.number().int().min(2000).max(9000).optional(),
  brightness: z.number().int().min(0).max(100).optional(),
})

const inputSchema = z.union([booleanInputSchema, objectInputSchema])

module.exports = function GoveeLightRegistration(RED) {
  let scanEndpointRegistered = false

  function GoveeLight(config) {
    RED.nodes.createNode(this, config)
    const node = this

    if (!config.deviceid) {
      node.status({ fill: 'red', shape: 'ring', text: 'govee-light.node.not-configured' })
      return
    }

    // Acquire a single shared client reference for the lifetime of this node.
    // It is released exactly once in the 'close' handler (see below), which
    // keeps the goveeClientManager reference count balanced.
    const clientPromise = getClient()

    let currentDevice

    const setStatus = device => {
      if (device) {
        node.status({ fill: 'green', shape: 'dot', text: 'govee-light.node.connected' })
      } else {
        node.status({ fill: 'yellow', shape: 'ring', text: 'govee-light.node.searching' })
      }
    }

    const onUpdated = () => {
      if (!currentDevice) return
      node.send({
        payload: {
          power: currentDevice.power,
          brightness: currentDevice.brightness,
          color: currentDevice.color,
          kelvin: currentDevice.kelvin,
        },
      })
    }

    const attachDevice = device => {
      if (currentDevice === device) return
      detachDevice()
      currentDevice = device
      device.on('updated', onUpdated)
      setStatus(device)
    }

    const detachDevice = () => {
      if (currentDevice) {
        currentDevice.removeListener('updated', onUpdated)
        currentDevice = undefined
      }
    }

    const onDeviceDiscovered = device => {
      if (device.id === config.deviceid) {
        attachDevice(device)
      }
    }

    const onDeviceRemoved = device => {
      if (device.id === config.deviceid) {
        detachDevice()
        setStatus(undefined)
      }
    }

    // Device discovery over UDP is asynchronous, so the device is rarely known
    // at construction time. Show "searching" and let the client events drive
    // the status once the configured device appears or disappears.
    setStatus(undefined)

    const clientReady = clientPromise.then(client => {
      client.on('deviceDiscovered', onDeviceDiscovered)
      client.on('deviceRemoved', onDeviceRemoved)

      // The device may already be known from an earlier scan.
      const existing = client.getDevice(config.deviceid)
      if (existing) {
        attachDevice(existing)
      }
      return client
    })

    // Resolve as soon as the configured device is available, nudging discovery
    // so we don't have to wait for the next periodic scan. Resolves to the
    // device, or undefined if it never shows up within the timeout.
    const waitForDevice = async (timeout = 8000) => {
      const client = await clientReady
      const existing = client.getDevice(config.deviceid)
      if (existing) return existing

      client.updateDeviceList()

      return new Promise(resolve => {
        const onDiscovered = device => {
          if (device.id !== config.deviceid) return
          clearTimeout(timer)
          client.removeListener('deviceDiscovered', onDiscovered)
          resolve(device)
        }

        const timer = setTimeout(() => {
          client.removeListener('deviceDiscovered', onDiscovered)
          resolve(client.getDevice(config.deviceid))
        }, timeout)

        client.on('deviceDiscovered', onDiscovered)
      })
    }

    node.on('input', async (msg, send, done) => {
      try {
        const parsedMessage = inputSchema.parse(msg.payload)

        const device = await waitForDevice()
        if (!device) {
          throw new Error(`No device found with id ${config.deviceid}`)
        }

        if (typeof parsedMessage === 'boolean') {
          device.setPower(parsedMessage)
          send(msg)
          done()
          return
        }

        if (typeof parsedMessage.power === 'boolean') {
          device.setPower(parsedMessage.power)
        }

        if (typeof parsedMessage.brightness === 'number') {
          device.setBrightness(parsedMessage.brightness)
        }

        if (typeof parsedMessage.kelvin !== 'undefined') {
          device.setKelvin(parsedMessage.kelvin)
        } else if (typeof parsedMessage.rgb !== 'undefined') {
          device.setRGB(parsedMessage.rgb)
        } else if (Array.isArray(parsedMessage.hsl)) {
          device.setHSL(parsedMessage.hsl)
        }

        send(msg)
        done()
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error
        }
        done(error)
      }
    })

    node.on('close', async (done) => {
      detachDevice()
      const client = await clientPromise.catch(() => null)
      if (client) {
        client.removeListener('deviceDiscovered', onDeviceDiscovered)
        client.removeListener('deviceRemoved', onDeviceRemoved)
      }
      await releaseClient()
      done()
    })
  }

  RED.nodes.registerType('govee-light', GoveeLight)

  // Register scan endpoint only once even if multiple nodes are loaded
  if (!scanEndpointRegistered) {
    scanEndpointRegistered = true
    RED.httpAdmin.get('/govee/lights', async (_req, res) => {
      try {
        const client = await getClient()
        client.updateDeviceList()
        await new Promise(resolve => setTimeout(resolve, 500))

        const devices = client.getDevices().map(device => ({ id: device.id, ip: device.ip, sku: device.sku }))
        res.json(devices)
      } catch (error) {
        res.status(500).json({ error: error.message })
      } finally {
        await releaseClient()
      }
    })
  }
}
