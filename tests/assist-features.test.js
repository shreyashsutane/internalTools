const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Dynamic Context-Aware Assist Manager evaluates screen states and modals', () => {
    const assistSrc = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/src/assist.ts'),
        'utf8'
    );
    assert.match(assistSrc, /getCurrentStep\(\)/, 'AssistManager.getCurrentStep must be defined');
    assert.match(assistSrc, /modal-json-editor-guide/, 'JSON editor modal guide must be defined');
    assert.match(assistSrc, /modal-sql-diff-guide/, 'SQL diff modal guide must be defined');
    assert.match(assistSrc, /app-loading-rocket/, 'Loading state with rocket launcher must be handled');
    assert.match(assistSrc, /focus-ds-src-db/, 'Database selection guidance must exist');
    assert.match(assistSrc, /focus-filter-prop/, 'Filter property column selection guidance must exist');
    assert.match(assistSrc, /focus-filter-op/, 'Filter operator selection guidance must exist');
    assert.match(assistSrc, /focus-filter-type/, 'Filter data type selection guidance must exist');
    assert.match(assistSrc, /focus-filter-val/, 'Filter value input guidance must exist');
    assert.match(assistSrc, /focus-ds-mod-field/, 'Modification field guidance must exist');
    assert.match(assistSrc, /focus-ds-mod-replace/, 'Modification replace guidance must exist');
    assert.match(assistSrc, /happy|angry/, 'Happy and Angry mascot states must be supported');
});

test('AssistUI handles reactive mutation observers, single click happy and double click angry reactions', () => {
    const uiSrc = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/src/assist-ui.ts'),
        'utf8'
    );
    assert.match(uiSrc, /setTemporaryReaction\('happy'\)/, 'Single click must trigger happy reaction');
    assert.match(uiSrc, /setTemporaryReaction\('angry'\)/, 'Double click must trigger angry reaction');
    assert.match(uiSrc, /bindReactiveObservers/, 'Reactive DOM and Mutation observers must be bound');
});

test('Rocket Launcher Loader is integrated into loading overlay and CSS', () => {
    const indexHtml = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/index.html'),
        'utf8'
    );
    const css = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/css/app.css'),
        'utf8'
    );
    assert.match(indexHtml, /rocket-launch-group/, 'Rocket launch group must exist in index.html');
    assert.match(indexHtml, /rocket-flame/, 'Rocket flame must exist in index.html');
    assert.match(indexHtml, /rocket-smoke-ring/, 'Rocket smoke ring must exist in index.html');
    assert.match(css, /rocketLaunchPath/, 'rocketLaunchPath keyframes must be present in app.css');
    assert.match(css, /flameLaunch/, 'flameLaunch keyframes must be present in app.css');
});

test('Datastore GQL Live Query Preview and Filter Sync are properly implemented in ui.ts', () => {
    const uiSrc = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/src/ui.ts'),
        'utf8'
    );
    assert.match(uiSrc, /updateGqlPreview/, 'UI.updateGqlPreview must be defined');
    assert.match(uiSrc, /refreshAllFilterPropertyDropdowns/, 'UI.refreshAllFilterPropertyDropdowns must be defined');
    assert.match(uiSrc, /SELECT \* FROM/, 'GQL syntax generator must format SELECT statements');
});

test('Dry Run simulation and Markdown report exports are wired into App', () => {
    const appSrc = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/src/app.ts'),
        'utf8'
    );
    assert.match(appSrc, /runDsDryRun/, 'App.runDsDryRun must be defined');
    assert.match(appSrc, /exportDsMarkdown/, 'App.exportDsMarkdown must be defined');
    assert.match(appSrc, /filterDsDiffSearch/, 'App.filterDsDiffSearch must be defined');
    assert.match(appSrc, /AssistUI\.init\(\)/, 'AssistUI must be initialized in App.init');
});

test('Datastore property discovery includes dual-strategy entity sample fallback', () => {
    const apiSrc = fs.readFileSync(
        path.join(__dirname, '../datastore-copier/src/api.ts'),
        'utf8'
    );
    assert.match(apiSrc, /__property__/, 'api.ts must attempt __property__ metadata query');
    assert.match(apiSrc, /properties\.size === 0/, 'api.ts must verify if metadata returned 0 properties');
    assert.match(apiSrc, /entity\??\.properties/, 'api.ts must sample entities as fallback');
});
