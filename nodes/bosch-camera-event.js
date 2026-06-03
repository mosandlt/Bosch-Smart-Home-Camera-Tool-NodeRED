// bosch-camera-event.js
// Input node: polls the Bosch cloud /v11/events endpoint and emits one message
// per *new* camera event.
//
// Output:  msg.payload = {
//     cam: string, event_type: string, timestamp: string,
//     image_url: string, clip_url: string, raw: object
// }
//
// The cloud API has no push/SSE for OSS clients, so this polls on an interval
// (default 30 s, min 10 s to protect the cloud). Events already emitted are
// tracked by id so each one fires at most once.

const api = require('./lib/bosch-api');

const MIN_INTERVAL_S = 10;
const SEEN_CAP = 500;

module.exports = function (RED) {
    function BoschCameraEventNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.limit = parseInt(config.limit, 10) || 5;

        let interval = parseInt(config.interval, 10) || 30;
        if (interval < MIN_INTERVAL_S) {
            interval = MIN_INTERVAL_S;
        }

        if (!node.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch config node selected');
            return;
        }
        if (!node.cameraId) {
            node.status({ fill: 'red', shape: 'ring', text: 'no camera id' });
            node.error('No camera ID configured');
            return;
        }

        const seen = new Set();
        let primed = false;
        let timer = null;
        let stopped = false;

        async function poll() {
            try {
                const token = await node.server.getAccessToken();
                const events = await api.getEvents(token, node.cameraId, node.limit);
                // A poll may still be mid-flight when the node is closed/redeployed;
                // don't emit or touch status on a node being torn down.
                if (stopped) { return; }
                // First successful poll only establishes a baseline — existing
                // events are recorded but NOT emitted, so a restart never replays
                // history into downstream automations.
                if (!primed) {
                    events.forEach(function (e) { if (e && e.id) { seen.add(e.id); } });
                    primed = true;
                    node.status({ fill: 'green', shape: 'dot', text: 'polling (' + interval + 's)' });
                    return;
                }
                // API is newest-first; emit oldest-first so downstream order is chronological.
                const fresh = events
                    .filter(function (e) { return e && e.id && !seen.has(e.id); })
                    .reverse();
                fresh.forEach(function (e) {
                    seen.add(e.id);
                    node.send({
                        topic: 'bosch/camera/event',
                        payload: {
                            cam: node.cameraId,
                            event_type: e.eventType,
                            timestamp: e.timestamp,
                            image_url: e.imageUrl,
                            clip_url: e.videoClipUrl,
                            raw: e
                        }
                    });
                });
                // Bound memory: once the seen-set grows large, keep only the ids
                // still present in the latest response.
                if (seen.size > SEEN_CAP) {
                    seen.clear();
                    events.forEach(function (e) { if (e && e.id) { seen.add(e.id); } });
                }
                node.status({ fill: 'green', shape: 'dot', text: 'polling (' + interval + 's)' });
            } catch (err) {
                if (stopped) { return; }
                node.status({ fill: 'red', shape: 'ring', text: err.message });
                node.error('bosch-camera-event poll failed: ' + err.message);
            }
        }

        // Exposed for tests; also drives the interval.
        node.poll = poll;

        node.status({ fill: 'grey', shape: 'ring', text: 'starting...' });
        timer = setInterval(function () { if (!stopped) { poll(); } }, interval * 1000);
        setImmediate(function () { if (!stopped) { poll(); } });

        node.on('close', function (done) {
            stopped = true;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-event', BoschCameraEventNode);
};
