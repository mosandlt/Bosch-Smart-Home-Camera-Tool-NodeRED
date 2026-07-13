const assert = require('assert');
const { EventEmitter } = require('events');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const nvrRecordNode = require('../nodes/bosch-camera-nvr-record.js');

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
            { type: 'LOCAL', highQualityVideo: true })
        .reply(200, { rtspUrl: 'rtsp://u:p@192.0.2.1:554/live/fake', rtspsUrl: rtsps });
}

// Minimal fake ffmpeg child_process — an EventEmitter with pid/kill(), no
// real subprocess is ever spawned in these tests.
function makeFakeChild(pid) {
    const child = new EventEmitter();
    child.pid = pid || 4242;
    child.killedWith = [];
    child.kill = function (signal) { child.killedWith.push(signal); };
    return child;
}

describe('bosch-camera-nvr-record', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    // ------------------------------------------------------------------ happy paths

    it('spawns ffmpeg with the expected args and emits recording:true (happy path, start)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', segmentTime: 60,
              ffmpegPath: 'ffmpeg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawnArgs = null;
            n1._spawn = function (cmd, args) {
                spawnArgs = { cmd, args };
                return makeFakeChild();
            };

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.cam, FAKE_CAM);
                    assert.strictEqual(msg.payload.recording, true);
                    assert.strictEqual(msg.payload.pid, 4242);
                    assert.strictEqual(msg.payload.outputDir, '/data/nvr/fake');

                    assert.strictEqual(spawnArgs.cmd, 'ffmpeg');
                    assert.ok(spawnArgs.args.includes('rtsps://u:p@192.0.2.1:322/live/fake'));
                    assert.ok(spawnArgs.args.includes('-segment_time'));
                    assert.strictEqual(spawnArgs.args[spawnArgs.args.indexOf('-segment_time') + 1], '60');
                    assert.ok(spawnArgs.args.includes('-c'));
                    assert.ok(spawnArgs.args.includes('copy'));
                    assert.ok(spawnArgs.args[spawnArgs.args.length - 1].endsWith('%Y%m%d-%H%M%S.mp4'));
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('falls back to plain rtsp when no rtsps URL is returned (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk(undefined);

            const n1 = helper.getNode('n1');
            let spawnArgs = null;
            n1._spawn = function (cmd, args) { spawnArgs = args; return makeFakeChild(); };

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.recording, true);
                    assert.ok(spawnArgs.includes('rtsp://u:p@192.0.2.1:554/live/fake'));
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ topic: 'start' });
        });
    });

    it('does not spawn a second ffmpeg while already recording (idempotent start)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawnCount = 0;
            n1._spawn = function () { spawnCount += 1; return makeFakeChild(); };

            let calls = 0;
            helper.getNode('h1').on('input', function (msg) {
                calls += 1;
                try {
                    assert.strictEqual(msg.payload.recording, true);
                    if (calls === 1) {
                        // First start has fully resolved (child is set) —
                        // NOW send a second start and confirm it's a no-op.
                        n1.receive({ payload: 'start' });
                    } else {
                        assert.strictEqual(spawnCount, 1);
                        done();
                    }
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('sends SIGTERM to the active ffmpeg on a stop message (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            let stage = 'start';
            helper.getNode('h1').on('input', function (msg) {
                try {
                    if (stage === 'start') {
                        assert.strictEqual(msg.payload.recording, true);
                        stage = 'stop';
                        n1.receive({ payload: 'stop' });
                    } else {
                        assert.strictEqual(msg.payload.recording, false);
                        assert.strictEqual(msg.payload.pid, 4242);
                        assert.deepStrictEqual(fakeChild.killedWith, ['SIGTERM']);
                        done();
                    }
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('reports recording:false with pid null when stopped while idle (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.recording, false);
                    assert.strictEqual(msg.payload.pid, null);
                    done();
                } catch (e) { done(e); }
            });
            helper.getNode('n1').receive({ payload: 'stop' });
        });
    });

    it('autostarts recording on deploy when autostart is enabled (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', autostart: true, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawned = false;
            n1._spawn = function () { spawned = true; return makeFakeChild(); };

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(spawned, true);
                    assert.strictEqual(msg.payload.recording, true);
                    done();
                } catch (e) { done(e); }
            });
            // n1._spawn is wired up synchronously above, before the node's
            // autostart setImmediate() callback gets a chance to run.
        });
    });

    it('escalates to SIGKILL when ffmpeg ignores SIGTERM past the stop grace (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', stopGraceMs: 50, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            let started = false;
            helper.getNode('h1').on('input', function (msg) {
                if (!started) {
                    started = true;
                    assert.strictEqual(msg.payload.recording, true);
                    n1.receive({ payload: 'stop' });
                    // Fake ffmpeg never actually exits — wait past stopGraceMs
                    // and assert the escalation fired.
                    setTimeout(function () {
                        try {
                            assert.deepStrictEqual(fakeChild.killedWith, ['SIGTERM', 'SIGKILL']);
                            done();
                        } catch (e) { done(e); }
                    }, 150);
                }
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('sends SIGTERM on node close/redeploy while recording (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () {
                fakeChild = makeFakeChild();
                // Simulate a real ffmpeg terminating once signalled, so the
                // node's close handler's exit-wait resolves promptly.
                const originalKill = fakeChild.kill;
                fakeChild.kill = function (signal) {
                    originalKill(signal);
                    setImmediate(function () { fakeChild.emit('exit', null, signal); });
                };
                return fakeChild;
            };

            helper.getNode('h1').on('input', function () {
                // Recording started — now unload (undeploy) the flow and
                // verify the node's close handler sent SIGTERM.
                helper.unload().then(function () {
                    try {
                        assert.deepStrictEqual(fakeChild.killedWith, ['SIGTERM']);
                        done();
                    } catch (e) { done(e); }
                });
            });
            n1.receive({ payload: 'start' });
        });
    });

    // ------------------------------------------------------------------ error paths

    it('errors when no camera id is configured or in msg (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg',
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'start' });
        });
    });

    it('errors when no Bosch config node is selected (error path)', function (done) {
        const flow = [
            { id: 'n1', type: 'bosch-camera-nvr-record', cameraId: FAKE_CAM,
              outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([configNode, nvrRecordNode], flow, function () {
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

    it('errors when no output directory is configured (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
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

    it('errors on an unrecognised command (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'banana' });
        });
    });

    it('errors when the stream connection returns no RTSP(S)/HLS URL at all (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'LOCAL', highQualityVideo: true })
                .reply(200, {});

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'start' });
        });
    });

    it('errors when the cloud PUT returns HTTP 500 (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection')
                .reply(500, 'server error');

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'start' });
        });
    });

    it('logs an error and turns the status red when ffmpeg exits unexpectedly', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            let sawErrorAfterCrash = false;
            const origError = n1.error;
            n1.error = function (msg) {
                if (typeof msg === 'string' && msg.indexOf('exited unexpectedly') !== -1) {
                    sawErrorAfterCrash = true;
                    try {
                        assert.strictEqual(sawErrorAfterCrash, true);
                        done();
                    } catch (e) { done(e); }
                } else if (origError) {
                    origError.apply(n1, arguments);
                }
            };

            helper.getNode('h1').on('input', function () {
                // Recording started successfully — now simulate ffmpeg dying
                // on its own (e.g. camera dropped the connection).
                fakeChild.emit('exit', 1, null);
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('errors when the camera only returns an HLS URL (no RTSP/RTSPS to feed ffmpeg)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'LOCAL', highQualityVideo: true })
                .reply(200, { hlsUrl: 'https://proxy.example.com/hls/fake.m3u8' });

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function (msg) {
                if (!fired) {
                    fired = true;
                    try {
                        assert.ok(/HLS-only cameras cannot be recorded/.test(msg));
                        done();
                    } catch (e) { done(e); }
                }
            };
            n1.receive({ payload: 'start' });
        });
    });

    it('turns status red and logs an error when ffmpeg fails to spawn', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            let fired = false;
            n1.error = function (msg) {
                if (!fired && typeof msg === 'string' && msg.indexOf('failed to start/run') !== -1) {
                    fired = true;
                    done();
                }
            };

            helper.getNode('h1').on('input', function () {
                // Recording started successfully — now simulate ffmpeg
                // failing after the fact (e.g. binary removed, ENOENT-style).
                fakeChild.emit('error', new Error('spawn ffmpeg ENOENT'));
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('returns to idle status after a clean stop-triggered exit (not node-close)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            const statusCalls = [];
            const origStatus = n1.status;
            n1.status = function (s) {
                statusCalls.push(s);
                if (origStatus) { origStatus.apply(n1, arguments); }
            };

            let stage = 'start';
            helper.getNode('h1').on('input', function (msg) {
                if (stage === 'start') {
                    stage = 'stop';
                    assert.strictEqual(msg.payload.recording, true);
                    n1.receive({ payload: 'stop' });
                    // Simulate ffmpeg actually exiting in response to SIGTERM,
                    // same as a real process would, without closing the node.
                    setImmediate(function () { fakeChild.emit('exit', null, 'SIGTERM'); });
                    setImmediate(function () {
                        setImmediate(function () {
                            try {
                                const idle = statusCalls.some(function (s) {
                                    return s && s.text === 'idle' && s.fill === 'grey';
                                });
                                assert.ok(idle, 'expected an idle status after the clean stop-triggered exit');
                                done();
                            } catch (e) { done(e); }
                        });
                    });
                }
            });
            n1.receive({ payload: 'start' });
        });
    });

    // ------------------------------------------------------------------ regression: state-machine races
    // (found by a THREE_PER_ISSUE_PER_CHANGE adversarial bug-hunt on the
    // original child-null-check implementation)

    it('does not spawn ffmpeg twice when two start messages arrive back-to-back before the cloud connection resolves (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawnCount = 0;
            n1._spawn = function () { spawnCount += 1; return makeFakeChild(); };

            const received = [];
            helper.getNode('h1').on('input', function (msg) {
                received.push(msg.payload);
                if (received.length === 2) {
                    try {
                        assert.strictEqual(spawnCount, 1);
                        assert.ok(received.every(function (p) { return p.recording === true; }));
                        done();
                    } catch (e) { done(e); }
                }
            });
            // Both fire synchronously, before the getAccessToken/getStreamUrl
            // promises have a chance to resolve — the second must see the
            // node already in the 'starting' state and short-circuit instead
            // of racing a duplicate spawn.
            n1.receive({ payload: 'start' });
            n1.receive({ payload: 'start' });
        });
    });

    it('never spawns ffmpeg when a stop arrives while still opening the connection (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawnCount = 0;
            n1._spawn = function () { spawnCount += 1; return makeFakeChild(); };

            const received = [];
            helper.getNode('h1').on('input', function (msg) {
                received.push(msg.payload);
                if (received.length === 2) {
                    try {
                        assert.strictEqual(spawnCount, 0);
                        assert.ok(received.every(function (p) { return p.recording === false; }));
                        done();
                    } catch (e) { done(e); }
                }
            });
            n1.receive({ payload: 'start' });
            n1.receive({ payload: 'stop' });
        });
    });

    it('does not re-signal or re-arm the escalation timer on a second stop while already stopping (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            let stage = 'start';
            helper.getNode('h1').on('input', function (msg) {
                if (stage !== 'start') { return; }
                stage = 'done-with-start';
                assert.strictEqual(msg.payload.recording, true);
                n1.receive({ payload: 'stop' });
                n1.receive({ payload: 'stop' });
                setImmediate(function () {
                    try {
                        // Exactly one SIGTERM despite two 'stop' messages —
                        // the second must not re-signal or re-arm the timer.
                        assert.deepStrictEqual(fakeChild.killedWith, ['SIGTERM']);
                        done();
                    } catch (e) { done(e); }
                });
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('errors when a start is requested while a stop is still in progress, instead of falsely reporting recording:true (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            // Fake child never auto-exits on kill(), so the node stays
            // 'stopping' for the rest of this test.
            n1._spawn = function () { return makeFakeChild(); };

            let expectError = false;
            n1.error = function (err) {
                if (!expectError) { return; }
                try {
                    assert.ok(/stop is still in progress/.test(err.message));
                    done();
                } catch (e) { done(e); }
            };

            let stage = 'start';
            helper.getNode('h1').on('input', function (msg) {
                if (stage !== 'start') { return; }
                stage = 'stopping';
                assert.strictEqual(msg.payload.recording, true);
                n1.receive({ payload: 'stop' });
                expectError = true;
                n1.receive({ payload: 'start' });
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('normalises msg.topic case-insensitively (regression: topic precedence bug)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            n1._spawn = function () { return makeFakeChild(); };

            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.recording, true);
                    done();
                } catch (e) { done(e); }
            });
            // Mixed-case topic, payload deliberately irrelevant/garbage —
            // topic must still be recognised and take precedence.
            n1.receive({ topic: 'On', payload: 'ignored-garbage' });
        });
    });

    it('falls back to msg.payload when msg.topic does not normalise to a command (regression: topic precedence bug)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            helper.getNode('h1').on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.recording, false);
                    assert.strictEqual(msg.payload.pid, null);
                    done();
                } catch (e) { done(e); }
            });
            // Unrelated topic (common generic MQTT/event-bus convention) must
            // NOT hijack this node — it should fall back to msg.payload.
            n1.receive({ topic: 'sensor/data', payload: 'stop' });
        });
    });

    it('treats an explicit segmentTime/stopGraceMs of 0 as garbage-clamped, not silently replaced by the default (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', segmentTime: 0, stopGraceMs: 0,
              wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let spawnArgs = null;
            n1._spawn = function (cmd, args) { spawnArgs = args; return makeFakeChild(); };

            helper.getNode('h1').on('input', function () {
                try {
                    // 0 is explicit input, not "unset" — it must be clamped to
                    // the configured minimum, not silently replaced by the
                    // 300s/5000ms defaults (parseInt(...) || fallback would
                    // do that, since 0 is falsy).
                    assert.strictEqual(spawnArgs[spawnArgs.indexOf('-segment_time') + 1], '10');
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'start' });
        });
    });

    // ------------------------------------------------------------------ regression: close() mid-flight
    // (found by a second THREE_PER_ISSUE_PER_CHANGE adversarial round on the
    // state-machine fix itself — close() while 'starting' or 'stopping' used
    // to short-circuit instead of preventing/awaiting the in-flight process)

    it('never spawns ffmpeg if the node is closed/undeployed while still opening the connection (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            // Local (not the shared tokenOk()/connectionOk() helpers) so we
            // can poll isDone() below — this test deliberately races
            // helper.unload() against these two mocked HTTP calls, and must
            // not let mocha finish (triggering afterEach's nock.cleanAll())
            // until both have actually been consumed. Otherwise cleanAll()
            // can strip a not-yet-matched interceptor out from under a
            // still-in-flight axios call, which then falls through to a real
            // (blocked, in this sandbox) network request and hangs for up to
            // axios's own 15s timeout — a test-infra flake, not a product bug.
            const tokenScope = nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
            const connScope = nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection',
                    { type: 'LOCAL', highQualityVideo: true })
                .reply(200, { rtspsUrl: 'rtsps://u:p@192.0.2.1:322/live/fake' });

            const n1 = helper.getNode('n1');
            let spawnCount = 0;
            n1._spawn = function () { spawnCount += 1; return makeFakeChild(); };

            // Fire 'start' (kicks off the async getAccessToken/getStreamUrl
            // chain, nothing spawned yet) and unload the flow in the same
            // tick, before those nocked HTTP calls have a chance to resolve.
            n1.receive({ payload: 'start' });
            helper.unload().then(function () {
                (function waitForNockThenAssert(attemptsLeft) {
                    if (tokenScope.isDone() && connScope.isDone()) {
                        try {
                            assert.strictEqual(spawnCount, 0);
                            done();
                        } catch (e) { done(e); }
                        return;
                    }
                    if (attemptsLeft <= 0) {
                        done(new Error('mocked HTTP calls never settled — cannot safely finish this test'));
                        return;
                    }
                    setTimeout(function () { waitForNockThenAssert(attemptsLeft - 1); }, 10);
                })(50);
            });
        });
    });

    it('still waits for ffmpeg to exit when the node is closed/undeployed while already stopping (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', stopGraceMs: 50, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            tokenOk();
            connectionOk('rtsps://u:p@192.0.2.1:322/live/fake');

            const n1 = helper.getNode('n1');
            let fakeChild = null;
            n1._spawn = function () { fakeChild = makeFakeChild(); return fakeChild; };

            helper.getNode('h1').on('input', function (msg) {
                if (msg.payload.recording !== true) { return; }
                // Recording started — request a stop (state -> 'stopping',
                // SIGTERM sent, escalation timer armed) but the fake ffmpeg
                // never actually exits on its own...
                n1.receive({ payload: 'stop' });
                // ...then close/undeploy the node WHILE it's already
                // 'stopping'. Before this fix, close() would short-circuit
                // immediately here (only 'recording' was treated as
                // "something to wait for"), silently reporting undeploy as
                // done without ever confirming ffmpeg actually exited.
                helper.unload().then(function () {
                    try {
                        // unload() only resolves once ffmpeg is confirmed
                        // gone — here via the escalation timer armed by the
                        // 'stop' message itself (SIGTERM then SIGKILL, since
                        // the fake child never emits 'exit' on its own), and
                        // NOT via close() short-circuiting instantly, which
                        // is what this regression guards against.
                        assert.deepStrictEqual(fakeChild.killedWith, ['SIGTERM', 'SIGKILL']);
                        done();
                    } catch (e) { done(e); }
                });
            });
            n1.receive({ payload: 'start' });
        });
    });

    it('does not touch the (destroyed) node when a mid-flight connection attempt fails after close (regression)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-nvr-record', server: 'cfg', cameraId: FAKE_CAM,
              connectionType: 'LOCAL', outputDir: '/data/nvr/fake', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, nvrRecordNode], flow, creds, function () {
            // Local scopes (not the shared tokenOk()/connectionOk() helpers)
            // so this test's own polling below can confirm both have been
            // consumed before finishing — same nock/afterEach race-avoidance
            // reasoning as the "never spawns... still opening" test above.
            const tokenScope = nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
            // The connection PUT fails (HTTP 500) — the async chain's
            // .catch() branch runs, not the cancelRequested-abort branch.
            const connScope = nock(CLOUD_HOST)
                .put('/v11/video_inputs/' + encodeURIComponent(FAKE_CAM) + '/connection')
                .reply(500, 'server error');

            const n1 = helper.getNode('n1');
            let statusOrErrorCalledAfterClose = false;
            const origStatus = n1.status;
            const origError = n1.error;

            // Fire 'start' (kicks off the async chain that will eventually
            // reject) and unload in the same tick, before the nocked HTTP
            // call has a chance to resolve/reject.
            n1.receive({ payload: 'start' });
            helper.unload().then(function () {
                // From this point on, the node is torn down — if the
                // pending .catch() branch's `if (closed) { return; }` guard
                // were missing, it would call node.status()/node.error()/
                // done(err) on this now-destroyed instance.
                n1.status = function () { statusOrErrorCalledAfterClose = true; if (origStatus) { origStatus.apply(n1, arguments); } };
                n1.error = function () { statusOrErrorCalledAfterClose = true; if (origError) { origError.apply(n1, arguments); } };

                (function waitForNockThenAssert(attemptsLeft) {
                    if (tokenScope.isDone() && connScope.isDone()) {
                        try {
                            assert.strictEqual(statusOrErrorCalledAfterClose, false);
                            done();
                        } catch (e) { done(e); }
                        return;
                    }
                    if (attemptsLeft <= 0) {
                        done(new Error('mocked HTTP calls never settled — cannot safely finish this test'));
                        return;
                    }
                    setTimeout(function () { waitForNockThenAssert(attemptsLeft - 1); }, 10);
                })(50);
            });
        });
    });
});
