const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

// Helper to compile TS module
function compileModule(filePath) {
    const build = buildSync({
        entryPoints: [filePath],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
        write: false
    });
    const compiled = new Module(filePath, module);
    compiled.filename = filePath;
    compiled.paths = module.paths;
    compiled._compile(build.outputFiles[0].text, filePath);
    return compiled.exports;
}

const utilsEntry = path.join(__dirname, '..', 'datastore-copier', 'src', 'datastore-utils.ts');
const revertEntry = path.join(__dirname, '..', 'datastore-copier', 'src', 'revert.ts');

const { compressJsonToGzipBlob, decompressFileToJson } = compileModule(utilsEntry);
const { validateBackupPayload, buildDatastoreRevertPlan } = compileModule(revertEntry);

test('compressJsonToGzipBlob compresses JSON and decompressFileToJson decompresses gzip blob', async () => {
    const originalData = {
        type: 'DATASTORE_BACKUP',
        version: 1,
        exportedAt: '2026-09-15T12:00:00.000Z',
        targetProject: 'my-gcp-project',
        databaseId: '(default)',
        backupData: [
            {
                action: 'RESTORE',
                prevEntity: {
                    key: {
                        partitionId: { projectId: 'my-gcp-project', databaseId: '(default)' },
                        path: [{ kind: 'Customer', id: '1001' }]
                    },
                    properties: {
                        name: { stringValue: 'Alice' },
                        balance: { integerValue: '5000' }
                    }
                }
            },
            {
                action: 'DELETE',
                prevEntity: {
                    key: {
                        partitionId: { projectId: 'my-gcp-project', databaseId: '(default)' },
                        path: [{ kind: 'Customer', id: '1002' }]
                    }
                }
            }
        ]
    };

    const blob = await compressJsonToGzipBlob(originalData);
    assert.ok(blob instanceof Blob, 'Should return a Blob instance');
    assert.ok(blob.size > 0, 'Compressed blob should have positive size');

    // Decompress gzip file/blob
    const decompressed = await decompressFileToJson(blob, 'backup.json.gz');
    assert.deepEqual(decompressed, originalData, 'Decompressed data must match original payload');
});

test('decompressFileToJson falls back gracefully to plain JSON when not gzipped', async () => {
    const originalData = {
        type: 'DATASTORE_BACKUP',
        version: 1,
        backupData: [
            {
                action: 'upsert',
                prevEntity: {
                    key: { path: [{ kind: 'Item', name: 'key1' }] },
                    properties: { status: { stringValue: 'active' } }
                }
            }
        ]
    };

    const plainBlob = new Blob([JSON.stringify(originalData)], { type: 'application/json' });
    const decompressed = await decompressFileToJson(plainBlob, 'backup.json');
    assert.deepEqual(decompressed, originalData, 'Plain JSON fallback should parse correctly');
});

test('validateBackupPayload validates correct backup file and calculates summary', () => {
    const payload = {
        type: 'DATASTORE_BACKUP',
        version: 1,
        exportedAt: '2026-09-15T12:00:00.000Z',
        targetProject: 'prod-project',
        databaseId: 'test-db',
        backupData: [
            {
                action: 'RESTORE',
                prevEntity: {
                    key: { path: [{ kind: 'Order', id: '1' }] },
                    properties: { total: { integerValue: '99' } }
                }
            },
            {
                action: 'UPDATE',
                prevEntity: {
                    key: { path: [{ kind: 'Order', id: '2' }] },
                    properties: { total: { integerValue: '150' } }
                }
            },
            {
                action: 'DELETE',
                prevEntity: {
                    key: { path: [{ kind: 'Invoice', id: '99' }] }
                }
            }
        ]
    };

    const res = validateBackupPayload(payload);
    assert.equal(res.valid, true);
    assert.ok(res.summary);
    assert.equal(res.summary.totalEntities, 3);
    assert.equal(res.summary.upsertCount, 2);
    assert.equal(res.summary.deleteCount, 1);
    assert.deepEqual(res.summary.kinds.sort(), ['Invoice', 'Order']);
    assert.equal(res.summary.targetProject, 'prod-project');
    assert.equal(res.summary.databaseId, 'test-db');
});

test('validateBackupPayload rejects malformed payloads with descriptive error', () => {
    assert.equal(validateBackupPayload(null).valid, false);
    assert.match(validateBackupPayload(null).error, /valid JSON object/);

    assert.equal(validateBackupPayload({}).valid, false);
    assert.match(validateBackupPayload({}).error, /no backup entities or items/);

    assert.equal(validateBackupPayload({ backupData: 'not-an-array' }).valid, false);
    assert.equal(validateBackupPayload({ backupData: [] }).valid, false);
    assert.match(validateBackupPayload({ backupData: [] }).error, /no backup entities or items/);

    assert.equal(validateBackupPayload({ backupData: [{ action: 'RESTORE' }] }).valid, false);
    assert.match(
        validateBackupPayload({ backupData: [{ action: 'RESTORE' }] }).error,
        /missing an entity key/
    );
});

test('buildDatastoreRevertPlan builds plan from DATASTORE_BACKUP with optional project override', () => {
    const payload = {
        type: 'DATASTORE_BACKUP',
        targetProject: 'original-project',
        databaseId: 'my-db',
        backupData: [
            {
                action: 'RESTORE',
                prevEntity: {
                    key: {
                        partitionId: { projectId: 'old-project', databaseId: 'old-db' },
                        path: [{ kind: 'User', id: 'u123' }]
                    },
                    properties: {
                        name: { stringValue: 'Bob' }
                    }
                }
            },
            {
                action: 'DELETE',
                prevEntity: {
                    key: {
                        partitionId: { projectId: 'old-project', databaseId: 'old-db' },
                        path: [{ kind: 'User', id: 'u456' }]
                    }
                }
            }
        ]
    };

    // With project override 'new-project'
    const plan = buildDatastoreRevertPlan(payload, 'new-project');
    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.deletes.length, 1);
    assert.equal(plan.upserts[0].upsert.key.partitionId.projectId, 'new-project');
    assert.equal(plan.upserts[0].upsert.key.partitionId.databaseId, 'my-db');
    assert.equal(plan.deletes[0].delete.partitionId.projectId, 'new-project');
});

test('index.html contains Restore Backup File button and template modal', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'datastore-copier', 'index.html'), 'utf8');
    assert.ok(html.includes('id="btn-restore-backup-file"'), 'index.html must contain btn-restore-backup-file button');
    assert.ok(html.includes('id="template-restore-backup-modal"'), 'index.html must contain template-restore-backup-modal');
    assert.ok(html.includes('id="restore-file-input"'), 'template must include restore-file-input');
    assert.ok(html.includes('id="restore-drop-zone"'), 'template must include restore-drop-zone');
    assert.ok(html.includes('id="restore-summary-box"'), 'template must include restore-summary-box');
    assert.ok(html.includes('id="btn-confirm-restore-file"'), 'template must include btn-confirm-restore-file');
});

test('app.ts handles local backup download and does not throw when centralized audit fails', () => {
    const appTs = fs.readFileSync(path.join(__dirname, '..', 'datastore-copier', 'src', 'app.ts'), 'utf8');
    // Ensure compressJsonToGzipBlob and downloadBlobFile are referenced in app.ts
    assert.ok(appTs.includes('compressJsonToGzipBlob'), 'app.ts should call compressJsonToGzipBlob');
    assert.ok(appTs.includes('downloadBlobFile'), 'app.ts should call downloadBlobFile');
    assert.ok(appTs.includes('hasLocalBackup'), 'app.ts should check hasLocalBackup before throwing');
});
