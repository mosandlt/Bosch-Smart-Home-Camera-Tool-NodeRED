// bosch-camera-firmware-status.js
// Query node: reads a camera's current firmware status from the Bosch cloud.
// Any incoming message triggers a fresh read (msg.payload is ignored).
// Output: msg.payload = { cam, installedVersion, latestVersion, upToDate,
//                          updating, status }
//
// Read-only — this node never triggers an install. Pair it with
// bosch-camera-firmware-install for that.

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraFirmwareStatusNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;

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

            node.status({ fill: 'blue', shape: 'dot', text: 'reading...' });

            node.server.getAccessToken()
                .then(function (token) { return api.getFirmware(token, camId); })
                .then(function (fw) {
                    const text = fw.upToDate === true
                        ? 'up to date'
                        : (fw.updating ? 'updating...' : (fw.latestVersion ? 'update available' : 'unknown'));
                    node.status({ fill: fw.upToDate === true ? 'green' : 'yellow', shape: 'dot', text: text });
                    send(Object.assign({}, msg, {
                        payload: Object.assign({ cam: camId }, fw)
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

    RED.nodes.registerType('bosch-camera-firmware-status', BoschCameraFirmwareStatusNode);
};
