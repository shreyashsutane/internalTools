const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'datastore-copier', 'src', 'datastore-utils.ts');
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
    DATASTORE_IN_LIMIT,
    splitInFilterValues,
    buildDatastoreFilterObject,
    buildChunkedDatastoreFilterSets
} = compiled.exports;

test('splitInFilterValues splits on newlines, CRLF, and commas', () => {
    const vals = splitInFilterValues('1001\n1002\r\n1003, 1004,\n\n  1005  ');
    assert.deepEqual(vals, ['1001', '1002', '1003', '1004', '1005']);
});

test('buildDatastoreFilterObject uses newline and comma splitting for IN', () => {
    const filter = buildDatastoreFilterObject('__key__', 'IN', '101\n102\n103', 'auto', 'Questions', 'my-proj');
    assert.equal(filter.propertyFilter.op, 'IN');
    assert.equal(filter.propertyFilter.value.arrayValue.values.length, 3);
    assert.deepEqual(
        filter.propertyFilter.value.arrayValue.values.map(v => v.keyValue.path[0].id),
        ['101', '102', '103']
    );
});

test('buildChunkedDatastoreFilterSets chunks > 30 IN values into <= 30-value queries while preserving other filters', () => {
    const ids = Array.from({ length: 65 }, (_, i) => String(i + 1)).join('\n');
    const sets = buildChunkedDatastoreFilterSets(
        [
            { prop: '__key__', op: 'IN', type: 'auto', val: ids },
            { prop: 'active', op: 'EQUAL', type: 'boolean', val: 'true' }
        ],
        'Questions',
        'my-proj'
    );

    assert.equal(DATASTORE_IN_LIMIT, 30);
    assert.equal(sets.length, 3);
    assert.equal(sets[0][0].propertyFilter.value.arrayValue.values.length, 30);
    assert.equal(sets[1][0].propertyFilter.value.arrayValue.values.length, 30);
    assert.equal(sets[2][0].propertyFilter.value.arrayValue.values.length, 5);
    assert.equal(sets[0][1].propertyFilter.property.name, 'active');
    assert.equal(sets[2][1].propertyFilter.property.name, 'active');
});

test('toggleKind defaults filter operator to IN and backupMethod is local file only', () => {
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'datastore-copier', 'src', 'ui.ts'), 'utf8');
    const stateSrc = fs.readFileSync(path.join(__dirname, '..', 'datastore-copier', 'src', 'state.ts'), 'utf8');
    const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'datastore-copier', 'index.html'), 'utf8');

    assert.match(uiSrc, /UI\.addDsFilter\(undefined,\s*'IN',\s*undefined,\s*undefined,\s*kind\)/);
    assert.match(stateSrc, /backupMethod:\s*'file'/);
    assert.doesNotMatch(htmlSrc, /name="ds-backup-method"\s+value="firestore"/);
    assert.doesNotMatch(htmlSrc, /name="ds-backup-method"\s+value="both"/);
});
