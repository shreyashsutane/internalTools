const assert = require('node:assert/strict');
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
    cloneDatastoreValue,
    compressJsonToBase64,
    decompressJsonFromBase64,
    deepEqual,
    editorTextToDatastoreValue,
    getDatastoreEditorType,
    datastoreValueToEditorText,
    mapConcurrent,
    minifyJsonProperties,
    replaceDatastoreField,
    replaceDatastoreRules
} = compiled.exports;

test('comparison ignores object property order but preserves array order', () => {
    assert.equal(deepEqual({ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 }), true);
    assert.equal(deepEqual([1, 2], [2, 1]), false);
});

test('JSON strings are minified recursively without changing Datastore value types', () => {
    const properties = {
        json: { stringValue: '{ "a": 1, "nested": [ true, false ] }' },
        integer: { integerValue: '9223372036854775807' },
        timestamp: { timestampValue: '2026-07-23T01:02:03.123456789Z' },
        array: {
            arrayValue: {
                values: [
                    { stringValue: '[ 1, 2 ]' },
                    { mapValue: { properties: { nestedJson: { stringValue: '{ "ok": true }' } } } }
                ]
            }
        },
        entity: {
            entityValue: {
                properties: { nestedJson: { stringValue: '{ "type": "entity" }' } }
            }
        }
    };
    const typesBefore = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [key, getDatastoreEditorType(value)])
    );

    minifyJsonProperties(properties);

    assert.equal(properties.json.stringValue, '{"a":1,"nested":[true,false]}');
    assert.equal(properties.array.arrayValue.values[0].stringValue, '[1,2]');
    assert.equal(
        properties.array.arrayValue.values[1].mapValue.properties.nestedJson.stringValue,
        '{"ok":true}'
    );
    assert.equal(properties.entity.entityValue.properties.nestedJson.stringValue, '{"type":"entity"}');
    assert.equal(properties.integer.integerValue, '9223372036854775807');
    assert.deepEqual(
        Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, getDatastoreEditorType(value)])),
        typesBefore
    );
});

test('copy clone preserves every Datastore wrapper while JSON strings are minified', () => {
    const source = {
        key: { partitionId: { projectId: 'source' }, path: [{ kind: 'Thing', id: '1' }] },
        properties: {
            empty: { stringValue: '' },
            integer: { integerValue: '-9007199254740993' },
            double: { doubleValue: 1.25 },
            bool: { booleanValue: false },
            nil: { nullValue: null },
            timestamp: { timestampValue: '2026-01-01T00:00:00Z' },
            blob: { blobValue: 'AQID' },
            key: { keyValue: { path: [{ kind: 'Parent', name: 'x' }] } },
            point: { geoPointValue: { latitude: 1, longitude: 2 } },
            json: { stringValue: '{ "x": 1 }' }
        }
    };
    const copied = cloneDatastoreValue(source);
    copied.key.partitionId.projectId = 'target';
    minifyJsonProperties(copied.properties);

    for (const property of Object.keys(source.properties)) {
        assert.equal(
            getDatastoreEditorType(copied.properties[property]),
            getDatastoreEditorType(source.properties[property])
        );
    }
    assert.equal(copied.properties.integer.integerValue, '-9007199254740993');
    assert.equal(copied.properties.empty.stringValue, '');
    assert.equal(copied.properties.json.stringValue, '{"x":1}');
    assert.equal(source.properties.json.stringValue, '{ "x": 1 }');
});

test('editor conversion keeps integers lossless and permits empty strings', () => {
    assert.deepEqual(
        editorTextToDatastoreValue('Integer', '9223372036854775807'),
        { integerValue: '9223372036854775807' }
    );
    assert.deepEqual(editorTextToDatastoreValue('String', ''), { stringValue: '' });
    assert.deepEqual(
        editorTextToDatastoreValue('String', '{ "saved": true }'),
        { stringValue: '{"saved":true}' }
    );
});

