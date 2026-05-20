// bosch-camera-config.js
// Config node: stores Bosch Smart Home Controller credentials.
// Credentials (email, password) are stored via Node-RED's secure credentials API —
// never written to flows.json in plaintext.
//
// Phase 2 TODO:
//   - Implement OAuth token fetch (POST /oauth/token on SHC port 8444)
//   - Token auto-refresh via setTimeout when expires_in approaches
//   - Expose this.token / this.refreshToken for sibling nodes to call
//   - Digest-auth fallback for local LAN access (SHC CBS user)

module.exports = function (RED) {
    function BoschCameraConfigNode(config) {
        RED.nodes.createNode(this, config);

        // Non-secret config properties saved in flows.json
        this.name        = config.name;
        this.shcHost     = config.shcHost;     // SHC local IP, e.g. 192.168.x.x
        this.shcPort     = config.shcPort || 8444;
        this.useCloud    = config.useCloud === true;

        // Credentials injected by Node-RED — never logged, never exported
        // Access: this.credentials.email / this.credentials.password
        // Phase 2: exchange for OAuth bearer token here

        this.on('close', function (done) {
            // Phase 2: clear token refresh timers here
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-config', BoschCameraConfigNode, {
        credentials: {
            email:    { type: 'text' },
            password: { type: 'password' }
        }
    });
};
