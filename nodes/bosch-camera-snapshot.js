// bosch-camera-snapshot.js
// Action node: incoming message triggers snapshot fetch from camera.
// Outputs: msg.payload = Buffer (JPEG), msg.contentType = 'image/jpeg'
//
// Phase 2 TODO:
//   - Fetch snapshot via SHC proxy endpoint (GET /smarthome/cameras/<id>/snapshot)
//     OR directly from camera LAN IP via Digest auth (GET /media/grab.jpg)
//   - Prefer LAN path when SHC config has useCloud=false
//   - Use config node token/credentials for Authorization
//   - Attach msg.cam and msg.timestamp to output message
//   - Handle HTTP 401 (re-auth), 503 (camera offline) with node.error()

module.exports = function (RED) {
    function BoschCameraSnapshotNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        this.server   = RED.nodes.getNode(config.server);
        this.cameraId = config.cameraId;
        this.name     = config.name;

        if (!this.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch SHC config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        this.on('input', function (msg, send, done) {
            // send() / done() are Node-RED 1.0+ API — fall back for older runtimes
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) node.error(err, msg); };

            node.status({ fill: 'blue', shape: 'dot', text: 'fetching...' });

            // Phase 2: replace stub with real HTTP request
            // const axios = require('axios');
            // const token = node.server.token;  // set by config node in Phase 2
            // axios.get(`https://${node.server.shcHost}:${node.server.shcPort}/...`, {
            //     headers: { Authorization: `Bearer ${token}` },
            //     responseType: 'arraybuffer',
            //     httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
            // }).then(res => {
            //     node.status({ fill: 'green', shape: 'dot', text: 'ok' });
            //     send({ ...msg, payload: Buffer.from(res.data), contentType: 'image/jpeg' });
            //     done();
            // }).catch(err => {
            //     node.status({ fill: 'red', shape: 'ring', text: err.message });
            //     done(err);
            // });

            node.status({ fill: 'yellow', shape: 'ring', text: 'Phase 2: not implemented' });
            node.warn('bosch-camera-snapshot: HTTP fetch not yet implemented (Phase 2)');
            done();
        });

        this.on('close', function (done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-snapshot', BoschCameraSnapshotNode);
};
