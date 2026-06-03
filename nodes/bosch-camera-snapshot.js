// bosch-camera-snapshot.js
// Action node: an incoming message triggers a live snapshot fetch.
// Output:  msg.payload = Buffer (JPEG), msg.contentType = 'image/jpeg',
//          msg.cam = <camera id>, msg.timestamp = ISO string.

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraSnapshotNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.name = config.name;

        if (!node.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        node.on('input', function (msg, send, done) {
            // Node-RED 1.0+ API; fall back for older runtimes.
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            const camId = msg.cameraId || node.cameraId;
            if (!camId) {
                node.status({ fill: 'red', shape: 'ring', text: 'no camera id' });
                done(new Error('no camera id (set Camera ID or msg.cameraId)'));
                return;
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'fetching...' });

            node.server.getAccessToken()
                .then(function (token) { return api.getSnapshot(token, camId); })
                .then(function (buf) {
                    node.status({ fill: 'green', shape: 'dot', text: 'ok' });
                    send(Object.assign({}, msg, {
                        payload: buf,
                        contentType: 'image/jpeg',
                        cam: camId,
                        timestamp: new Date().toISOString()
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

    RED.nodes.registerType('bosch-camera-snapshot', BoschCameraSnapshotNode);
};
