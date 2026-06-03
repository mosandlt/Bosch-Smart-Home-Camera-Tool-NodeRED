const assert = require('assert');
const nock = require('nock');
const api = require('../nodes/lib/bosch-api.js');

const TOKEN_HOST = 'https://smarthome.authz.bosch.com';
const TOKEN_PATH = '/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLOUD_HOST = 'https://residential.cbs.boschsecurity.com';

describe('bosch-api', function () {
    afterEach(function () { nock.cleanAll(); });

    it('refreshAccessToken returns access token + expiry', async function () {
        nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { access_token: 'AT', expires_in: 1800 });
        const res = await api.refreshAccessToken('rt');
        assert.strictEqual(res.accessToken, 'AT');
        assert.strictEqual(res.expiresIn, 1800);
    });

    it('refreshAccessToken rejects without a refresh token', async function () {
        await assert.rejects(function () { return api.refreshAccessToken(''); });
    });

    it('refreshAccessToken rejects when access_token missing', async function () {
        nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, { token_type: 'bearer' });
        await assert.rejects(function () { return api.refreshAccessToken('rt'); });
    });

    it('getEvents returns [] for a non-array body', async function () {
        nock(CLOUD_HOST).get('/v11/events').query(true).reply(200, {});
        const out = await api.getEvents('AT', 'cam-x', 5);
        assert.deepStrictEqual(out, []);
    });

    it('getPrivacy returns the privacyMode string', async function () {
        nock(CLOUD_HOST).get('/v11/video_inputs/cam-x/privacy').reply(200, { privacyMode: 'ON' });
        assert.strictEqual(await api.getPrivacy('AT', 'cam-x'), 'ON');
    });

    it('setPrivacy resolves on HTTP 204', async function () {
        nock(CLOUD_HOST).put('/v11/video_inputs/cam-x/privacy', { privacyMode: 'OFF', durationInSeconds: null }).reply(204);
        await api.setPrivacy('AT', 'cam-x', 'OFF');
    });
});
