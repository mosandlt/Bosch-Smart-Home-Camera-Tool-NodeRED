// bosch-camera-config.js
// Config node: holds the Bosch SingleKey ID *refresh token* and mints short-lived
// cloud access tokens from it (Keycloak refresh_token grant).
//
// The refresh token is obtained once via the Bosch Camera Python CLI
// (`get_token.py`, browser/PKCE login) and pasted here. Bosch sets
// refresh_expires_in=0 (never expires), so this node can silently issue access
// tokens (~1 h TTL) to the sibling camera nodes indefinitely.
//
// Exposes:  node.getAccessToken()  -> Promise<string>  (cached, auto-refreshing)

const api = require('./lib/bosch-api');

// 60 s safety margin so a token is never handed out right before it expires.
const EXPIRY_MARGIN_MS = 60 * 1000;

module.exports = function (RED) {
    function BoschCameraConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name;

        let accessToken = null;
        let expiresAt = 0;       // epoch ms
        let inflight = null;     // de-dupes concurrent refreshes

        function haveCreds() {
            return Boolean(node.credentials && node.credentials.refreshToken);
        }

        node.status(haveCreds()
            ? { fill: 'grey', shape: 'ring', text: 'token not yet fetched' }
            : { fill: 'red', shape: 'ring', text: 'no refresh token' });

        // Returns a valid cloud access token, refreshing it via Keycloak when the
        // cached one is missing or within the expiry margin.
        node.getAccessToken = function () {
            if (!haveCreds()) {
                return Promise.reject(new Error('Bosch config: no refresh token configured'));
            }
            if (accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) {
                return Promise.resolve(accessToken);
            }
            if (!inflight) {
                inflight = api.refreshAccessToken(node.credentials.refreshToken)
                    .then(function (res) {
                        accessToken = res.accessToken;
                        expiresAt = Date.now() + res.expiresIn * 1000;
                        node.status({ fill: 'green', shape: 'dot', text: 'token ok' });
                        return accessToken;
                    })
                    .catch(function (err) {
                        node.status({ fill: 'red', shape: 'ring', text: 'auth failed' });
                        throw err;
                    })
                    .finally(function () { inflight = null; });
            }
            return inflight;
        };

        node.on('close', function (done) {
            accessToken = null;
            expiresAt = 0;
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-config', BoschCameraConfigNode, {
        credentials: {
            refreshToken: { type: 'password' }
        }
    });
};
