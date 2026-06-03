# node-red-contrib-bosch-camera

> **Alpha — functional. The four nodes talk to the Bosch Smart Home cloud API. Field-test before relying on it in production flows.**

Node-RED nodes for [Bosch Smart Home Cameras](https://www.bosch-smarthome.com/de/de/produkte/kameras/) (Eyes Outdoor, 360° Indoor, Eyes Outdoor II, Eyes Indoor II) via the Bosch Smart Home cloud API.

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

Holds a Bosch SingleKey ID **refresh token** and exchanges it for short-lived cloud access tokens (refreshed automatically, cached until they near expiry). Stored via Node-RED's secure credentials API — never exported to `flows.json`. One config node per Bosch account.

**Getting a refresh token:** run the [Bosch Camera Python CLI](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python) once to log in via the browser (PKCE), then copy the `refresh_token` it stores into the config node. The refresh token does not expire, so this is a one-time step.

### bosch-camera-event (input node)

Polls the cloud for camera events and emits one message per new event (deduplicated by id). Configurable poll interval (default 30 s, min 10 s) and per-poll event limit.

Output `msg.payload`:
```json
{
  "cam":        "your-video-input-id",
  "event_type": "PERSON",
  "timestamp":  "2026-06-03T12:34:56.000Z",
  "image_url":  "https://.../snap.jpg",
  "clip_url":   "https://.../clip.mp4"
}
```

### bosch-camera-snapshot (action node)

Any incoming message triggers a live snapshot fetch through the cloud REMOTE proxy. Output `msg.payload` is a `Buffer` containing the JPEG image (`msg.contentType = 'image/jpeg'`). Camera ID comes from the node config or `msg.cameraId`.

Pipe to `node-red-contrib-image-output` or a file node to save/display.

### bosch-camera-privacy (action node)

Enables, disables or toggles camera privacy mode.

Input (Mode = *Use msg.payload*): `msg.payload = true`/`'on'`/`1` to enable, `false`/`'off'`/`0` to disable. Other modes (*on*, *off*, *toggle*) are fixed in the node config; *toggle* reads the current state first and flips it.

Output: `msg.payload = { cam, privacy, success }`

## Roadmap

- Stream URL node (RTSP/HLS via the cloud proxy)
- Light control + pan/tilt nodes (Gen2 cameras)
- FCM push as a lower-latency alternative to event polling

## License

MIT — see [LICENSE](LICENSE)
