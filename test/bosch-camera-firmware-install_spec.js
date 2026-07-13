const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const firmwareInstallNode = require('../nodes/bosch-camera-firmware-install.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-firmware-install', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('triggers an install when confirmed and an update is available (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.102', upToDate: false, update: '9.40.104', updating: false, status: 'available' });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/firmware', { id: '9.40.104' })
                .reply(204);

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.triggered, true);
                    assert.strictEqual(msg.payload.reason, null);
                    assert.strictEqual(msg.payload.installedVersion, '9.40.102');
                    assert.strictEqual(msg.payload.targetVersion, '9.40.104');
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { confirm: true } });
        });
    });

    it('does NOT call the network at all when not confirmed (safety gate, error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            // Deliberately no nock interceptors registered at all — any HTTP
            // call this node made would throw "Nock: No match for request".
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'trigger' });
        });
    });

    it('rejects a truthy-but-not-boolean-true confirm value (safety gate, edge case)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: { confirm: 'true' } });
        });
    });

    it('rejects when msg.payload is missing entirely (safety gate, edge case)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({});
        });
    });

    it('reports up_to_date without calling PUT when already up to date (happy path, no-op)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.104', upToDate: true, update: null, updating: false, status: 'idle' });
            // No PUT interceptor registered — a PUT call would fail the test.

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.triggered, false);
                    assert.strictEqual(msg.payload.reason, 'up_to_date');
                    assert.strictEqual(msg.payload.success, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { confirm: true } });
        });
    });

    it('reports already_updating without calling PUT when camera already updating (edge case)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.102', upToDate: false, update: '9.40.104', updating: true, status: 'updating' });
            // No PUT interceptor registered — a PUT call would fail the test.

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.triggered, false);
                    assert.strictEqual(msg.payload.reason, 'already_updating');
                    assert.strictEqual(msg.payload.updating, true);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: { confirm: true } });
        });
    });

    it('rejects a second overlapping confirm while the first install is still in flight (busy guard, edge case)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            tokenOk();
            // Delay the GET response so the second message arrives while the
            // node is still awaiting the first's cloud round-trip.
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .delay(50)
                .reply(200, { current: '9.40.102', upToDate: false, update: '9.40.104', updating: false, status: 'available' });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/firmware', { id: '9.40.104' })
                .reply(204);

            const n1 = helper.getNode('n1');
            let sawBusyError = false;
            let sawTriggered = false;

            n1.error = function (err) {
                if (/already in flight/.test(err && err.message)) {
                    sawBusyError = true;
                    maybeFinish();
                }
            };
            helper.getNode('h1').on('input', function (msg) {
                if (msg.payload.triggered === true) {
                    sawTriggered = true;
                    maybeFinish();
                }
            });

            function maybeFinish() {
                if (sawBusyError && sawTriggered) { done(); }
            }

            n1.receive({ payload: { confirm: true } });
            // Fired synchronously right after — the first request's GET is
            // still pending (delayed 50ms), so this must be rejected locally
            // without ever making its own network call.
            n1.receive({ payload: { confirm: true } });
        });
    });

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: { confirm: true } });
        });
    });

    it('errors when no Bosch config node is selected (error path)', function (done) {
        const flow = [
            { id: 'n1', type: 'bosch-camera-firmware-install', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([configNode, firmwareInstallNode], flow, function () {
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

    it('reports an error and releases the busy guard when the cloud GET fails (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware').reply(444, 'offline');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () {
                if (fired) { return; }
                fired = true;
                // Busy guard must have been released — a follow-up confirmed
                // request should reach the network again, not be blocked.
                tokenOk();
                nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                    .reply(200, { current: '1.0.0', upToDate: true, update: null, updating: false, status: 'idle' });
                helper.getNode('h1').on('input', function (msg) {
                    try {
                        assert.strictEqual(msg.payload.reason, 'up_to_date');
                        done();
                    } catch (e) { done(e); }
                });
                n1.receive({ payload: { confirm: true } });
            };
            n1.receive({ payload: { confirm: true } });
        });
    });

    it('reports an error when the install PUT fails (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-install', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, firmwareInstallNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).get('/v11/video_inputs/' + FAKE_CAM + '/firmware')
                .reply(200, { current: '9.40.102', upToDate: false, update: '9.40.104', updating: false, status: 'available' });
            nock(CLOUD_HOST).put('/v11/video_inputs/' + FAKE_CAM + '/firmware', { id: '9.40.104' })
                .reply(500, 'server error');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: { confirm: true } });
        });
    });
});
