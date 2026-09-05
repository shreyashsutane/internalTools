const test = require('node:test');
const assert = require('node:assert');

// Test the extractEntityDisplayName algorithm directly
function extractEntityDisplayName(entity) {
    if (!entity || !entity.properties || typeof entity.properties !== 'object') {
        return null;
    }
    const props = entity.properties;

    const getPropVal = p => {
        if (!p) return null;
        const rawVal = p.stringValue !== undefined ? p.stringValue
            : p.integerValue !== undefined ? p.integerValue
            : p.booleanValue !== undefined ? p.booleanValue
            : p.timestampValue !== undefined ? p.timestampValue
            : null;
        if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
            return String(rawVal).trim();
        }
        return null;
    };

    const priorityFields = [
        'name',
        'referencename',
        'displayname',
        'username',
        'chainname',
        'jobname',
        'taskname'
    ];

    // 1. Exact Priority Match (Case-Insensitive)
    for (const field of priorityFields) {
        const key = Object.keys(props).find(k => k.toLowerCase() === field.toLowerCase());
        if (key && props[key]) {
            const val = getPropVal(props[key]);
            if (val !== null) {
                return { fieldName: key, value: val };
            }
        }
    }

    // 2. Any field containing "name" (case-insensitive)
    for (const key of Object.keys(props)) {
        if (key.toLowerCase().includes('name') && props[key]) {
            const val = getPropVal(props[key]);
            if (val !== null) {
                return { fieldName: key, value: val };
            }
        }
    }

    // 3. Fallback: Any property ending in 'title' or 'label'
    for (const key of Object.keys(props)) {
        const lower = key.toLowerCase();
        if ((lower.endsWith('title') || lower.endsWith('label')) && props[key]) {
            const val = getPropVal(props[key]);
            if (val !== null) {
                return { fieldName: key, value: val };
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

test('extractEntityDisplayName matches any property containing name anywhere (case-insensitive)', () => {
    const entity1 = {
        key: { path: [{ kind: 'UserMaster', id: '4535697042046976' }] },
        properties: {
            user_name_alias: { stringValue: 'Salesplayer_48' },
            activeStatus: { stringValue: 'ENABLED' }
        }
    };
    const res1 = extractEntityDisplayName(entity1);
    assert.deepStrictEqual(res1, { fieldName: 'user_name_alias', value: 'Salesplayer_48' });

    const entity2 = {
        key: { path: [{ kind: 'Org', id: '8812' }] },
        properties: {
            COMPANY_NAME_FULL: { stringValue: 'Acme Global Corp' },
            taxId: { stringValue: 'US-99120' }
        }
    };
    const res2 = extractEntityDisplayName(entity2);
    assert.deepStrictEqual(res2, { fieldName: 'COMPANY_NAME_FULL', value: 'Acme Global Corp' });
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
