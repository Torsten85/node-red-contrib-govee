const { networkInterfaces } = require('os')
const GoveeSocket = require('./GoveeSocket')

async function createGoveeClient(interfaceName) {
  const interfaces = networkInterfaces()

  let networkAddresses
  if (interfaceName) {
    networkAddresses = interfaces[interfaceName] ?? []
  } else {
    networkAddresses = Object.values(interfaces)
      .filter(Boolean)
      .flat()
      .filter(networkAddress => networkAddress.family === 'IPv4' && !networkAddress.internal)
  }

  if (networkAddresses.length === 0) {
    throw new Error('Could not discover network address')
  }

  const sockets = networkAddresses.map(networkAddress => new GoveeSocket(networkAddress))
  // find first ready socket
  const govee = await Promise.any(sockets.map(socket => socket.ready()))
  // close every other socket
  sockets.filter(socket => socket !== govee).forEach(socket => socket.close())

  return govee
}

module.exports = createGoveeClient
