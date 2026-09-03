const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'datastore-copier', 'src', 'audit.ts');
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

const { AuditLog, preparePrevState } = compiled.exports;

test('oversized audit state is split and reassembled without losing entity properties', async () => {
    const randomValue = crypto.randomBytes(900_000).toString('base64');
    const previousState = {
        type: 'DATASTORE_COPY',
        tgtDb: 'target-db',
        backupData: [{
            action: 'upsert',
            keyStr: 'LargeEntity:1',
            prevEntity: {
                key: { path: [{ kind: 'LargeEntity', id: '1' }] },
                properties: { payload: { stringValue: randomValue } }
            }
        }]
    };

    const prepared = await preparePrevState(previousState);
    assert.ok(prepared.chunks && prepared.chunks.length > 1);
    assert.equal(prepared.inline.chunked, true);
    assert.equal(prepared.inline.backupComplete, false);

    const originalRequest = AuditLog.request;
    AuditLog.request = async (_path, body) => ({ data: prepared.chunks[body.index] });
    try {
        const restored = await AuditLog.resolvePrevState(
            'AbCdEfGhIjKlMnOpQrSt',
            { ...prepared.inline, backupComplete: true }
        );
        assert.deepEqual(restored, previousState);
        assert.equal(restored.backupData[0].prevEntity.properties.payload.stringValue, randomValue);
    } finally {
        AuditLog.request = originalRequest;
    }
});
