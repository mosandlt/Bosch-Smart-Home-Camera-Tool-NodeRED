// bosch-camera-audio-detection.js
// Action/query node: reads or sets glass-break / fire-alarm sound detection
// (Gen2 Audio-Plus cameras only — Bosch rejects with HTTP 442 on unsupported
// models, surfaced as a normal error here).
// Mode 'get' → reads current state, ignores msg.payload
// Mode 'msg' → msg.payload = { detectGlassBreak: boolean, detectFireAlarm: boolean }
//              (both fields are always sent together — Bosch resets an omitted
//              field to false server-side, so this node merges with the
//              current state first so a partial patch behaves as expected)
// Fixed presets: 'glass-break-on/off', 'fire-alarm-on/off' (merges with current state)
// Output: msg.payload = { cam, detectGlassBreak, detectFireAlarm, success }

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraAudioDetectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.mode = config.mode || 'get'; // 'get' | 'glass-break-on' | 'glass-break-off' | 'fire-alarm-on' | 'fire-alarm-off' | 'msg'

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

            let patch = null;
            if (node.mode === 'glass-break-on') { patch = { detectGlassBreak: true }; }
            else if (node.mode === 'glass-break-off') { patch = { detectGlassBreak: false }; }
            else if (node.mode === 'fire-alarm-on') { patch = { detectFireAlarm: true }; }
            else if (node.mode === 'fire-alarm-off') { patch = { detectFireAlarm: false }; }
            else if (node.mode === 'msg') {
                if (msg.payload === null || typeof msg.payload !== 'object') {
                    node.status({ fill: 'red', shape: 'ring', text: 'bad payload' });
                    done(new Error('mode "msg" requires msg.payload to be { detectGlassBreak, detectFireAlarm }'));
                    return;
                }
                patch = msg.payload;
            }
            // else mode === 'get': patch stays null

            node.status({ fill: 'blue', shape: 'dot', text: patch ? 'setting...' : 'reading...' });

            node.server.getAccessToken()
                .then(function (token) {
                    if (!patch) {
                        return api.getAudioDetection(token, camId);
                    }
                    // Merge with current state first: the Bosch API always
                    // expects both fields and resets an omitted one to false.
                    return api.getAudioDetection(token, camId).then(function (current) {
                        return api.setAudioDetection(
                            token,
                            camId,
                            patch.detectGlassBreak !== undefined ? patch.detectGlassBreak : current.detectGlassBreak,
                            patch.detectFireAlarm !== undefined ? patch.detectFireAlarm : current.detectFireAlarm
                        );
                    });
                })
                .then(function (state) {
                    node.status({
                        fill: (state.detectGlassBreak || state.detectFireAlarm) ? 'green' : 'grey',
                        shape: 'dot',
                        text: `glass:${state.detectGlassBreak ? 'on' : 'off'} fire:${state.detectFireAlarm ? 'on' : 'off'}`
                    });
                    send(Object.assign({}, msg, {
                        payload: Object.assign({ cam: camId, success: true }, state)
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

    RED.nodes.registerType('bosch-camera-audio-detection', BoschCameraAudioDetectionNode);
};
