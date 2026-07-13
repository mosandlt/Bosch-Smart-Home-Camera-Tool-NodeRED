const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const firmwareStatusNode = require('../nodes/bosch-camera-firmware-status.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-firmware-status', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('reports up-to-date status (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareStatusNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.104', upToDate: true, update: null, updating: false, status: 'idle' });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.installedVersion, '9.40.104');
                    assert.strictEqual(msg.payload.latestVersion, null);
                    assert.strictEqual(msg.payload.upToDate, true);
                    assert.strictEqual(msg.payload.updating, false);
                    assert.strictEqual(msg.payload.status, 'idle');
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('reports an available update (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareStatusNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.102', upToDate: false, update: '9.40.104', updating: false, status: 'available' });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.installedVersion, '9.40.102');
                    assert.strictEqual(msg.payload.latestVersion, '9.40.104');
                    assert.strictEqual(msg.payload.upToDate, false);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('normalises a missing/unreported upToDate field to null (edge case)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareStatusNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.102' });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.upToDate, null);
                    assert.strictEqual(msg.payload.latestVersion, null);
                    assert.strictEqual(msg.payload.updating, false);
                    assert.strictEqual(msg.payload.status, null);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null });
        });
    });

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareStatusNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });

    it('errors when no Bosch config node is selected (error path)', function (done) {
        const flow = [
            { id: 'n1', type: 'bosch-camera-firmware-status', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([configNode, firmwareStatusNode], flow, function () {
            const logSpy = helper.log();
            const sawIt = logSpy.getCalls().some(function (call) {
                const arg = call.args[0];
                return arg && arg.level === helper._log.ERROR
                    && /No Bosch config node selected/.test(arg.msg);
            });
            assert.ok(sawIt, 'expected a "No Bosch config node selected" error log entry');
            done();
        });
    });

    it('reports an error when the cloud GET fails (error path, e.g. camera offline)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareStatusNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware').reply(444, 'offline');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: null });
        });
    });

    it('uses msg.cameraId to override the configured camera id (edge case)', function (done) {
        const OTHER_CAM = '11111111-0000-0000-0000-000000000002';
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareStatusNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + OTHER_CAM + '/firmware')
                .reply(200, { current: '1.0.0', upToDate: true, update: null, updating: false, status: 'idle' });

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, OTHER_CAM);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: null, cameraId: OTHER_CAM });
        });
    });
});
