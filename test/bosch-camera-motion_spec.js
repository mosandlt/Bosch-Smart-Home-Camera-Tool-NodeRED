const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const motionNode = require('../nodes/bosch-camera-motion.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-motion', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('reads current motion state (happy path, mode=get)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', cameraId: FAKE_CAM, mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/motion')
                .reply(200, { enabled: true, motionAlarmConfiguration: 'HIGH' });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.enabled, true);
                    assert.strictEqual(msg.payload.sensitivity, 'HIGH');
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('enables motion detection via fixed mode (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', cameraId: FAKE_CAM, mode: 'on', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/motion', { enabled: true })
                .reply(200, { enabled: true });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.enabled, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('sets sensitivity from msg.payload object, implicitly enabling (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/motion',
                { enabled: true, motionAlarmConfiguration: 'LOW' })
                .reply(200, { enabled: true, motionAlarmConfiguration: 'LOW' });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.sensitivity, 'LOW');
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { sensitivity: 'LOW' } });
        });
    });

    it('disables motion from a boolean msg.payload (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/motion', { enabled: false })
                .reply(200, { enabled: false });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.enabled, false);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: false });
        });
    });

    it('errors when mode=msg gets an unusable payload (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', cameraId: FAKE_CAM, mode: 'msg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'garbage' });
        });
    });

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', mode: 'get', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });

    it('reports an error when the cloud PUT fails (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-motion', server: 'cfg', cameraId: FAKE_CAM, mode: 'on', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, motionNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/motion').reply(500, 'boom');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });
});