test('complex editor JSON preserves nested Datastore wrappers and 64-bit integers', () => {
    const original = {
        mapValue: {
            properties: {
                large: { integerValue: '9223372036854775807' },
                when: { timestampValue: '2026-07-23T01:02:03Z' }
            }
        }
    };
    const text = datastoreValueToEditorText(original);
    const parsed = JSON.parse(text);
    parsed.properties.note = { stringValue: '{ "new": true }' };
    const edited = editorTextToDatastoreValue('Map', JSON.stringify(parsed), original);
    minifyJsonProperties({ edited });

    assert.equal(edited.mapValue.properties.large.integerValue, '9223372036854775807');
    assert.equal(edited.mapValue.properties.when.timestampValue, '2026-07-23T01:02:03Z');
    assert.equal(edited.mapValue.properties.note.stringValue, '{"new":true}');
});

test('nested find and replace traverses maps, embedded entities, and arrays only in strings', () => {
    const properties = {
        profile: {
            mapValue: {
                properties: {
                    url: { stringValue: 'https://old.example/a' },
                    count: { integerValue: '10' },
                    children: {
                        arrayValue: {
                            values: [
                                {
                                    entityValue: {
                                        properties: {
                                            url: { stringValue: 'https://old.example/b' }
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        },
        'profile.url': { stringValue: 'https://old.example/exact' }
    };

    assert.equal(replaceDatastoreField(properties, 'profile.url', 'old.example', 'new.example'), 1);
    assert.equal(properties['profile.url'].stringValue, 'https://new.example/exact');
    assert.equal(properties.profile.mapValue.properties.url.stringValue, 'https://old.example/a');

    assert.equal(replaceDatastoreField(properties, 'profile.children.url', 'old.example', 'new.example'), 1);
    assert.equal(
        properties.profile.mapValue.properties.children.arrayValue.values[0]
            .entityValue.properties.url.stringValue,
        'https://new.example/b'
    );
    assert.equal(properties.profile.mapValue.properties.count.integerValue, '10');
});

test('invalid JSON-like strings are left unchanged', () => {
    const properties = { invalid: { stringValue: '{ not-json }' } };
    minifyJsonProperties(properties);
    assert.equal(properties.invalid.stringValue, '{ not-json }');
});

test('semantic JSON comparison normalizes key order, whitespace, and numbers without false positives', () => {
    // 1. Re-ordered keys in JSON string
    const jsonStrA = '{"user": "alice", "roles": ["admin", "editor"], "active": true}';
    const jsonStrB = '{\n  "active": true,\n  "user": "alice",\n  "roles": [\n    "admin",\n    "editor"\n  ]\n}';
    assert.equal(deepEqual(jsonStrA, jsonStrB), true);

    // 2. Datastore stringValue wrapper containing JSON
    const dsA = { stringValue: jsonStrA };
    const dsB = { stringValue: jsonStrB };
    assert.equal(deepEqual(dsA, dsB), true);

    // 3. Array order inside JSON is preserved
    const jsonDiffOrderA = '{"items": [1, 2]}';
    const jsonDiffOrderB = '{"items": [2, 1]}';
    assert.equal(deepEqual(jsonDiffOrderA, jsonDiffOrderB), false);

    // 4. Datastore empty array variants compare as equal
    const emptyArr1 = { arrayValue: {} };
    const emptyArr2 = { arrayValue: { values: [] } };
    assert.equal(deepEqual(emptyArr1, emptyArr2), true);

    // 5. Datastore excludeFromIndexes metadata normalization
    const propWithIndex = { stringValue: 'hello', excludeFromIndexes: false };
    const propWithoutIndex = { stringValue: 'hello' };
    assert.equal(deepEqual(propWithIndex, propWithoutIndex), true);

    // 6. Datastore timestamp ISO normalization
    const ts1 = { timestampValue: '2026-08-20T10:00:00Z' };
    const ts2 = { timestampValue: '2026-08-20T10:00:00.000Z' };
    assert.equal(deepEqual(ts1, ts2), true);
});

test('compressJsonToBase64 and decompressJsonFromBase64 preserve 100% data fidelity losslessly', async () => {
    const complexData = {
        type: 'DATASTORE_COPY',
        kind: 'TestKind',
        backupData: [
            {
                keyStr: 'Kind:1',
                action: 'upsert',
                prevEntity: {
                    key: { path: [{ kind: 'TestKind', id: '1' }] },
                    properties: {
                        integer: { integerValue: '9223372036854775807' },
                        jsonStr: { stringValue: '{"nested": [1, 2, 3], "flag": true}' }
                    }
                }
            }
        ]
    };

    const compressed = await compressJsonToBase64(complexData);
    assert.equal(typeof compressed, 'string');
    assert.ok(compressed.length > 0);

    const decompressed = await decompressJsonFromBase64(compressed);
    assert.deepEqual(decompressed, complexData);
});

test('mapConcurrent executes tasks in parallel within bounded concurrency limit', async () => {
    const items = [10, 20, 30, 40, 50];
    let activeWorkers = 0;
    let maxObservedWorkers = 0;

    const results = await mapConcurrent(items, 3, async (item) => {
        activeWorkers++;
        if (activeWorkers > maxObservedWorkers) maxObservedWorkers = activeWorkers;
        await new Promise(r => setTimeout(r, 10));
        activeWorkers--;
        return item * 2;
    });

    assert.deepEqual(results, [20, 40, 60, 80, 100]);
    assert.ok(maxObservedWorkers <= 3, 'Observed concurrency exceeded max allowed');
});

test('deepEqual normalizes CRLF line endings, Datastore meaning metadata, blob padding, and key values', () => {
    // 1. CRLF vs LF in plain strings
    assert.equal(deepEqual('line1\r\nline2', 'line1\nline2'), true);

    // 2. Datastore internal meaning metadata field
    const propWithMeaning = { stringValue: 'test', meaning: 18 };
    const propWithoutMeaning = { stringValue: 'test' };
    assert.equal(deepEqual(propWithMeaning, propWithoutMeaning), true);

    // 3. Blob base64 padding difference
    const blob1 = { blobValue: 'dGVzdA==' };
    const blob2 = { blobValue: 'dGVzdA' };
    assert.equal(deepEqual(blob1, blob2), true);

    // 4. KeyValue cross-project partition reference
    const keyRefA = { keyValue: { partitionId: { projectId: 'proj-a' }, path: [{ kind: 'User', id: '123' }] } };
    const keyRefB = { keyValue: { partitionId: { projectId: 'proj-b' }, path: [{ kind: 'User', id: '123' }] } };
    assert.equal(deepEqual(keyRefA, keyRefB), true);
});

test('replaceDatastoreRules applies multiple sequential find & replace rules including long values and 64-bit integers', () => {
    const longSqlA = 'SELECT user_id, order_total\nFROM `source-analytics-prod.sales.orders`\nWHERE status = "COMPLETED"\nAND region = "us-east1";';
    const longSqlExpected = 'SELECT user_id, order_total\nFROM `target-analytics-staging.sales.orders`\nWHERE status = "FINALIZED"\nAND region = "us-east1";';

    const entity = {
        key: { path: [{ kind: 'Task', id: '555' }] },
        properties: {
            sqlQuery: { stringValue: longSqlA },
            endpoint: { stringValue: 'https://api.source-internal.com/v1/checkout' },
            legacyId: { integerValue: '9876543210123' },
            nested: {
                mapValue: {
                    properties: {
                        subUrl: { stringValue: 'https://sub.source-internal.com' },
                        subCount: { integerValue: '9876543210123' }
                    }
                }
            }
        }
    };

    const rules = [
        { field: 'sqlQuery', target: 'source-analytics-prod', replacement: 'target-analytics-staging' },
        { field: 'sqlQuery', target: 'COMPLETED', replacement: 'FINALIZED' },
        { field: '*', target: 'source-internal.com', replacement: 'target-cloud.org' },
        { field: '*', target: '9876543210123', replacement: '1122334455667' }
    ];

    const count = replaceDatastoreRules(entity, rules);
    assert.ok(count >= 5);

    // Verify long multiline SQL query was replaced accurately
    assert.equal(entity.properties.sqlQuery.stringValue, longSqlExpected);

    // Verify endpoint string was replaced
    assert.equal(entity.properties.endpoint.stringValue, 'https://api.target-cloud.org/v1/checkout');

    // Verify 64-bit integer / long value was replaced in root and nested maps
    assert.equal(entity.properties.legacyId.integerValue, '1122334455667');
    assert.equal(entity.properties.nested.mapValue.properties.subUrl.stringValue, 'https://sub.target-cloud.org');
    assert.equal(entity.properties.nested.mapValue.properties.subCount.integerValue, '1122334455667');
});


