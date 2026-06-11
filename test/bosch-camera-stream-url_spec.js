const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const streamUrlNode = require('../nodes/bosch-camera-stream-url.js');
const api = require('../nodes/lib/bosch-api.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';

// Fake camera ID — never real device values in fixtures.
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-stream-url', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    // ------------------------------------------------------------------ happy paths

    it('emits REMOTE rtsps + rtsp URLs in msg.payload (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              cameraId: FAKE_CAM, connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'REMOTE', highQualityVideo: true })
                .reply(200, {
                    rtspUrl:  'rtsp://u:p@proxy.example.com:554/live/fake',
                    rtspsUrl: 'rtsps://u:p@proxy.example.com:322/live/fake',
                    hlsUrl:   null
                });

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.rtsp,  'rtsp://u:p@proxy.example.com:554/live/fake');
                    assert.strictEqual(msg.payload.rtsps, 'rtsps://u:p@proxy.example.com:322/live/fake');
                    assert.strictEqual(msg.payload.hls,   null);
                    assert.strictEqual(msg.payload.connectionType, 'REMOTE');
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.ok(typeof msg.payload.timestamp === 'string');
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'go' });
        });
    });

    it('accepts LOCAL connection type from msg.connectionType (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              cameraId: FAKE_CAM, connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'LOCAL', highQualityVideo: true })
                .reply(200, {
                    rtspUrl: 'rtsp://192.0.2.1:554/live/fake'
                });

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.connectionType, 'LOCAL');
                    assert.ok(msg.payload.rtsp.startsWith('rtsp://'));
                    done();
                } catch (e) { done(e); }
            });
            // msg.connectionType overrides node config
            helper.getNode('n1').receive({ connectionType: 'LOCAL' });
        });
    });

    it('emits an HLS URL when only hlsUrl is present (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              cameraId: FAKE_CAM, connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'REMOTE', highQualityVideo: true })
                .reply(200, {
                    hlsUrl: 'https://proxy.example.com/hls/fake.m3u8'
                });

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.rtsp,  null);
                    assert.strictEqual(msg.payload.rtsps, null);
                    assert.strictEqual(msg.payload.hls, 'https://proxy.example.com/hls/fake.m3u8');
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'go' });
        });
    });

    it('accepts camera id override from msg.cameraId (happy path)', function (done) {
        const OVERRIDE_CAM = '22222222-0000-0000-0000-000000000002';
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            // Node has no cameraId configured — must come from msg
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(OVERRIDE_CAM) + '/connection',
                    { type: 'REMOTE', highQualityVideo: true })
                .reply(200, {
                    rtspsUrl: 'rtsps://u:p@proxy.example.com:322/live/override'
                });

            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, OVERRIDE_CAM);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ cameraId: OVERRIDE_CAM });
        });
    });

    // ------------------------------------------------------------------ error paths

    it('errors when the connection returns no usable URL (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              cameraId: FAKE_CAM, connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'REMOTE', highQualityVideo: true })
                .reply(200, {});  // empty response — no URL fields

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when the cloud PUT returns HTTP 500 (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg',
              cameraId: FAKE_CAM, connectionType: 'REMOTE', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, streamUrlNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection')
                .reply(500, 'server error');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    // ------------------------------------------------------------------ redactStreamUrl unit tests

    describe('api.redactStreamUrl', function () {
        it('redacts user:pass in an rtsp URL', function () {
            const raw = 'rtsp://alice:s3cr3t@proxy.example.com:554/live/cam';
            assert.strictEqual(api.redactStreamUrl(raw), 'rtsp://***:***@proxy.example.com:554/live/cam');
        });

        it('redacts user-only (no password) in an rtsps URL', function () {
            const raw = 'rtsps://alice@proxy.example.com:322/live/cam';
            assert.strictEqual(api.redactStreamUrl(raw), 'rtsps://***:***@proxy.example.com:322/live/cam');
        });

        it('leaves an https HLS URL untouched (no userinfo)', function () {
            const url = 'https://proxy.example.com/hls/cam.m3u8';
            assert.strictEqual(api.redactStreamUrl(url), url);
        });

        it('returns non-string values unchanged', function () {
            assert.strictEqual(api.redactStreamUrl(null), null);
            assert.strictEqual(api.redactStreamUrl(undefined), undefined);
        });
    });
});
