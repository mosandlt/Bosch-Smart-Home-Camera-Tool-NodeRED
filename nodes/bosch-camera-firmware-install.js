// bosch-camera-firmware-install.js
// Action node: triggers a firmware install on a Bosch camera via the cloud
// API (PUT .../firmware {"id": <targetVersion>}).
//
// PHYSICAL SIDE EFFECT WARNING: a successful trigger makes the real camera
// reboot for roughly 3-7 minutes (observed behaviour, documented in the
// sibling HA integration's v14.4.10 release notes). This is NOT reversible
// from software once triggered.
//
// SAFETY GATE: unlike the other action nodes in this repo, this node does
// NOT fire on every incoming message. It only proceeds when
// msg.payload is an object with `confirm === true` (strictly the boolean
// `true`, not a truthy string) — any other payload is rejected with an
// error and NO network call is made at all, so an accidental/malformed
// upstream message (e.g. a bare 'trigger' string, or a stray poll message
// reused from a status node) can never install firmware by accident.
//
// Before installing, this node always re-reads the camera's current
// firmware status (fresh GET, no caching) and refuses to send the install
// PUT when:
//   - the camera reports an install already in progress (fw.updating), or
//   - no update is currently available (fw.latestVersion is falsy / already
//     upToDate)
// Both are reported as a non-error informational output
// (payload.triggered === false) rather than a flow error, since "nothing to
// do" is an expected outcome, not a failure.
//
// A local busy-guard additionally blocks a second install request for the
// same node instance while an earlier one is still in flight (its own GET
// + PUT round-trip), so two 'confirm' messages arriving close together can
// never race into two concurrent install PUTs.
//
// Output: msg.payload = { cam, triggered: boolean, reason: string|null,
//                          installedVersion, targetVersion, upToDate,
//                          updating, success }

const api = require('./lib/bosch-api');

module.exports = function (RED) {
    function BoschCameraFirmwareInstallNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.cameraId = config.cameraId;

        let busy = false;

        if (!node.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'dot', text: 'idle' });

        node.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            const confirmed = !!(msg.payload && typeof msg.payload === 'object' && msg.payload.confirm === true);
            if (!confirmed) {
                node.status({ fill: 'red', shape: 'ring', text: 'not confirmed' });
                done(new Error(
                    'bosch-camera-firmware-install: refusing to install — msg.payload must be ' +
                    'an object with confirm === true (this triggers a real camera reboot; ' +
                    'no network call was made)'
                ));
                return;
            }

            const camId = msg.cameraId || node.cameraId;
            if (!camId) {
                node.status({ fill: 'red', shape: 'ring', text: 'no camera id' });
                done(new Error('no camera id (set Camera ID or msg.cameraId)'));
                return;
            }

            if (busy) {
                node.status({ fill: 'yellow', shape: 'ring', text: 'busy' });
                done(new Error(
                    'bosch-camera-firmware-install: an install request for this node is already ' +
                    'in flight — retry once it completes (no second network call was made)'
                ));
                return;
            }

            busy = true;
            node.status({ fill: 'blue', shape: 'dot', text: 'checking status...' });

            let token;
            node.server.getAccessToken()
                .then(function (t) {
                    token = t;
                    return api.getFirmware(token, camId);
                })
                .then(function (fw) {
                    if (fw.updating) {
                        node.status({ fill: 'yellow', shape: 'dot', text: 'already updating' });
                        send(Object.assign({}, msg, {
                            payload: {
                                cam: camId,
                                triggered: false,
                                reason: 'already_updating',
                                installedVersion: fw.installedVersion,
                                targetVersion: fw.latestVersion,
                                upToDate: fw.upToDate,
                                updating: true,
                                success: true
                            }
                        }));
                        return null; // signals "handled, no PUT" to the chain below
                    }
                    if (!fw.latestVersion || fw.upToDate === true) {
                        node.status({ fill: 'green', shape: 'dot', text: 'up to date' });
                        send(Object.assign({}, msg, {
                            payload: {
                                cam: camId,
                                triggered: false,
                                reason: 'up_to_date',
                                installedVersion: fw.installedVersion,
                                targetVersion: fw.latestVersion,
                                upToDate: fw.upToDate,
                                updating: false,
                                success: true
                            }
                        }));
                        return null;
                    }

                    node.status({ fill: 'blue', shape: 'dot', text: 'installing ' + fw.latestVersion + '...' });
                    return api.installFirmware(token, camId, fw.latestVersion).then(function () {
                        node.status({ fill: 'green', shape: 'dot', text: 'install triggered' });
                        send(Object.assign({}, msg, {
                            payload: {
                                cam: camId,
                                triggered: true,
                                reason: null,
                                installedVersion: fw.installedVersion,
                                targetVersion: fw.latestVersion,
                                upToDate: false,
                                updating: true,
                                success: true
                            }
                        }));
                    });
                })
                .then(function () {
                    busy = false;
                    done();
                })
                .catch(function (err) {
                    busy = false;
                    node.status({ fill: 'red', shape: 'ring', text: err.message });
                    done(err);
                });
        });

        node.on('close', function (done) {
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-firmware-install', BoschCameraFirmwareInstallNode);
};
