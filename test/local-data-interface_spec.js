const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const statusNode = require('../nodes/bosch-camera-firmware-status.js');
const streamNode = require('../nodes/bosch-camera-stream-url.js');
const api = require('../nodes/lib/bosch-api.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD = 'https://residential.cbs.boschsecurity.com';
const CAM = '11111111-0000-0000-0000-000000000001';
const BASE = '/v11/video_inputs/' + CAM;
const PW = 'test-pw';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}
function fw(v) {
    nock(CLOUD).get(BASE + '/firmware').reply(200, { current: v, upToDate: true, updating: false });
}

describe('local data interface helpers', function () {
    it('firmware gate', function () {
        assert.strictEqual(api.firmwareSupportsLdi('9.40.105'), true);
        assert.strictEqual(api.firmwareSupportsLdi('9.40.202'), true);
        assert.strictEqual(api.firmwareSupportsLdi('9.41'), true);
        assert.strictEqual(api.firmwareSupportsLdi('10.0.0'), true);
        assert.strictEqual(api.firmwareSupportsLdi('9.40.104'), false);
        assert.strictEqual(api.firmwareSupportsLdi('9.40.99'), false);
        assert.strictEqual(api.firmwareSupportsLdi('7.0.0'), false);
        assert.strictEqual(api.firmwareSupportsLdi(null), false);
        assert.strictEqual(api.firmwareSupportsLdi(undefined), false);
        assert.strictEqual(api.firmwareSupportsLdi(''), false);
        assert.strictEqual(api.firmwareSupportsLdi('9.40.x'), false);
        assert.strictEqual(api.firmwareSupportsLdi('9.-1.5'), false);
        assert.strictEqual(api.firmwareSupportsLdi('9' + '9'.repeat(400) + '.0.0'), false);
        assert.strictEqual(api.firmwareSupportsLdi(9405), false);
    });
    it('maps HTTP results to states', function () {
        assert.deepStrictEqual(api.ldiStateFromResponse(200, { username: 'u' }), { state: 'active', username: 'u' });
        assert.strictEqual(api.ldiStateFromResponse(200, {}), null);
        assert.strictEqual(api.ldiStateFromResponse(200, 'junk'), null);
        assert.strictEqual(api.ldiStateFromResponse(200, null), null);
        assert.deepStrictEqual(api.ldiStateFromResponse(404, null), { state: 'inactive' });
        assert.deepStrictEqual(api.ldiStateFromResponse(449, null), { state: 'unsupported' });
        assert.strictEqual(api.ldiStateFromResponse(500, null), null);
        assert.strictEqual(api.ldiStateFromResponse(401, { username: 'u' }), null);
    });
    it('validates LAN hosts', function () {
        ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.2'].forEach(function (h) {
            assert.strictEqual(api.isSafeLanHost(h), true, h);
        });
        ['127.0.0.1', '169.254.169.254', '0.0.0.0', '8.8.8.8', '172.32.0.1', '::1', 'cam.local', '', null, undefined, '10.0.0.5:9554']
            .forEach(function (h) { assert.strictEqual(api.isSafeLanHost(h), false, String(h)); });
    });
    it('url-quotes the password', function () {
        assert.strictEqual(api.ldiSourceUrl('10.0.0.5', 'p@:/ w'),
            'rtsps://localuser:p%40%3A%2F%20w@10.0.0.5:9554/rtsp_tunnel?line=1&inst=1&enableaudio=1');
    });
    const B = 'rtsps://localuser:pw@10.0.0.5:9554/rtsp_tunnel?line=1';
    [['high', true, 1, 1], ['high', false, 1, 0], ['low', true, 2, 1], ['low', false, 2, 0],
        ['auto', true, 1, 1], ['garbage', true, 1, 1], [undefined, undefined, 1, 1]].forEach(function (c) {
        it('url mode quality=' + c[0] + ' audio=' + c[1], function () {
            assert.strictEqual(api.ldiSourceUrl('10.0.0.5', 'pw', c[0], c[1]), `${B}&inst=${c[2]}&enableaudio=${c[3]}`);
        });
    });
    it('status read maps 200/404/449/garbage/network error', async function () {
        nock(CLOUD).get(BASE + '/onvif_user').reply(200, { username: 'localuser' });
        assert.deepStrictEqual(await api.getLocalDataInterface('AT', CAM), { state: 'active', username: 'localuser' });
        nock(CLOUD).get(BASE + '/onvif_user').reply(404, { error: 'x' });
        assert.deepStrictEqual(await api.getLocalDataInterface('AT', CAM), { state: 'inactive' });
        nock(CLOUD).get(BASE + '/onvif_user').reply(449, {});
        assert.deepStrictEqual(await api.getLocalDataInterface('AT', CAM), { state: 'unsupported' });
        nock(CLOUD).get(BASE + '/onvif_user').reply(200, 'not json');
        assert.strictEqual(await api.getLocalDataInterface('AT', CAM), null);
        nock(CLOUD).get(BASE + '/onvif_user').reply(503, {});
        assert.strictEqual(await api.getLocalDataInterface('AT', CAM), null);
        nock(CLOUD).get(BASE + '/onvif_user').replyWithError('boom');
        assert.strictEqual(await api.getLocalDataInterface('AT', CAM), null);
        nock.cleanAll();
    });
});

