const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const entry = path.join(__dirname, '..', 'superadmin', 'src', 'sql-formatter.ts');
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
    classifyBigQuerySql,
    extractVariables,
    resolveSqlVariables,
    formatEmailToDisplayName,
    formatBigQuerySql
} = compiled.exports;

const compileTs = relativePath => {
    const moduleEntry = path.join(__dirname, '..', relativePath);
    const moduleBuild = buildSync({
        entryPoints: [moduleEntry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
        write: false
    });
    const loaded = new Module(moduleEntry, module);
    loaded.filename = moduleEntry;
    loaded.paths = module.paths;
    loaded._compile(moduleBuild.outputFiles[0].text, moduleEntry);
    return loaded.exports;
};

test('extractVariables parses single and multiple variables without duplicates', () => {
    const query = `
        SELECT * FROM \`project.dataset.table\`
        WHERE user_id = '{{user_id}}'
          AND created_at >= '{{ start_date }}'
          AND updated_by = '{{user_id}}'
          AND region = '{{region_code}}'
    `;
    const vars = extractVariables(query);
    assert.deepEqual(vars, ['user_id', 'start_date', 'region_code']);
});

test('extractVariables returns empty array when query has no variables', () => {
    assert.deepEqual(extractVariables('SELECT 1'), []);
    assert.deepEqual(extractVariables(''), []);
});

test('resolveSqlVariables replaces all matching {{variables}} with user input', () => {
    const query = `SELECT * FROM \`prod.users\` WHERE id = '{{user_id}}' AND env = '{{env}}'`;
    const values = {
        user_id: 'usr_12345',
        env: 'production'
    };
    const resolved = resolveSqlVariables(query, values);
    assert.equal(resolved, `SELECT * FROM \`prod.users\` WHERE id = 'usr_12345' AND env = 'production'`);
});

test('resolveSqlVariables replaces missing variables with empty string safely', () => {
    const query = `SELECT * FROM \`prod.orders\` WHERE code = '{{code}}'`;
    const resolved = resolveSqlVariables(query, {});
    assert.equal(resolved, `SELECT * FROM \`prod.orders\` WHERE code = ''`);
});

test('formatEmailToDisplayName parses Gmail and enterprise email addresses to clean Title Case names', () => {
    assert.equal(formatEmailToDisplayName('shreyash.sutane@gmail.com'), 'Shreyash Sutane');
    assert.equal(formatEmailToDisplayName('john_doe@company.org'), 'John Doe');
    assert.equal(formatEmailToDisplayName('alice-smith+test@domain.com'), 'Alice Smith Test');
    assert.equal(formatEmailToDisplayName('admin@gcp.com'), 'Admin');
    assert.equal(formatEmailToDisplayName(''), '');
});

test('formatBigQuerySql capitalizes keywords and indents while preserving {{variables}} and strings', () => {
    const rawSql = `
select id, name, status from \`project.dataset.users\`
where status = 'active' and created_at >= '{{start_date}}'
order by id desc
`;
    const formatted = formatBigQuerySql(rawSql);
    assert.match(formatted, /SELECT id, name, status FROM `project.dataset.users`/);
    assert.match(formatted, /WHERE status = 'active' AND created_at >= '{{start_date}}'/);
    assert.match(formatted, /ORDER BY id DESC/);
    assert.ok(formatted.includes('{{start_date}}'), 'Variables must be preserved verbatim');
});

test('BigQuery SQL safety requires explicit confirmation for mutations but ignores literals and comments', () => {
    assert.deepEqual(classifyBigQuerySql('SELECT 1'), {
        requiresDestructiveConfirmation: false,
        keyword: null
    });
    assert.equal(
        classifyBigQuerySql("SELECT 'DELETE FROM table' AS example -- UPDATE ignored\n").requiresDestructiveConfirmation,
        false
    );
    assert.deepEqual(classifyBigQuerySql('WITH ids AS (SELECT 1) DELETE FROM `p.d.t` WHERE id IN (SELECT * FROM ids)'), {
        requiresDestructiveConfirmation: true,
        keyword: 'DELETE'
    });
    assert.equal(classifyBigQuerySql('CREATE OR REPLACE TABLE `p.d.t` AS SELECT 1').keyword, 'CREATE');
});

test('CSV export cells neutralize spreadsheet formulas while preserving ordinary values', () => {
    const { escapeCsvCell } = compileTs('superadmin/src/utils.ts');
    assert.equal(escapeCsvCell('=IMPORTXML("https://example.test")'), '"\'=IMPORTXML(""https://example.test"")"');
    assert.equal(escapeCsvCell('  +1+1'), '"\'  +1+1"');
    assert.equal(escapeCsvCell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
    assert.equal(escapeCsvCell('ordinary'), '"ordinary"');
});

test('BigQuery page failures reject the full query instead of returning truncated success', async () => {
    const { Api } = compileTs('superadmin/src/api.ts');
    const previousFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls === 1) {
            return new Response(JSON.stringify({
                jobReference: { jobId: 'job-1', location: 'US' },
                jobComplete: true,
                totalRows: '2',
                rows: [{ f: [{ v: 'first' }] }],
                schema: { fields: [{ name: 'value', type: 'STRING' }] }
            }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: 'page unavailable' } }), { status: 503 });
    };
    try {
        await assert.rejects(Api.executeBigQuery('project', 'SELECT 1'), /page unavailable/);
    } finally {
        global.fetch = previousFetch;
    }
});

test('SuperAdmin audit creation rejects non-success responses', async () => {
    const { Api } = compileTs('superadmin/src/api.ts');
    const previousFetch = global.fetch;
    global.fetch = async () => new Response(
        JSON.stringify({ error: { message: 'audit unavailable' } }),
        { status: 503 }
    );
    try {
        await assert.rejects(Api.recordAudit('UPDATE_QUESTION', 'change'), /audit unavailable/);
    } finally {
        global.fetch = previousFetch;
    }
});

test('SuperAdmin mutation creates its audit record before saving Datastore', () => {
    const fs = require('node:fs');
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'superadmin', 'src', 'app.ts'), 'utf8');
    const handlerStart = appSource.indexOf('handleSaveToDatastore: async');
    const auditCreate = appSource.indexOf('auditId = await Api.recordAudit', handlerStart);
    const save = appSource.indexOf('await Api.saveQuestionEntity', handlerStart);
    assert.ok(handlerStart >= 0 && auditCreate > handlerStart && auditCreate < save);
});

test('destructive BigQuery creates an audit record before executing', () => {
    const fs = require('node:fs');
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'superadmin', 'src', 'app.ts'), 'utf8');
    const handlerStart = appSource.indexOf('executeLiveQuery: async');
    const auditCreate = appSource.indexOf("queryAuditId = await Api.recordAudit", handlerStart);
    const execute = appSource.indexOf('const results = await Api.executeBigQuery', handlerStart);
    assert.ok(handlerStart >= 0 && auditCreate > handlerStart && auditCreate < execute);
});
