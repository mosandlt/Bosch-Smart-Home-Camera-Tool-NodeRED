const assert = require('assert');
const nock = require('nock');
const helper = require('node-red-node-test-helper');
const configNode = require('../nodes/bosch-camera-config.js');
const eventNode = require('../nodes/bosch-camera-event.js');

helper.init(require.resolve('node-red'));

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';

function tokenOk() {
    nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 3600 });
}

describe('bosch-camera-event', function () {
    before(function (done) { helper.startServer(done); });
    after(function (done) { helper.stopServer(done); });
    afterEach(function () { helper.unload(); nock.cleanAll(); });

    it('primes a baseline then emits only new events (happy path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-event', server: 'cfg', cameraId: 'cam-x', limit: 5, interval: 30, wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        tokenOk();
        // First poll (auto, on start) establishes the baseline and emits nothing.
        nock(CLOUD_HOST).get('/v11/events').query(true).reply(200, [
            { id: 'ev-old', eventType: 'MOTION', timestamp: '2026-06-03T09:00:00.000Z' }
        ]);
        // Second poll (manual, below) carries a genuinely new event → emitted.
        nock(CLOUD_HOST).get('/v11/events').query(true).reply(200, [
            { id: 'ev-1', eventType: 'PERSON', timestamp: '2026-06-03T10:00:00.000Z', imageUrl: 'https://x/i.jpg', videoClipUrl: 'https://x/c.mp4' },
            { id: 'ev-old', eventType: 'MOTION', timestamp: '2026-06-03T09:00:00.000Z' }
        ]);
        helper.load([configNode, eventNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            const h1 = helper.getNode('h1');
            h1.on('input', function (msg) {
                try {
                    assert.strictEqual(msg.topic, 'bosch/camera/event');
                    assert.strictEqual(msg.payload.cam, 'cam-x');
                    assert.strictEqual(msg.payload.event_type, 'PERSON');
                    assert.strictEqual(msg.payload.timestamp, '2026-06-03T10:00:00.000Z');
                    done();
                } catch (e) { done(e); }
            });
            // Let the auto baseline poll settle, then trigger the second poll.
            setTimeout(function () { n1.poll(); }, 80);
        });
    });

    it('reports an error when the events poll fails (error path)', function (done) {
        const flow = [
            { id: 'cfg', type: 'bosch-camera-config' },
            { id: 'n1', type: 'bosch-camera-event', server: 'cfg', cameraId: 'cam-x', wires: [['h1']] },
            { id: 'h1', type: 'helper' }
        ];
        const creds = { cfg: { refreshToken: 'rt' } };
        tokenOk();
        nock(CLOUD_HOST).get('/v11/events').query(true).reply(500, 'boom');
        helper.load([configNode, eventNode], flow, creds, function () {
            const n1 = helper.getNode('n1');
            let fired = false;
            n1.error = function () {
                if (!fired) { fired = true; done(); }
            };
        });
    });
});
