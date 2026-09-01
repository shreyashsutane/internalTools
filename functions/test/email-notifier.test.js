'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_RECIPIENT,
    escapeHtml,
    formatEmailSubject,
    formatEmailHtml,
    sendMutationAlertEmail,
    extractEntityList,
    extractRulesList,
    parseEntitiesFromDetails,
    parseRulesFromDetails
} = require('../lib/email-notifier');

test('escapeHtml sanitizes HTML entities and handles nulls safely', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(escapeHtml("Tom & Jerry's 'Cat'"), 'Tom &amp; Jerry&#039;s &#039;Cat&#039;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

test('formatEmailSubject handles success, failure and custom statuses', () => {
    assert.equal(
        formatEmailSubject({
            operation: 'DATASTORE_COPY',
            status: 'SUCCESS',
            user: 'operator@example.com'
        }),
        '[GCP Portal] Datastore Copy: operator@example.com'
    );

    assert.equal(
        formatEmailSubject({
            operation: 'AUTHENTICATION',
            status: 'SUCCESS',
            user: 'operator@example.com'
        }),
        '[GCP Portal] User Login: operator@example.com'
    );

    assert.equal(
        formatEmailSubject({
            operation: 'DATASTORE_ANALYZE',
            status: 'SUCCESS',
            user: 'operator@example.com'
        }),
        '[GCP Portal] Datastore Analysis: operator@example.com'
    );

    assert.equal(
        formatEmailSubject({
            operation: 'DATASTORE_COPY',
            status: 'FAILED',
            user: 'operator@example.com'
        }),
        '[GCP Portal ALERT] Datastore Copy FAILED: operator@example.com'
    );

    assert.equal(
        formatEmailSubject({
            operation: 'DATASTORE_REVERT',
            status: 'PARTIAL',
            user: 'operator@example.com'
        }),
        '[GCP Portal] Datastore Revert (PARTIAL): operator@example.com'
    );
});

test('formatEmailHtml renders routing pipeline, itemized entities and rules', () => {
    const html = formatEmailHtml({
        id: 'log-test-12345',
        operation: 'DATASTORE_COPY',
        status: 'SUCCESS',
        user: 'shreyashs14102002@gmail.com',
        srcProject: 'prod-source-project (db: default)',
        tgtProject: 'backup-target-project',
        details: 'Batch 1/1 copied 2 entities.',
        timestamp: '2026-09-01T04:20:00.000Z',
        entitySummary: [
            { kind: 'UserProfile', id: '5629499534213120', name: 'John Doe', action: 'CREATED' },
            { kind: 'Orders', id: 'ord-991', name: 'Express Shipping', action: 'UPDATED' }
        ],
        rulesSummary: [
            { property: 'targetProjectId', target: 'prod-source', replacement: 'backup-target' }
        ]
    });

    assert.match(html, /DATASTORE COPY Notification/);
    assert.match(html, /shreyashs14102002@gmail\.com/);
    assert.match(html, /prod-source-project \(db: default\)/);
    assert.match(html, /backup-target-project/);
    assert.match(html, /UserProfile/);
    assert.match(html, /5629499534213120/);
    assert.match(html, /John Doe/);
    assert.match(html, /CREATED \(New\)/);
    assert.match(html, /Orders/);
    assert.match(html, /Express Shipping/);
    assert.match(html, /UPDATED \(Replaced\)/);
    assert.match(html, /targetProjectId/);
    assert.match(html, /prod-source/);
    assert.match(html, /backup-target/);
    assert.match(html, /log-test-12345/);
});

test('parseEntitiesFromDetails parses live screenshot details text into proper table items', () => {
    const rawDetails = `Datastore batch 1/1 copied 2 entities across kinds: UserMaster, Users.
Source: project-c0e231c7-2177-4eb0-979 (database: (default))
Target: second-project-16364 (database: (default))
Status: 2 entities written successfully (0 failed).
Find & Replace: Applied 1 rule(s):
  - Rule 1 [field '*']: "project-c0e231c7-2177-4eb0-979" -> "second-project-16364"

Itemized Records (2):
• UserMaster, Users/UserMaster:4623657972269056 (Salesplayer_48) [UPDATED]
• UserMaster, Users/Users:user_008 (Users:user_008) [UPDATED]`;

    const entities = parseEntitiesFromDetails(rawDetails);
    assert.equal(entities.length, 2);
    assert.equal(entities[0].kind, 'UserMaster');
    assert.equal(entities[0].id, '4623657972269056');
    assert.equal(entities[0].name, 'Salesplayer_48');
    assert.equal(entities[0].action, 'UPDATED');

    assert.equal(entities[1].kind, 'Users');
    assert.equal(entities[1].id, 'user_008');
    assert.equal(entities[1].name, 'Users:user_008');
    assert.equal(entities[1].action, 'UPDATED');

    const rules = parseRulesFromDetails(rawDetails);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].property, '*');
    assert.equal(rules[0].target, 'project-c0e231c7-2177-4eb0-979');
    assert.equal(rules[0].replacement, 'second-project-16364');

    // Verify formatEmailHtml converts this text into an HTML table
    const html = formatEmailHtml({
        id: 'log-8iDqEJlNEGSnF07j0BDY',
        operation: 'DATASTORE_COPY',
        status: 'SUCCESS',
        user: 'shreyashs14102002@gmail.com',
        srcProject: 'project-c0e231c7-2177-4eb0-979',
        tgtProject: 'second-project-16364',
        details: rawDetails
    });

    assert.match(html, /Itemized Entities Table/);
    assert.match(html, /4623657972269056/);
    assert.match(html, /Salesplayer_48/);
    assert.match(html, /Find &amp; Replace Substitution Rules/);
    assert.match(html, /project-c0e231c7-2177-4eb0-979/);
    assert.match(html, /second-project-16364/);
});

