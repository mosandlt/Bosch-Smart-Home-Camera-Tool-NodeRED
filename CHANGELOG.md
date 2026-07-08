# Changelog

## Unreleased

## [0.2.7-alpha] - 2026-07-08

CI-only fix: the release-workflow job could crash on `gh release edit`, which does not support `--generate-notes` (create-only), and had two smaller hardening gaps.

- **CI:** `gh release edit`/`gh release create` now always pass `--notes-file`, never `--generate-notes` — the same bug that actually crashed the HA repo's Publish-release job on a tag-edit path.
- **CI security:** the release version is now passed to `awk` via `-v` instead of being interpolated into the program text, closing an awk/command-injection vector reachable through the pushed tag name.
- **CI:** a missing `## [VERSION]` CHANGELOG.md section for the tagged release now hard-fails the workflow instead of silently falling back to auto-generated notes.

## [0.2.6-alpha] - 2026-07-03

Docs-only patch: the "Related Projects" table listed sibling-repo versions several releases behind (Home Assistant, Python CLI, ioBroker, MCP Server, and this repo's own self-reference).

- **Docs:** refreshed sibling-repo version references in README.md to current released versions.

## [0.2.5-alpha] - 2026-07-01

Maintenance release: a security fix for a transitive dependency plus CI hardening.

- **Security — `form-data` bumped to 4.0.6 ([GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx)):** versions 4.0.0–4.0.5 (pulled in transitively via `axios`) allowed CRLF injection through unescaped multipart field names/filenames. Resolved via `npm audit fix`. No runtime CVEs (`npm audit --omit=dev`: 0 vulnerabilities).
- **CI:** added a GitHub Release job to the pipeline.

## [0.2.4-alpha] - 2026-06-18

Consistency hardening: the OAuth token refresh now uses the same pinned cloud agent as every other cloud call.

- **NR-N1 — cert-pinning consistency:** `refreshAccessToken()` in `nodes/lib/bosch-api.js` now passes `httpsAgent: boschCloudAgent` to its `axios.post`, matching `getEvents`/`getSnapshot`/`getPrivacy`/`setPrivacy`/`getStreamUrl`. The OAuth host uses a public CA so this was already safe, but the call is now consistent with the rest of the cloud surface. +1 regression test.

## [0.2.3-alpha] - 2026-06-12

Fix: Bosch cloud connections failed to start with `unable to get issuer certificate` after the v0.2.1 TLS hardening (CWE-295).

- **Cloud TLS partial-chain fix:** v0.2.1 pinned only the Bosch "Video CA 2A" intermediate certificate. Node.js has no equivalent of OpenSSL's `PARTIAL_CHAIN` flag (nodejs/node#36453), so it could not anchor the certificate chain at the pinned intermediate and every Bosch cloud handshake failed with `unable to get issuer certificate`. The shared `nodes/lib/bosch-api.js` now verifies cloud certificates directly: the peer is trusted only when the hostname matches, the certificate is within its validity window, and the leaf either chains to a trusted system root (Let's Encrypt OAuth host) or is signed by the pinned Bosch CA. MITM protection from v0.2.1 is fully preserved — self-signed, expired, hostname-mismatch and untrusted-root certificates are still rejected. Verified live against the Bosch cloud; +10 regression tests.

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
