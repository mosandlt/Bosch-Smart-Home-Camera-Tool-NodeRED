// bosch-camera-motion.js
// Action/query node: reads or sets a camera's motion-detection state.
// Mode 'get'  → reads current state, ignores msg.payload
// Mode 'on'   → enables motion detection, ignores msg.payload
// Mode 'off'  → disables motion detection, ignores msg.payload
// Mode 'msg'  → msg.payload = boolean (enable/disable) OR
//               msg.payload = { enabled: boolean, sensitivity: 'OFF'|'LOW'|'MEDIUM_LOW'|
//                                'MEDIUM_HIGH'|'HIGH'|'SUPER_HIGH' }
// Output: msg.payload = { cam, enabled, sensitivity, success }

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraMotionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.mode = config.mode || 'get'; // 'get' | 'on' | 'off' | 'msg'

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

            let action = null; // null = get; otherwise { enabled, sensitivity }
            if (node.mode === 'on') { action = { enabled: true, sensitivity: null }; }
            else if (node.mode === 'off') { action = { enabled: false, sensitivity: null }; }
            else if (node.mode === 'msg') {
                if (typeof msg.payload === 'boolean') {
                    action = { enabled: msg.payload, sensitivity: null };
                } else if (msg.payload !== null && typeof msg.payload === 'object') {
                    if (typeof msg.payload.enabled !== 'boolean' && msg.payload.sensitivity === undefined) {
                        node.status({ fill: 'red', shape: 'ring', text: 'bad payload' });
                        done(new Error('mode "msg" requires msg.payload to be a boolean or { enabled, sensitivity }'));
                        return;
                    }
                    action = {
                        enabled: typeof msg.payload.enabled === 'boolean' ? msg.payload.enabled : true,
                        sensitivity: msg.payload.sensitivity !== undefined ? msg.payload.sensitivity : null
                    };
                } else {
                    node.status({ fill: 'red', shape: 'ring', text: 'bad payload' });
                    done(new Error('mode "msg" requires msg.payload to be a boolean or { enabled, sensitivity }'));
                    return;
                }
            }
            // else mode === 'get': action stays null

            node.status({ fill: 'blue', shape: 'dot', text: action ? 'setting...' : 'reading...' });

            node.server.getAccessToken()
                .then(function (token) {
                    return action
                        ? api.setMotion(token, camId, action.enabled, action.sensitivity)
                        : api.getMotion(token, camId);
                })
                .then(function (state) {
                    node.status({ fill: state.enabled ? 'green' : 'grey', shape: 'dot', text: state.enabled ? 'enabled' : 'disabled' });
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

    RED.nodes.registerType('bosch-camera-motion', BoschCameraMotionNode);
};
