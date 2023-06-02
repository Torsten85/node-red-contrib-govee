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

    const getDevice = () => getClient().then(client => client.getDevice(config.deviceid))

    const onUpdated = () => {
      getDevice().then(device => {
        if (!device) return
        node.send({
          payload: {
            power: device.power,
            brightness: device.brightness,
            color: device.color,
            kelvin: device.kelvin,
          },
        })
      })
    }

    getDevice().then(device => {
      if (!device) {
        node.status({ fill: 'red', shape: 'ring', text: 'govee-light.node.not-configured' })
        return
      }
      device.on('updated', onUpdated)
    })

    node.on('input', async (msg, send, done) => {
      try {
        if (!config.deviceid) {
          throw new Error('Missing device id')
        }
        const parsedMessage = inputSchema.parse(msg.payload)

        const device = await getDevice()
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
      const device = await getDevice().catch(() => null)
      if (device) {
        device.removeListener('updated', onUpdated)
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
