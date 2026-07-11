const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const audioNode = require('../nodes/bosch-camera-audio-detection.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-audio-detection', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('reads current detection state (happy path, mode=get)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-audio-detection', server: 'cfg', cameraId: FAKE_CAM, mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, audioNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/audioDetectionConfig')
                .reply(200, { detectGlassBreak: true, detectFireAlarm: false });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.detectGlassBreak, true);
                    assert.strictEqual(msg.payload.detectFireAlarm, false);
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('enables glass-break detection via fixed mode, merging with current fire-alarm state (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-audio-detection', server: 'cfg', cameraId: FAKE_CAM, mode: 'glass-break-on', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, audioNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/audioDetectionConfig')
                .reply(200, { detectGlassBreak: false, detectFireAlarm: true });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/audioDetectionConfig',
                { detectGlassBreak: true, detectFireAlarm: true })
                .reply(200, {});

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.detectGlassBreak, true);
                    assert.strictEqual(msg.payload.detectFireAlarm, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('applies a msg.payload patch (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-audio-detection', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, audioNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/audioDetectionConfig')
                .reply(200, { detectGlassBreak: false, detectFireAlarm: false });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/audioDetectionConfig',
                { detectGlassBreak: false, detectFireAlarm: true })
                .reply(200, {});

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.detectFireAlarm, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { detectFireAlarm: true } });
        });
    });

    it('errors when mode=msg gets a non-object payload (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-audio-detection', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, audioNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 42 });
        });
    });

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-audio-detection', server: 'cfg', mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, audioNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });

    it('reports an error (HTTP 442) when the camera model is unsupported (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-audio-detection', server: 'cfg', cameraId: FAKE_CAM, mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, audioNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/audioDetectionConfig').reply(442, 'unsupported');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });
});
