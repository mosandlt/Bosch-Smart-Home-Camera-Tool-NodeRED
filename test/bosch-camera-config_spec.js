const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';

describe('bosch-camera-config', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('mints an access token from the refresh token (happy path)', function (done) {
        const flow = [{ id: 'cfg', type: 'bosch-camera-config', name: 'c' }];
        const creds = { cfg: { refreshToken: 'rt-123' } };
        helper.load(configNode, flow, creds, function () {
            nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT-1', expires_in: 3600 });
            const cfg = helper.getNode('cfg');
            cfg.getAccessToken().then(function (tok) {
                try { assert.strictEqual(tok, 'AT-1'); done(); } catch (e) { done(e); }
            }).catch(done);
        });
    });

    it('caches the token across calls (single HTTP round-trip)', function (done) {
        const flow = [{ id: 'cfg', type: 'bosch-camera-config' }];
        const creds = { cfg: { refreshToken: 'rt-123' } };
        helper.load(configNode, flow, creds, function () {
            const scope = nock(TOKEN_HOST).post(TOKEN_PATH).once()
                .reply(200, { access_token: 'AT-2', expires_in: 3600 });
            const cfg = helper.getNode('cfg');
            cfg.getAccessToken()
                .then(function () { return cfg.getAccessToken(); })
                .then(function (tok) {
                    try {
                        assert.strictEqual(tok, 'AT-2');
                        assert.ok(scope.isDone());
                        done();
                    } catch (e) { done(e); }
                })
                .catch(done);
        });
    });

    it('rejects when no refresh token is configured (error path)', function (done) {
        const flow = [{ id: 'cfg', type: 'bosch-camera-config' }];
        helper.load(configNode, flow, {}, function () {
            const cfg = helper.getNode('cfg');
            cfg.getAccessToken()
                .then(function () { done(new Error('should have rejected')); })
                .catch(function () { done(); });
        });
    });

    it('rejects when Keycloak refuses the refresh token (error path)', function (done) {
        const flow = [{ id: 'cfg', type: 'bosch-camera-config' }];
        const creds = { cfg: { refreshToken: 'bad' } };
        helper.load(configNode, flow, creds, function () {
            nock(TOKEN_HOST).post(TOKEN_PATH).reply(400, { error: 'invalid_grant' });
            const cfg = helper.getNode('cfg');
            cfg.getAccessToken()
                .then(function () { done(new Error('should have rejected')); })
                .catch(function () { done(); });
        });
    });
});
