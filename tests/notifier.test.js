const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'datastore-copier', 'src', 'notifier.ts');
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
const { FORMSPREE_ENTITY_CHUNK_SIZE, buildOperationEmailPayloads } = compiled.exports;

test('buildOperationEmailPayloads chunks >500 entities into multiple parts without dropping any', () => {
    const entities = Array.from({ length: 1120 }, (_, i) => ({
        keyStr: `Questions:${1000 + i}`,
        name: `Question ${i}`,
        status: i % 4 === 0 ? 'different' : i % 4 === 1 ? 'missing' : i % 4 === 2 ? 'mapped' : 'identical'
    }));

    const payloads = buildOperationEmailPayloads({
        operation: 'Datastore Analyze & Compare',
        status: 'SUCCESS',
        operatorEmail: 'yash.jadhav@dista.ai',
        srcProject: 'src-proj',
        tgtProject: 'tgt-proj',
        kinds: ['Questions'],
        summary: 'Total: 1120',
        filters: ['[Questions] __key__ IN (auto): 1000, 1001'],
        entities
    });

    assert.equal(FORMSPREE_ENTITY_CHUNK_SIZE, 500);
    assert.equal(payloads.length, 3);
    assert.match(payloads[0]._subject, /\[Part 1\/3\]/);
    assert.match(payloads[2]._subject, /\[Part 3\/3\]/);
    assert.match(payloads[0].message, /Filters Used:\n  - \[Questions\] __key__ IN/);
    assert.match(payloads[0].message, /1\. Questions:1000 — "Question 0" \[DIFFERENT\]/);
    assert.match(payloads[2].message, /1120\. Questions:2119 — "Question 1119" \[IDENTICAL\]/);
});

test('buildOperationEmailPayloads includes error message on FAILED operations', () => {
    const payloads = buildOperationEmailPayloads({
        operation: 'Datastore Copy',
        status: 'FAILED',
        operatorEmail: 'yash.jadhav@dista.ai',
        srcProject: 'src-proj',
        tgtProject: 'tgt-proj',
        summary: 'Copy failed',
        errorMessage: 'PERMISSION_DENIED: Missing datastore.entities.create',
        entities: [{ keyStr: 'Questions:55', name: 'Sample Q', status: 'FAILED' }]
    });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].status, 'FAILED');
    assert.match(payloads[0].message, /PERMISSION_DENIED: Missing datastore\.entities\.create/);
    assert.match(payloads[0].message, /1\. Questions:55 — "Sample Q" \[FAILED\]/);
});
