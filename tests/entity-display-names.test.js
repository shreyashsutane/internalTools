const test = require('node:test');
const assert = require('node:assert');

// Test the extractEntityDisplayName algorithm directly
function extractEntityDisplayName(entity) {
    if (!entity || !entity.properties || typeof entity.properties !== 'object') {
        return null;
    }
    const props = entity.properties;

    const priorityFields = [
        'referenceName',
        'chainName',
        'name',
        'displayName',
        'title',
        'jobName',
        'taskName',
        'username',
        'email',
        'label',
        'code',
        'slug',
        'description'
    ];

    // 1. Exact Priority Match (Case-Insensitive)
    for (const field of priorityFields) {
        const key = Object.keys(props).find(k => k.toLowerCase() === field.toLowerCase());
        if (key && props[key]) {
            const rawVal = props[key].stringValue !== undefined ? props[key].stringValue
                : props[key].integerValue !== undefined ? props[key].integerValue
                : props[key].booleanValue !== undefined ? props[key].booleanValue
                : props[key].timestampValue !== undefined ? props[key].timestampValue
                : null;
            if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
                return { fieldName: key, value: String(rawVal) };
            }
        }
    }

    // 2. Any property ending in 'name' or 'title' or 'id'
    for (const key of Object.keys(props)) {
        const lower = key.toLowerCase();
        if ((lower.endsWith('name') || lower.endsWith('title') || lower.endsWith('label')) && props[key]) {
            const rawVal = props[key].stringValue !== undefined ? props[key].stringValue
                : props[key].integerValue !== undefined ? props[key].integerValue
                : props[key].booleanValue !== undefined ? props[key].booleanValue
                : null;
            if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
                return { fieldName: key, value: String(rawVal) };
            }
        }
    }

    return null;
}

test('extractEntityDisplayName finds referenceName property', () => {
    const entity = {
        key: { path: [{ kind: 'JobMaster', id: '1001' }] },
        properties: {
            referenceName: { stringValue: 'PaymentGateway_v2' },
            status: { stringValue: 'ACTIVE' }
        }
    };
    const res = extractEntityDisplayName(entity);
    assert.deepStrictEqual(res, { fieldName: 'referenceName', value: 'PaymentGateway_v2' });
});

test('extractEntityDisplayName finds chainName property', () => {
    const entity = {
        key: { path: [{ kind: 'ChainConfig', id: '56' }] },
        properties: {
            chainName: { stringValue: 'Binance Smart Chain' },
            rpcUrl: { stringValue: 'https://bsc-dataseed.binance.org/' }
        }
    };
    const res = extractEntityDisplayName(entity);
    assert.deepStrictEqual(res, { fieldName: 'chainName', value: 'Binance Smart Chain' });
});

test('extractEntityDisplayName matches custom suffix property ending in Name', () => {
    const entity = {
        key: { path: [{ kind: 'Cluster', name: 'us-central-1' }] },
        properties: {
            clusterNodeName: { stringValue: 'prod-primary-node-01' },
            port: { integerValue: 8080 }
        }
    };
    const res = extractEntityDisplayName(entity);
    assert.deepStrictEqual(res, { fieldName: 'clusterNodeName', value: 'prod-primary-node-01' });
});

test('extractEntityDisplayName returns null when no matching name property exists', () => {
    const entity = {
        key: { path: [{ kind: 'Session', id: '99999' }] },
        properties: {
            timeoutSeconds: { integerValue: 3600 },
            isActive: { booleanValue: true }
        }
    };
    const res = extractEntityDisplayName(entity);
    assert.strictEqual(res, null);
});
