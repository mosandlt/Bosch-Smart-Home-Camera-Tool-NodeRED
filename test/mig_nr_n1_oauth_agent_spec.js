/**
 * Item: NR-N1
 * Migration concept: Security / TLS consistency
 * Layer: nodes/lib/bosch-api.js — refreshAccessToken()
 *
 * Asserts that refreshAccessToken() calls axios.post with httpsAgent set to
 * boschCloudAgent, consistent with every other cloud HTTP call in the module.
 *
 * Run: npx mocha test/mig_nr_n1_oauth_agent.spec.js
 */

'use strict';

const assert = require('assert');
const axios = require('axios');

const {
    refreshAccessToken,
    BoschCloudAgent,
    KEYCLOAK_TOKEN_URL,
} = require('../nodes/lib/bosch-api');

describe('NR-N1 — refreshAccessToken httpsAgent consistency', () => {
    it('refreshAccessToken passes boschCloudAgent as httpsAgent to axios.post', async () => {
        const capturedConfigs = [];
        const origPost = axios.post;
        // Stub axios.post to capture the config object without making a real request.
        axios.post = (url, data, config) => {
            capturedConfigs.push({ url, config });
            return Promise.resolve({ data: { access_token: 'fake-access-token', expires_in: 3600 } });
        };
        try {
            await refreshAccessToken('fake-refresh-token');
        } finally {
            axios.post = origPost;
        }

        const oauthCall = capturedConfigs.find(c => c.url === KEYCLOAK_TOKEN_URL);
        assert.ok(oauthCall, 'axios.post was not called with KEYCLOAK_TOKEN_URL');
        assert.ok(
            oauthCall.config && oauthCall.config.httpsAgent != null,
            'httpsAgent must be set on the axios.post config'
        );
        assert.ok(
            oauthCall.config.httpsAgent instanceof BoschCloudAgent,
            'httpsAgent must be a BoschCloudAgent instance (the module-level boschCloudAgent)'
        );
    });
});
