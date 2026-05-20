// bosch-camera-privacy.js
// Action node: enables or disables privacy mode on a Bosch Smart Home Camera.
// Input: msg.payload = true/false (or 'on'/'off', 1/0 — normalised below)
// Output: msg.payload = { cam: string, privacy: boolean, success: boolean }
//
// Phase 2 TODO:
//   - Call SHC endpoint: PUT /smarthome/devices/<id>/services/PrivacyMode/state
//     with body: { "@type": "privacyModeState", "value": true/false }
//   - Use config node bearer token for Authorization
//   - Handle token expiry → re-auth and retry once
//   - Gen2 cameras: verify endpoint path differs from Gen1 if needed

module.exports = function (RED) {
    function BoschCameraPrivacyNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        this.server      = RED.nodes.getNode(config.server);
        this.cameraId    = config.cameraId;
        this.defaultMode = config.defaultMode; // 'on' | 'off' | 'toggle' | 'msg'

        if (!this.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch SHC config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        this.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) node.error(err, msg); };

            // Normalise input to boolean
            let enable;
            const raw = node.defaultMode === 'msg' ? msg.payload : node.defaultMode;
            if (raw === 'toggle') {
                // Phase 2: read current state first, then invert
                node.warn('bosch-camera-privacy: toggle requires current state read (Phase 2)');
                done();
                return;
            }
            enable = (raw === true || raw === 'on' || raw === 1 || raw === '1');

            node.status({ fill: 'blue', shape: 'dot', text: enable ? 'enabling...' : 'disabling...' });

            // Phase 2: replace stub with real HTTP PUT
            // const axios = require('axios');
            // axios.put(`https://${node.server.shcHost}:${node.server.shcPort}/smarthome/devices/${node.cameraId}/services/PrivacyMode/state`, {
            //     "@type": "privacyModeState",
            //     "value": enable
            // }, { headers: { Authorization: `Bearer ${node.server.token}` }, ... })
            // .then(() => {
            //     node.status({ fill: enable ? 'red' : 'green', shape: 'dot', text: enable ? 'privacy on' : 'privacy off' });
            //     send({ ...msg, payload: { cam: node.cameraId, privacy: enable, success: true } });
            //     done();
            // }).catch(err => { ... });

            node.status({ fill: 'yellow', shape: 'ring', text: 'Phase 2: not implemented' });
            node.warn('bosch-camera-privacy: HTTP PUT not yet implemented (Phase 2)');
            done();
        });

        this.on('close', function (done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-privacy', BoschCameraPrivacyNode);
};
