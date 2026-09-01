'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_RECIPIENT,
    escapeHtml,
    formatEmailSubject,
    formatEmailHtml,
    sendMutationAlertEmail
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

test('formatEmailHtml renders key metadata, routing and summary details', () => {
    const html = formatEmailHtml({
        id: 'log-test-12345',
        operation: 'DATASTORE_COPY',
        status: 'SUCCESS',
        user: 'shreyashs14102002@gmail.com',
        srcProject: 'prod-source-project (db: default)',
        tgtProject: 'backup-target-project',
        details: 'Batch 1/1 copied 42 entities across kinds: UserProfile, Orders (0 failed).',
        timestamp: '2026-09-01T04:20:00.000Z'
    });

    assert.match(html, /DATASTORE COPY Notification/);
    assert.match(html, /shreyashs14102002@gmail\.com/);
    assert.match(html, /prod-source-project \(db: default\)/);
    assert.match(html, /backup-target-project/);
    assert.match(html, /Batch 1\/1 copied 42 entities/);
    assert.match(html, /log-test-12345/);
    assert.match(html, /SUCCESS/);
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
    assert.match(capturedMail.html, /Copied 10 entities\./);
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
