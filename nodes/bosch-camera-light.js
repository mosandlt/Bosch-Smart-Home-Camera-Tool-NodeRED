// bosch-camera-light.js
// Action/query node: reads or sets a camera's front-illuminator / wallwasher
// light state (Eyes Outdoor cameras with LED light only).
// Mode 'get'          → reads current state, ignores msg.payload
// Mode 'front-on/off'  \
// Mode 'wallwasher-on/off' } fixed convenience presets, msg.payload ignored
// Mode 'msg'           → msg.payload is a patch object, e.g.
//                        { frontLightOn: true, frontLightIntensity: 0.6 }
//                        Only the fields present are changed (read-modify-write).
// Output: msg.payload = { cam, frontLightOn, wallwasherOn, frontLightIntensity, success }

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraLightNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.mode = config.mode || 'get'; // 'get' | 'front-on' | 'front-off' | 'wallwasher-on' | 'wallwasher-off' | 'msg'

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
            if (node.mode === 'front-on') { patch = { frontLightOn: true }; }
            else if (node.mode === 'front-off') { patch = { frontLightOn: false }; }
            else if (node.mode === 'wallwasher-on') { patch = { wallwasherOn: true }; }
            else if (node.mode === 'wallwasher-off') { patch = { wallwasherOn: false }; }
            else if (node.mode === 'msg') {
                if (msg.payload === null || typeof msg.payload !== 'object') {
                    node.status({ fill: 'red', shape: 'ring', text: 'bad payload' });
                    done(new Error('mode "msg" requires msg.payload to be a patch object'));
                    return;
                }
                patch = msg.payload;
            }
            // else mode === 'get': patch stays null

            node.status({ fill: 'blue', shape: 'dot', text: patch ? 'setting...' : 'reading...' });

            node.server.getAccessToken()
                .then(function (token) {
                    return patch ? api.setLight(token, camId, patch) : api.getLight(token, camId);
                })
                .then(function (state) {
                    node.status({ fill: 'green', shape: 'dot', text: state.frontLightOn ? 'front on' : 'front off' });
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

    RED.nodes.registerType('bosch-camera-light', BoschCameraLightNode);
};
