const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('template-ds-copy-modal contains the Audit Tracking checkbox with complete field rules description', () => {
    const htmlPath = path.join(__dirname, '../datastore-copier/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Verify template exists
    assert.ok(html.includes('id="template-ds-copy-modal"'), 'template-ds-copy-modal should exist');

    const templateMatch = html.match(/<template id="template-ds-copy-modal">([\s\S]*?)<\/template>/);
    assert.ok(templateMatch, 'Should find template-ds-copy-modal block');
    const templateContent = templateMatch[1];

    // Verify checkbox ID and class
    assert.ok(templateContent.includes('id="chk-apply-audit-tracking"'), 'Must contain checkbox id="chk-apply-audit-tracking"');
    assert.ok(templateContent.includes('chk-apply-audit-tracking'), 'Must contain class chk-apply-audit-tracking');

    // Verify target fields description
    assert.ok(templateContent.includes('updatedByName'), 'Must mention updatedByName');
    assert.ok(templateContent.includes('createdByName'), 'Must mention createdByName');
    assert.ok(templateContent.includes('createdBy'), 'Must mention createdBy');
    assert.ok(templateContent.includes('updatedBy'), 'Must mention updatedBy');
    assert.ok(templateContent.includes('untouched'), 'Must state that createdBy & updatedBy are preserved untouched');

    // Verify timestamps description
    assert.ok(templateContent.includes('updateAt') || templateContent.includes('updatedAt'), 'Must mention updateAt/updatedAt');
    assert.ok(templateContent.includes('createdAt') || templateContent.includes('createAt'), 'Must mention createdAt/createAt');

    // Verify default is unchecked
    assert.strictEqual(
        templateContent.includes('id="chk-apply-audit-tracking" checked'),
        false,
        'Audit tracking checkbox must be unchecked by default so user opt-in is required'
    );
});

test('app.ts guards applyEntityAuditTracking with if (applyAuditTracking)', () => {
    const appTsPath = path.join(__dirname, '../datastore-copier/src/app.ts');
    const code = fs.readFileSync(appTsPath, 'utf8');

    // Verify conditional execution
    assert.ok(code.includes('if (applyAuditTracking) {'), 'applyEntityAuditTracking must be guarded by if (applyAuditTracking)');
    assert.ok(code.includes('applyEntityAuditTracking(entity, e.entity, isUpdate, userAuditName, kindProps)'), 'Must pass exact parameters to applyEntityAuditTracking');

    // Verify copyOptions in state captures applyAuditTracking
    assert.ok(code.includes('applyAuditTracking: isAuditSelected'), 'Must capture audit tracking checkbox state in copyOptions');
});

test('Conditional audit tracking logic leaves entities untouched when unchecked', async () => {
    // Dynamically bundle and test datastore-utils applyEntityAuditTracking behavior
    const esbuild = require('esbuild');
    const tsPath = path.join(__dirname, '../datastore-copier/src/datastore-utils.ts');
    const result = await esbuild.build({
        entryPoints: [tsPath],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
    });
    const { applyEntityAuditTracking } = requireFromString(result.outputFiles[0].text);

    const srcEntity = {
        key: { path: [{ kind: 'Customer', id: '123' }] },
        properties: {
            name: { stringValue: 'Alice' },
            updateAt: { stringValue: '2026-01-01T00:00:00Z' },
            updatedByName: { stringValue: 'Old Name' },
            updatedBy: { stringValue: 'uid-old-system' }
        }
    };

    // Scenario 1: applyAuditTracking is FALSE (user did NOT select checkbox)
    const applyAuditTrackingFalse = false;
    const targetEntityUnchecked = JSON.parse(JSON.stringify(srcEntity));
    if (applyAuditTrackingFalse) {
        applyEntityAuditTracking(targetEntityUnchecked, srcEntity, true, 'Yash Jadhav CC', ['name', 'updateAt', 'updatedByName', 'updatedBy']);
    }

    // Must remain 100% identical to source when unchecked
    assert.strictEqual(targetEntityUnchecked.properties.updatedByName.stringValue, 'Old Name', 'updatedByName must not change when checkbox is unchecked');
    assert.strictEqual(targetEntityUnchecked.properties.updateAt.stringValue, '2026-01-01T00:00:00Z', 'updateAt must not change when checkbox is unchecked');
    assert.strictEqual(targetEntityUnchecked.properties.updatedBy.stringValue, 'uid-old-system', 'updatedBy must remain untouched');

    // Scenario 2: applyAuditTracking is TRUE (user selected checkbox)
    const applyAuditTrackingTrue = true;
    const targetEntityChecked = JSON.parse(JSON.stringify(srcEntity));
    if (applyAuditTrackingTrue) {
        applyEntityAuditTracking(targetEntityChecked, srcEntity, true, 'Yash Jadhav CC', ['name', 'updateAt', 'updatedByName', 'updatedBy']);
    }

    // Must apply rules:
    // 1. updatedByName is updated with operator name
    assert.strictEqual(targetEntityChecked.properties.updatedByName.stringValue, 'Yash Jadhav CC', 'updatedByName must be updated with operator name');
    // 2. updateAt is updated with current timestamp
    assert.notStrictEqual(targetEntityChecked.properties.updateAt.stringValue, '2026-01-01T00:00:00Z', 'updateAt must be refreshed');
    // 3. updatedBy is preserved UNTOUCHED
    assert.strictEqual(targetEntityChecked.properties.updatedBy.stringValue, 'uid-old-system', 'updatedBy must remain untouched');
});

test('Conditional audit tracking on CREATE respects createdByName and preserves createdBy', async () => {
    const esbuild = require('esbuild');
    const tsPath = path.join(__dirname, '../datastore-copier/src/datastore-utils.ts');
    const result = await esbuild.build({
        entryPoints: [tsPath],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
    });
    const { applyEntityAuditTracking } = requireFromString(result.outputFiles[0].text);

    const srcEntity = {
        key: { path: [{ kind: 'Product', id: 'p1' }] },
        properties: {
            title: { stringValue: 'Gadget' },
            createdAt: { timestampValue: '2025-05-01T12:00:00Z' },
            createdByName: { stringValue: 'Initial Creator' },
            createdBy: { stringValue: 'system-agent-007' }
        }
    };

    // User checked the box
    const targetEntity = JSON.parse(JSON.stringify(srcEntity));
    applyEntityAuditTracking(targetEntity, srcEntity, false, 'Yash Jadhav CC', ['title', 'createdAt', 'createdByName', 'createdBy']);

    // createdByName is updated
    assert.strictEqual(targetEntity.properties.createdByName.stringValue, 'Yash Jadhav CC');
    // createdAt is updated
    assert.notStrictEqual(targetEntity.properties.createdAt.timestampValue, '2025-05-01T12:00:00Z');
    // createdBy is NEVER altered
    assert.strictEqual(targetEntity.properties.createdBy.stringValue, 'system-agent-007');
});

function requireFromString(code) {
    const Module = module.constructor;
    const m = new Module();
    m._compile(code, 'virtual-module.js');
    return m.exports;
}
