# node-red-contrib-govee

Node-RED nodes for controlling Govee smart lights over the local network (LAN). No cloud API or account required — communication happens directly via UDP multicast.

## Installation

```bash
npm install node-red-contrib-govee
```

Or install via the Node-RED Palette Manager: search for `node-red-contrib-govee`.

## Node: Govee Light

A single node that both **sends commands** to and **receives status updates** from a Govee light on your local network.

### Setup

1. Drag the **Govee Light** node into your flow
2. Double-click it and press the **🔍 scan** button to discover devices on your LAN
3. Select your device from the dropdown
4. Deploy

### Sending Commands (Input)

Send a `msg.payload` to control the light:

| Payload | Type | Description |
|---------|------|-------------|
| `true` / `false` | `boolean` | Turn light on / off |
| `{ power: true }` | `object` | Turn light on / off |
| `{ brightness: 75 }` | `object` | Set brightness (0–100) |
| `{ kelvin: 4000 }` | `object` | Set color temperature (2000–9000 K) |
| `{ rgb: [255, 0, 128] }` | `object` | Set color as RGB array |
| `{ rgb: "#ff0080" }` | `object` | Set color as hex string |
| `{ hsl: [300, 255, 128] }` | `object` | Set color as HSL array |

Multiple properties can be combined in a single payload:

```json
{ "power": true, "brightness": 80, "kelvin": 4000 }
```

> **Note:** `kelvin` and `rgb`/`hsl` are mutually exclusive — if `kelvin` is set, `rgb` and `hsl` are ignored.

### Receiving Status (Output)

The node emits a `msg.payload` whenever the device status changes:

```json
{
  "power": true,
  "brightness": 80,
  "color": [255, 0, 128],
  "kelvin": 0
}
```

## Requirements

- Node.js ≥ 18.0.0
- Node-RED ≥ 4.0.0
- Govee light must be on the same LAN (UDP multicast)

## License

MIT
