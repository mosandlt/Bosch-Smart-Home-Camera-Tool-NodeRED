// bosch-camera-stream-url.js
// Action node: opens a live stream connection and emits the stream URL(s).
// Output:  msg.payload = { rtsp, rtsps, hls, connectionType, cam, timestamp }
//
// SECURITY: URLs that embed Digest credentials (rtsp://user:pass@host) are
// NEVER logged raw — only the redacted form (***:***@) is written to the node
// log or status widget.

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraStreamUrlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;
        node.connectionType = config.connectionType || 'REMOTE'; // 'REMOTE' | 'LOCAL'

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

            // Connection type: msg wins, then node config, then default REMOTE.
            const connType = msg.connectionType || node.connectionType || 'REMOTE';

            node.status({ fill: 'blue', shape: 'dot', text: 'opening...' });

            node.server.getAccessToken()
                .then(function (token) { return api.getStreamUrl(token, camId, connType); })
                .then(function (result) {
                    // Log only the redacted forms — never raw URLs with credentials.
                    const logUrl = api.redactStreamUrl(result.rtsps || result.rtsp || result.hls);
                    node.status({ fill: 'green', shape: 'dot', text: logUrl || 'ok' });

                    send(Object.assign({}, msg, {
                        payload: {
                            rtsp: result.rtsp,
                            rtsps: result.rtsps,
                            hls: result.hls,
                            connectionType: connType,
                            cam: camId,
                            timestamp: new Date().toISOString()
                        }
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

    RED.nodes.registerType('bosch-camera-stream-url', BoschCameraStreamUrlNode);
};