describe('firmware-status local data interface', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    function run(setup, inputMsg, check, done, repeats) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-firmware-status', server: 'cfg', cameraId: CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([configNode, statusNode], flow, { cfg: { refreshToken: 'rt' } }, function () {
            tokenOk();
            setup();
            let n = 0;
            helper.getNode('h1').on('input', function (msg) {
                n++;
                try { check(msg, n); } catch (e) { return done(e); }
                if (n >= (repeats || 1)) { done(); }
                else { tokenOk(); setup(); helper.getNode('n1').receive(inputMsg || {}); }
            });
            helper.getNode('n1').receive(inputMsg || {});
        });
    }

    it('active', function (done) {
        run(function () {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(200, { username: 'localuser' });
        }, {}, function (msg) {
            assert.deepStrictEqual(msg.payload.localDataInterface, { state: 'active', username: 'localuser' });
        }, done);
    });
    it('inactive (404)', function (done) {
        run(function () { fw('9.40.105'); nock(CLOUD).get(BASE + '/onvif_user').reply(404, {}); }, {},
            function (msg) { assert.deepStrictEqual(msg.payload.localDataInterface, { state: 'inactive' }); }, done);
    });
    it('unsupported (449)', function (done) {
        run(function () { fw('9.40.105'); nock(CLOUD).get(BASE + '/onvif_user').reply(449, {}); }, {},
            function (msg) { assert.deepStrictEqual(msg.payload.localDataInterface, { state: 'unsupported' }); }, done);
    });
    it('firmware too old: not queried', function (done) {
        run(function () { fw('9.40.104'); }, {}, function (msg) {
            assert.strictEqual(msg.payload.localDataInterface, null);
            assert.ok(!nock.pendingMocks().length);
        }, done);
    });
    it('firmware null: not queried', function (done) {
        run(function () { nock(CLOUD).get(BASE + '/firmware').reply(200, { upToDate: null }); }, {},
            function (msg) { assert.strictEqual(msg.payload.localDataInterface, null); }, done);
    });
    it('Gen1 skipped', function (done) {
        run(function () { fw('9.40.202'); }, { generation: 1 },
            function (msg) { assert.strictEqual(msg.payload.localDataInterface, null); }, done);
    });
    it('garbage / network error keeps last value', function (done) {
        let round = 0;
        run(function () {
            round++;
            fw('9.40.202');
            const i = nock(CLOUD).get(BASE + '/onvif_user');
            if (round === 1) { i.reply(200, { username: 'localuser' }); }
            else if (round === 2) { i.reply(200, 'junk'); }
            else { i.replyWithError('boom'); }
        }, {}, function (msg) {
            assert.deepStrictEqual(msg.payload.localDataInterface, { state: 'active', username: 'localuser' });
        }, done, 3);
    });
});

