# Changelog

## Unreleased

## [0.2.2-alpha] - 2026-06-11

New node `bosch-camera-stream-url` — opens a live connection and returns the RTSP/RTSPS/HLS stream URL(s) in msg.payload (cloud TLS-pinned; embedded credentials redacted in logs).

- **New node `bosch-camera-stream-url`**: opens a live stream connection
  (`PUT /v11/video_inputs/{id}/connection`) and emits RTSP, RTSPS, and HLS
  stream URLs in `msg.payload`. Supports `REMOTE` (cloud proxy, default) and
  `LOCAL` (LAN) connection types. Camera ID and connection type can be overridden
  at runtime via `msg.cameraId` / `msg.connectionType`. URLs embedding Digest
  credentials are never logged raw — only the redacted form (`***:***@`) appears
  in node status and logs.
- `bosch-api`: added `getStreamUrl()` and `redactStreamUrl()` helpers.

## 0.2.1-alpha (2026-06-11)

**Security:** Verify TLS for all Bosch cloud calls (CWE-295, GHSA-6qh5-x5m5-vj6v).

The shared `nodes/lib/bosch-api.js` previously used `rejectUnauthorized: false`,
accepting any certificate for all HTTPS calls to `residential.cbs.boschsecurity.com`
and the cloud video proxy. An adjacent-network attacker could intercept OAuth tokens,
event data, and snapshots via a self-signed certificate.

**Fix:** replaced the insecure agent with a pinned `https.Agent` that trusts both system
roots (Let's Encrypt, used by Keycloak/OAuth) and the private Bosch Video CA 2A (used by
the snapshot proxy), and nothing else.

## 0.2.0-alpha (2026-06-03)

Phase 5 — the four nodes are now functional against the Bosch Smart Home **cloud** API
(`residential.cbs.boschsecurity.com` /v11), verified against the Python CLI.

- `bosch-camera-config` — reworked to hold a Bosch SingleKey ID **refresh token** and mint
  cached, auto-refreshing access tokens (Keycloak `refresh_token` grant). Replaces the earlier
  SHC host/email/password skeleton.
- `bosch-camera-event` — real polling of `GET /v11/events` (configurable interval ≥10 s and
  per-poll limit); emits one message per new event, deduplicated by id; now exposes
  `image_url`/`clip_url`/`raw`.
- `bosch-camera-snapshot` — live snapshot via the cloud REMOTE proxy (PUT connection → GET JPEG).
- `bosch-camera-privacy` — enable/disable plus a working **toggle** (reads current state, flips it)
  via `GET`/`PUT /v11/video_inputs/<id>/privacy`.
- Shared `nodes/lib/bosch-api.js` wrapper (no Node-RED dependency, unit-testable).
- Tests: per-node happy + error paths via `node-red-node-test-helper` + `nock`, plus a lib spec
  (19 specs). CI now runs the real suite on Node 22 + 24.

## 0.1.0-alpha (2026-05-20)

Initial skeleton release.

- `bosch-camera-config` — config node: stores SHC host + credentials securely via Node-RED credentials API
- `bosch-camera-event` — input node: emits `msg.payload = {cam, event_type, timestamp}` on motion/alarm/person events (Phase 2: SSE subscription)
- `bosch-camera-snapshot` — action node: incoming msg triggers snapshot fetch, outputs JPEG Buffer (Phase 2: HTTP request)
- `bosch-camera-privacy` — action node: enables/disables privacy mode via `msg.payload` or fixed setting (Phase 2: HTTP PUT)

Note: all HTTP communication is stubbed. Nodes register correctly in Node-RED and display status indicators, but no actual SHC calls are made yet.
