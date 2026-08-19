// bosch-camera-postroll-capture.js
// Action node: on an incoming message, opens the camera's local RTSP/RTSPS
// stream and captures a single BOUNDED clip (N seconds starting now) to a
// file, using ffmpeg's own `-t` duration flag — then emits the file path
// once the capture has finished.
//
// SCOPE: this is a one-shot "record N seconds starting now" capture, NOT
// the sibling HA integration's `nvr_postroll_seconds` ring-buffer/pre-roll
// design (which derives its post-roll tail from an already-running
// continuous pre-roll recorder — a stateful, long-running supervisor that
// does not fit this repo's stateless message-in/message-out flow-node
// paradigm, same reasoning as bosch-camera-nvr-record's continuous-only
// scoping). This node is a simpler, event-triggered analogue: wire it to a
// motion/person event (e.g. from bosch-camera-event) to get a bounded clip
// starting at that moment.
//
// ffmpeg codec/argv choices mirror the sibling HA integration's
// `bosch_shc_camera_client.mini_nvr.build_preroll_ffmpeg_args` (same
// -analyzeduration/-probesize 10M robustness fix for GitHub #64's rc=234
// codec-probe failure, same -c copy no-re-encode + -movflags +faststart)
// so output files are consistent with what HA's Mini-NVR produces —
// adapted here for a single bounded `-t <seconds>` output file instead of
// `-f segment` ring writing.
//
// Input:  any msg triggers a capture (payload is not inspected).
// Output: msg.payload = { cam, file, seconds, connectionType, quality }
//
// A capture already in progress rejects a new trigger with an error rather
// than queueing or overlapping — a single ffmpeg per node instance, matching
// bosch-camera-nvr-record's "no double-spawn" guarantee.
//
// SECURITY: the RTSP(S) URL used to launch ffmpeg may embed Digest
// credentials in its userinfo component — it is NEVER logged raw, only its
// redacted form (***:***@) appears in node status/log.

const path = require('path');
const childProcess = require('child_process');
const api = require('./lib/bosch-api');

const DEFAULT_SECONDS = 10;
const MIN_SECONDS = 1;
const MAX_SECONDS = 60;
const DEFAULT_STOP_GRACE_MS = 5000;
const MIN_STOP_GRACE_MS = 50;
// Hard safety margin on top of `-t <seconds>` before this node gives up
// waiting for ffmpeg to exit on its own and force-kills it — covers a slow
// network/mux flush, not just the capture duration itself.
const FFMPEG_EXIT_MARGIN_MS = 15000;

function parseIntOrDefault(raw, fallback) {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
}

// Filesystem-safe timestamp for the output filename: ISO-8601 with ':' and
// '.' replaced so it's valid on Windows/macOS/Linux alike.
function safeTimestamp(date) {
    return date.toISOString().replace(/[:.]/g, '-');
}

