# node-red-contrib-bosch-camera

[![NPM version](https://img.shields.io/npm/v/node-red-contrib-bosch-camera.svg)](https://www.npmjs.com/package/node-red-contrib-bosch-camera)
[![Downloads](https://img.shields.io/npm/dm/node-red-contrib-bosch-camera.svg)](https://www.npmjs.com/package/node-red-contrib-bosch-camera)
[![CI](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/ci.yml/badge.svg)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/ci.yml)

Node-RED nodes for Bosch Smart Home Cameras (Eyes Outdoor, 360° Indoor, Eyes Outdoor II, Eyes Indoor II) via the Bosch Smart Home cloud API.

> **Alpha — functional.** The four nodes talk to the Bosch cloud API and are covered by tests, but the surface is young. Field-test before relying on it in production flows.

> **No official API.** These nodes use the reverse-engineered Bosch Cloud API, discovered via traffic analysis of the official Bosch Smart Camera app — the same API the [sibling projects](#related-projects) use.

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)
![AI-Assisted](https://img.shields.io/badge/AI--Assisted-blue?style=for-the-badge)

[releases-shield]: https://img.shields.io/github/release/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED.svg?style=for-the-badge&include_prereleases
[releases]: https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/releases
[license-shield]: https://img.shields.io/github/license/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED.svg?style=for-the-badge

---

## Table of Contents

- [Supported Cameras](#supported-cameras)
- [Disclaimer](#disclaimer)
- [Install](#install)
- [Setup](#setup)
- [Nodes](#nodes)
- [Example Flow](#example-flow)
- [Development](#development)
- [Release Process](#release-process)
- [Related Projects](#related-projects)
- [Changelog](#changelog)
- [License](#license)

---

## Supported Cameras

| Model | Generation |
|---|---|
| Eyes Outdoor (SVO-1601-220) | Gen1 |
| 360° Indoor (SVI-1609-5) | Gen1 |
| Eyes Outdoor II | Gen2 |
| Eyes Indoor II | Gen2 |

Model-specific differences are handled by the cloud API; the nodes are model-agnostic.

---

## Disclaimer

**This project is an independent, community-developed integration. It is not affiliated with, endorsed by, or connected to Robert Bosch GmbH. "Bosch" and "Bosch Smart Home" are registered trademarks of Robert Bosch GmbH.**

These nodes communicate with a reverse-engineered, undocumented API. Provided **"as is"**, without warranty. Use at your own risk. The API may change or be shut down by Bosch at any time. Reverse engineering was performed solely for interoperability under **§ 69e UrhG** and **EU Directive 2009/24/EC**.

---

## Install

```bash
# In your Node-RED user directory (~/.node-red):
npm install node-red-contrib-bosch-camera
```

Or use the Node-RED Palette Manager (search `bosch-camera`).

Requires Node-RED ≥ 3.0 and Node.js ≥ 22.

---

## Setup

Authentication uses the Bosch SingleKey ID cloud OAuth flow. The full browser
login (PKCE) cannot run inside a Node-RED config dialog, so you obtain a
**refresh token** once with the sibling Python CLI and paste it into the config
node. The refresh token does not expire, so this is a one-time step.

1. Clone and run the [Bosch Camera Python CLI](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python) and complete its browser login once.
2. Copy the `refresh_token` it stores in its local config file.
3. In Node-RED, add a **bosch-camera-config** node and paste the token into the **Refresh Token** field (stored securely via Node-RED's credentials API — never written to `flows.json`).
4. Point the event / snapshot / privacy nodes at that config node and at a camera (video input) ID.

If the refresh token is ever rejected (after a Bosch password change or extended downtime), repeat step 1 to obtain a fresh one.

---

## Nodes

### bosch-camera-config (config node)

Holds the Bosch SingleKey ID **refresh token** and mints short-lived cloud
access tokens from it (Keycloak `refresh_token` grant), cached until they near
expiry and refreshed automatically. One config node per Bosch account.

### bosch-camera-event (input node)

Polls the cloud for camera events and emits one message per **new** event
(deduplicated by id). The first poll after start only establishes a baseline —
existing events are recorded but not emitted, so a restart never replays
history. Configurable poll interval (default 30 s, min 10 s) and per-poll limit.

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
`msg.topic` is `bosch/camera/event`; `msg.payload.raw` carries the full event object.

### bosch-camera-snapshot (action node)

Any incoming message triggers a live snapshot fetch through the cloud REMOTE
proxy. Output `msg.payload` is a `Buffer` containing the JPEG image
(`msg.contentType = 'image/jpeg'`, plus `msg.cam` and `msg.timestamp`). Camera
ID comes from the node config or `msg.cameraId`.

Pipe to `node-red-contrib-image-output` or a file node to save/display.

### bosch-camera-privacy (action node)

Enables, disables or toggles camera privacy mode.

Input (Mode = *Use msg.payload*): `msg.payload = true`/`'on'`/`1` to enable,
`false`/`'off'`/`0` to disable. The fixed modes *on*, *off* and *toggle* are set
in the node config; *toggle* reads the current state first and flips it.

Output: `msg.payload = { cam, privacy, success }`

---

## Example Flow

Motion/person event → fetch a snapshot → write it to disk:

```
[bosch-camera-event] ──▶ [switch: event_type == "PERSON"] ──▶ [bosch-camera-snapshot] ──▶ [file: /tmp/last_person.jpg]
```

Privacy automation (turn privacy on at night via an inject + the privacy node in
fixed *on* mode), or wire a dashboard button to a privacy node in *toggle* mode
for a one-tap privacy switch.

---

## Development

```bash
npm install
npm run lint     # eslint (flat config) over nodes/
npm test         # mocha + node-red-node-test-helper + nock (20 specs)
```

The HTTP layer lives in `nodes/lib/bosch-api.js` (no Node-RED dependency, unit-testable). Each node has happy- and error-path tests; CI runs the suite on Node 22 + 24.

---

## Release Process

Releases are automated by CI on tag push — see [`RELEASING.md`](./RELEASING.md). In short: bump the version, move the [`CHANGELOG.md`](./CHANGELOG.md) heading, then `git tag vX.Y.Z && git push origin main vX.Y.Z`. The `publish` job in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the gates and publishes to npm via **tokenless OIDC Trusted Publishing** (prerelease → `alpha` dist-tag, stable → `latest`). Never run `npm publish` by hand.

---

## Related Projects

Part of a five-implementation family for Bosch Smart Home Cameras (plus an alpha frontend):

| Implementation | Repo | Status |
|---|---|---|
| 🏆 Home Assistant Integration | [Bosch-Smart-Home-Camera-Tool-HomeAssistant](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-HomeAssistant) | **v13.5.7** · HA Quality Scale **Platinum** · production-ready |
| 🐍 Python CLI | [Bosch-Smart-Home-Camera-Tool-Python](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python) | **v10.10.x** · Mini-NVR + SMB upload (BETA) · LAN-fallback · PTZ presets · webhook delivery |
| 🟢 ioBroker Adapter | [ioBroker.bosch-smart-home-camera](https://github.com/mosandlt/ioBroker.bosch-smart-home-camera) | **v1.1.0** · stable · npm · MQTT bridge · PTZ presets · VIS-2 widget |
| 🤖 MCP Server | [Bosch-Smart-Home-Camera-Tool-MCP](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-MCP) | **v1.5.2** · cred-rotation · PTZ presets · TOFU cert pinning · Claude integration |
| 🔴 **Node-RED nodes** (this repo) | [Bosch-Smart-Home-Camera-Tool-NodeRED](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED) | **v0.2.1-alpha** · on npm · 4 functional nodes (event / snapshot / privacy / config) |

Also: [Bosch Smart Home Camera — Python Frontend (NiceGUI)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python-frontend) — alpha dashboard.

Home Assistant stays the **reference implementation** — features land there first; the other projects catch up over time.

---

## Changelog

Full history in [`CHANGELOG.md`](./CHANGELOG.md). Latest:

### 0.2.1-alpha (2026-06-11)
**Security:** TLS verification for all Bosch cloud calls (CWE-295, GHSA-6qh5-x5m5-vj6v). The cloud REST API and video proxy now validate the Bosch private CA (pinned, plus system roots) instead of accepting any certificate, closing an adjacent-network MITM on OAuth tokens, event data, and snapshots.

### 0.2.0-alpha (2026-06-03)
The four nodes are now functional against the Bosch Smart Home cloud API: config-node refresh-token auth, `/v11/events` polling, cloud-proxy snapshots, and privacy enable/disable/toggle. Shared `nodes/lib/bosch-api.js`, 20 tests, CI on Node 22 + 24, tokenless OIDC npm publishing.

---

## License

MIT — see [LICENSE](./LICENSE)
