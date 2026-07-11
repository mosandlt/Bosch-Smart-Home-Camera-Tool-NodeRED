# node-red-contrib-bosch-camera

[![NPM version](https://img.shields.io/npm/v/node-red-contrib-bosch-camera.svg)](https://www.npmjs.com/package/node-red-contrib-bosch-camera)
[![Downloads](https://img.shields.io/npm/dm/node-red-contrib-bosch-camera.svg)](https://www.npmjs.com/package/node-red-contrib-bosch-camera)
[![CI](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/ci.yml/badge.svg)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/codeql.yml/badge.svg)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/codeql.yml)
[![Secret scan](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED/actions/workflows/secret-scan.yml)

Node-RED nodes for Bosch Smart Home Cameras (Eyes Outdoor, 360° Indoor, Eyes Outdoor II, Eyes Indoor II) via the Bosch Smart Home cloud API.

> **Alpha — functional.** The nodes talk to the Bosch cloud API and are covered by tests, but the surface is young. Field-test before relying on it in production flows.

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
2. Copy the `refresh_token` from `bosch_config.json` (created by the CLI next to `bosch_camera.py` after first login — see the [Python CLI README](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python#readme) for details).
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

### bosch-camera-stream-url (action node)

Opens a live stream connection via the cloud proxy and returns the available
stream URLs in `msg.payload`. Useful for feeding the URL into an RTSP player,
go2rtc, or a recording pipeline without having to call the API manually.

Output `msg.payload`:
```json
{
  "rtspUrl":  "rtsps://proxy.example.com/…",
  "rtspsUrl": "rtsps://proxy.example.com/…",
  "hlsUrl":   "https://proxy.example.com/…"
}
```
`msg.cam` carries the camera ID. Connection type defaults to `REMOTE` (cloud
TLS proxy); set to `LOCAL` for LAN. Camera ID and connection type can be
overridden at runtime via `msg.cameraId` / `msg.connectionType`. Digest
credentials embedded in RTSP URLs are redacted in node status and logs (`***:***@`).

### bosch-camera-light (action/query node)

Reads or sets the front-illuminator / wallwasher light state on a Bosch Eyes
Outdoor camera (LED-light models only). Mode *Read current light state* just
queries; the fixed on/off presets and *Use msg.payload as patch* mode write
via a read-modify-write PUT (only the fields you set change).

Input (Mode = *Use msg.payload as patch*): `msg.payload = { frontLightOn, wallwasherOn, frontLightIntensity }`
— any subset. `frontLightIntensity` is a 0.0-1.0 fraction, not a percentage;
setting it implicitly turns the front light on (Bosch-side behaviour).

Output: `msg.payload = { cam, frontLightOn, wallwasherOn, frontLightIntensity, success }`

### bosch-camera-motion (action/query node)

Reads or sets motion detection (enabled + sensitivity).

Input (Mode = *Use msg.payload*): `msg.payload = true`/`false` to enable/disable,
or `{ enabled, sensitivity }` where `sensitivity` is one of
`OFF`/`LOW`/`MEDIUM_LOW`/`MEDIUM_HIGH`/`HIGH`/`SUPER_HIGH`. Setting a sensitivity
implicitly enables motion detection.

Output: `msg.payload = { cam, enabled, sensitivity, success }`

### bosch-camera-audio-detection (action/query node)

Reads or sets glass-break / fire-and-smoke-alarm sound detection. Gen2
Audio-Plus cameras only — Bosch rejects the request on unsupported models
(surfaced as a node error).

Input (Mode = *Use msg.payload*): `msg.payload = { detectGlassBreak, detectFireAlarm }`
— any subset; the node reads the current state first and merges, since Bosch
requires both fields on every write.

Output: `msg.payload = { cam, detectGlassBreak, detectFireAlarm, success }`

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
npm test         # mocha + node-red-node-test-helper + nock (31 specs)
```

The HTTP layer lives in `nodes/lib/bosch-api.js` (no Node-RED dependency, unit-testable). Each node has happy- and error-path tests; CI runs the suite on Node 22 + 24.

---

## Release Process

Releases are automated by CI on tag push — see [`RELEASING.md`](./RELEASING.md). In short: bump the version, move the [`CHANGELOG.md`](./CHANGELOG.md) heading, then `git tag vX.Y.Z && git push origin main vX.Y.Z`. The `publish` job in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs the gates and publishes to npm via **tokenless OIDC Trusted Publishing** (prerelease → `alpha` dist-tag, stable → `latest`). Never run `npm publish` by hand.

---

## Integration Comparison

How this tool compares to the rest of the Bosch Smart Home Camera ecosystem (Home Assistant integration, Python CLI, ioBroker adapter, MCP server, this NiceGUI frontend, and the Node-RED nodes):

| Feature | [Home Assistant Integration](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-HomeAssistant) | [Python CLI Tool](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python) | [ioBroker Adapter](https://github.com/mosandlt/ioBroker.bosch-smart-home-camera) | [MCP Server](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-MCP) | [Frontend (NiceGUI)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python-frontend) | [Node-RED](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED) |
|---|---|---|---|---|---|---|
| **Maturity** | v13.5+ — HA Quality Scale **Platinum** | v10.10+ stable (Mini-NVR BETA) | v1.5+ stable · npm | v1.5+ stable · PyPI | v0.1.2 **alpha** · PyPI | v0.2.3 **alpha** · npm |
| **Platform** | Home Assistant (HACS) | Standalone Python 3.10+ CLI | ioBroker (npm) | Python 3.10+ · pipx / uvx · stdio + streamable-HTTP for MCP clients (Claude Desktop, Claude Code, custom) | NiceGUI web app · Python 3.10+ | Node-RED palette · npm |
| **Login** | OAuth2 PKCE (browser) | OAuth2 PKCE (browser) | OAuth2 PKCE (browser) | OAuth2 PKCE (browser, one-time) | ◑ shares CLI `bosch_config.json` | ◑ refresh-token from CLI |
| **Snapshots** | ✅ Native `Camera.image` | ✅ `snapshot` command | ✅ File-store + base64 DP | ✅ `bosch_camera_snapshot` (LAN-only) | ✅ live + event fallback | ✅ `snapshot` node |
| **Live RTSP stream (LAN)** | ✅ via HA Stream component | ✅ ffmpeg/RTSPS output | ✅ TLS proxy → local RTSP | ✅ `bosch_camera_stream_url` (LAN-only, no cloud relay) | ◑ internal (go2rtc) | ◑ `stream-url` node (URL only) |
| **WebRTC (sub-second latency)** | ✅ via integrated go2rtc | ✅ *(v10.6.0)* `live --webrtc` | ❌ | ❌ | ✅ via go2rtc (else snapshot) | ❌ |
| **Dual-stream URL (main + sub)** | ✅ `sensor.bosch_<n>_stream_url` + `_sub` *(v12.4.0, opt-in per cam)* | ✅ `info` shows both · `live --sub` *(v10.5.0)* | ✅ `stream_url` + `stream_url_sub` *(v0.5.3 experimental)* | ◑ `bosch_camera_stream_url` — main stream only | ❌ *(sub-stream only)* | ◑ URL only — no sub option |
| **External recorder (BlueIris, Frigate)** | ✅ via go2rtc | ✅ stdout pipe | ✅ Digest-creds URL + LAN bind option | ✅ URL returned, hand off to ffmpeg / go2rtc downstream | ❌ | ◑ `stream-url` → wire downstream |
| **Privacy mode** | ✅ switch entity | ✅ command | ✅ DP | ✅ `bosch_camera_privacy_set` (LAN-fallback via `prefer_local`) | ✅ toggle | ✅ `privacy` node |
| **Front spotlight (Gen1/Gen2)** | ✅ light entity | ✅ command | ✅ DP | ✅ `bosch_camera_light_set` (LAN-fallback) | ❌ *(Phase 2 stub)* | ❌ |
| **RGB wallwasher (Gen2 Outdoor II)** | ✅ light w/ RGB | ◑ on/off only — no RGB | ✅ color + brightness DPs | ❌ *(on/off only — RGB not exposed)* | ❌ | ❌ |
| **Panic-alarm siren** | ✅ button entity *(Gen2 Indoor II)* | ✅ command *(Gen2 Indoor II only)* | ✅ DP | ✅ `bosch_camera_siren_trigger` *(Gen2 Indoor II only)* | ❌ | ❌ |
| **Image rotation 180°** | ✅ switch | ❌ | ✅ DP | ❌ | ❌ | ❌ |
| **Motion / person / audio events** | ✅ FCM push + polling fallback | ◑ `watch` command only (events cmd removed) | ✅ FCM push + polling fallback | ✅ `bosch_camera_events` (on-demand pull) | ◑ pull-only events table | ✅ `event` node (poll) |
| **Motion edge-trigger state** | ✅ `binary_sensor.motion` | n/a | ✅ `motion_active` DP *(v0.5.3)* | n/a *(request-response, no subscription)* | ❌ | ❌ |
| **Auto-snapshot on motion** | ✅ refreshes Camera entity | n/a | ✅ writes `last_event_image` base64 *(v0.5.3)* | n/a *(no background loop)* | ❌ | ❌ |
| **Synthetic motion trigger (external sensor)** | ✅ service | n/a | ✅ DP | ❌ | ❌ | ❌ |
| **Motion zones / privacy masks (read)** | ✅ | ✅ | ✅ read-only *(v1.2.0)* | ❌ | ❌ | ❌ |
| **Automation rules / schedules (read)** | ✅ | ✅ | ◑ read-only count + JSON *(v1.2.0)* | ❌ | ❌ | ❌ |
| **Lighting schedule (read)** | ✅ | ✅ | ✅ read *(Gen1-only, v1.2.0)* | ❌ | ❌ | ❌ |
| **Cloud clip download (history ~30 d)** | ✅ via Media Browser | ❌ | ❌ *(parked — no community request yet)* | ❌ *(intentionally not exposed — large payloads)* | ❌ *(use CLI)* | ◑ `clip_url` in event payload |
| **Mini-NVR (motion-triggered local recording)** | ✅ *(v11.2.0 BETA)* | ✅ *(v10.7.0 BETA)* | ❌ | ❌ | ❌ | ❌ |
| **SMB / NAS clip upload** | ✅ | ✅ *(v10.7.0 BETA)* | ❌ | ❌ | ❌ | ❌ |
| **Camera sharing (friends)** | ✅ services (share / invite / list) | ✅ command | ◑ read-only list *(v1.2.0)* | ❌ *(intentionally not exposed — needs user-driven flow)* | ❌ | ❌ |
| **Pan / tilt (360° Gen1)** | ✅ services | ✅ command | ✅ `pan_position` DP | ✅ `bosch_camera_pan` | ❌ *(Phase 2 stub)* | ❌ |
| **Named pan presets (home / left / right / back-left / back-right)** | ✅ opt-in select entity | ✅ `pan --preset` flag | ✅ `pan_preset` DP | ✅ `bosch_camera_pan preset=` | ❌ | ❌ |
| **Two-way audio / intercom** | ❌ | ✅ command | ❌ | ❌ *(intentionally not exposed — timing-sensitive)* | ❌ | ❌ |
| **Webhook delivery on events** | ✅ service + opt-in options | ✅ `watch --webhook URL` | ✅ via MQTT bridge | ❌ *(request-response model)* | ❌ | ❌ |
| **MQTT event bridge (motion / audio / person)** | n/a *(HA event bus native)* | n/a *(single-run)* | ✅ admin-config | n/a | ❌ | ❌ |
| **Apple HomeKit (via HA Core bridge)** | ✅ documented | n/a | n/a | n/a | n/a | n/a |
| **Snapshot scheduler / time-lapse** | ✅ examples/ YAML | ✅ cron + ffmpeg examples | ✅ Blockly example | n/a | ❌ | ❌ |
| **Native dashboard card / widget** | ✅ 2 Lovelace cards (single + grid) | n/a | ✅ 2 vis-2 widgets — BoschCamera + BoschOverview multi-cam | n/a | ✅ *(is itself a web dashboard)* | ❌ |
| **Cloud-relay REMOTE fallback** | ✅ auto-switch when LAN unreachable | ✅ remote mode | ❌ *(LOCAL-only by design)* | ❌ *(media LAN-only; status/events via cloud)* | ◑ inherits CLI | ◑ REMOTE opt (manual) |
| **Browser-based admin / config UI** | ✅ HA Config Flow | n/a (CLI) | ✅ JSON-config tabs | n/a (LLM-mediated; config via CLI / MCP client) | ✅ Settings page | ◑ editor config node |
| **UI languages** | EN · DE · FR · ES · IT · NL · PL · PT · RU · UK · ZH-Hans *(v12.4.0)* | EN · DE · FR · ES · IT · NL · PL · PT · RU · UK · ZH-Hans *(v10.3.0)* | EN · DE · FR · ES · IT · NL · PL · PT · RU · UK · ZH-CN | n/a *(no UI — LLM is the front-end)* | ◑ backend i18n · UI mostly EN | n/a *(English only)* |

## Related Projects

Part of a five-implementation family for Bosch Smart Home Cameras (plus an alpha frontend):

| Implementation | Repo | Status |
|---|---|---|
| 🏆 Home Assistant Integration | [Bosch-Smart-Home-Camera-Tool-HomeAssistant](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-HomeAssistant) | **v14.4.1** · HA Quality Scale **Platinum** · production-ready |
| 🐍 Python CLI | [Bosch-Smart-Home-Camera-Tool-Python](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python) | **v10.10.4** · Mini-NVR + SMB upload (BETA) · LAN-fallback · PTZ presets · webhook delivery |
| 🟢 ioBroker Adapter | [ioBroker.bosch-smart-home-camera](https://github.com/mosandlt/ioBroker.bosch-smart-home-camera) | **v1.7.7** · stable · npm · MQTT bridge · PTZ presets · VIS-2 widgets (BoschCamera + BoschOverview) |
| 🤖 MCP Server | [Bosch-Smart-Home-Camera-Tool-MCP](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-MCP) | **v1.5.5** · cred-rotation · PTZ presets · TOFU cert pinning · Claude integration |
| 🔴 **Node-RED nodes** (this repo) | [Bosch-Smart-Home-Camera-Tool-NodeRED](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-NodeRED) | **v0.3.0-alpha** · on npm · 8 functional nodes (event / snapshot / privacy / stream-url / light / motion / audio-detection / config) |

Also: [Bosch Smart Home Camera — Python Frontend (NiceGUI)](https://github.com/mosandlt/Bosch-Smart-Home-Camera-Tool-Python-frontend) — **v0.1.5-alpha** — alpha dashboard.

Home Assistant stays the **reference implementation** — features land there first; the other projects catch up over time.

---

## Changelog

Full history in [`CHANGELOG.md`](./CHANGELOG.md). Latest:

### 0.2.3-alpha (2026-06-12)
Fix: Bosch cloud connections failed with `unable to get issuer certificate` after the v0.2.1 TLS hardening. Node has no OpenSSL `PARTIAL_CHAIN` flag, so pinning only the Bosch intermediate could not anchor the chain. Cloud certificates are now verified directly (hostname + validity + system-root chain or pinned-Bosch-CA signature); full MITM protection preserved.

### 0.2.2-alpha (2026-06-11)
New `bosch-camera-stream-url` node — opens a live connection and returns RTSP/RTSPS/HLS stream URL(s) in `msg.payload`; credentials redacted in logs.

### 0.2.1-alpha (2026-06-11)
**Security:** TLS verification for all Bosch cloud calls (CWE-295, GHSA-6qh5-x5m5-vj6v). The cloud REST API and video proxy now validate the Bosch private CA (pinned, plus system roots) instead of accepting any certificate, closing an adjacent-network MITM on OAuth tokens, event data, and snapshots.

### 0.2.0-alpha (2026-06-03)
The four nodes are now functional against the Bosch Smart Home cloud API: config-node refresh-token auth, `/v11/events` polling, cloud-proxy snapshots, and privacy enable/disable/toggle. Shared `nodes/lib/bosch-api.js`, 20 tests, CI on Node 22 + 24, tokenless OIDC npm publishing.

---

## License

MIT — see [LICENSE](./LICENSE)
