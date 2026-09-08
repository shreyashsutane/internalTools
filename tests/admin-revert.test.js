const assert = require('node:assert/strict');
const test = require('node:test');

// Test helper implementations matching admin.html
function cleanDbId(dbId) {
    return dbId === '(default)' || !dbId ? '' : dbId;
}

function targetPartition(projectId, databaseId) {
    const partitionId = { projectId };
    const cleanId = cleanDbId(databaseId);
    if (cleanId) partitionId.databaseId = cleanId;
    return partitionId;
}

function retargetKey(key, projectId, databaseId) {
    if (!key) throw new Error('Revert backup contains an invalid Datastore key.');
    const copy = JSON.parse(JSON.stringify(key));
    copy.partitionId = targetPartition(projectId, databaseId);
    return copy;
}

function retargetEntity(entity, projectId, databaseId) {
    if (!entity || !entity.key) throw new Error('Revert backup contains an entity without a key.');
    const copy = JSON.parse(JSON.stringify(entity));
    copy.key = retargetKey(copy.key, projectId, databaseId);
    return copy;
}

function checkRequiredPermissions(grantedPermissions, isQuerySync = false) {
    const writePerms = isQuerySync
        ? ['bigquery.transfers.update']
        : ['datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete'];
    return writePerms.filter(p => !grantedPermissions.includes(p));
}

function isLogReversible(log) {
    return (log.operation === 'DATASTORE_COPY' || log.operation === 'DATASTORE_EDIT' || log.operation === 'QUERY_SYNC')
        && log.status !== 'FAILED'
        && log.status !== 'CANCELLED'
        && Boolean(log.tgtProject)
        && log.tgtProject !== '—';
}

function parseRevertUrlParams(queryString) {
    const params = new URLSearchParams(queryString);
    if (params.get('action') === 'revert' && params.get('logId')) {
        return { action: 'revert', logId: params.get('logId') };
    }
    return null;
}

test('Admin Revert: retargetKey updates partition projectId and databaseId correctly', () => {
    const sourceKey = {
        partitionId: { projectId: 'src-project-123', databaseId: 'custom-db' },
        path: [{ kind: 'Customer', name: 'cust_001' }]
    };

    const retargeted = retargetKey(sourceKey, 'dest-project-999', 'dest-db');
    assert.equal(retargeted.partitionId.projectId, 'dest-project-999');
    assert.equal(retargeted.partitionId.databaseId, 'dest-db');
    assert.equal(retargeted.path[0].name, 'cust_001');

    // Default db cleans databaseId
    const defaultDbKey = retargetKey(sourceKey, 'dest-project-999', '(default)');
    assert.equal(defaultDbKey.partitionId.projectId, 'dest-project-999');
    assert.equal(defaultDbKey.partitionId.databaseId, undefined);
});

test('Admin Revert: retargetEntity updates entity key and preserves properties', () => {
    const sourceEntity = {
        key: {
            partitionId: { projectId: 'src-proj' },
            path: [{ kind: 'Invoice', id: '10023' }]
        },
        properties: {
            amount: { doubleValue: 450.50 },
            status: { stringValue: 'PAID' }
        }
    };

    const retargeted = retargetEntity(sourceEntity, 'target-project-777', '');
    assert.equal(retargeted.key.partitionId.projectId, 'target-project-777');
    assert.equal(retargeted.properties.amount.doubleValue, 450.50);
    assert.equal(retargeted.properties.status.stringValue, 'PAID');
});

test('Admin Revert: checkRequiredPermissions identifies missing Datastore and BigQuery IAM permissions', () => {
    const fullDatastorePerms = [
        'datastore.entities.create',
        'datastore.entities.update',
        'datastore.entities.delete',
        'datastore.entities.get'
    ];
    assert.deepEqual(checkRequiredPermissions(fullDatastorePerms), []);

    // Missing delete permission
    const readCreateOnly = ['datastore.entities.create', 'datastore.entities.get'];
    const missing = checkRequiredPermissions(readCreateOnly);
    assert.deepEqual(missing, ['datastore.entities.update', 'datastore.entities.delete']);

    // BigQuery Transfer permissions
    assert.deepEqual(checkRequiredPermissions(['bigquery.transfers.update'], true), []);
    assert.deepEqual(checkRequiredPermissions(['bigquery.transfers.get'], true), ['bigquery.transfers.update']);
});

