# node-red-contrib-bosch-camera

> **Alpha — Phase 1 skeleton. Nodes register and display status but make no HTTP calls yet.**

Node-RED nodes for [Bosch Smart Home Cameras](https://www.bosch-smarthome.com/de/de/produkte/kameras/) (Eyes Outdoor, 360° Indoor, Eyes Outdoor II, Eyes Indoor II) connected via a Bosch Smart Home Controller (SHC).

Part of the [Bosch Smart Home Camera Tool](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-HomeAssistant) family:

| Platform | Repo |
|---|---|
| Home Assistant | [mosandlt/Bosch-Smart-Home-Camera-Tool-HomeAssistant](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-HomeAssistant) |
| Python CLI | [mosandlt/Bosch-Smart-Home-Camera-Tool-Python](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python) |
| ioBroker | [mosandlt/ioBroker.bosch-smart-home-camera](https://github.com/mosandlt/ioBroker.bosch-smart-home-camera) |
| MCP Server | [mosandlt/Bosch-Smart-Home-Camera-Tool-MCP](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-MCP) |
| **Node-RED** | **this repo** |

## Install

```bash
# In your Node-RED user directory (~/.node-red):
npm install node-red-contrib-bosch-camera
```

Or use the Node-RED Palette Manager (search `bosch-camera`).

## Nodes

### bosch-camera-config (config node)

Shared credentials for one Bosch SHC. Stores email + password via Node-RED's secure credentials API — never exported to `flows.json`. One config node per SHC installation.

Fields: SHC host/IP, port (default 8444), email, password, use-cloud toggle.

### bosch-camera-event (input node)

Emits a message whenever a camera fires an event. Connect to downstream nodes to trigger automations.

Output `msg.payload`:
```json
{
  "cam":        "hdm:Cameras:YOUR-CAMERA-UUID",
  "event_type": "MOTION_DETECTED",
  "timestamp":  "2026-05-20T12:34:56.000Z"
}
```

Event types: `MOTION_DETECTED`, `ALARM`, `PERSON_DETECTED`, `AUDIO_ALARM`

### bosch-camera-snapshot (action node)

Any incoming message triggers a snapshot fetch. Output `msg.payload` is a `Buffer` containing the JPEG image (`msg.contentType = 'image/jpeg'`).

Pipe to `node-red-contrib-image-output` or a file node to save/display.

### bosch-camera-privacy (action node)

Enables or disables camera privacy mode.

Input: `msg.payload = true` (enable) or `false` (disable). Or set a fixed mode in the node config.

Output: `msg.payload = { cam, privacy, success }`

## Roadmap

- **Phase 2**: OAuth token exchange with SHC, SSE/long-poll event subscription, live snapshot + privacy HTTP calls
- **Phase 3**: Stream URL node (RTSP/HLS), light control node, pan/tilt (Gen2)

## License

MIT — see [LICENSE](LICENSE)
