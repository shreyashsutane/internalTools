'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const {
    AuditRequestError,
    assertTrustedOrigin,
    extractBearerToken,
    hashIdentity,
    normalizeAuditPayload,
    normalizeAuditUpdatePayload,
    normalizeVerifiedIdentity,
    parseReadLimit
} = require('./lib/audit-core');
const { sendMutationAlertEmail } = require('./lib/email-notifier');

initializeApp();

const db = getFirestore();
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const RATE_LIMIT_PER_MINUTE = 120;

const sendJson = (res, status, body, origin = '') => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Vary', 'Origin');
    if (origin) res.set('Access-Control-Allow-Origin', origin);
    res.status(status).send(JSON.stringify(body));
};

const verifyGoogleIdentity = async token => {
    const response = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error'
    });
    if (!response.ok) {
        throw new AuditRequestError(401, 'INVALID_TOKEN', 'The Google access token is invalid or expired.');
    }
    return normalizeVerifiedIdentity(await response.json());
};

const enforceRateLimit = async email => {
    const ref = db.collection('_audit_rate_limits').doc(hashIdentity(email));
    const now = Date.now();
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const data = snapshot.exists ? snapshot.data() : null;
        const windowStart = Number(data?.windowStart || 0);
        const currentCount = Number(data?.count || 0);
        const inCurrentWindow = now - windowStart < 60_000;
        const nextCount = inCurrentWindow ? currentCount + 1 : 1;

        if (nextCount > RATE_LIMIT_PER_MINUTE) {
            throw new AuditRequestError(429, 'RATE_LIMITED', 'Too many audit requests. Try again shortly.');
        }
        transaction.set(ref, {
            user: email,
            windowStart: inCurrentWindow ? windowStart : now,
            count: nextCount,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
};

const readOwnLogs = async (email, limit) => {
    const snapshot = await db.collection('audit_logs')
        .where('user', '==', email)
        .limit(500)
        .get();

    return snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }))
        .sort((a, b) => Number(b.timestampEpochMs || 0) - Number(a.timestampEpochMs || 0))
        .slice(0, limit)
        .map(log => {
            const { createdAt, ...safeLog } = log;
            return safeLog;
        });
};

const createAuditLog = async (identity, payload, req) => {
    const now = Date.now();
    const record = {
        timestamp: new Date(now).toISOString(),
        timestampEpochMs: now,
        user: identity.email,
        userSubject: identity.subject,
        operation: payload.operation,
        srcProject: payload.srcProject,
        tgtProject: payload.tgtProject,
        status: payload.status,
        details: payload.details,
        userAgent: String(req.get('user-agent') || '').slice(0, 500),
        createdAt: FieldValue.serverTimestamp()
    };
    if (payload.prevState !== null) record.prevState = payload.prevState;

    const document = await db.collection('audit_logs').add(record);

    if (payload.status !== 'IN_PROGRESS') {
        sendMutationAlertEmail({ id: document.id, ...record }).catch(err => {
            logger.warn('Failed to send mutation alert email on log create:', err?.message || err);
        });
    }

    return document.id;
};

const updateOwnAuditLog = async (identity, payload) => {
    const ref = db.collection('audit_logs').doc(payload.id);
    let emailLogPayload = null;
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
            throw new AuditRequestError(404, 'LOG_NOT_FOUND', 'Audit log entry was not found.');
        }
        if (snapshot.data()?.user !== identity.email) {
            throw new AuditRequestError(403, 'LOG_FORBIDDEN', 'Users can update only their own audit records.');
        }
        const existing = snapshot.data();
        const updates = {
            status: payload.status,
            details: payload.details,
            updatedAt: FieldValue.serverTimestamp()
        };
        if (payload.hasPrevState) {
            if (payload.prevState === null) {
                updates.prevState = FieldValue.delete();
            } else {
                updates.prevState = payload.prevState;
            }
        }
        transaction.update(ref, updates);

        emailLogPayload = {
            id: payload.id,
            user: identity.email,
            operation: existing?.operation || 'DATASTORE_COPY',
            srcProject: existing?.srcProject || '—',
            tgtProject: existing?.tgtProject || '—',
            status: payload.status,
            details: payload.details,
            prevState: payload.hasPrevState ? payload.prevState : existing?.prevState,
            timestamp: existing?.timestamp || new Date().toISOString()
        };
    });

    if (emailLogPayload && emailLogPayload.status !== 'IN_PROGRESS') {
        sendMutationAlertEmail(emailLogPayload).catch(err => {
            logger.warn('Failed to send mutation alert email on log update:', err?.message || err);
        });
    }
};

exports.auditApi = onRequest({
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '512MiB',
    maxInstances: 10,
    concurrency: 40,
    invoker: 'public',
    serviceAccount: 'audit-logger@gcp-tools-portal.iam.gserviceaccount.com',
    secrets: ['ALERT_GMAIL_APP_PASSWORD']
}, async (req, res) => {
    let origin = '';
    try {
        origin = assertTrustedOrigin(req.headers, process.env.AUDIT_ALLOWED_ORIGINS);
        if (req.method === 'OPTIONS') {
            res.set('Access-Control-Allow-Origin', origin);
            res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.set('Cache-Control', 'no-store');
            res.status(204).send('');
            return;
        }
        if (req.method !== 'POST') {
            throw new AuditRequestError(405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.');
        }

        const token = extractBearerToken(req.headers);
        const identity = await verifyGoogleIdentity(token);
        await enforceRateLimit(identity.email);

        if (req.path.endsWith('/runQuery')) {
            const logs = await readOwnLogs(identity.email, parseReadLimit(req.body));
            sendJson(res, 200, { ok: true, logs }, origin);
            return;
        }
        if (req.path.endsWith('/update')) {
            const payload = normalizeAuditUpdatePayload(req.body);
            await updateOwnAuditLog(identity, payload);
            sendJson(res, 200, { ok: true, id: payload.id }, origin);
            return;
        }

        const payload = normalizeAuditPayload(req.body);
        const id = await createAuditLog(identity, payload, req);
        sendJson(res, 201, { ok: true, id }, origin);
    } catch (error) {
        const expected = error instanceof AuditRequestError;
        const status = expected ? error.status : 500;
        const code = expected ? error.code : 'INTERNAL_ERROR';
        if (!expected) {
            logger.error('Audit API failure', {
                message: error instanceof Error ? error.message : String(error)
            });
        }
        sendJson(
            res,
            status,
            { ok: false, error: { code, message: expected ? error.message : 'Audit service failed.' } },
            origin
        );
    }
});
