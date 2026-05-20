# Changelog

## 0.1.0-alpha (2026-05-20)

Initial skeleton release.

- `bosch-camera-config` — config node: stores SHC host + credentials securely via Node-RED credentials API
- `bosch-camera-event` — input node: emits `msg.payload = {cam, event_type, timestamp}` on motion/alarm/person events (Phase 2: SSE subscription)
- `bosch-camera-snapshot` — action node: incoming msg triggers snapshot fetch, outputs JPEG Buffer (Phase 2: HTTP request)
- `bosch-camera-privacy` — action node: enables/disables privacy mode via `msg.payload` or fixed setting (Phase 2: HTTP PUT)

Note: all HTTP communication is stubbed. Nodes register correctly in Node-RED and display status indicators, but no actual SHC calls are made yet.