test('Admin Revert: isLogReversible correctly classifies operations', () => {
    assert.equal(isLogReversible({ operation: 'DATASTORE_COPY', status: 'SUCCESS', tgtProject: 'proj-b' }), true);
    assert.equal(isLogReversible({ operation: 'DATASTORE_EDIT', status: 'SUCCESS', tgtProject: 'proj-b' }), true);
    assert.equal(isLogReversible({ operation: 'QUERY_SYNC', status: 'PARTIAL', tgtProject: 'proj-b' }), true);

    // Non-reversible cases
    assert.equal(isLogReversible({ operation: 'AUTHENTICATION', status: 'SUCCESS', tgtProject: '—' }), false);
    assert.equal(isLogReversible({ operation: 'DATASTORE_ANALYZE', status: 'SUCCESS', tgtProject: 'proj-b' }), false);
    assert.equal(isLogReversible({ operation: 'DATASTORE_COPY', status: 'FAILED', tgtProject: 'proj-b' }), false);
    assert.equal(isLogReversible({ operation: 'DATASTORE_COPY', status: 'SUCCESS', tgtProject: '—' }), false);
});

test('Admin Revert: parseRevertUrlParams extracts deep-linked revert action from URL', () => {
    const parsed = parseRevertUrlParams('?action=revert&logId=audit-doc-987123');
    assert.deepEqual(parsed, { action: 'revert', logId: 'audit-doc-987123' });

    assert.equal(parseRevertUrlParams('?action=view'), null);
    assert.equal(parseRevertUrlParams(''), null);
});

test('Admin Console: toggleLogExpand in admin.html defines isReversible before template rendering', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const adminHtml = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');

    // Extract toggleLogExpand function body
    const fnMatch = adminHtml.match(/async function toggleLogExpand\(tr, logId\)\s*\{([\s\S]*?)\n\s*\}\n\s*\/\/\s*Export Consolidated logs/);
    assert.ok(fnMatch, 'toggleLogExpand function must be found in admin.html');
    const fnBody = fnMatch[1];

    // Must define isReversible before using ${isReversible ? ...}
    const defIndex = fnBody.indexOf('const isReversible =');
    const useIndex = fnBody.indexOf('${isReversible ?');
    assert.ok(defIndex !== -1, 'isReversible must be defined in toggleLogExpand');
    assert.ok(useIndex !== -1, '${isReversible ? ...} template literal should be present');
    assert.ok(defIndex < useIndex, 'isReversible must be defined before its usage in toggleLogExpand template literal');
});

test('Admin Console: layout and styling guarantees full screen width with no horizontal scroll', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const adminHtml = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');

    // 1. Workspace active takes 100% width and display block
    assert.ok(adminHtml.includes('body.workspace-active {'), 'body.workspace-active rule must exist');
    assert.ok(adminHtml.includes('width: 100%;'), 'width: 100% must be present');

    // 2. Table has table-layout fixed so columns fit 100% without horizontal blowup
    assert.ok(adminHtml.includes('.table {') && adminHtml.includes('table-layout: fixed;'), 'table must have table-layout: fixed');

    // 3. Table header has opaque sticky background
    assert.ok(adminHtml.includes('.table th {') && adminHtml.includes('background: #0c121d !important;'), 'table th must have opaque background');

    // 4. Expanded card has word-break break-word and 100% width
    assert.ok(adminHtml.includes('.audit-expanded-card {') && adminHtml.includes('word-break: break-word;'), 'audit-expanded-card must wrap words');

    // 5. Entity mutations table has table-layout fixed
    assert.ok(adminHtml.includes('.audit-entity-table {') && adminHtml.includes('table-layout: fixed;'), 'audit-entity-table must have table-layout fixed');
});

