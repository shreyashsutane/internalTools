'use strict';

const { createHash } = require('node:crypto');

const MAX_DETAILS_LENGTH = 10_000;
const MAX_PREV_STATE_BYTES = 700_000;
const MAX_BODY_BYTES = 800_000;
const MAX_BACKUP_CHUNK_BYTES = 650_000;
const MAX_BACKUP_CHUNKS = 110;
const MAX_TREE_DEPTH = 40;
const ALLOWED_STATUSES = new Set([
    'IN_PROGRESS',
    'SUCCESS',
    'PARTIAL',
    'FAILED',
    'CANCELLED'
]);
const DEFAULT_ALLOWED_ORIGINS = new Set([
    'https://gcp-tools-portal.web.app',
    'https://gcp-tools-portal.firebaseapp.com'
]);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class AuditRequestError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'AuditRequestError';
        this.status = status;
        this.code = code;
    }
}

const getHeader = (headers, name) => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const direct = headers[name];
    if (typeof direct === 'string') return direct;
    const lower = headers[name.toLowerCase()];
    return Array.isArray(lower) ? lower[0] || '' : lower || '';
};

const parseAllowedOrigins = (extraOrigins = '') => {
    const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);
    for (const origin of String(extraOrigins).split(',')) {
        const clean = origin.trim();
        if (clean) allowed.add(clean);
    }
    return allowed;
};

const assertTrustedOrigin = (headers, extraOrigins = '') => {
    const origin = getHeader(headers, 'origin');
    if (!origin) {
        throw new AuditRequestError(403, 'UNTRUSTED_ORIGIN', 'A trusted browser origin is required.');
    }

    const allowed = parseAllowedOrigins(extraOrigins);
    const isLocalEmulator = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
    if (!allowed.has(origin) && !isLocalEmulator) {
        throw new AuditRequestError(403, 'UNTRUSTED_ORIGIN', 'The request origin is not allowed.');
    }
    return origin;
};

const extractBearerToken = headers => {
    const authorization = getHeader(headers, 'authorization');
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!match) {
        throw new AuditRequestError(401, 'MISSING_TOKEN', 'A valid bearer token is required.');
    }
    return match[1];
};

const assertSafeTree = (value, depth = 0) => {
    if (depth > MAX_TREE_DEPTH) {
        throw new AuditRequestError(400, 'INVALID_PREV_STATE', 'Audit backup nesting is too deep.');
    }
    if (!value || typeof value !== 'object') return;

    for (const key of Object.keys(value)) {
        if (FORBIDDEN_OBJECT_KEYS.has(key)) {
            throw new AuditRequestError(400, 'INVALID_PREV_STATE', 'Audit backup contains a forbidden object key.');
        }
        assertSafeTree(value[key], depth + 1);
    }
};

const unwrapFirestoreValue = value => {
    if (!value || typeof value !== 'object') return undefined;
    if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
    if (Object.hasOwn(value, 'integerValue')) return value.integerValue;
    if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue;
    if (Object.hasOwn(value, 'doubleValue')) return value.doubleValue;
    if (Object.hasOwn(value, 'nullValue')) return null;
    return undefined;
};

const unwrapLegacyBody = body => {
    if (!body?.fields || typeof body.fields !== 'object') return body;
    const result = {};
    for (const [key, value] of Object.entries(body.fields)) {
        result[key] = unwrapFirestoreValue(value);
    }
    return result;
};

const cleanText = (value, fallback = '') =>
    typeof value === 'string' ? value.trim() : fallback;

const normalizeLogId = value => {
    const id = cleanText(value);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
        throw new AuditRequestError(400, 'INVALID_LOG_ID', 'Audit log ID is invalid.');
    }
    return id;
};

const normalizeChunkRevision = value => {
    const revision = cleanText(value);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(revision)) {
        throw new AuditRequestError(400, 'INVALID_CHUNK_REVISION', 'Audit backup revision is invalid.');
    }
    return revision;
};

const normalizeAuditChunkPayload = rawBody => {
    const serializedBody = JSON.stringify(rawBody ?? {});
    if (Buffer.byteLength(serializedBody, 'utf8') > MAX_BODY_BYTES) {
        throw new AuditRequestError(413, 'PAYLOAD_TOO_LARGE', 'Audit chunk request is too large.');
    }
    const body = rawBody || {};
    const action = cleanText(body.action).toLowerCase();
    if (action !== 'write' && action !== 'read') {
        throw new AuditRequestError(400, 'INVALID_CHUNK_ACTION', 'Audit backup chunk action is invalid.');
    }

    const id = normalizeLogId(body.id);
    const revision = normalizeChunkRevision(body.revision);
    const index = Number(body.index);
    const count = Number(body.count);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_BACKUP_CHUNKS) {
        throw new AuditRequestError(400, 'INVALID_CHUNK_INDEX', 'Audit backup chunk index is invalid.');
    }
    if (!Number.isInteger(count) || count < 1 || count > MAX_BACKUP_CHUNKS || index >= count) {
        throw new AuditRequestError(400, 'INVALID_CHUNK_COUNT', 'Audit backup chunk count is invalid.');
    }

    if (action === 'read') return { action, id, revision, index, count };

    const data = typeof body.data === 'string' ? body.data : '';
    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        throw new AuditRequestError(400, 'INVALID_CHUNK_DATA', 'Audit backup chunk is not valid base64 data.');
    }
    if (Buffer.byteLength(data, 'utf8') > MAX_BACKUP_CHUNK_BYTES) {
        throw new AuditRequestError(413, 'CHUNK_TOO_LARGE', 'Audit backup chunk exceeds the safe size limit.');
    }
    return { action, id, revision, index, count, data };
};

