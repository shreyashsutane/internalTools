const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
    fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Firebase Hosting routes the audit API to the secured function', () => {
    const config = JSON.parse(read('firebase.json'));
    assert.equal(config.functions.source, 'functions');
    assert.equal(config.functions.runtime, 'nodejs22');

    const rewrites = new Map(
        config.hosting.rewrites.map(item => [item.source, item.function])
    );
    for (const route of [
        '/api/audit_logs',
        '/api/audit_logs/runQuery',
        '/api/audit_logs/update'
    ]) {
        assert.equal(rewrites.get(route)?.functionId, 'auditApi');
        assert.equal(rewrites.get(route)?.region, 'us-central1');
    }
    assert.ok(config.hosting.ignore.includes('functions/**'));
});

test('browser audit client has no direct Firestore fallback', () => {
    const audit = read('datastore-copier/src/audit.ts');
    const localServer = read('server.js');
    assert.match(audit, /FIRESTORE_AUDIT_LOG_URL/);
    assert.match(audit, /\/runQuery/);
    assert.match(audit, /\/update/);
    assert.doesNotMatch(audit, /firestore\.googleapis\.com/);
    assert.doesNotMatch(audit, /structuredQuery/);
    assert.match(audit, /cache: 'no-store'/);
    assert.match(audit, /referrerPolicy: 'no-referrer'/);
    assert.doesNotMatch(localServer, /firestore\.googleapis\.com/);
    assert.doesNotMatch(localServer, /Access-Control-Allow-Origin': '\*'/);
    assert.match(localServer, /gcp-tools-portal\.web\.app/);
});

test('server derives identity and scopes reads and updates to that identity', () => {
    const fn = read('functions/index.js');
    const core = read('functions/lib/audit-core.js');

    assert.match(fn, /openidconnect\.googleapis\.com\/v1\/userinfo/);
    assert.match(fn, /Authorization: `Bearer \$\{token\}`/);
    assert.match(fn, /\.where\('user', '==', email\)/);
    assert.match(fn, /snapshot\.data\(\)\?\.user !== identity\.email/);
    assert.match(fn, /serviceAccount: 'audit-logger@gcp-tools-portal\.iam\.gserviceaccount\.com'/);
    assert.doesNotMatch(fn, /access_token=/);
    assert.match(core, /DEFAULT_ALLOWED_ORIGINS/);
    assert.match(core, /MAX_PREV_STATE_BYTES = 700_000/);
    assert.match(core, /FORBIDDEN_OBJECT_KEYS/);
});

test('admins retain global visibility while direct public audit access stays denied', () => {
    const rules = read('firestore.rules');
    assert.match(rules, /match \/audit_logs\/\{document\}/);
    assert.match(rules, /allow read, write: if isAdmin\(\)/);
    assert.doesNotMatch(rules, /match \/audit_logs[\s\S]*allow create: if request\.auth != null/);
});

test('all meaningful infrastructure operations emit audit events', () => {
    const app = read('datastore-copier/src/app.ts');
    const audit = read('datastore-copier/src/audit.ts');
    for (const operation of [
        'AUTHENTICATION',
        'MODE_SELECT',
        'BQ_SCHEMA_COMPARE',
        'BQ_CSV_EXPORT',
        'QUERY_COMPARE',
        'QUERY_SYNC',
        'DATASTORE_ANALYZE',
        'DATASTORE_CANCEL',
        'DATASTORE_CSV_EXPORT',
        'DATASTORE_COPY',
        'DATASTORE_EDIT'
    ]) {
        assert.match(app, new RegExp(`['"]${operation}['"]`), `${operation} must be logged`);
    }
    for (const operation of [
        'QUERY_REVERT',
        'DATASTORE_REVERT',
        'DATASTORE_EDIT_REVERT',
        'AUDIT_EXPORT'
    ]) {
        assert.match(audit, new RegExp(`['"]${operation}['"]`), `${operation} must be logged`);
    }
});

test('mutating workflows persist revert state before Datastore changes', () => {
    const app = read('datastore-copier/src/app.ts');
    const datastoreAudit = app.indexOf("'DATASTORE_COPY'");
    const datastoreCommit = app.indexOf('await Api.commitDatastore(State.ds.tgt');
    const editAudit = app.indexOf("'DATASTORE_EDIT'");
    const editCommit = app.indexOf('await Api.commitDatastore(pid');

    assert.ok(datastoreAudit >= 0 && datastoreAudit < datastoreCommit);
    assert.ok(editAudit >= 0 && editAudit < editCommit);
    assert.match(app, /centralized audit backup could not be persisted\. No entities were changed/);
    assert.match(app, /centralized audit backup could not be persisted\. The entity was not changed/);
});
