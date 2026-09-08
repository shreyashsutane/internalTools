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