test('extractEntityList parses uncompressed prevState backupData and displayNames', () => {
    const list = extractEntityList({
        prevState: {
            kind: 'Config',
            backupData: [
                { keyStr: 'Config/1001', action: 'CREATE' },
                { keyStr: 'Config/1002', action: 'UPDATE' }
            ],
            entityDisplayNames: {
                'Config/1001': { fieldName: 'name', value: 'Production Setup' },
                'Config/1002': 'Staging Setup'
            }
        }
    });

    assert.equal(list.length, 2);
    assert.equal(list[0].kind, 'Config');
    assert.equal(list[0].id, '1001');
    assert.equal(list[0].name, 'Production Setup');
    assert.equal(list[0].action, 'CREATED');

    assert.equal(list[1].kind, 'Config');
    assert.equal(list[1].id, '1002');
    assert.equal(list[1].name, 'Staging Setup');
    assert.equal(list[1].action, 'UPDATED');
});

test('sendMutationAlertEmail gracefully skips if app password is not configured', async () => {
    const prevPass = process.env.ALERT_GMAIL_APP_PASSWORD;
    delete process.env.ALERT_GMAIL_APP_PASSWORD;

    try {
        const result = await sendMutationAlertEmail({
            operation: 'DATASTORE_COPY',
            status: 'SUCCESS',
            user: 'test@example.com'
        });

        assert.equal(result.sent, false);
        assert.match(result.reason, /ALERT_GMAIL_APP_PASSWORD is not configured/);
    } finally {
        if (prevPass) process.env.ALERT_GMAIL_APP_PASSWORD = prevPass;
    }
});

test('sendMutationAlertEmail dispatches email via mock transporter successfully', async () => {
    let capturedMail = null;
    const mockTransporter = {
        sendMail: async mailOptions => {
            capturedMail = mailOptions;
            return { messageId: '<mock-msg-id-123@gmail.com>' };
        }
    };

    const result = await sendMutationAlertEmail({
        id: 'log-abc-999',
        operation: 'DATASTORE_COPY',
        status: 'SUCCESS',
        user: 'operator@company.com',
        srcProject: 'src-proj',
        tgtProject: 'tgt-proj',
        details: 'Copied 10 entities.'
    }, {
        to: DEFAULT_RECIPIENT,
        transporter: mockTransporter
    });

    assert.equal(result.sent, true);
    assert.equal(result.messageId, '<mock-msg-id-123@gmail.com>');
    assert.equal(capturedMail.to, 'shreyashs14102002@gmail.com');
    assert.match(capturedMail.subject, /Datastore Copy: operator@company\.com/);
});

test('sendMutationAlertEmail handles transporter failure without throwing', async () => {
    const failingTransporter = {
        sendMail: async () => {
            throw new Error('SMTP connection timeout');
        }
    };

    const result = await sendMutationAlertEmail({
        operation: 'DATASTORE_COPY',
        status: 'SUCCESS',
        user: 'test@example.com'
    }, {
        transporter: failingTransporter
    });

    assert.equal(result.sent, false);
    assert.equal(result.reason, 'SMTP connection timeout');
});
