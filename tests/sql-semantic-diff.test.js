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
    isQueryKey,
    normalizeSqlQuery,
    formatSqlQuery,
    minifySqlQuery,
    isQuerySemanticallyEqual
} = compiled.exports;

test('isQueryKey detects standard query and SQL property names', () => {
    assert.equal(isQueryKey('queryString'), true);
    assert.equal(isQueryKey('query'), true);
    assert.equal(isQueryKey('sqlQuery'), true);
    assert.equal(isQueryKey('customSql'), true);
    assert.equal(isQueryKey('Query'), true);
    assert.equal(isQueryKey('SQL_QUERY'), true);
    assert.equal(isQueryKey('questionsVariableInfos'), false);
    assert.equal(isQueryKey('htmlString'), false);
    assert.equal(isQueryKey('isActive'), false);
});

test('normalizeSqlQuery strips comments, semicolons, and collapses whitespace', () => {
    const rawSql = `
        -- Fetch active records
        /* Multi-line
           comment block */
        SELECT 
            id, 
            name, 
            status 
        FROM \`project-src.dataset.table\` 
        WHERE status = 'ACTIVE' 
          AND age >= 18;
    `;
    const normalized = normalizeSqlQuery(rawSql, 'project-src', 'project-tgt');
    assert.equal(
        normalized,
        "SELECT id,name,status FROM `project-tgt.dataset.table` WHERE status='ACTIVE' AND age>=18"
    );
});

test('formatSqlQuery cleanly formats clauses, CTEs, and preserves variables', () => {
    const unformatted = "WITH user_cte AS (SELECT id, email FROM `proj.data.users` WHERE active = true) SELECT id, COUNT(1) FROM user_cte WHERE country = '{{country}}' AND date >= '2026-01-01' GROUP BY id ORDER BY id LIMIT 50;";
    const formatted = formatSqlQuery(unformatted);
    assert.ok(formatted.includes('WITH user_cte AS ('));
    assert.ok(formatted.includes('FROM `proj.data.users`'));
    assert.ok(formatted.includes("WHERE country = '{{country}}'"));
    assert.ok(formatted.includes('GROUP BY id'));
    assert.ok(formatted.includes('ORDER BY id'));
    assert.ok(formatted.includes('LIMIT 50;'));
});

test('minifySqlQuery strips comments and collapses whitespace into single line', () => {
    const multiLine = `
        -- Comments
        SELECT id,
               name
        FROM \`proj.data.table\`
        WHERE x = 1;
    `;
    const minified = minifySqlQuery(multiLine);
    assert.equal(minified, "SELECT id, name FROM `proj.data.table` WHERE x = 1;");
});

test('isQuerySemanticallyEqual identifies project-mapped queries as semantic matches', () => {
    const srcSql = "SELECT * FROM `source-proj-123.analytics.events` WHERE country = '{{country}}' AND date >= '{{start_date}}';";
    const tgtSql = `
        SELECT * 
        FROM \`target-proj-456.analytics.events\` 
        WHERE country = '{{country}}' 
          AND date >= '{{start_date}}'
    `;

    const result = isQuerySemanticallyEqual(srcSql, tgtSql, 'source-proj-123', 'target-proj-456');
    assert.deepEqual(result, { match: true, type: 'project_mapped' });
});

test('isQuerySemanticallyEqual flags queries with real column or logic differences as modified', () => {
    const srcSql = "SELECT id, name FROM `source-proj-123.dataset.users` WHERE active = true";
    const tgtSql = "SELECT id, email FROM `target-proj-456.dataset.users` WHERE active = true";

    const result = isQuerySemanticallyEqual(srcSql, tgtSql, 'source-proj-123', 'target-proj-456');
    assert.deepEqual(result, { match: false, type: 'modified' });
});

test('isQuerySemanticallyEqual flags queries with mismatched {{variable}} parameters as modified', () => {
    const srcSql = "SELECT * FROM `source-proj-123.dataset.table` WHERE category = '{{category}}'";
    const tgtSql = "SELECT * FROM `target-proj-456.dataset.table` WHERE category = '{{target_category}}'";

    const result = isQuerySemanticallyEqual(srcSql, tgtSql, 'source-proj-123', 'target-proj-456');
    assert.deepEqual(result, { match: false, type: 'modified' });
});

test('isQuerySemanticallyEqual returns identical for exact matches', () => {
    const query = "SELECT 1";
    assert.deepEqual(isQuerySemanticallyEqual(query, query, 'projA', 'projB'), {
        match: true,
        type: 'identical'
    });
});

test('entity with only project-mapped query differences is classified as mapped', () => {
    const srcEntity = {
        properties: {
            title: { stringValue: 'Dashboard' },
            queryString: { stringValue: 'SELECT * FROM `src-proj.db.tbl` WHERE id = 1;' }
        }
    };
    const tgtEntity = {
        properties: {
            title: { stringValue: 'Dashboard' },
            queryString: { stringValue: 'SELECT * FROM `tgt-proj.db.tbl` WHERE id = 1' }
        }
    };

    // Check individual property equality
    const qEq = isQuerySemanticallyEqual(
        srcEntity.properties.queryString.stringValue,
        tgtEntity.properties.queryString.stringValue,
        'src-proj',
        'tgt-proj'
    );
    assert.equal(qEq.type, 'project_mapped');
});
