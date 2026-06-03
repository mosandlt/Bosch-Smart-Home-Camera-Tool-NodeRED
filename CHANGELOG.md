# Changelog

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
