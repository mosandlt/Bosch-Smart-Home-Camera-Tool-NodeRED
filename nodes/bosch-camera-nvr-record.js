// bosch-camera-nvr-record.js
// Action node: continuous local NVR recording — spawns an ffmpeg subprocess
// that pulls the camera's local RTSP/RTSPS stream and writes it to disk as
// fixed-length segments (-f segment -c copy, no re-encode).
//
// SCOPE: "continuous" mode only. A ring-buffer / pre-roll-postroll "event
// buffered" mode (like the sibling HA integration's Mini-NVR) does not fit
// this repo's stateless message-in/message-out flow-node paradigm and was
// deliberately scoped out.
//
// Input:  msg.payload = 'start' | 'stop' (also accepts true/false/on/off/1/0,
//         case-insensitive). msg.topic is checked FIRST using the same
//         normalisation rules — when it yields a recognised command it takes
//         precedence over msg.payload; otherwise msg.payload is used.
// Output: msg.payload = { cam, recording: boolean, pid: number|null, outputDir }
//
// Lifecycle: `autostart` (config) spawns ffmpeg once on deploy. A 'stop'
// message or node close (undeploy/redeploy) sends SIGTERM, escalating to
// SIGKILL after `stopGraceMs` if the process hasn't exited by itself.
//
// A small state machine (idle -> starting -> recording -> stopping -> idle)
// guards every transition so that two 'start' messages arriving before the
// first has finished opening the cloud stream connection can never spawn two
// concurrent ffmpeg processes (the actual spawn only happens after two
// awaited network calls), and so that repeated 'stop' messages can't keep
// pushing back the SIGTERM->SIGKILL escalation deadline forever.
//
// SECURITY: the RTSP(S) URL used to launch ffmpeg may embed Digest
// credentials in its userinfo component — it is NEVER logged raw, only its
// redacted form (***:***@) appears in node status/log.

const path = require('path');
const childProcess = require('child_process');
const api = require('./lib/bosch-api');

const DEFAULT_SEGMENT_TIME_S = 300;
const MIN_SEGMENT_TIME_S = 10;
const DEFAULT_STOP_GRACE_MS = 5000;
const MIN_STOP_GRACE_MS = 50;

// Normalises a start/stop command from a raw msg.topic/msg.payload value.
// Returns 'start', 'stop', or null when unrecognised. Case-insensitive for
// strings; also accepts boolean/numeric truthy-start / falsy-stop shorthand.
function normaliseCommand(raw) {
    if (raw === true || raw === 1 || raw === '1') { return 'start'; }
    if (raw === false || raw === 0 || raw === '0') { return 'stop'; }
    if (typeof raw === 'string') {
        const lower = raw.toLowerCase();
        if (lower === 'start' || lower === 'on') { return 'start'; }
        if (lower === 'stop' || lower === 'off') { return 'stop'; }
    }
    return null;
}

// parseInt-with-default that treats an explicit 0 (or other falsy-but-valid
// number) as intentional, unlike `parseInt(x, 10) || fallback` which would
// silently discard it.
function parseIntOrDefault(raw, fallback) {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
}

