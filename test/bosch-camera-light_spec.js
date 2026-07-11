const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const lightNode = require('../nodes/bosch-camera-light.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-light', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('reads current light state (happy path, mode=get)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', cameraId: FAKE_CAM, mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/lighting_override')
                .reply(200, { frontLightOn: true, wallwasherOn: false, frontLightIntensity: 0.5 });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.frontLightOn, true);
                    assert.strictEqual(msg.payload.wallwasherOn, false);
                    assert.strictEqual(msg.payload.frontLightIntensity, 0.5);
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('turns the front light on via fixed mode (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', cameraId: FAKE_CAM, mode: 'front-on', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/lighting_override')
                .reply(200, { frontLightOn: false, wallwasherOn: false, frontLightIntensity: 0.2 });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/lighting_override',
                { frontLightOn: true, wallwasherOn: false, frontLightIntensity: 0.2 })
                .reply(200, {});

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.frontLightOn, true);
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('applies a msg.payload patch, merging with current state (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/lighting_override')
                .reply(200, { frontLightOn: false, wallwasherOn: true, frontLightIntensity: 0.3 });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/lighting_override',
                { frontLightOn: false, wallwasherOn: true, frontLightIntensity: 0.9 })
                .reply(200, {});

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.frontLightIntensity, 0.9);
                    assert.strictEqual(msg.payload.wallwasherOn, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { frontLightIntensity: 0.9 } });
        });
    });

    it('passes frontLightIntensity=0 through unchanged, not treated as "unset" (edge case)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/lighting_override')
                .reply(200, { frontLightOn: true, wallwasherOn: false, frontLightIntensity: 0.5 });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/lighting_override',
                { frontLightOn: true, wallwasherOn: false, frontLightIntensity: 0 })
                .reply(200, {});

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.frontLightIntensity, 0);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { frontLightIntensity: 0 } });
        });
    });

    it('errors when mode=msg gets a non-object payload (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'not-an-object' });
        });
    });

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });

    it('reports an error when the cloud GET fails (error path, e.g. camera offline)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-light', server: 'cfg', cameraId: FAKE_CAM, mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, lightNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/lighting_override').reply(444, 'offline');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });
});
