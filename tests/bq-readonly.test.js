const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
    fs.readFileSync(path.join(root, relativePath), 'utf8');

test('BigQuery schema mode exposes comparison controls only', () => {
    const html = read('datastore-copier/index.html');

    assert.match(html, /BQ Schema Comparator/);
    assert.match(html, /Compare Schemas \(Read Only\)/);
    assert.doesNotMatch(html, /btn-bq-copy|template-bq-copy-modal/);
    assert.doesNotMatch(html, /Copy Src|Copy Tgt|Confirm Copy[\s\S]*BigQuery/);
});

test('BigQuery application block contains no mutating API path', () => {
    const app = read('datastore-copier/src/app.ts');
    const start = app.indexOf('// --- BQ logic ---');
    const end = app.indexOf('// --- QUERY logic ---');
    assert.ok(start >= 0 && end > start, 'BigQuery block markers must exist');

    const bqBlock = app.slice(start, end);
    assert.doesNotMatch(
        bqBlock,
        /executeBqCopy|openBqCopyModal|createDataset|createTable|patchTable|deleteTable/
    );
    assert.doesNotMatch(
        bqBlock,
        /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i
    );
    assert.match(bqBlock, /Api\.getDatasets/);
    assert.match(bqBlock, /Api\.getTables/);
    assert.match(bqBlock, /Api\.getSchema/);
});

test('BigQuery mutation helpers and historical revert are absent', () => {
    const api = read('datastore-copier/src/api.ts');
    const audit = read('datastore-copier/src/audit.ts');

    assert.doesNotMatch(
        api,
        /\b(?:createDataset|createTable|patchTable|deleteTable)\s*:/
    );
    assert.doesNotMatch(audit, /Api\.(?:patchTable|deleteTable)/);
    assert.match(
        audit,
        /BigQuery Schema Comparator is read-only/
    );
});
