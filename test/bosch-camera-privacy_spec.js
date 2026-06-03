const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const privacyNode = require('../nodes/bosch-camera-privacy.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-privacy', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('disables privacy in fixed "off" mode (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-privacy', server: 'cfg', cameraId: 'cam-x', defaultMode: 'off', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, privacyNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/privacy', { privacyMode: 'OFF', durationInSeconds: null }).reply(204);

            const n1 = helper.getNode('n1');
            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, 'cam-x');
                    assert.strictEqual(msg.payload.privacy, false);
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'anything' });
        });
    });

    it('enables privacy from msg.payload boolean (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-privacy', server: 'cfg', cameraId: 'cam-x', defaultMode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, privacyNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/privacy', { privacyMode: 'ON', durationInSeconds: null }).reply(204);

            const n1 = helper.getNode('n1');
            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.privacy, true);
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: true });
        });
    });

    it('toggles by reading current state then flipping it (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-privacy', server: 'cfg', cameraId: 'cam-x', defaultMode: 'toggle', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, privacyNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/cam-x/privacy').reply(200, { privacyMode: 'OFF' });
            nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/privacy', { privacyMode: 'ON', durationInSeconds: null }).reply(204);

            const n1 = helper.getNode('n1');
            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.privacy, true);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: null });
        });
    });

    it('errors on toggle when the current state is unexpected (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-privacy', server: 'cfg', cameraId: 'cam-x', defaultMode: 'toggle', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, privacyNode], flow, creds, function () {
            tokenOk();
            // No privacyMode in the body → must NOT silently enable privacy.
            nock(CLOUD_HOST).get('/v11/video_inputs/cam-x/privacy').reply(200, {});
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });

    it('reports an error when the privacy PUT fails (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-privacy', server: 'cfg', cameraId: 'cam-x', defaultMode: 'on', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, privacyNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/privacy').reply(500, 'boom');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'on' });
        });
    });
});
