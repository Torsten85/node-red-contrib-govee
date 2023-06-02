const z = require('zod')

const scanResponseSchema = z.object({
  cmd: z.literal('scan'),
  data: z.object({
    ip: z.string().ip(),
    device: z.string(),
    sku: z.string(),
    bleVersionHard: z.string(),
    bleVersionSoft: z.string(),
    wifiVersionHard: z.string(),
    wifiVersionSoft: z.string(),
  }),
})

const deviceStatusResponseSchema = z.object({
  cmd: z.literal('devStatus'),
  data: z.object({
    onOff: z.union([z.literal(0), z.literal(1)]),
    brightness: z.number().int().min(0).max(100),
    color: z.object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255),
    }),
    colorTemInKelvin: z.number().int(),
  }),
})

const responseSchema = z
  .instanceof(Buffer)
  .transform(str => JSON.parse(str.toString()))
  .pipe(z.object({ msg: z.any() }))
  .transform(obj => obj.msg)
  .pipe(z.union([scanResponseSchema, deviceStatusResponseSchema]))

module.exports = { responseSchema }
