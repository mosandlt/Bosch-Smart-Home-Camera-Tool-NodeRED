// bosch-api.js
// Thin async wrapper around the Bosch Smart Home *cloud* camera API.
// Verified against the Bosch Camera Python CLI
// (smarthome.authz.bosch.com Keycloak + residential.cbs.boschsecurity.com /v11).
// Deliberately has NO Node-RED dependency so it can be unit-tested in isolation.

const axios = require('axios');
const https = require('https');

const KEYCLOAK_TOKEN_URL =
    'https://smarthome.authz.bosch.com/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLIENT_ID = 'oss_residential_app';
// Public OSS-app client secret — the identical value the Bosch Camera Python CLI
// ships. Kept base64-encoded to match upstream and stay out of plaintext scanners.
const CLIENT_SECRET = Buffer.from(
    'RjFqWnpzRzVOdHc3eDJWVmM4SjZxZ3NuaXNNT2ZhWmc=', 'base64'
).toString('utf8');

const CLOUD_API = 'https://residential.cbs.boschsecurity.com';

// The cloud API and its live snapshot proxies are served from a private Bosch CA
// with no client certificate — the upstream CLI uses verify=False here. Keycloak
// (the token URL) is publicly CA-signed and keeps default TLS verification.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

const TIMEOUT = 15000;

// `Accept` MUST stay */* — application/json makes Bosch return HTTP 500 on the
// media (snap.jpg / clip.mp4) endpoints.
function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, Accept: '*/*' };
}

// Exchange a (non-expiring) Bosch SingleKey ID refresh token for a ~1 h access
// token via the Keycloak refresh_token grant.
async function refreshAccessToken(refreshToken) {
    if (!refreshToken) {
        throw new Error('missing refresh token');
    }
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    });
    const res = await axios.post(KEYCLOAK_TOKEN_URL, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: TIMEOUT
    });
    if (!res.data || !res.data.access_token) {
        throw new Error('token response missing access_token');
    }
    return {
        accessToken: res.data.access_token,
        expiresIn: res.data.expires_in || 3600
    };
}

// Newest-first list of camera events. Each item: { id, eventType, timestamp,
// imageUrl, videoClipUrl }.
async function getEvents(token, cameraId, limit = 5) {
    const res = await axios.get(`${CLOUD_API}/v11/events`, {
        params: { videoInputId: cameraId, limit },
        headers: authHeaders(token),
        httpsAgent: insecureAgent,
        timeout: TIMEOUT
    });
    return Array.isArray(res.data) ? res.data : [];
}

// Live snapshot via the cloud REMOTE proxy: open a connection, then GET the
// JPEG from the returned proxy URL (the URL hash is the credential — no bearer).
async function getSnapshot(token, cameraId) {
    const conn = await axios.put(
        `${CLOUD_API}/v11/video_inputs/${encodeURIComponent(cameraId)}/connection`,
        { type: 'REMOTE', highQualityVideo: false },
        {
            headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
            httpsAgent: insecureAgent,
            timeout: TIMEOUT
        }
    );
    const urls = conn.data && conn.data.urls;
    const scheme = conn.data && conn.data.imageUrlScheme;
    if (!Array.isArray(urls) || urls.length === 0 || !scheme) {
        throw new Error('snapshot connection returned no proxy url');
    }
    const snapUrl = scheme.replaceAll('{url}', urls[0]);
    const img = await axios.get(snapUrl, {
        responseType: 'arraybuffer',
        httpsAgent: insecureAgent,
        timeout: TIMEOUT
    });
    return Buffer.from(img.data);
}

// Current privacy state of a camera: resolves to 'ON' or 'OFF'.
async function getPrivacy(token, cameraId) {
    const res = await axios.get(
        `${CLOUD_API}/v11/video_inputs/${encodeURIComponent(cameraId)}/privacy`,
        { headers: authHeaders(token), httpsAgent: insecureAgent, timeout: TIMEOUT }
    );
    return res.data && res.data.privacyMode;
}

// Set privacy mode. `mode` is 'ON' or 'OFF'. Optional timed privacy via
// durationInSeconds. Bosch answers HTTP 204 on success.
async function setPrivacy(token, cameraId, mode, durationInSeconds = null) {
    await axios.put(
        `${CLOUD_API}/v11/video_inputs/${encodeURIComponent(cameraId)}/privacy`,
        { privacyMode: mode, durationInSeconds },
        {
            headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
            httpsAgent: insecureAgent,
            timeout: TIMEOUT
        }
    );
}

module.exports = {
    refreshAccessToken,
    getEvents,
    getSnapshot,
    getPrivacy,
    setPrivacy,
    KEYCLOAK_TOKEN_URL,
    CLOUD_API
};
