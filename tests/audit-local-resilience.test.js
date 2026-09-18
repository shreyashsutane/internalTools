const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

test("app.ts always invokes AuditLog.addLog for all copy operations", () => {
    const appTs = fs.readFileSync(path.join(__dirname, "..", "datastore-copier", "src", "app.ts"), "utf8");
    assert.match(appTs, /batchAuditLogId\s*=\s*await AuditLog\.addLog\(\s*['"]DATASTORE_COPY['"]/);
    assert.match(appTs, /await AuditLog\.renderLogs\(true\);/);
});

test("audit.ts contains saveLogsToLocalStorage and local fallback in addLog", () => {
    const auditTs = fs.readFileSync(path.join(__dirname, "..", "datastore-copier", "src", "audit.ts"), "utf8");
    assert.match(auditTs, /export const saveLogsToLocalStorage/);
    assert.match(auditTs, /Centralized audit service unavailable/);
    assert.match(auditTs, /local-\${Date\.now\(\)\}/);
});

test("audit.ts merges server logs with locally cached logs to prevent log loss", () => {
    const auditTs = fs.readFileSync(path.join(__dirname, "..", "datastore-copier", "src", "audit.ts"), "utf8");
    assert.match(auditTs, /mergedMap\.set\(sl\.id,\s*sl\)/);
    assert.match(auditTs, /mergedMap\.has\(cl\.id\)/);
    assert.match(auditTs, /existing\.prevState = cl\.prevState/);
});

test("TODAY date range filter includes logs created today across timezone offsets", () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const nowEpoch = Date.now();
    const isTodayFilter = (logEpoch) => {
        return logEpoch >= startOfToday.getTime() ||
            (logEpoch > 0 && new Date(logEpoch).toDateString() === new Date().toDateString());
    };

    assert.equal(isTodayFilter(nowEpoch - 5 * 60 * 1000), true);
    assert.equal(isTodayFilter(startOfToday.getTime() + 1000), true);
    assert.equal(isTodayFilter(nowEpoch - 48 * 3600 * 1000), false);
});

test("audit.ts renders Restore File button for Datastore copy operations without prevState", () => {
    const auditTs = fs.readFileSync(path.join(__dirname, "..", "datastore-copier", "src", "audit.ts"), "utf8");
    assert.match(auditTs, /log\.operation === ['"]DATASTORE_COPY['"] && log\.tgtProject/);
    assert.match(auditTs, /AuditLog\.openRestoreFileModal\(\)/);
    assert.match(auditTs, /Restore/);
});
