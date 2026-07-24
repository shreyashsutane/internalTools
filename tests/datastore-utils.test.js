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
    deepEqual,
    editorTextToDatastoreValue,
    getDatastoreEditorType,
    datastoreValueToEditorText,
    minifyJsonProperties,
    replaceDatastoreField
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