module.exports = function (RED) {
    function BoschCameraNvrRecordNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.connectionType = config.connectionType || 'LOCAL'; // 'LOCAL' | 'REMOTE'
        node.outputDir = config.outputDir;
        node.ffmpegPath = config.ffmpegPath || 'ffmpeg';
        node.autostart = !!config.autostart;

        let segmentTime = parseIntOrDefault(config.segmentTime, DEFAULT_SEGMENT_TIME_S);
        if (segmentTime < MIN_SEGMENT_TIME_S) { segmentTime = MIN_SEGMENT_TIME_S; }

        let stopGraceMs = parseIntOrDefault(config.stopGraceMs, DEFAULT_STOP_GRACE_MS);
        if (stopGraceMs < MIN_STOP_GRACE_MS) { stopGraceMs = MIN_STOP_GRACE_MS; }

        // Injectable for tests — real child_process.spawn in production.
        node._spawn = childProcess.spawn;

        // State machine: 'idle' -> 'starting' -> 'recording' -> 'stopping' -> 'idle'.
        // Every input handler and event listener below checks/sets `state`
        // instead of just null-checking `child`, so overlapping start/stop
        // messages can never race into a double-spawn or a doubly-scheduled
        // kill-escalation timer.
        let state = 'idle';
        let child = null;          // active ffmpeg subprocess (set once 'recording')
        let stopTimer = null;      // SIGTERM -> SIGKILL escalation timer
        let cancelRequested = false; // a 'stop' arrived while still 'starting'
        let closed = false;        // true once the node has been closed

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

        function segmentFilenamePattern() {
            return path.join(node.outputDir, '%Y%m%d-%H%M%S.mp4');
        }

        function clearStopTimer() {
            if (stopTimer) {
                clearTimeout(stopTimer);
                stopTimer = null;
            }
        }

        // Sends SIGTERM to the given child, escalating to SIGKILL after
        // stopGraceMs if it's still the active child and hasn't exited yet.
        // Callers must only invoke this once per stop (guarded by `state`
        // transitioning to 'stopping') so repeated 'stop' messages can't keep
        // pushing the escalation deadline back indefinitely.
        function killChild(target) {
            try { target.kill('SIGTERM'); } catch { /* already gone */ }
            clearStopTimer();
            stopTimer = setTimeout(function () {
                if (child === target) {
                    try { target.kill('SIGKILL'); } catch { /* already gone */ }
                }
            }, stopGraceMs);
        }

        function startRecording(msg, send, done) {
            const camId = msg.cameraId || node.cameraId;

            if (state === 'recording') {
                // Idempotent: already recording, report current state.
                node.status({ fill: 'green', shape: 'dot', text: 'recording' });
                send(Object.assign({}, msg, {
                    payload: { cam: camId, recording: true, pid: child.pid, outputDir: node.outputDir }
                }));
                done();
                return;
            }
            if (state === 'starting') {
                // A start is already opening the stream connection — don't
                // fire a second cloud call / spawn a second ffmpeg for it.
                node.status({ fill: 'blue', shape: 'dot', text: 'opening stream...' });
                send(Object.assign({}, msg, {
                    payload: { cam: camId, recording: true, pid: null, outputDir: node.outputDir }
                }));
                done();
                return;
            }
            if (state === 'stopping') {
                node.status({ fill: 'red', shape: 'ring', text: 'stop in progress' });
                done(new Error('bosch-camera-nvr-record: cannot start while a stop is still in progress — retry shortly'));
                return;
            }

            if (!camId) {
                node.status({ fill: 'red', shape: 'ring', text: 'no camera id' });
                done(new Error('no camera id (set Camera ID or msg.cameraId)'));
                return;
            }

            const connType = msg.connectionType || node.connectionType || 'LOCAL';

            state = 'starting';
            cancelRequested = false;
            node.status({ fill: 'blue', shape: 'dot', text: 'opening stream...' });

            node.server.getAccessToken()
                .then(function (token) { return api.getStreamUrl(token, camId, connType); })
                .then(function (result) {
                    const streamUrl = result.rtsps || result.rtsp;
                    if (!streamUrl) {
                        throw new Error('stream connection returned no RTSP(S) URL (HLS-only cameras cannot be recorded via ffmpeg segment)');
                    }

                    if (cancelRequested) {
                        // A 'stop' arrived while we were still waiting on the
                        // cloud connection (or the node was closed/undeployed
                        // mid-flight — the close handler also sets this flag)
                        // — honour it and never spawn ffmpeg at all, instead
                        // of starting a process we'd have to immediately kill
                        // (or worse, leaking it untracked after close()).
                        cancelRequested = false;
                        state = 'idle';
                        if (closed) {
                            // Node already torn down — don't touch its status
                            // widget or emit further messages, just make sure
                            // ffmpeg never spawns (already guaranteed above).
                            return;
                        }
                        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });
                        send(Object.assign({}, msg, {
                            payload: { cam: camId, recording: false, pid: null, outputDir: node.outputDir }
                        }));
                        done();
                        return;
                    }

                    const args = [
                        '-y',
                        '-rtsp_transport', 'tcp',
                        '-i', streamUrl,
                        '-c', 'copy',
                        '-f', 'segment',
                        '-segment_time', String(segmentTime),
                        '-reset_timestamps', '1',
                        '-strftime', '1',
                        segmentFilenamePattern()
                    ];

                    const spawned = node._spawn(node.ffmpegPath, args);
                    child = spawned;
                    state = 'recording';

                    const logUrl = api.redactStreamUrl(streamUrl);
                    node.status({ fill: 'green', shape: 'dot', text: 'recording' });
                    node.log('bosch-camera-nvr-record: started ffmpeg (pid ' + spawned.pid + ') for ' + logUrl);

                    spawned.on('error', function (err) {
                        if (child !== spawned) { return; }
                        child = null;
                        state = 'idle';
                        clearStopTimer();
                        node.status({ fill: 'red', shape: 'ring', text: 'ffmpeg error: ' + err.message });
                        node.error('bosch-camera-nvr-record: ffmpeg failed to start/run: ' + err.message);
                    });

                    spawned.on('exit', function (code, signal) {
                        if (child !== spawned) { return; }
                        const wasStopping = state === 'stopping';
                        child = null;
                        state = 'idle';
                        clearStopTimer();
                        if (closed) { return; }
                        if (wasStopping) {
                            node.status({ fill: 'grey', shape: 'dot', text: 'idle' });
                        } else {
                            node.status({ fill: 'red', shape: 'ring', text: 'stopped (code ' + code + ')' });
                            node.error('bosch-camera-nvr-record: ffmpeg exited unexpectedly (code=' + code + ', signal=' + signal + ')');
                        }
                    });

                    send(Object.assign({}, msg, {
                        payload: { cam: camId, recording: true, pid: spawned.pid, outputDir: node.outputDir }
                    }));
                    done();
                })
                .catch(function (err) {
                    state = 'idle';
                    cancelRequested = false;
                    if (closed) {
                        // Node already torn down while the cloud connection
                        // was still being negotiated — nothing left to spawn
                        // or clean up, don't touch the (destroyed) node.
                        return;
                    }
                    node.status({ fill: 'red', shape: 'ring', text: err.message });
                    done(err);
                });
        }

        function stopRecording(msg, send, done) {
            const camId = msg.cameraId || node.cameraId;

            if (state === 'idle') {
                node.status({ fill: 'grey', shape: 'dot', text: 'idle' });
                send(Object.assign({}, msg, {
                    payload: { cam: camId, recording: false, pid: null, outputDir: node.outputDir }
                }));
                done();
                return;
            }
            if (state === 'starting') {
                // Nothing spawned yet — flag it so the in-flight start aborts
                // before ever launching ffmpeg (see cancelRequested above).
                cancelRequested = true;
                node.status({ fill: 'blue', shape: 'dot', text: 'stopping...' });
                send(Object.assign({}, msg, {
                    payload: { cam: camId, recording: false, pid: null, outputDir: node.outputDir }
                }));
                done();
                return;
            }
            if (state === 'stopping') {
                // Already stopping — report the same outcome without
                // re-sending a signal or resetting the SIGKILL escalation
                // deadline (repeated 'stop' messages must not keep pushing
                // it back indefinitely).
                node.status({ fill: 'blue', shape: 'dot', text: 'stopping...' });
                send(Object.assign({}, msg, {
                    payload: { cam: camId, recording: false, pid: child ? child.pid : null, outputDir: node.outputDir }
                }));
                done();
                return;
            }

            // state === 'recording'
            const pid = child.pid;
            state = 'stopping';
            node.status({ fill: 'blue', shape: 'dot', text: 'stopping...' });
            killChild(child);
            send(Object.assign({}, msg, {
                payload: { cam: camId, recording: false, pid: pid, outputDir: node.outputDir }
            }));
            done();
        }

        node.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            const cmd = normaliseCommand(msg.topic) || normaliseCommand(msg.payload);

            if (cmd === 'start') {
                startRecording(msg, send, done);
            } else if (cmd === 'stop') {
                stopRecording(msg, send, done);
            } else {
                node.status({ fill: 'red', shape: 'ring', text: 'bad command' });
                done(new Error('bosch-camera-nvr-record: unrecognised command (msg.payload/msg.topic must be "start" or "stop")'));
            }
        });

        if (node.autostart) {
            setImmediate(function () {
                if (closed) { return; }
                startRecording({}, function (m) { node.send(m); }, function (err) {
                    if (err) { node.error('bosch-camera-nvr-record: autostart failed: ' + err.message); }
                });
            });
        }

        node.on('close', function (done) {
            closed = true;

            if (state === 'starting') {
                // A start is still opening the cloud connection (no child
                // exists yet). The pending promise chain checks this flag
                // right before it would otherwise spawn ffmpeg and aborts
                // instead — without this, close() would return immediately
                // (nothing to kill yet) while the in-flight start could still
                // spawn an untracked, unkillable ffmpeg process afterwards.
                cancelRequested = true;
            }

            if (!child) {
                // 'idle', or 'starting' with the abort above now guaranteed
                // to prevent a spawn — nothing to wait for.
                clearStopTimer();
                node.status({});
                done();
                return;
            }

            // state is 'recording' or 'stopping' — a real ffmpeg child
            // exists; make sure it is (being) killed and wait for it to
            // actually exit before letting Node-RED consider undeploy done.
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
            if (state === 'recording') {
                // First signal for this child. If it was already 'stopping',
                // stopRecording() already sent SIGTERM and armed the
                // escalation timer — don't re-signal or re-arm it here
                // (matches the message-level stop dedupe in stopRecording()).
                state = 'stopping';
                killChild(target);
            }
            // Hard safety net: never block Node-RED's undeploy indefinitely
            // even if the ffmpeg subprocess becomes unkillable (e.g.
            // zombie/defunct), or if it was already 'stopping' and its
            // existing escalation timer already fired SIGKILL without the
            // process actually dying.
            hardTimer = setTimeout(finish, stopGraceMs + 1000);
        });
    }

    RED.nodes.registerType('bosch-camera-nvr-record', BoschCameraNvrRecordNode);
};
