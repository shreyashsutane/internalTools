const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('DistaEntities / Template Copying sub-tab and subview exist in index.html', () => {
    const htmlPath = path.join(__dirname, '../datastore-copier/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Sub-tab button
    assert.ok(html.includes('id="tab-ds-sub-dista"'), 'Must contain tab-ds-sub-dista');
    assert.ok(html.includes('DistaEntities / Template Copying'), 'Must contain button label');

    // Subview
    assert.ok(html.includes('id="ds-subview-dista"'), 'Must contain ds-subview-dista container');

    // 2 Workflow selection cards
    assert.ok(html.includes('id="card-dista-wf-taskmaster"'), 'Must contain TaskMaster card');
    assert.ok(html.includes('id="card-dista-wf-entities"'), 'Must contain DistaEntities card');

    // Project and database selectors
    assert.ok(html.includes('id="ds-dista-src"'), 'Must contain ds-dista-src');
    assert.ok(html.includes('id="ds-dista-tgt"'), 'Must contain ds-dista-tgt');
    assert.ok(html.includes('id="ds-dista-src-db"'), 'Must contain ds-dista-src-db');
    assert.ok(html.includes('id="ds-dista-tgt-db"'), 'Must contain ds-dista-tgt-db');

    // ID inputs
    assert.ok(html.includes('id="ds-dista-tm-id"'), 'Must contain ds-dista-tm-id for templateId');
    assert.ok(html.includes('id="ds-dista-ent-id"'), 'Must contain ds-dista-ent-id for distaEntitiesId');
    assert.ok(html.includes('id="ds-dista-tmpl-id"'), 'Must contain ds-dista-tmpl-id for dynamic select box templateId');

    // Buttons
    assert.ok(html.includes('id="btn-dista-dry-run"'), 'Must contain Dry Run button');
    assert.ok(html.includes('id="btn-dista-analyze"'), 'Must contain Analyze button');
    assert.ok(html.includes('id="btn-dista-start-copy"'), 'Must contain Start Copy button');
});

test('app.ts implements complete Dista relational workflow', () => {
    const appTsPath = path.join(__dirname, '../datastore-copier/src/app.ts');
    const code = fs.readFileSync(appTsPath, 'utf8');

    // Methods
    assert.ok(code.includes('updateDistaLiveFilters:'), 'Must implement updateDistaLiveFilters');
    assert.ok(code.includes('analyzeDistaRelational:'), 'Must implement analyzeDistaRelational');
    assert.ok(code.includes('startDistaRelationalCopy:'), 'Must implement startDistaRelationalCopy');
    assert.ok(code.includes('executeDistaRelationalCopy:'), 'Must implement executeDistaRelationalCopy');

    // Tab wiring
    assert.ok(code.includes("Utils.$('tab-ds-sub-dista')"), 'Must wire tab-ds-sub-dista');

    // Kinds verification for Workflow 1
    assert.ok(code.includes("'TaskMasterTemplate'"), 'Must query TaskMasterTemplate');
    assert.ok(code.includes("'TaskMasterEntitySections'"), 'Must query TaskMasterEntitySections');
    assert.ok(code.includes("'TaskMasterEntityFields'"), 'Must query TaskMasterEntityFields');

    // Kinds verification for Workflow 2
    assert.ok(code.includes("'DistaEntities'"), 'Must query DistaEntities');
    assert.ok(code.includes("'DistaEntityFields'"), 'Must query DistaEntityFields');
    assert.ok(code.includes("'DistaEntitySections'"), 'Must query DistaEntitySections');
    assert.ok(code.includes("'DistaEntityTemplate'"), 'Must query DistaEntityTemplate');
    assert.ok(code.includes("'DistaEntityDynamicSelectBox'"), 'Must query DistaEntityDynamicSelectBox');

    // Property filters
    assert.ok(code.includes("prop: 'templateId'"), 'Must filter sections/fields by templateId');
    assert.ok(code.includes("prop: 'distaEntitiesId'"), 'Must filter entity items by distaEntitiesId');
});

test('ui.ts implements Dista confirmation modal and database dropdowns', () => {
    const uiTsPath = path.join(__dirname, '../datastore-copier/src/ui.ts');
    const code = fs.readFileSync(uiTsPath, 'utf8');

    assert.ok(code.includes('openDistaConfirmModal:'), 'Must implement openDistaConfirmModal');
    assert.ok(code.includes('ds-dista-src-db'), 'Must setup ds-dista-src-db dropdown');
    assert.ok(code.includes('ds-dista-tgt-db'), 'Must setup ds-dista-tgt-db dropdown');
    assert.ok(code.includes('ds-dista-rules-container'), 'Must support ds-dista-rules-container in renderDsRules');
});
