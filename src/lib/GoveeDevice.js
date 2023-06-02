const { EventEmitter } = require('events')
const { hsl, hex } = require('color-convert')
const z = require('zod')

const brightnessRangeSchema = z.number().int().min(0).max(100)
const kelvinSchema = z.number().int().min(2000).max(9000)
const hslSchema = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)])
const rgbSchema = z.union([hslSchema, z.string().regex(/^#[a-fA-F0-9]{6}$/)])

class GoveeDevice extends EventEmitter {
  constructor(config, send) {
    super()
    this._config = config
    this._send = send
    this._status = undefined
    this._targetStatus = {}
    this._initPromise = new Promise(resolve => {
      this._resolveInitPromise = resolve
    })
  }

  updateConfig(config, send) {
    this._config = config
    this._send = send
  }

  updateStatus(status) {
    const hasChanges =
      this._status?.brightness !== status.brightness ||
      this._status?.onOff !== status.onOff ||
      this._status?.colorTemInKelvin !== status.colorTemInKelvin ||
      this._status?.color.r !== status.color.r ||
      this._status?.color.g !== status.color.g ||
      this._status?.color.b !== status.color.b

    const target = this._targetStatus
    this._status = status

    if (status.onOff === target.onOff) {
      console.info(`Govee Light ${this.id} reached target onOff (${target.onOff})`)
      delete target.onOff
    } else if ('onOff' in target) {
      console.info(`Govee Light ${this.id} did not reach target onOff (${target.onOff})`)
      this.setPower(Boolean(target.onOff))
    }

    if (status.brightness === target.brightness) {
      console.info(`Govee Light ${this.id} reached target brightness (${target.brightness})`)
      delete target.brightness
    } else if ('brightness' in target) {
      console.info(`Govee Light ${this.id} did not reach target brightness (${target.brightness})`)
      this.setBrightness(target.brightness)
    }

    if (status.colorTemInKelvin === target.colorTemInKelvin) {
      console.info(`Govee Light ${this.id} reached target colorTemInKelvin (${target.colorTemInKelvin})`)
      delete target.colorTemInKelvin
    } else if ('colorTemInKelvin' in target) {
      console.info(`Govee Light ${this.id} did not reach target colorTemInKelvin (${target.colorTemInKelvin})`)
      this.setKelvin(target.colorTemInKelvin)
    }

    if (status.color.r === target.color?.r && status.color.g === target.color?.g && status.color.b === target.color?.b) {
      console.info(`Govee Light ${this.id} reached target color (${target.color.r},${target.color.g},${target.color.b})`)
      delete target.color
    } else if ('color' in target) {
      console.info(`Govee Light ${this.id} did not reach target color (${target.color.r},${target.color.g},${target.color.b})`)
      this.setRGB([target.color.r, target.color.g, target.color.b])
    }

    this._resolveInitPromise()
    if (hasChanges) {
      this.emit('updated')
    }
    return hasChanges
  }

  get ip() {
    return this._config.ip
  }

  get id() {
    return this._config.device
  }

  get sku() {
    return this._config.sku
  }

  initialized() {
    return this._initPromise
  }

  get power() {
    return Boolean(this._status?.onOff)
  }

  get kelvin() {
    return this._status?.colorTemInKelvin || 0
  }

  get brightness() {
    return this._status?.brightness || 0
  }

  get color() {
    if (this._status?.color) {
      return [this._status.color.r, this._status.color.g, this._status.color.b]
    }
    return [0, 0, 0]
  }

  setPower(power) {
    const onOff = power ? 1 : 0
    this._targetStatus = { onOff }
    return this._send('turn', { value: onOff })
  }

  async setBrightness(value) {
    const brightness = brightnessRangeSchema.parse(value)
    this._targetStatus.brightness = brightness
    return this._send('brightness', { value: brightness })
  }

  async setKelvin(value) {
    const colorTemInKelvin = kelvinSchema.parse(value)
    this._targetStatus.colorTemInKelvin = colorTemInKelvin
    delete this._targetStatus.color
    return this._send('colorwc', { colorTemInKelvin })
  }

  async setRGB(value) {
    let color = rgbSchema.parse(value)
    if (typeof color === 'string') {
      color = hex.rgb(color)
    }

    const rgb = { r: color[0], g: color[1], b: color[2] }
    this._targetStatus.color = rgb
    delete this._targetStatus.colorTemInKelvin
    return this._send('colorwc', { color: rgb })
  }

  setHSL(value) {
    return this.setRGB(hsl.rgb(value))
  }
}

module.exports = GoveeDevice
