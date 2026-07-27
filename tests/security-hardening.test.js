const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
    fs.readFileSync(path.join(root, relativePath), 'utf8');

test('GCP bearer tokens are memory-only and never placed in URLs', () => {
    const activeClient = [
        'datastore-copier/src/api.ts',
        'datastore-copier/src/app.ts',
        'datastore-copier/src/ui.ts'
    ].map(read).join('\n');

    assert.doesNotMatch(activeClient, /tokeninfo\?access_token/i);
    assert.doesNotMatch(activeClient, /(?:localStorage|sessionStorage).*access_token/i);
    assert.match(activeClient, /Authorization: `Bearer \$\{token\}`/);
    assert.match(activeClient, /cache: 'no-store'/);
    assert.match(activeClient, /referrerPolicy: 'no-referrer'/);
});

test('credentialed API client blocks unknown or non-HTTPS origins', () => {
    const api = read('datastore-copier/src/api.ts');

    assert.match(api, /const ALLOWED_API_ORIGINS = new Set/);
    assert.match(api, /parsed\.protocol !== 'https:'/);
    assert.match(api, /ALLOWED_API_ORIGINS\.has\(parsed\.origin\)/);
    assert.match(api, /Blocked API destination/);
});

test('Firebase Hosting applies browser security headers and safe exclusions', () => {
    const config = JSON.parse(read('firebase.json'));
    const hosting = config.hosting;
    const globalHeaders = hosting.headers.find(item => item.source === '**').headers;
    const headerMap = new Map(globalHeaders.map(item => [item.key, item.value]));

    for (const name of [
        'Content-Security-Policy',
        'Cross-Origin-Opener-Policy',
        'Cross-Origin-Resource-Policy',
        'Permissions-Policy',
        'Referrer-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options'
    ]) {
        assert.ok(headerMap.has(name), `${name} must be configured`);
    }
    assert.match(headerMap.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.match(headerMap.get('Content-Security-Policy'), /object-src 'none'/);

    for (const ignored of [
        '.git/**',
        '.firebase/**',
        '.firebaserc',
        'tests/**',
        'functions/**',
        'datastore-copier/src/**',
        'datastore-copier/js/*.map',
        'datastore-copier/script.js'
    ]) {
        assert.ok(hosting.ignore.includes(ignored), `${ignored} must not be hosted`);
    }
});

test('public feedback writes are field-, type-, size-, and time-constrained', () => {
    const rules = read('firestore.rules');

    assert.match(rules, /function validFeedback\(\)/);
    assert.match(rules, /keys\(\)\.hasOnly/);
    assert.match(rules, /message\.size\(\) <= 5000/);
    assert.match(rules, /timestamp >= request\.time - duration\.value\(10, 'm'\)/);
    assert.match(rules, /allow create: if validFeedback\(\)/);
});

test('new-window links prevent opener access', () => {
    const html = read('datastore-copier/index.html');
    const links = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || [];

    assert.ok(links.length > 0);
    for (const link of links) {
        assert.match(link, /rel="noopener noreferrer"/);
    }
});