module.exports = function (RED) {
    function BoschCameraPostrollCaptureNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.connectionType = config.connectionType || 'LOCAL'; // 'LOCAL' | 'REMOTE'
        node.quality = config.quality || 'auto'; // 'auto' | 'high' | 'low'
        node.outputDir = config.outputDir;
        node.ffmpegPath = config.ffmpegPath || 'ffmpeg';

        let seconds = parseIntOrDefault(config.seconds, DEFAULT_SECONDS);
        if (seconds < MIN_SECONDS) { seconds = MIN_SECONDS; }
        if (seconds > MAX_SECONDS) { seconds = MAX_SECONDS; }

        let stopGraceMs = parseIntOrDefault(config.stopGraceMs, DEFAULT_STOP_GRACE_MS);
        if (stopGraceMs < MIN_STOP_GRACE_MS) { stopGraceMs = MIN_STOP_GRACE_MS; }

        // Injectable for tests — real child_process.spawn in production.
        node._spawn = childProcess.spawn;

        let capturing = false;
        let child = null;
        let closed = false;

        if (!node.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch config node selected');
            return;
        }
        if (!node.outputDir) {
            node.status({ fill: 'red', shape: 'ring', text: 'no output dir' });
            node.error('No output directory configured');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        function buildArgs(streamUrl, outputPath, secs) {
            return [
                '-y',
                '-hide_banner',
                '-nostdin',
                '-loglevel', 'warning',
                '-rtsp_transport', 'tcp',
                // Same rc=234 codec-probe robustness fix as the sibling HA
                // integration's Mini-NVR pre-roll ring (GitHub #64) — a
                // concurrent RTSP session against the same camera can need
                // more than ffmpeg's 5s/5MB default probe window.
                '-analyzeduration', '10M',
                '-probesize', '10M',
                '-i', streamUrl,
                '-map', '0', // video + audio, no re-encode
                '-c', 'copy',
                '-t', String(secs),
                '-movflags', '+faststart',
                outputPath
            ];
        }

        node.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            if (capturing) {
                node.status({ fill: 'red', shape: 'ring', text: 'capture in progress' });
                done(new Error('bosch-camera-postroll-capture: a capture is already in progress — retry after it finishes'));
                return;
            }

            const camId = msg.cameraId || node.cameraId;
            if (!camId) {
                node.status({ fill: 'red', shape: 'ring', text: 'no camera id' });
                done(new Error('no camera id (set Camera ID or msg.cameraId)'));
                return;
            }

            const connType = msg.connectionType || node.connectionType || 'LOCAL';
            const quality = msg.quality || node.quality || 'auto';
            const secs = (function () {
                const n = parseIntOrDefault(msg.seconds, seconds);
                if (n < MIN_SECONDS) { return MIN_SECONDS; }
                if (n > MAX_SECONDS) { return MAX_SECONDS; }
                return n;
            }());

            capturing = true;
            node.status({ fill: 'blue', shape: 'dot', text: 'opening stream...' });

            node.server.getAccessToken()
                .then(function (token) { return api.getStreamUrl(token, camId, connType, quality); })
                .then(function (result) {
                    const streamUrl = result.rtsps || result.rtsp;
                    if (!streamUrl) {
                        throw new Error('stream connection returned no RTSP(S) URL (HLS-only cameras cannot be captured via ffmpeg)');
                    }
                    if (closed) {
                        // Node torn down while the cloud connection was
                        // still being negotiated — never spawn ffmpeg.
                        capturing = false;
                        return;
                    }

                    const outputPath = path.join(
                        node.outputDir,
                        `postroll-${camId}-${safeTimestamp(new Date())}.mp4`
                    );
                    const args = buildArgs(streamUrl, outputPath, secs);
                    const logUrl = api.redactStreamUrl(streamUrl);

                    node.status({ fill: 'blue', shape: 'dot', text: `capturing ${secs}s...` });
                    node.log(`bosch-camera-postroll-capture: capturing ${secs}s from ${logUrl} -> ${outputPath}`);

                    const spawned = node._spawn(node.ffmpegPath, args);
                    child = spawned;

                    let stderrTail = '';
                    if (spawned.stderr) {
                        spawned.stderr.on('data', function (chunk) {
                            stderrTail = (stderrTail + chunk.toString()).slice(-2000);
                        });
                    }

                    // Hard safety net: ffmpeg's own `-t` bounds the capture,
                    // but a stuck mux/flush or a hung process must not block
                    // this node forever — force-kill after seconds + margin.
                    const hardTimer = setTimeout(function () {
                        if (child === spawned) {
                            try { spawned.kill('SIGKILL'); } catch { /* already gone */ }
                        }
                    }, secs * 1000 + stopGraceMs + FFMPEG_EXIT_MARGIN_MS);

                    spawned.on('error', function (err) {
                        if (child !== spawned) { return; }
                        clearTimeout(hardTimer);
                        child = null;
                        capturing = false;
                        if (closed) { return; }
                        node.status({ fill: 'red', shape: 'ring', text: 'ffmpeg error: ' + err.message });
                        done(new Error('bosch-camera-postroll-capture: ffmpeg failed to start/run: ' + err.message));
                    });

                    spawned.on('exit', function (code) {
                        if (child !== spawned) { return; }
                        clearTimeout(hardTimer);
                        child = null;
                        capturing = false;
                        if (closed) { return; }

                        if (code !== 0) {
                            node.status({ fill: 'red', shape: 'ring', text: 'ffmpeg exit ' + code });
                            done(new Error(
                                'bosch-camera-postroll-capture: ffmpeg exited with code ' + code +
                                (stderrTail ? (' — ' + stderrTail.trim().slice(-300)) : '')
                            ));
                            return;
                        }

                        node.status({ fill: 'green', shape: 'dot', text: 'idle' });
                        send(Object.assign({}, msg, {
                            payload: {
                                cam: camId,
                                file: outputPath,
                                seconds: secs,
                                connectionType: connType,
                                quality: quality
                            }
                        }));
                        done();
                    });
                })
                .catch(function (err) {
                    capturing = false;
                    if (closed) { return; }
                    node.status({ fill: 'red', shape: 'ring', text: err.message });
                    done(err);
                });
        });

        node.on('close', function (done) {
            closed = true;
            if (!child) {
                node.status({});
                done();
                return;
            }
            const target = child;
            let finished = false;
            let hardTimer = null;
            function finish() {
                if (finished) { return; }
                finished = true;
                if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
                done();
            }
            target.once('exit', finish);
            try { target.kill('SIGTERM'); } catch { /* already gone */ }
            hardTimer = setTimeout(function () {
                try { target.kill('SIGKILL'); } catch { /* already gone */ }
            }, stopGraceMs);
            // Absolute safety net so undeploy never blocks indefinitely.
            setTimeout(finish, stopGraceMs + 1000);
        });
    }

    RED.nodes.registerType('bosch-camera-postroll-capture', BoschCameraPostrollCaptureNode);
};
