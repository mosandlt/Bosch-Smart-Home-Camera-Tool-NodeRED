// bosch-camera-ai-analysis.js
// Action node: on an incoming message, fetches one or more live snapshots
// for a camera and emits them together with a ready-to-use prompt +
// structured-output schema for an AI/vision analysis — mirroring the
// sibling HA integration's `analyze_camera_ai` service (1-10 suspicion
// score + fields).
//
// DESIGN CHOICE (documented per the family-parity port request): this node
// does NOT call any AI/LLM provider itself. HA's own `analyze_camera_ai`
// service does the same separation — it never embeds an LLM client, it
// delegates entirely to HA's own separately-configured `ai_task` integration
// (`ai_analysis.py`'s `async_generate_ai_analysis` calls
// `hass.services.async_call("ai_task", "generate_data", ...)`, HA-core's own
// abstraction over whichever AI provider the user set up). Node-RED has no
// equivalent built-in AI-provider abstraction, and this repo's existing
// design already deliberately scopes stateful/provider-specific concerns out
// (see bosch-camera-nvr-record's continuous-only scoping). Embedding a
// bespoke HTTP client + API-key/endpoint config here would mean re-inventing
// a small, brittle subset of what dedicated community nodes (an `openai`
// node, a generic `http request` node, any vision-capable LLM node) already
// do well and are independently testable/composable — Node-RED's whole
// philosophy is wiring small single-purpose nodes together, and a plain
// `http request`/LLM node downstream is the more idiomatic answer here than
// duplicating that logic inside this node.
//
// This node's job ends where HA's `ai_task.generate_data` call begins: fetch
// the snapshot(s), and hand them to the flow together with the same prompt
// text + structured-output schema HA uses, ready to wire into whichever
// AI/vision node the user has installed.
//
// Output: msg.payload = {
//   cam, timestamp, snapshotCount,
//   images: [Buffer, ...],                 // JPEG snapshots, newest last
//   instructions: string,                  // suggested analysis prompt
//   structure: { <field>: { description, required, selector } }
// }
// msg.attachments = [{ data: Buffer, contentType: 'image/jpeg' }, ...]
//   convenience alias for LLM/vision nodes that expect an attachments array.

const api = require('./lib/bosch-api');

const DEFAULT_SNAPSHOT_COUNT = 3;
const MIN_SNAPSHOT_COUNT = 1;
const MAX_SNAPSHOT_COUNT = 10;

const DEFAULT_PROMPT =
    'You are a security-camera analysis assistant. Rate EACH image on a scale ' +
    'of 1 (nothing notable) to 10 (clear threat/break-in in progress) and ' +
    'briefly describe what is visible. Score 1 for empty scenes, animals, ' +
    "weather, shadows, plants. Score rises with unknown people, suspicious " +
    'behaviour (loitering, masking, tools at doors/windows), unusual hours. ' +
    'Do not guess — if unclear, choose a low score.';

// Mirrors the sibling HA integration's `ai_analysis.py` STRUCTURE_SCHEMA
// (ai_task.generate_data's selector-based structured-output schema) so a
// downstream AI/vision node can request the same validated shape HA does.
const STRUCTURE_SCHEMA = {
    score: {
        description: 'Suspicion/security-relevance score, 1 (nothing notable) to 10 (clear threat/break-in in progress)',
        required: true,
        selector: { number: { min: 1, max: 10, mode: 'box' } }
    },
    short: {
        description: 'One-sentence summary of what is happening',
        required: true,
        selector: { text: {} }
    },
    detail: {
        description: 'Longer description of the observed activity',
        required: false,
        selector: { text: {} }
    },
    direction: {
        description: 'Movement direction if a person/vehicle is present (e.g. approaching, leaving, passing)',
        required: false,
        selector: { text: {} }
    },
    carrying: {
        description: 'Any object being carried, if visible',
        required: false,
        selector: { text: {} }
    },
    activity: {
        description: 'Short activity label, e.g. walking, delivering, loitering',
        required: false,
        selector: { text: {} }
    }
};

function parseIntOrDefault(raw, fallback) {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
}

module.exports = function (RED) {
    function BoschCameraAiAnalysisNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;

        let snapshotCount = parseIntOrDefault(config.snapshotCount, DEFAULT_SNAPSHOT_COUNT);
        if (snapshotCount < MIN_SNAPSHOT_COUNT) { snapshotCount = MIN_SNAPSHOT_COUNT; }
        if (snapshotCount > MAX_SNAPSHOT_COUNT) { snapshotCount = MAX_SNAPSHOT_COUNT; }

        node.promptOverride = (config.promptOverride || '').trim();

        if (!node.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        node.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            const camId = msg.cameraId || node.cameraId;
            if (!camId) {
                node.status({ fill: 'red', shape: 'ring', text: 'no camera id' });
                done(new Error('no camera id (set Camera ID or msg.cameraId)'));
                return;
            }

            let count = parseIntOrDefault(msg.snapshotCount, snapshotCount);
            if (count < MIN_SNAPSHOT_COUNT) { count = MIN_SNAPSHOT_COUNT; }
            if (count > MAX_SNAPSHOT_COUNT) { count = MAX_SNAPSHOT_COUNT; }

            const instructions = (typeof msg.instructions === 'string' && msg.instructions.trim())
                ? msg.instructions.trim()
                : (node.promptOverride || DEFAULT_PROMPT);

            node.status({ fill: 'blue', shape: 'dot', text: `fetching ${count} snapshot(s)...` });

            node.server.getAccessToken()
                .then(function (token) {
                    // Sequential, not Promise.all — a live snapshot fetch
                    // opens/reuses a cloud REMOTE connection per call, and a
                    // burst of parallel connection PUTs against the same
                    // camera is exactly the kind of concurrent-session
                    // pressure the sibling HA integration's rc=234 fix
                    // (GitHub #64) exists to avoid. Sequential fetches also
                    // naturally space the frames out in time, which is more
                    // useful for motion analysis than N near-identical
                    // simultaneous captures.
                    const images = [];
                    let chain = Promise.resolve();
                    for (let i = 0; i < count; i += 1) {
                        chain = chain.then(function () {
                            return api.getSnapshot(token, camId).then(function (buf) {
                                images.push(buf);
                            });
                        });
                    }
                    return chain.then(function () { return images; });
                })
                .then(function (images) {
                    node.status({ fill: 'green', shape: 'dot', text: `ok (${images.length})` });
                    send(Object.assign({}, msg, {
                        payload: {
                            cam: camId,
                            timestamp: new Date().toISOString(),
                            snapshotCount: images.length,
                            images: images,
                            instructions: instructions,
                            structure: STRUCTURE_SCHEMA
                        },
                        attachments: images.map(function (buf) {
                            return { data: buf, contentType: 'image/jpeg' };
                        })
                    }));
                    done();
                })
                .catch(function (err) {
                    node.status({ fill: 'red', shape: 'ring', text: err.message });
                    done(err);
                });
        });

        node.on('close', function (done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-ai-analysis', BoschCameraAiAnalysisNode);
};