const normalizeAuditPayload = rawBody => {
    const serializedBody = JSON.stringify(rawBody ?? {});
    if (Buffer.byteLength(serializedBody, 'utf8') > MAX_BODY_BYTES) {
        throw new AuditRequestError(413, 'PAYLOAD_TOO_LARGE', 'Audit request is too large.');
    }

    const body = unwrapLegacyBody(rawBody || {});
    const operation = cleanText(body.operation);
    const status = cleanText(body.status, 'SUCCESS').toUpperCase();
    const srcProject = cleanText(body.srcProject, '—').slice(0, 200) || '—';
    const tgtProject = cleanText(body.tgtProject, '—').slice(0, 200) || '—';
    const details = typeof body.details === 'string' ? body.details.trim() : '';

    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(operation)) {
        throw new AuditRequestError(400, 'INVALID_OPERATION', 'Audit operation name is invalid.');
    }
    if (!ALLOWED_STATUSES.has(status)) {
        throw new AuditRequestError(400, 'INVALID_STATUS', 'Audit status is invalid.');
    }
    if (details.length > MAX_DETAILS_LENGTH) {
        throw new AuditRequestError(400, 'DETAILS_TOO_LONG', 'Audit details exceed the allowed length.');
    }

    let prevState = body.prevState ?? null;
    if (typeof prevState === 'string' && prevState) {
        try {
            prevState = JSON.parse(prevState);
        } catch {
            throw new AuditRequestError(400, 'INVALID_PREV_STATE', 'Audit backup is not valid JSON.');
        }
    }
    if (prevState !== null) {
        assertSafeTree(prevState);
        const prevStateJson = JSON.stringify(prevState);
        if (Buffer.byteLength(prevStateJson, 'utf8') > MAX_PREV_STATE_BYTES) {
            throw new AuditRequestError(413, 'PREV_STATE_TOO_LARGE', 'Audit backup exceeds the safe size limit.');
        }
        prevState = prevStateJson;
    }

    return {
        operation,
        srcProject,
        tgtProject,
        status,
        details,
        prevState
    };
};

const normalizeAuditUpdatePayload = rawBody => {
    const id = normalizeLogId(rawBody?.id);
    const normalized = normalizeAuditPayload({
        operation: 'AUDIT_UPDATE',
        status: rawBody?.status,
        details: rawBody?.details,
        prevState: rawBody?.prevState
    });
    return {
        id,
        status: normalized.status,
        details: normalized.details,
        hasPrevState: Object.hasOwn(rawBody || {}, 'prevState'),
        prevState: normalized.prevState
    };
};

const normalizeVerifiedIdentity = identity => {
    const email = cleanText(identity?.email).toLowerCase();
    const subject = cleanText(identity?.sub);
    if (!email || identity?.email_verified === false) {
        throw new AuditRequestError(401, 'UNVERIFIED_IDENTITY', 'The Google token does not contain a verified email.');
    }
    return { email, subject };
};

const assertAuditStatusTransition = (existingStatus, nextStatus) => {
    if (cleanText(existingStatus).toUpperCase() !== 'IN_PROGRESS') {
        throw new AuditRequestError(409, 'LOG_IMMUTABLE', 'Finalized audit log entries are immutable.');
    }
    if (!ALLOWED_STATUSES.has(cleanText(nextStatus).toUpperCase())) {
        throw new AuditRequestError(400, 'INVALID_STATUS', 'Audit status is invalid.');
    }
};

const parseReadLimit = rawBody => {
    const requested = Number(rawBody?.limit);
    if (!Number.isInteger(requested)) return 200;
    return Math.max(1, Math.min(requested, 500));
};

const hashIdentity = email =>
    createHash('sha256').update(email).digest('hex');

module.exports = {
    ALLOWED_STATUSES,
    AuditRequestError,
    MAX_BACKUP_CHUNK_BYTES,
    MAX_BACKUP_CHUNKS,
    assertAuditStatusTransition,
    assertSafeTree,
    assertTrustedOrigin,
    extractBearerToken,
    hashIdentity,
    normalizeAuditChunkPayload,
    normalizeAuditPayload,
    normalizeAuditUpdatePayload,
    normalizeVerifiedIdentity,
    parseReadLimit
};
