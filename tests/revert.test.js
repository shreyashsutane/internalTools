const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'datastore-copier', 'src', 'revert.ts');
const build = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
    write: false
});
const compiled = new Module(entry, module);
compiled.filename = entry;
compiled.paths = module.paths;
compiled._compile(build.outputFiles[0].text, entry);
const {
    buildDatastoreRevertPlan,
    executeDatastoreRevert,
    executeScheduledQueryRevert,
    isPermissionDenied
} = compiled.exports;

const key = id => ({
    partitionId: { projectId: 'old-project', databaseId: 'old-db' },
    path: [{ kind: 'Thing', id: String(id) }]
});

const entity = id => ({
    key: key(id),
    properties: {
        integer: { integerValue: '9223372036854775807' },
        json: { stringValue: '{ "restored": true }' }
    }
});

test('Datastore copy revert plan preserves types, minifies JSON, and retargets keys', () => {
    const previous = entity(1);
    const state = {
        type: 'DATASTORE_COPY',
        tgtDb: 'target-db',
        backupData: [
            { action: 'upsert', prevEntity: previous },
            { action: 'delete', prevEntity: { key: key(2) } }
        ]
    };

    const plan = buildDatastoreRevertPlan(state, 'target-project');

    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.deletes.length, 1);
    assert.equal(plan.upserts[0].upsert.key.partitionId.projectId, 'target-project');
    assert.equal(plan.upserts[0].upsert.key.partitionId.databaseId, 'target-db');
    assert.equal(
        plan.upserts[0].upsert.properties.integer.integerValue,
        '9223372036854775807'
    );
    assert.equal(
        plan.upserts[0].upsert.properties.json.stringValue,
        '{"restored":true}'
    );
    assert.equal(plan.deletes[0].delete.partitionId.projectId, 'target-project');
    assert.equal(previous.properties.json.stringValue, '{ "restored": true }');
});

test('revert commits all upserts and skips deletes when delete permission is absent', async () => {
    const calls = [];
    const api = {
        commitDatastore: async (projectId, mutations, databaseId) => {
            calls.push({ projectId, mutations, databaseId });
            if (mutations.some(mutation => mutation.delete)) {
                const error = new Error('PERMISSION_DENIED: insufficient permission');
                error.status = 403;
                throw error;
            }
        }
    };
    const state = {
        type: 'DATASTORE_COPY',
        tgtDb: '(default)',
        backupData: [
            { action: 'upsert', prevEntity: entity(1) },
            { action: 'upsert', prevEntity: entity(2) },
            { action: 'delete', prevEntity: { key: key(3) } },
            { action: 'delete', prevEntity: { key: key(4) } }
        ]
    };

    const result = await executeDatastoreRevert(api, 'target-project', state, 1);

    assert.deepEqual(result, { restored: 2, deleted: 0, skippedDeletes: 2 });
    assert.equal(calls.length, 3);
    assert.ok(calls[0].mutations.every(mutation => mutation.upsert));
    assert.ok(calls[1].mutations.every(mutation => mutation.upsert));
    assert.ok(calls[2].mutations.every(mutation => mutation.delete));
});

test('non-permission delete failures still fail the revert', async () => {
    const api = {
        commitDatastore: async (_projectId, mutations) => {
            if (mutations.some(mutation => mutation.delete)) {
                const error = new Error('backend unavailable');
                error.status = 503;
                throw error;
            }
        }
    };
    const state = {
        type: 'DATASTORE_EDIT',
        dbId: '(default)',
        prevEntity: null,
        rawKey: key(5)
    };

    await assert.rejects(
        executeDatastoreRevert(api, 'target-project', state),
        /backend unavailable/
    );
});

test('permission detection handles status, code, and service messages', () => {
    assert.equal(isPermissionDenied({ status: 403 }), true);
    assert.equal(isPermissionDenied({ code: 'PERMISSION_DENIED' }), true);
    assert.equal(isPermissionDenied(new Error('not authorized to delete')), true);
    assert.equal(isPermissionDenied({ status: 500, message: 'server error' }), false);
});

test('large restores are committed in bounded chunks', async () => {
    const sizes = [];
    const api = {
        commitDatastore: async (_projectId, mutations) => sizes.push(mutations.length)
    };
    const state = {
        type: 'DATASTORE_COPY',
        tgtDb: '(default)',
        backupData: Array.from(
            { length: 401 },
            (_, index) => ({ action: 'upsert', prevEntity: entity(index + 1) })
        )
    };

    const result = await executeDatastoreRevert(api, 'target-project', state);

    assert.deepEqual(sizes, [400, 1]);
    assert.deepEqual(result, { restored: 401, deleted: 0, skippedDeletes: 0 });
});

test('scheduled-query revert deletes created configs and restores updated configs', async () => {
    const calls = [];
    const api = {
        deleteQuery: async name => calls.push(['delete', name]),
        createQuery: async (project, location, config) => {
            calls.push(['create', project, location, config.displayName]);
            return { name: `projects/${project}/locations/${location}/transferConfigs/restored` };
        }
    };
    const result = await executeScheduledQueryRevert(api, 'target-project', [
        {
            action: 'create',
            name: 'projects/target-project/locations/us/transferConfigs/new-one'
        },
        {
            action: 'update',
            name: 'projects/target-project/locations/europe-west1/transferConfigs/replacement',
            prevQuery: { displayName: 'Previous' },
            newQuery: { displayName: 'Replacement' }
        }
    ]);

    assert.deepEqual(result, { restored: 1, deleted: 1, failed: 0, errors: [] });
    assert.deepEqual(calls, [
        ['delete', 'projects/target-project/locations/us/transferConfigs/new-one'],
        ['delete', 'projects/target-project/locations/europe-west1/transferConfigs/replacement'],
        ['create', 'target-project', 'europe-west1', 'Previous']
    ]);
});

test('failed scheduled-query restore recreates the copied config and reports failure', async () => {
    const calls = [];
    let createAttempt = 0;
    const api = {
        deleteQuery: async name => calls.push(['delete', name]),
        createQuery: async (_project, _location, config) => {
            createAttempt++;
            calls.push(['create', config.displayName]);
            if (createAttempt === 1) throw new Error('restore rejected');
            return { name: 'recovered' };
        }
    };

    const result = await executeScheduledQueryRevert(api, 'target-project', [{
        action: 'update',
        name: 'projects/target-project/locations/us/transferConfigs/current',
        prevQuery: { displayName: 'Previous' },
        newQuery: { displayName: 'Current' }
    }]);

    assert.equal(result.restored, 0);
    assert.equal(result.deleted, 0);
    assert.equal(result.failed, 1);
    assert.match(result.errors[0], /restore rejected/);
    assert.deepEqual(calls, [
        ['delete', 'projects/target-project/locations/us/transferConfigs/current'],
        ['create', 'Previous'],
        ['create', 'Current']
    ]);
});
