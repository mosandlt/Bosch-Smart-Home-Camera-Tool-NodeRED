/**
 * Tests for the editor-side console version banner injected in
 * nodes/bosch-camera-config.html.
 *
 * These are pure file-content assertions — no browser or Node-RED runtime
 * needed — so they run fast and in the normal mocha suite.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, '..', 'nodes', 'bosch-camera-config.html');
const PKG_FILE  = path.join(__dirname, '..', 'package.json');

const html = fs.readFileSync(HTML_FILE, 'utf8');
const pkg  = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));

describe('editor-banner (bosch-camera-config.html)', function () {
    it('contains the banner console.info call', function () {
        assert.ok(
            html.includes('NODE-RED-BOSCH-CAMERA'),
            'Expected banner text "NODE-RED-BOSCH-CAMERA" to be present'
        );
        assert.ok(
            html.includes('console.info'),
            'Expected console.info call to be present'
        );
    });

    it('uses the correct Node-RED admin API endpoint for the module', function () {
        const moduleName = pkg.name; // 'node-red-contrib-bosch-camera'
        assert.ok(
            html.includes("'nodes/" + moduleName + "'") ||
            html.includes('"nodes/' + moduleName + '"'),
            'Expected $.getJSON endpoint "nodes/' + moduleName + '" to be present'
        );
    });

    it('guards against double-print with a window flag', function () {
        assert.ok(
            html.includes('__boschCameraConsoleBannerShown'),
            'Expected window.__boschCameraConsoleBannerShown guard to be present'
        );
    });

    it('includes a .fail() fallback that prints without version', function () {
        assert.ok(
            html.includes('.fail('),
            'Expected .fail() fallback handler to be present'
        );
    });

    it('applies Bosch red (#ea0016) CSS to the banner', function () {
        assert.ok(
            html.includes('#ea0016'),
            'Expected Bosch brand colour #ea0016 in banner styles'
        );
    });

    it('banner API endpoint module name matches package.json name', function () {
        // This pins the API call to the actual published package name so a
        // rename is caught immediately by CI.
        assert.strictEqual(
            pkg.name,
            'node-red-contrib-bosch-camera',
            'package.json name must stay "node-red-contrib-bosch-camera"'
        );
        assert.ok(
            html.includes(pkg.name),
            'bosch-camera-config.html must reference the package name from package.json'
        );
    });
});
