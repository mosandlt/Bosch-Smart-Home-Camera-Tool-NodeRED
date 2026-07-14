# Changelog

## Unreleased

## [0.4.1-alpha] - 2026-07-14

Docs-only release: refreshed the sibling-repo version table in README's
Integration Comparison section. No functional changes.

## [0.4.0-alpha] - 2026-07-13

Feature-parity batch 2: local NVR recording plus firmware status/install —
closing more of the gap against the family's Feature Parity Matrix
(`docs/family-parity-plan.md` §2b).

- **New node `bosch-camera-nvr-record`**: spawns/manages an `ffmpeg`
  subprocess that pulls a camera's local RTSP/RTSPS stream (via the existing
  cloud connection API) and writes it to disk as fixed-length segments
  (`-f segment -c copy`). Continuous mode only — a ring-buffer/pre-roll
  "event buffered" mode was scoped out as it doesn't fit this repo's
  stateless flow-node paradigm. Start/stop via `msg.payload`/`msg.topic`
  (start/stop/on/off/1/0, case-insensitive) or autostart-on-deploy. A small
  state machine (idle → starting → recording → stopping) plus a
  `cancelRequested` flag guards every transition so overlapping start/stop
  messages, and node close (undeploy/redeploy) firing mid-flight, can never
  leak an untracked ffmpeg process or double-spawn one. SIGTERM → SIGKILL
  escalation on stop/close, with a hard safety-net timer so undeploy never
  blocks indefinitely on an unkillable process.
- **New node `bosch-camera-firmware-status`** (query, read-only): `GET
  /v11/video_inputs/{id}/firmware`, normalises the wire response
  (current/upToDate/update/updating/status) into
  `installedVersion`/`latestVersion`/`upToDate`/`updating`/`status`.
- **New node `bosch-camera-firmware-install`** (action): `PUT
  /v11/video_inputs/{id}/firmware {"id": <latestVersion>}`, ported
  byte-accurate against the sibling HA integration's endpoint/field contract.
  Triggers a real camera reboot (~3-7 min), so it only proceeds when
  `msg.payload` is strictly `{confirm: true}` — any other input is rejected
  before any network call. Always re-reads firmware status fresh before
  installing and refuses to PUT when the camera already reports `updating`
  or is already up to date (reported as a non-error `triggered: false`
  output, not a flow error). A local busy-guard blocks a second install for
  the same node instance while one is still in flight.
- `bosch-api`: added `getFirmware()`/`installFirmware()` wrappers, same
  TLS-pinned/timeout-guarded pattern as every existing function.
- 46 new tests (nvr-record: 28, firmware-status/install: 18), 100% line
  coverage on all three new nodes. Every change hardened via
  THREE_PER_ISSUE_PER_CHANGE adversarial sub-agent bug-hunts before release
  (nvr-record: 3 rounds, fixed a concurrent-start double-spawn race, a stop
  escalation-timer reset bug, a false "already recording" report during an
  in-flight stop, close-during-transition handling, and a test-infra flake;
  firmware nodes: node logic/editor-help/API-contract review, no bugs found).

## [0.3.0-alpha] - 2026-07-11

Feature-parity batch 1: 3 new nodes covering camera light control, motion
detection, and glass-break/fire-alarm sound detection — closing part of the
gap against the family's Feature Parity Matrix (`docs/family-parity-plan.md` §2b).

- **New node `bosch-camera-light`**: reads or sets the front-illuminator /
  wallwasher light state (`GET`/`PUT /v11/video_inputs/{id}/lighting_override`,
  read-modify-write). Fixed on/off presets plus a `msg.payload` patch mode
  (`frontLightOn`/`wallwasherOn`/`frontLightIntensity`, a 0.0-1.0 fraction).
  Wallwasher is cloud-write-only — no LAN/RCP fallback exists for it.
- **New node `bosch-camera-motion`**: reads or sets motion detection
  (`GET`/`PUT /v11/video_inputs/{id}/motion`) — enable/disable plus sensitivity
  (`OFF`/`LOW`/`MEDIUM_LOW`/`MEDIUM_HIGH`/`HIGH`/`SUPER_HIGH`). Setting a
  sensitivity implicitly enables motion detection (Bosch-side behaviour).
- **New node `bosch-camera-audio-detection`**: reads or sets glass-break /
  fire-and-smoke-alarm sound detection (`GET`/`PUT /v11/video_inputs/{id}/audioDetectionConfig`,
  Gen2 Audio-Plus cameras only). Both fields are always sent together on write
  (the node reads current state first and merges, since Bosch resets an
  omitted field to `false` server-side).
- `bosch-api`: added `getLight`/`setLight`, `getMotion`/`setMotion`,
  `getAudioDetection`/`setAudioDetection` — same TLS-pinned, timeout-guarded
  pattern as every existing wrapper function.
- 21 new tests (happy + error paths per node, `node-red-node-test-helper` + `nock`),
  including an explicit `frontLightIntensity: 0` regression (minimum brightness
  must not be mistaken for "unset").

**Deliberately out of scope for this release** (documented, not silently
dropped — see the session notes in `docs/family-parity-plan.md`): lighting
schedule, wifi/network info, diagnostics, unread count, zones/masks, and
rules/friends are planned for a follow-up batch. Two-way intercom, pan/PTZ,
the full alarm suite, and NVR/recording browse are deliberately skipped —
their session/stateful nature doesn't map cleanly onto Node-RED's
fire-and-forget node model; revisit only on a concrete user request.

## [0.2.8-alpha] - 2026-07-11

CI uplift to match the family's Gold-tier quality bar (HA integration / MCP reference).

- **Coverage:** added `c8` coverage measurement (`npm run coverage`), wired into the `test`
  CI job. Gated at 85% lines / 70% functions / 75% branches (set just below the measured
  baseline of 92%/77%/83%, not invented).
- **CI:** new `codeql.yml` (CodeQL `javascript-typescript`, `security-extended` queries,
  weekly scheduled scan).
- **CI:** new `secret-scan.yml` (gitleaks) + `.gitleaks.toml` — allowlists this repo's known
  intentional non-secrets (the public OSS-app OAuth client_id/secret pair and the pinned
  Bosch TLS CA certificate in `nodes/lib/bosch-api.js`, both already documented in-code as
  non-sensitive) without blinding the scanner to anything else.
- **CI:** new `dependency-review.yml`, gated on `package.json`/`package-lock.json` diffs in
  PRs, fails on high-severity advisories.
- No functional/runtime changes. `npm audit --omit=dev`: 0 vulnerabilities.

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
