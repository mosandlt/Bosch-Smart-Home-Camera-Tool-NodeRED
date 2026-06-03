// bosch-camera-privacy.js
// Action node: enables/disables (or toggles) privacy mode on a camera.
// Input:  msg.payload = true/false | 'on'/'off' | 1/0   (when Mode = 'msg')
// Output: msg.payload = { cam: string, privacy: boolean, success: boolean }

const api = require('./lib/bosch-api');

function normalise(raw) {
    return raw === true || raw === 'on' || raw === 'ON' || raw === 1 || raw === '1';
}

module.exports = function (RED) {
    function BoschCameraPrivacyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.defaultMode = config.defaultMode || 'msg'; // 'on' | 'off' | 'toggle' | 'msg'

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

            const raw = node.defaultMode === 'msg' ? msg.payload : node.defaultMode;

            node.server.getAccessToken()
                .then(function (token) {
                    if (raw === 'toggle') {
                        // Read current state, then flip it.
                        return api.getPrivacy(token, camId).then(function (current) {
                            if (current !== 'ON' && current !== 'OFF') {
                                throw new Error('cannot toggle: unexpected privacy state "' + current + '"');
                            }
                            return { token: token, enable: current !== 'ON' };
                        });
                    }
                    return { token: token, enable: normalise(raw) };
                })
                .then(function (ctx) {
                    node.status({
                        fill: 'blue', shape: 'dot',
                        text: ctx.enable ? 'enabling...' : 'disabling...'
                    });
                    return api.setPrivacy(ctx.token, camId, ctx.enable ? 'ON' : 'OFF')
                        .then(function () { return ctx.enable; });
                })
                .then(function (enable) {
                    node.status({
                        fill: enable ? 'red' : 'green', shape: 'dot',
                        text: enable ? 'privacy on' : 'privacy off'
                    });
                    send(Object.assign({}, msg, {
                        payload: { cam: camId, privacy: enable, success: true }
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

    RED.nodes.registerType('bosch-camera-privacy', BoschCameraPrivacyNode);
};
