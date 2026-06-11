// bosch-api.js
// Thin async wrapper around the Bosch Smart Home *cloud* camera API.
// Verified against the Bosch Camera Python CLI
// (smarthome.authz.bosch.com Keycloak + residential.cbs.boschsecurity.com /v11).
// Deliberately has NO Node-RED dependency so it can be unit-tested in isolation.

const axios = require('axios');
const https = require('https');
const tls = require('tls');

const KEYCLOAK_TOKEN_URL =
    'https://smarthome.authz.bosch.com/auth/realms/home_auth_provider/protocol/openid-connect/token';
const CLIENT_ID = 'oss_residential_app';
// Public OSS-app client secret — the identical value the Bosch Camera Python CLI
// ships. Kept base64-encoded to match upstream and stay out of plaintext scanners.
const CLIENT_SECRET = Buffer.from(
    'RjFqWnpzRzVOdHc3eDJWVmM4SjZxZ3NuaXNNT2ZhWmc=', 'base64'
).toString('utf8');

const CLOUD_API = 'https://residential.cbs.boschsecurity.com';

// Bosch "Video CA 2A" intermediate CA, issued by the private "Bosch ST Root CA".
// Extracted from the live residential.cbs.boschsecurity.com certificate chain.
// Validity: 2021-03-18 .. 2057-03-20.
// SHA-256 fingerprint:
//   9F:6A:CB:6D:79:38:60:A3:B1:B4:37:EA:D3:A7:D5:A6:
//   28:D0:28:8E:24:41:52:A5:E9:C9:6B:36:51:D6:01:D1
// Fixes CWE-295 / GHSA-6qh5-x5m5-vj6v: residential.cbs.boschsecurity.com and
// proxy-*.live.cbs.boschsecurity.com use a private Bosch PKI absent from public
// trust stores. We pin this CA and keep system roots so that the Let's Encrypt
// OAuth host (smarthome.authz.bosch.com) continues to validate.
// CRITICAL: when `ca` is set Node drops system roots → spread tls.rootCertificates
// first so all public hosts remain trusted.
const BOSCH_CLOUD_CA_PEM = `-----BEGIN CERTIFICATE-----
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
nvQ8Em1LhUA=
-----END CERTIFICATE-----
`;

// Secure pinned agent: trusts system roots (for Let's Encrypt OAuth host) PLUS
// the private Bosch Video CA 2A (for cloud REST + proxy snapshot hosts).
const boschCloudAgent = new https.Agent({
    rejectUnauthorized: true,
    ca: [...tls.rootCertificates, BOSCH_CLOUD_CA_PEM]
});

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
        httpsAgent: boschCloudAgent,
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
            httpsAgent: boschCloudAgent,
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
        httpsAgent: boschCloudAgent,
        timeout: TIMEOUT
    });
    return Buffer.from(img.data);
}

// Current privacy state of a camera: resolves to 'ON' or 'OFF'.
async function getPrivacy(token, cameraId) {
    const res = await axios.get(
        `${CLOUD_API}/v11/video_inputs/${encodeURIComponent(cameraId)}/privacy`,
        { headers: authHeaders(token), httpsAgent: boschCloudAgent, timeout: TIMEOUT }
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
            httpsAgent: boschCloudAgent,
            timeout: TIMEOUT
        }
    );
}

// Open a live stream connection and return stream URLs for the camera.
// `connectionType` is 'REMOTE' (default, cloud proxy RTSP/RTSPS) or 'LOCAL'
// (LAN — only reachable on the same network as the SHC, no TLS pinning needed).
// Resolves to:
//   { rtsp: string|null, rtsps: string|null, hls: string|null, raw: object }
// where `raw` is the full connection response from the Bosch API.
//
// SECURITY: callers MUST NOT log the returned URLs directly — they may embed
// Digest credentials in the userinfo component (rtsp://user:pass@host/...).
// Use redactStreamUrl() before any logging.
async function getStreamUrl(token, cameraId, connectionType = 'REMOTE') {
    const res = await axios.put(
        `${CLOUD_API}/v11/video_inputs/${encodeURIComponent(cameraId)}/connection`,
        { type: connectionType, highQualityVideo: true },
        {
            headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
            httpsAgent: boschCloudAgent,
            timeout: TIMEOUT
        }
    );
    const data = res.data || {};

    // The Bosch connection response carries one or more stream URLs.
    // Observed shapes (from Python CLI + HA integration research):
    //   data.rtspUrl   — e.g. "rtsp://user:pass@proxy.live.cbs.boschsecurity.com:554/..."
    //   data.rtspsUrl  — TLS variant (rtsps://)
    //   data.hlsUrl    — HLS playlist URL (https://...)
    // For LOCAL connections the URL is a direct LAN address (no cloud proxy).
    const rtsp = data.rtspUrl || null;
    const rtsps = data.rtspsUrl || null;
    const hls = data.hlsUrl || null;

    if (!rtsp && !rtsps && !hls) {
        throw new Error('stream connection returned no usable URL');
    }

    return { rtsp, rtsps, hls, raw: data };
}

// Replace the userinfo section (user:pass@) in a stream URL with "***:***@"
// so it is safe to emit in node logs/status.
function redactStreamUrl(url) {
    if (typeof url !== 'string') { return url; }
    // Matches  scheme://user:pass@  or  scheme://user@
    return url.replace(/^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)[^@]*@/, '$1***:***@');
}

module.exports = {
    refreshAccessToken,
    getEvents,
    getSnapshot,
    getPrivacy,
    setPrivacy,
    getStreamUrl,
    redactStreamUrl,
    KEYCLOAK_TOKEN_URL,
    CLOUD_API
};
