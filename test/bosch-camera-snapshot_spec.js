const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const snapshotNode = require('../nodes/bosch-camera-snapshot.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';
const PROXY_HOST = 'https://proxy-1.live.cbs.boschsecurity.com:42090';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-snapshot', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('fetches a JPEG snapshot via the cloud proxy (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-snapshot', server: 'cfg', cameraId: 'cam-x', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, snapshotNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/connection').reply(200, {
                urls: ['proxy-1.live.cbs.boschsecurity.com:42090/abc'],
                imageUrlScheme: 'https://{url}/snap.jpg'
            });
            nock(PROXY_HOST).get('/abc/snap.jpg')
                .reply(200, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { 'Content-Type': 'image/jpeg' });

            const n1 = helper.getNode('n1');
            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.ok(Buffer.isBuffer(msg.payload));
                    assert.strictEqual(msg.contentType, 'image/jpeg');
                    assert.strictEqual(msg.cam, 'cam-x');
                    assert.ok(typeof msg.timestamp === 'string');
                    done();
                } catch (e) { done(e); }
            });
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when the proxy connection returns no url (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-snapshot', server: 'cfg', cameraId: 'cam-x', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, snapshotNode], flow, creds, function () {
            tokenOk();
            nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/connection')
                .reply(200, { urls: [], imageUrlScheme: 'https://{url}/snap.jpg' });

            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });

    it('errors when no camera id is available (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-snapshot', server: 'cfg', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        helper.load([configNode, snapshotNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () { if (!fired) { fired = true; done(); } };
            n1.receive({ payload: 'go' });
        });
    });
});
