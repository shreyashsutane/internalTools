'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AuditRequestError,
    assertAuditStatusTransition,
    assertTrustedOrigin,
    extractBearerToken,
    hashIdentity,
    normalizeAuditChunkPayload,
    normalizeAuditPayload,
    normalizeAuditUpdatePayload,
    normalizeVerifiedIdentity,
    parseReadLimit
} = require('../lib/audit-core');

test('only trusted Hosting or local emulator origins are accepted', () => {
    assert.equal(
        assertTrustedOrigin({ origin: 'https://gcp-tools-portal.web.app' }),
        'https://gcp-tools-portal.web.app'
    );
    assert.equal(
        assertTrustedOrigin({ origin: 'http://127.0.0.1:5000' }),
        'http://127.0.0.1:5000'
    );
    assert.throws(
        () => assertTrustedOrigin({ origin: 'https://attacker.example' }),
        error => error instanceof AuditRequestError && error.code === 'UNTRUSTED_ORIGIN'
    );
    assert.throws(
        () => assertTrustedOrigin({}),
        error => error instanceof AuditRequestError && error.code === 'UNTRUSTED_ORIGIN'
    );
});

test('bearer tokens are accepted only through the Authorization header', () => {
    assert.equal(
        extractBearerToken({ authorization: 'Bearer short-lived-token' }),
        'short-lived-token'
    );
    assert.throws(
        () => extractBearerToken({}),
        error => error instanceof AuditRequestError && error.code === 'MISSING_TOKEN'
    );
});

test('verified identity is normalized and cannot be supplied by the client payload', () => {
    assert.deepEqual(
        normalizeVerifiedIdentity({
            email: 'Employee@Example.COM',
            email_verified: true,
            sub: 'google-subject'
        }),
        { email: 'employee@example.com', subject: 'google-subject' }
    );
    assert.throws(
        () => normalizeVerifiedIdentity({ email: 'employee@example.com', email_verified: false }),
        error => error instanceof AuditRequestError && error.code === 'UNVERIFIED_IDENTITY'
    );
});

test('audit payload accepts reversible state but ignores user and timestamp fields', () => {
    const payload = normalizeAuditPayload({
        user: 'forged@example.com',
        timestamp: '1990-01-01T00:00:00.000Z',
        operation: 'DATASTORE_COPY',
        srcProject: 'source-project',
        tgtProject: 'target-project',
        status: 'SUCCESS',
        details: 'Copied one entity.',
        prevState: { type: 'DATASTORE_COPY', backupData: [{ action: 'delete' }] }
    });

    assert.equal(payload.operation, 'DATASTORE_COPY');
    assert.equal(payload.status, 'SUCCESS');
    assert.equal(
        payload.prevState,
        '{"type":"DATASTORE_COPY","backupData":[{"action":"delete"}]}'
    );
    assert.equal(Object.hasOwn(payload, 'user'), false);
    assert.equal(Object.hasOwn(payload, 'timestamp'), false);
});

test('legacy Firestore REST-shaped requests remain compatible during rollout', () => {
    const payload = normalizeAuditPayload({
        fields: {
            operation: { stringValue: 'AUTHENTICATION' },
            srcProject: { stringValue: '—' },
            tgtProject: { stringValue: '—' },
            status: { stringValue: 'SUCCESS' },
            details: { stringValue: 'Signed in.' }
        }
    });
    assert.equal(payload.operation, 'AUTHENTICATION');
    assert.equal(payload.details, 'Signed in.');
});

test('prototype-pollution keys and oversized details are rejected', () => {
    const polluted = JSON.parse(
        '{"operation":"DATASTORE_COPY","details":"x","prevState":{"__proto__":{"admin":true}}}'
    );
    assert.throws(
        () => normalizeAuditPayload(polluted),
        error => error instanceof AuditRequestError && error.code === 'INVALID_PREV_STATE'
    );
    assert.throws(
        () => normalizeAuditPayload({
            operation: 'DATASTORE_COPY',
            details: 'x'.repeat(10_001)
        }),
        error => error instanceof AuditRequestError && error.code === 'DETAILS_TOO_LONG'
    );
});

test('audit updates require a bounded Firestore ID and validated status', () => {
    assert.deepEqual(
        normalizeAuditUpdatePayload({
            id: 'AbCdEfGhIjKlMnOpQrSt',
            status: 'PARTIAL',
            details: 'One item was skipped.'
        }),
        {
            id: 'AbCdEfGhIjKlMnOpQrSt',
            status: 'PARTIAL',
            details: 'One item was skipped.',
            hasPrevState: false,
            prevState: null
        }
    );
    assert.throws(
        () => normalizeAuditUpdatePayload({ id: '../other-user', status: 'SUCCESS' }),
        error => error instanceof AuditRequestError && error.code === 'INVALID_LOG_ID'
    );
});

test('only in-progress audit records may transition or change backup state', () => {
    assert.doesNotThrow(() => assertAuditStatusTransition('IN_PROGRESS', 'SUCCESS'));
    assert.doesNotThrow(() => assertAuditStatusTransition('IN_PROGRESS', 'IN_PROGRESS'));
    assert.throws(
        () => assertAuditStatusTransition('SUCCESS', 'FAILED'),
        error => error instanceof AuditRequestError && error.code === 'LOG_IMMUTABLE'
    );
});

test('read limits are bounded and rate-limit keys do not expose email addresses', () => {
    assert.equal(parseReadLimit({ limit: 0 }), 1);
    assert.equal(parseReadLimit({ limit: 9999 }), 500);
    assert.equal(parseReadLimit({}), 200);
    assert.match(hashIdentity('employee@example.com'), /^[a-f0-9]{64}$/);
    assert.doesNotMatch(hashIdentity('employee@example.com'), /employee/);
});

test('audit backup chunks are bounded, indexed, and restricted to base64 data', () => {
    assert.deepEqual(
        normalizeAuditChunkPayload({
            action: 'write',
            id: 'AbCdEfGhIjKlMnOpQrSt',
            revision: 'revision123',
            index: 1,
            count: 3,
            data: 'YWJjZA=='
        }),
        {
            action: 'write',
            id: 'AbCdEfGhIjKlMnOpQrSt',
            revision: 'revision123',
            index: 1,
            count: 3,
            data: 'YWJjZA=='
        }
    );
    assert.throws(
        () => normalizeAuditChunkPayload({
            action: 'write',
            id: 'AbCdEfGhIjKlMnOpQrSt',
            revision: 'revision123',
            index: 0,
            count: 1,
            data: '<script>'
        }),
        error => error instanceof AuditRequestError && error.code === 'INVALID_CHUNK_DATA'
    );
    assert.throws(
        () => normalizeAuditChunkPayload({
            action: 'read',
            id: 'AbCdEfGhIjKlMnOpQrSt',
            revision: 'revision123',
            index: 110,
            count: 111
        }),
        error => error instanceof AuditRequestError && error.code === 'INVALID_CHUNK_INDEX'
    );
});
