'use strict';

const nodemailer = require('nodemailer');

const DEFAULT_RECIPIENT = 'shreyashs14102002@gmail.com';
const DEFAULT_SENDER = 'shreyashs14102002@gmail.com';
const PORTAL_URL = 'https://gcp-tools-portal.web.app';

/**
 * Escapes HTML characters to prevent XSS/injection in email templates.
 */
const escapeHtml = str => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

/**
 * Generates an informative, standardized subject line for the email alert.
 */
const formatEmailSubject = log => {
    const opRaw = String(log.operation || 'MUTATION').toUpperCase();
    const status = String(log.status || 'SUCCESS').toUpperCase();
    const user = log.user || 'Unknown User';
    
    let opName = opRaw.replace(/_/g, ' ');
    if (opRaw === 'AUTHENTICATION') opName = 'User Login';
    else if (opRaw === 'DATASTORE_ANALYZE') opName = 'Datastore Analysis';
    else if (opRaw === 'DATASTORE_COPY') opName = 'Datastore Copy';
    else if (opRaw === 'DATASTORE_REVERT') opName = 'Datastore Revert';

    if (status === 'SUCCESS') {
        return `[GCP Portal] ${opName}: ${user}`;
    } else if (status === 'FAILED') {
        return `[GCP Portal ALERT] ${opName} FAILED: ${user}`;
    }
    return `[GCP Portal] ${opName} (${status}): ${user}`;
};

/**
 * Builds a clean, responsive HTML email template.
 */
const formatEmailHtml = log => {
    const op = escapeHtml(String(log.operation || 'MUTATION').replace(/_/g, ' '));
    const status = escapeHtml(String(log.status || 'SUCCESS').toUpperCase());
    const user = escapeHtml(log.user || 'Unknown User');
    const srcProject = escapeHtml(log.srcProject || '—');
    const tgtProject = escapeHtml(log.tgtProject || '—');
    const details = escapeHtml(log.details || 'No additional details provided.');
    const logId = escapeHtml(log.id || 'N/A');
    const timestamp = escapeHtml(log.timestamp || new Date().toISOString());

    const isSuccess = status === 'SUCCESS';
    const statusColor = isSuccess ? '#10b981' : (status === 'FAILED' ? '#ef4444' : '#f59e0b');
    const statusBg = isSuccess ? 'rgba(16, 185, 129, 0.15)' : (status === 'FAILED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${op} Notification</title>
</head>
<body style="margin: 0; padding: 0; background-color: #080c14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9; -webkit-font-smoothing: antialiased;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #080c14; padding: 24px 12px;">
        <tr>
            <td align="center">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #0f172a; border-radius: 12px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 24px 28px; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); border-bottom: 1px solid #334155;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td>
                                        <div style="font-size: 13px; font-weight: 700; letter-spacing: 0.05em; color: #00d4ff; text-transform: uppercase; margin-bottom: 4px;">
                                            ☁️ GCP Tools Portal Security Alert
                                        </div>
                                        <div style="font-size: 20px; font-weight: 700; color: #ffffff;">
                                            ${op} Notification
                                        </div>
                                    </td>
                                    <td align="right" valign="middle">
                                        <span style="display: inline-block; padding: 6px 12px; font-size: 12px; font-weight: 700; color: ${statusColor}; background: ${statusBg}; border: 1px solid ${statusColor}; border-radius: 20px; text-transform: uppercase;">
                                            ${status}
                                        </span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding: 28px;">
                            <!-- Operator Info Card -->
                            <div style="background-color: #1e293b; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; border: 1px solid #334155;">
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td style="padding-bottom: 10px;">
                                            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Verified Operator</div>
                                            <div style="font-size: 15px; font-weight: 600; color: #38bdf8; font-family: monospace;">${user}</div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>
                                            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Timestamp</div>
                                            <div style="font-size: 13px; color: #e2e8f0; font-family: monospace;">${timestamp}</div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Source & Target Routing -->
                            <div style="background-color: #1e293b; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; border: 1px solid #334155;">
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td width="48%" valign="top">
                                            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Source Project / DB</div>
                                            <div style="font-size: 13px; font-weight: 600; color: #f8fafc; font-family: monospace; word-break: break-all;">${srcProject}</div>
                                        </td>
                                        <td width="4%" align="center" style="color: #64748b; font-size: 14px;">➔</td>
                                        <td width="48%" valign="top">
                                            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Target Project / DB</div>
                                            <div style="font-size: 13px; font-weight: 600; color: #10b981; font-family: monospace; word-break: break-all;">${tgtProject}</div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Operation Details -->
                            <div style="margin-bottom: 24px;">
                                <div style="font-size: 12px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                                    Execution Summary &amp; Rules
                                </div>
                                <div style="background-color: #090d16; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 16px; font-size: 13px; line-height: 1.5; color: #e2e8f0; font-family: monospace; white-space: pre-wrap;">${details}</div>
                            </div>

                            <!-- Audit Reference ID -->
                            <div style="font-size: 11px; color: #64748b; margin-bottom: 24px;">
                                Audit Record Reference: <code style="color: #94a3b8; background: #1e293b; padding: 2px 6px; border-radius: 4px;">${logId}</code>
                            </div>

                            <!-- CTA Button -->
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td align="center">
                                        <a href="${PORTAL_URL}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 12px 24px; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);">
                                            Open GCP Tools Portal
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 16px 28px; background-color: #090d16; border-top: 1px solid #1e293b; font-size: 11px; color: #64748b; text-align: center;">
                            This is an automated operational audit alert from GCP Tools Portal.<br>
                            Identity verified via Google Cloud OAuth2 tokeninfo.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim();
};

/**
 * Creates Nodemailer transporter configured for Gmail SMTP.
 */
const createGmailTransporter = () => {
    const user = process.env.ALERT_GMAIL_USER || DEFAULT_SENDER;
    const pass = String(process.env.ALERT_GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();

    if (!pass) {
        return null;
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass
        }
    });
};

/**
 * Dispatches an email notification alert when a mutation occurs.
 * Does not throw error on email delivery failure to ensure audit persistence is never blocked.
 */
const sendMutationAlertEmail = async (log, options = {}) => {
    const recipient = options.to || process.env.ALERT_EMAIL_RECIPIENT || DEFAULT_RECIPIENT;
    const sender = process.env.ALERT_GMAIL_USER || DEFAULT_SENDER;

    const transporter = options.transporter || createGmailTransporter();
    if (!transporter) {
        return {
            sent: false,
            reason: 'ALERT_GMAIL_APP_PASSWORD is not configured. Email notification was skipped.'
        };
    }

    const subject = formatEmailSubject(log);
    const html = formatEmailHtml(log);

    try {
        const info = await transporter.sendMail({
            from: `"GCP Tools Portal" <${sender}>`,
            to: recipient,
            subject,
            html
        });
        return {
            sent: true,
            messageId: info?.messageId || 'sent'
        };
    } catch (err) {
        console.warn('Failed to dispatch mutation alert email:', err?.message || err);
        return {
            sent: false,
            reason: err?.message || 'Email delivery failed'
        };
    }
};

module.exports = {
    DEFAULT_RECIPIENT,
    DEFAULT_SENDER,
    escapeHtml,
    formatEmailSubject,
    formatEmailHtml,
    createGmailTransporter,
    sendMutationAlertEmail
};
