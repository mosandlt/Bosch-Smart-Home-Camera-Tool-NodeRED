const assert = require('assert');
const { EventEmitter } = require('events');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const postrollNode = require('../nodes/bosch-camera-postroll-capture.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';

// Fake camera ID — never real device values in fixtures.
const FAKE_CAM = '11111111-0000-0000-0000-000000000001';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

function connectionOk(rtsps) {
    nock(CLOUD_HOST)
        .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
            { type: 'LOCAL', highQualityVideo: false })
        .reply(200, { rtspUrl: 'rtsp://u:p@192.0.2.1:554/live/fake', rtspsUrl: rtsps });
}

// Minimal fake ffmpeg child_process — an EventEmitter with pid/kill()/stderr,
// no real subprocess is ever spawned in these tests.
function makeFakeChild(pid) {
    const child = new EventEmitter();
    child.pid = pid || 4242;
    child.stderr = new EventEmitter();
    child.killedWith = [];
    child.kill = function (signal) { child.killedWith.push(signal); };
    return child;
}

describe('bosch-camera-postroll-capture', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    // ------------------------------------------------------------------ happy paths

    it('spawns ffmpeg with a bounded -t <seconds> capture and emits the file path on success (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', seconds: 10,
              ffmpegPath: 'ffmpeg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawnArgs = null;
            n1._spawn = function (cmd, args) {
                spawnArgs = { cmd, args };
                const spawned = makeFakeChild();
                // ffmpeg "finishes" cleanly right after spawn.
                setImmediate(function () { spawned.emit('exit', 0, null); });
                return spawned;
            };

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.ok(msg.payload.file.startsWith('/data/nvr/fake/postroll/postroll-' + FAKE_CAM + '-'));
                    assert.ok(msg.payload.file.endsWith('.mp4'));
                    assert.strictEqual(msg.payload.seconds, 10);
                    assert.strictEqual(msg.payload.connectionType, 'LOCAL');
                    assert.strictEqual(msg.payload.quality, 'auto');

                    assert.strictEqual(spawnArgs.cmd, 'ffmpeg');
                    assert.ok(spawnArgs.args.includes('rtsps://u:p@192.0.2.1:322/live/fake?inst=2'));
                    assert.ok(spawnArgs.args.includes('-t'));
                    assert.strictEqual(spawnArgs.args[spawnArgs.args.indexOf('-t') + 1], '10');
                    assert.ok(spawnArgs.args.includes('-c'));
                    assert.ok(spawnArgs.args.includes('copy'));
                    assert.ok(spawnArgs.args.includes('-analyzeduration'));
                    assert.ok(spawnArgs.args.includes('-movflags'));
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'go' });
        });
    });

    it('honours a runtime msg.seconds override, clamped to the 1-60 range (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', seconds: 10, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            n1._spawn = function () {
                const spawned = makeFakeChild();
                setImmediate(function () { spawned.emit('exit', 0, null); });
                return spawned;
            };

            helper.getNode('h1').on('input', function (msg) {
                try {
                    // 999 is clamped down to MAX_SECONDS (60).
                    assert.strictEqual(msg.payload.seconds, 60);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'go', seconds: 999 });
        });
    });

    // ------------------------------------------------------------------ error paths

    it('errors when ffmpeg exits non-zero (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            n1._spawn = function () {
                const spawned = makeFakeChild();
                setImmediate(function () { spawned.emit('exit', 1, null); });
                return spawned;
            };
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };

            n1.receive({ payload: 'go' });
        });
    });

    it('errors on a second trigger while a capture is already in progress (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            n1._spawn = function () { return makeFakeChild(); };
            let fired = false;
            n1.error = function (err) {
                if (!fired) {
                    fired = true;
                    try {
                        assert.ok(/already in progress/.test(err.message));
                        done();
                    } catch (e) { done(e); }
                }
            };

            n1.receive({ payload: 'go' });
            // Fires synchronously against the still-'capturing' state (the
            // first receive() is mid-flight on the async token/connection
            // chain when this second one arrives).
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when no camera id is available (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg',
              outputDir: '/data/nvr/fake/postroll', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when no output dir is configured (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            const logSpy = helper.log();
            const sawIt = logSpy.getCalls().some(function (call) {
                const arg = call.args[0];
                return arg && arg.level === helper._log.ERROR
                    && /No output directory configured/.test(arg.msg);
            });
            assert.ok(sawIt, 'expected a "No output directory configured" error log entry');
            done();
        });
    });

    it('errors when ffmpeg fails to spawn (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            n1._spawn = function () {
                const spawned = makeFakeChild();
                setImmediate(function () { spawned.emit('error', new Error('ENOENT')); });
                return spawned;
            };
            let fired = false;
            n1.error = function (err) {
                if (!fired) {
                    fired = true;
                    try {
                        assert.ok(/failed to start\/run/.test(err.message));
                        done();
                    } catch (e) { done(e); }
                }
            };

            n1.receive({ payload: 'go' });
        });
    });

    it('kills ffmpeg and waits for exit on node close/undeploy mid-capture (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', stopGraceMs: 100, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawned = null;
            n1._spawn = function () { spawned = makeFakeChild(); return spawned; };

            n1.receive({ payload: 'go' });
            // Wait for the (mocked, async) cloud connection to resolve and
            // ffmpeg to actually spawn before triggering close/undeploy.
            const waitForSpawn = setInterval(function () {
                if (!spawned) { return; }
                clearInterval(waitForSpawn);
                helper.unload().then(function () {
                    try {
                        assert.ok(spawned.killedWith.includes('SIGTERM'));
                        done();
                    } catch (e) { done(e); }
                });
                // helper.unload() resolves once close() calls done() —
                // the node's close handler waits for the child's 'exit'.
                setImmediate(function () { spawned.emit('exit', null, 'SIGTERM'); });
            }, 5);
        });
    });

    it('errors when the stream connection returns no RTSP(S) URL (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-postroll-capture', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake/postroll', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, postrollNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'LOCAL', highQualityVideo: false })
                .reply(200, { hlsUrl: 'https://proxy.example.com/hls/fake.m3u8' });

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });
});
