const { createSocket } = require('node:dgram')
const { EventEmitter } = require('node:events')
const z = require('zod')

const GoveeDevice = require('./GoveeDevice')
const { responseSchema } = require('./protocol')

const GOVEE_ADDRESS = '239.255.255.250'
const GOVEE_INCOMING_PORT = 4002
const GOVEE_OUTGOING_PORT = 4001
const UNRESPONSIVE_THRESHOLD = 10_000 // 10s

const SCAN_INTERVAL = 10_000 // 10s
const STATUS_INTERVAL = 1_000 // 1s

const ipSchema = z.string().ip()

class GoveeSocket extends EventEmitter {
  constructor(networkAddress) {
    super()
    this._networkAddress = networkAddress
    this._closed = true
    this._pollStatusInterval = undefined
    this._pollScanInterval = undefined
    this._devices = new Map()
    this.connect()
  }

  connect() {
    if (!this._closed) {
      return
    }
    this._closed = false
    const socket = createSocket({
      type: 'udp4',
      reuseAddr: true,
    })

    this._socketPromise = new Promise(resolve => {
      socket.once('message', (...params) => {
        this._handleMessage(...params)
        this._init(socket)
        resolve(socket)
      })

      socket.on('listening', () => {
        socket.setBroadcast(true)
        socket.setMulticastTTL(128)
        socket.addMembership(GOVEE_ADDRESS)
        const message = JSON.stringify({ msg: { cmd: 'scan', data: { account_topic: 'reserve' } } })
        socket.send(message, 0, message.length, GOVEE_OUTGOING_PORT, GOVEE_ADDRESS)
      })

      socket.bind(GOVEE_INCOMING_PORT, this._networkAddress.address)
    })
  }

  async send(command, data = {}, target = GOVEE_ADDRESS) {
    const message = JSON.stringify({ msg: { cmd: command, data } })

    const socket = await this._getSocket()
    return new Promise((resolve, reject) => {
      socket.send(message, 0, message.length, GOVEE_OUTGOING_PORT, target, error => {
        if (error) {
          reject(error)
        } else {
          resolve()
          if (target !== GOVEE_ADDRESS && command !== 'devStatus') {
            this.updateDeviceStatus(target)
          }
        }
      })
    })
  }

  _handleMessage(buffer, remoteInfo) {
    if (this._closed) {
      return
    }
    try {
      const { cmd, data } = responseSchema.parse(buffer)

      switch (cmd) {
        case 'scan': {
          if (this._devices.has(data.device)) {
            const deviceEntry = this._devices.get(data.device)
            if (deviceEntry.device.ip !== data.ip) {
              console.info(`Device ${data.device} switched ip from ${deviceEntry.device.ip} to ${data.ip}`)
            }
            deviceEntry.device.updateConfig(data, (c, d) => this.send(c, d, data.ip))
            deviceEntry.lastSeen = Date.now()
          } else {
            const device = new GoveeDevice(data, (c, d) => this.send(c, d, data.ip))
            this._devices.set(data.device, {
              device,
              lastSeen: Date.now(),
            })
            this.updateDeviceStatus(device.ip)
            device.initialized().then(() => {
              this.emit('deviceDiscovered', device)
            })
          }
          break
        }

        case 'devStatus': {
          const deviceEntry = Array.from(this._devices.values()).find(({ device }) => device.ip === remoteInfo.address)
          if (!deviceEntry) {
            throw new Error(`No device with ip ${remoteInfo.address}`)
          }
          if (deviceEntry.device.updateStatus(data)) {
            this.emit('deviceUpdated', deviceEntry.device)
          }
          deviceEntry.lastSeen = Date.now()
          break
        }
        default: {
          throw new Error(`Received unknown message cmd ${cmd}`)
        }
      }
    } catch (error) {
      console.error(error)
    }
  }

  async _init(socket) {
    if (this._closed) {
      return
    }

    socket.on('message', (...params) => this._handleMessage(...params))

    this._pollStatusInterval = setInterval(() => {
      this.updateDeviceStatus()
    }, STATUS_INTERVAL)

    this._pollScanInterval = setInterval(() => {
      this.updateDeviceList()
    }, SCAN_INTERVAL)
  }

  close() {
    this._closed = true
    clearInterval(this._pollStatusInterval)
    clearInterval(this._pollScanInterval)
    return new Promise(resolve => {
      this._getSocket().then(socket => socket.close(resolve))
    })
  }

  destroy() {
    return this.close()
  }

  _getSocket() {
    return this._socketPromise
  }

  ready() {
    return this._getSocket().then(() => this)
  }

  updateDeviceStatus(ip) {
    return this.send('devStatus', {}, ip)
  }

  updateDeviceList() {
    const threshold = Date.now() - UNRESPONSIVE_THRESHOLD
    this._devices.forEach(deviceEntry => {
      if (deviceEntry.lastSeen < threshold) {
        this._devices.delete(deviceEntry.device.id)
        deviceEntry.device.emit('removed')
        this.emit('deviceRemoved', deviceEntry.device)
      }
    })

    return this.send('scan', { account_topic: 'reserve' })
  }

  getDevices() {
    return Array.from(this._devices.values()).map(deviceEntry => deviceEntry.device)
  }

  getDevice(idOrIp) {
    if (ipSchema.safeParse(idOrIp).success) {
      return this.getDevices().find(device => device.ip === idOrIp)
    }
    return this._devices.get(idOrIp)?.device
  }
}

module.exports = GoveeSocket