describe('stream-url local data interface', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    function load(creds, cb) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-stream-url', server: 'cfg', cameraId: CAM, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        helper.load([configNode, streamNode], flow, { cfg: Object.assign({ refreshToken: 'rt' }, creds) }, function () {
            tokenOk();
            cb(helper.getNode('n1'), helper.getNode('h1'));
        });
    }
    const pwCreds = { localPasswords: JSON.stringify({ [CAM.toUpperCase()]: PW }) };
    function cloudConn() {
        nock(CLOUD).put(BASE + '/connection').reply(200, { rtspsUrl: 'rtsps://u:p@proxy.example/x' });
    }
    it('active + password: local url, no cloud connection', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(200, { username: 'localuser' });
            nock(CLOUD).get(BASE + '/wifiinfo').reply(200, { ipAddress: '10.0.0.7' });
            // no /connection mock: a cloud call would fail the test
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.rtsps, 'rtsps://localuser:test-pw@10.0.0.7:9554/rtsp_tunnel?line=1&inst=1&enableaudio=1');
                    assert.strictEqual(msg.payload.rtsp, null);
                    assert.strictEqual(msg.payload.hls, null);
                    assert.strictEqual(msg.payload.localDataInterface, true);
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({});
        });
    });
    it('active + password: msg.quality=low and msg.audio=false -> inst=2, enableaudio=0', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(200, { username: 'localuser' });
            nock(CLOUD).get(BASE + '/wifiinfo').reply(200, { ipAddress: '10.0.0.7' });
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.payload.rtsps, 'rtsps://localuser:test-pw@10.0.0.7:9554/rtsp_tunnel?line=1&inst=2&enableaudio=0');
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ quality: 'low', audio: false });
        });
    });
    it('active + password: status text is redacted, password never logged', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(200, { username: 'localuser' });
            nock(CLOUD).get(BASE + '/wifiinfo').reply(200, { ipAddress: '10.0.0.7' });
            const seen = [];
            n1.on('call:status', function (c) { seen.push(JSON.stringify(c.args)); });
            n1.on('call:log', function (c) { seen.push(JSON.stringify(c.args)); });
            h1.on('input', function () {
                try {
                    assert.ok(seen.length > 0);
                    assert.ok(!seen.join('').includes(PW));
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({});
        });
    });
    it('active + wrong-format password store (not JSON): cloud path', function (done) {
        load({ localPasswords: PW }, function (n1, h1) {
            cloudConn();
            h1.on('input', function (msg) {
                try { assert.ok(!msg.payload.localDataInterface); assert.ok(/proxy\.example/.test(msg.payload.rtsps)); done(); }
                catch (e) { done(e); }
            });
            n1.receive({});
        });
    });
    it('active, password for another camera only: cloud path', function (done) {
        load({ localPasswords: JSON.stringify({ other: PW }) }, function (n1, h1) {
            cloudConn();
            h1.on('input', function (msg) { try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); done(); } catch (e) { done(e); } });
            n1.receive({});
        });
    });
    it('active, no password: unchanged cloud path, no extra calls', function (done) {
        load({}, function (n1, h1) {
            cloudConn();
            h1.on('input', function (msg) {
                try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); assert.ok(!nock.pendingMocks().length); done(); }
                catch (e) { done(e); }
            });
            n1.receive({});
        });
    });
    it('inactive + password: cloud path', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(404, {});
            cloudConn();
            h1.on('input', function (msg) { try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); done(); } catch (e) { done(e); } });
            n1.receive({});
        });
    });
    it('449 + password: cloud path', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(449, {});
            cloudConn();
            h1.on('input', function (msg) { try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); done(); } catch (e) { done(e); } });
            n1.receive({});
        });
    });
    it('firmware too old + password: cloud path, status not queried', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.104');
            cloudConn();
            h1.on('input', function (msg) { try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); assert.ok(!nock.pendingMocks().length); done(); } catch (e) { done(e); } });
            n1.receive({});
        });
    });
    it('firmware None + password: cloud path', function (done) {
        load(pwCreds, function (n1, h1) {
            nock(CLOUD).get(BASE + '/firmware').reply(200, {});
            cloudConn();
            h1.on('input', function (msg) { try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); done(); } catch (e) { done(e); } });
            n1.receive({});
        });
    });
    it('Gen1 + password: skipped, cloud path', function (done) {
        load(pwCreds, function (n1, h1) {
            cloudConn();
            h1.on('input', function (msg) { try { assert.ok(/proxy\.example/.test(msg.payload.rtsps)); assert.ok(!nock.pendingMocks().length); done(); } catch (e) { done(e); } });
            n1.receive({ generation: 1 });
        });
    });
    it('active + password + unsafe LAN address: fails closed', function (done) {
        load(pwCreds, function (n1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').reply(200, { username: 'localuser' });
            nock(CLOUD).get(BASE + '/wifiinfo').reply(200, { ipAddress: '8.8.8.8' });
            nock(CLOUD).put(BASE + '/connection').reply(200, {});
            n1.on('call:error', function (call) {
                try {
                    assert.ok(/no usable LAN address/.test(call.firstArg.message));
                    assert.ok(!call.firstArg.message.includes(PW));
                    assert.strictEqual(nock.pendingMocks().length, 1); // connection never called
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({});
        });
    });
    it('status unreadable (network error), no prior value + password: still local', function (done) {
        load(pwCreds, function (n1, h1) {
            fw('9.40.202');
            nock(CLOUD).get(BASE + '/onvif_user').replyWithError('boom');
            nock(CLOUD).get(BASE + '/wifiinfo').reply(200, { ipAddress: '192.168.1.9' });
            h1.on('input', function (msg) {
                try { assert.strictEqual(msg.payload.localDataInterface, true); done(); } catch (e) { done(e); }
            });
            n1.receive({});
        });
    });
});
