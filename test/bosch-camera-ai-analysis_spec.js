const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const aiAnalysisNode = require('../nodes/bosch-camera-ai-analysis.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const PROXY_HOST = 'https://proxy-1.live.cbs.boschsecurity.com:42090';

// Fake camera ID — never real device values in fixtures.
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

// Mocks one live-snapshot fetch cycle (open REMOTE connection -> GET jpeg).
function snapshotOk() {
    nock(CLOUD_HOST).put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection').reply(200, {
        urls: ['proxy-1.live.cbs.boschsecurity.com:42090/abc'],
        imageUrlScheme: 'https://{url}/snap.jpg'
    });
    nock(PROXY_HOST).get('/abc/snap.jpg')
        .reply(200, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { 'Content-Type': 'image/jpeg' });
}

describe('bosch-camera-ai-analysis', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    // ------------------------------------------------------------------ happy paths

    it('fetches the configured number of snapshots and emits images + prompt + schema (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', cameraId: FAKE_CAM,
              snapshotCount: 2, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, aiAnalysisNode], flow, creds, function () {
            tokenOk();
            snapshotOk();
            snapshotOk();

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.snapshotCount, 2);
                    assert.strictEqual(msg.payload.images.length, 2);
                    assert.ok(Buffer.isBuffer(msg.payload.images[0]));
                    assert.ok(typeof msg.payload.instructions === 'string' && msg.payload.instructions.length > 0);
                    assert.ok(msg.payload.structure && msg.payload.structure.score);
                    assert.strictEqual(msg.payload.structure.score.required, true);
                    assert.ok(typeof msg.payload.timestamp === 'string');

                    assert.strictEqual(msg.attachments.length, 2);
                    assert.strictEqual(msg.attachments[0].contentType, 'image/jpeg');
                    assert.ok(Buffer.isBuffer(msg.attachments[0].data));
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'go' });
        });
    });

    it('defaults to 3 snapshots when snapshotCount is not configured (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, aiAnalysisNode], flow, creds, function () {
            tokenOk();
            snapshotOk();
            snapshotOk();
            snapshotOk();

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.snapshotCount, 3);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'go' });
        });
    });

    it('honours a runtime msg.snapshotCount override, clamped to 1-10 (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', cameraId: FAKE_CAM,
              snapshotCount: 3, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, aiAnalysisNode], flow, creds, function () {
            tokenOk();
            snapshotOk();

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.snapshotCount, 1);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'go', snapshotCount: 1 });
        });
    });

    it('uses a custom instructions override from msg.instructions (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', cameraId: FAKE_CAM,
              snapshotCount: 1, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, aiAnalysisNode], flow, creds, function () {
            tokenOk();
            snapshotOk();

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.instructions, 'custom test prompt');
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'go', instructions: 'custom test prompt' });
        });
    });

    // ------------------------------------------------------------------ error paths

    it('errors when no camera id is available (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, aiAnalysisNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when a snapshot fetch fails mid-burst (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', cameraId: FAKE_CAM,
              snapshotCount: 2, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, aiAnalysisNode], flow, creds, function () {
            tokenOk();
            snapshotOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection')
                .reply(200, { urls: [], imageUrlScheme: 'https://{url}/snap.jpg' });

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when the config node has no refresh token (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-ai-analysis', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([configNode, aiAnalysisNode], flow, {}, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });
});
