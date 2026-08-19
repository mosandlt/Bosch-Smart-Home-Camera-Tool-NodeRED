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

    describe('getQualityParams', function () {
        it('maps "high" to highQualityVideo=true, inst=1', function () {
            assert.deepStrictEqual(api.getQualityParams('high'), { highQualityVideo: true, inst: 1 });
        });

        it('maps "low" to highQualityVideo=false, inst=4', function () {
            assert.deepStrictEqual(api.getQualityParams('low'), { highQualityVideo: false, inst: 4 });
        });

        it('maps "auto" to highQualityVideo=false, inst=2', function () {
            assert.deepStrictEqual(api.getQualityParams('auto'), { highQualityVideo: false, inst: 2 });
        });

        it('falls back to "auto" mapping for an unrecognised value', function () {
            assert.deepStrictEqual(api.getQualityParams('garbage'), { highQualityVideo: false, inst: 2 });
            assert.deepStrictEqual(api.getQualityParams(undefined), { highQualityVideo: false, inst: 2 });
        });
    });

    describe('getStreamUrl quality parameter', function () {
        it('sends highQualityVideo=true and appends inst=1 for quality="high"', async function () {
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/cam-x/connection', { type: 'LOCAL', highQualityVideo: true })
                .reply(200, { rtspUrl: 'rtsp://192.0.2.1:554/live/cam' });
            const res = await api.getStreamUrl('AT', 'cam-x', 'LOCAL', 'high');
            assert.strictEqual(res.rtsp, 'rtsp://192.0.2.1:554/live/cam?inst=1');
        });

        it('sends highQualityVideo=false and appends inst=4 for quality="low"', async function () {
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/cam-x/connection', { type: 'LOCAL', highQualityVideo: false })
                .reply(200, { rtspUrl: 'rtsp://192.0.2.1:554/live/cam' });
            const res = await api.getStreamUrl('AT', 'cam-x', 'LOCAL', 'low');
            assert.strictEqual(res.rtsp, 'rtsp://192.0.2.1:554/live/cam?inst=4');
        });

        it('defaults to "auto" (highQualityVideo=false, inst=2) when quality is omitted', async function () {
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/cam-x/connection', { type: 'LOCAL', highQualityVideo: false })
                .reply(200, { rtspUrl: 'rtsp://192.0.2.1:554/live/cam' });
            const res = await api.getStreamUrl('AT', 'cam-x', 'LOCAL');
            assert.strictEqual(res.rtsp, 'rtsp://192.0.2.1:554/live/cam?inst=2');
        });

        it('replaces an existing inst= query param instead of duplicating it', async function () {
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/cam-x/connection', { type: 'LOCAL', highQualityVideo: true })
                .reply(200, { rtspUrl: 'rtsp://192.0.2.1:554/live/cam?inst=2&fmtp=1' });
            const res = await api.getStreamUrl('AT', 'cam-x', 'LOCAL', 'high');
            assert.strictEqual(res.rtsp, 'rtsp://192.0.2.1:554/live/cam?inst=1&fmtp=1');
        });

        it('leaves a null/absent rtsp(s) URL untouched by applyInst', async function () {
            nock(CLOUD_HOST)
                .put('/v11/video_inputs/cam-x/connection', { type: 'LOCAL', highQualityVideo: true })
                .reply(200, { hlsUrl: 'https://proxy.example.com/hls/cam.m3u8' });
            const res = await api.getStreamUrl('AT', 'cam-x', 'LOCAL', 'high');
            assert.strictEqual(res.rtsp, null);
            assert.strictEqual(res.rtsps, null);
            assert.strictEqual(res.hls, 'https://proxy.example.com/hls/cam.m3u8');
        });
    });
});
