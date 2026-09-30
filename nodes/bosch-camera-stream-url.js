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
        node.quality = config.quality || 'auto'; // 'auto' | 'high' | 'low'

        if (!node.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        // Local data interface source: applies only with a stored password and
        // an active interface. Returns null to keep the normal cloud path; an
        // applicable but unusable local source fails closed (no cloud session).
        function localSource(token, camId, msg) {
            const password = node.server.getLocalPassword ? node.server.getLocalPassword(camId) : null;
            if (!password || msg.generation === 1) { return Promise.resolve(null); }
            const cache = node.server.ldiCache || new Map();
            return api.getFirmware(token, camId).then(function (fw) {
                if (!api.firmwareSupportsLdi(fw.installedVersion)) { return null; }
                return api.getLocalDataInterface(token, camId).then(function (state) {
                    if (state) { cache.set(camId, state); }
                    const known = cache.get(camId);
                    // Unknown status on qualifying firmware counts as wanted.
                    if (known && known.state !== 'active') { return null; }
                    return api.getLanAddress(token, camId).then(function (ip) {
                        if (!api.isSafeLanHost(ip)) {
                            throw new Error('local data interface: no usable LAN address for this camera (stream not opened)');
                        }
                        return { rtsp: null, rtsps: api.ldiSourceUrl(ip, password), hls: null, local: true };
                    });
                });
            });
        }

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
            // Quality: msg wins, then node config, then default 'auto'.
            const quality = msg.quality || node.quality || 'auto';

            node.status({ fill: 'blue', shape: 'dot', text: 'opening...' });

            node.server.getAccessToken()
                .then(function (token) {
                    return localSource(token, camId, msg).then(function (local) {
                        if (local) { return local; }
                        return api.getStreamUrl(token, camId, connType, quality);
                    });
                })
                .then(function (result) {
                    // Log only the redacted forms — never raw URLs with credentials.
                    const logUrl = api.redactStreamUrl(result.rtsps || result.rtsp || result.hls);
                    node.status({ fill: 'green', shape: 'dot', text: logUrl || 'ok' });

                    send(Object.assign({}, msg, {
                        payload: {
                            rtsp: result.rtsp,
                            rtsps: result.rtsps,
                            hls: result.hls,
                            localDataInterface: result.local === true,
                            connectionType: result.local ? 'LOCAL' : connType,
                            quality: quality,
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
