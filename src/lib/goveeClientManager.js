const createGoveeClient = require('./createGoveeClient')

let clientPromise
let refCount = 0

function getClient() {
  refCount++
  if (!clientPromise) {
    clientPromise = createGoveeClient()
    clientPromise.then(client => {
      client.on('deviceDiscovered', device => {
        console.info(`Found govee device "${device.id}" at ip "${device.ip}"`)
      })
      client.on('deviceRemoved', device => {
        console.info(`Removed govee device "${device.id}" at ip "${device.ip}"`)
      })
      client.on('deviceUpdated', device => {
        console.info(`Updated govee device "${device.id}" at ip "${device.ip}"`)
      })
    })
  }
  return clientPromise
}

async function releaseClient() {
  refCount--
  if (refCount <= 0 && clientPromise) {
    const client = await clientPromise
    clientPromise = undefined
    refCount = 0
    await client.destroy()
  }
}

module.exports = { getClient, releaseClient }
