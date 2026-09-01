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
 * Extracts structured entity itemization list from log payload or prevState.
 */
const extractEntityList = log => {
    if (Array.isArray(log?.entitySummary) && log.entitySummary.length > 0) {
        return log.entitySummary;
    }

    const prevState = log?.prevState;
    if (!prevState || typeof prevState !== 'object') return [];

    if (Array.isArray(prevState.entitySummary) && prevState.entitySummary.length > 0) {
        return prevState.entitySummary;
    }

    const backupData = Array.isArray(prevState.backupData) ? prevState.backupData : [];
    const displayNames = prevState.entityDisplayNames || {};
    const defaultKind = prevState.kind || 'Entity';

    if (backupData.length > 0) {
        return backupData.map(item => {
            const keyStr = String(item.keyStr || '');
            const parts = keyStr.split('/');
            const kind = parts.length > 1 ? parts[0] : defaultKind;
            const id = parts.length > 1 ? parts.slice(1).join('/') : keyStr;
            const rawDisp = displayNames[keyStr];
            const name = rawDisp ? (typeof rawDisp === 'object' ? (rawDisp.value || id) : rawDisp) : id;
            
            let action = 'UPDATED';
            if (item.action === 'CREATE' || item.action === 'CREATED') action = 'CREATED';
            else if (item.action === 'REVERT' || item.action === 'RESTORED') action = 'RESTORED';
            else if (item.action === 'delete') action = 'DELETED';
            else if (item.action === 'upsert') action = 'RESTORED';

            return { kind, id, key: keyStr, name, action };
        });
    }

    return [];
};

/**
 * Extracts Find & Replace rules from log payload or prevState.
 */
const extractRulesList = log => {
    if (Array.isArray(log?.rulesSummary) && log.rulesSummary.length > 0) {
        return log.rulesSummary;
    }
    const prevState = log?.prevState;
    if (Array.isArray(prevState?.rulesSummary) && prevState.rulesSummary.length > 0) {
        return prevState.rulesSummary;
    }
    return [];
};

/**
 * Formats a clean, readable timestamp in UTC and IST.
 */
const formatTimestampDisplay = rawTs => {
    try {
        const d = rawTs ? new Date(rawTs) : new Date();
        const utcStr = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
        const istStr = new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'medium'
        }).format(d) + ' IST';
        return `${utcStr} (${istStr})`;
    } catch {
        return String(rawTs || new Date().toISOString());
    }
};

/**
 * Builds an enterprise-grade, high-contrast responsive HTML email template.
 */
const formatEmailHtml = log => {
    const op = escapeHtml(String(log.operation || 'MUTATION').replace(/_/g, ' '));
    const status = escapeHtml(String(log.status || 'SUCCESS').toUpperCase());
    const user = escapeHtml(log.user || 'Unknown User');
    const srcProject = escapeHtml(log.srcProject || '—');
    const tgtProject = escapeHtml(log.tgtProject || '—');
    const details = escapeHtml(log.details || 'No additional details provided.');
    const logId = escapeHtml(log.id || 'N/A');
    const timestamp = escapeHtml(formatTimestampDisplay(log.timestamp));

    const isSuccess = status === 'SUCCESS';
    const isFailed = status === 'FAILED';
    const isRestored = status === 'RESTORED' || status === 'PARTIAL';

    const statusColor = isSuccess ? '#10b981' : (isFailed ? '#ef4444' : '#f59e0b');
    const statusBg = isSuccess ? 'rgba(16, 185, 129, 0.15)' : (isFailed ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)');

    const entities = extractEntityList(log);
    const rules = extractRulesList(log);

    // Entity table generation (first 25 entities with overflow badge if large)
    let entityTableHtml = '';
    if (entities.length > 0) {
        const displayLimit = 25;
        const visibleEntities = entities.slice(0, displayLimit);
        const overflowCount = entities.length - displayLimit;

        const rows = visibleEntities.map((e, idx) => {
            const isCreated = e.action === 'CREATED';
            const isRestoredItem = e.action === 'RESTORED';
            const isDeleted = e.action === 'DELETED';
            
            const badgeColor = isCreated ? '#10b981' : (isRestoredItem ? '#38bdf8' : (isDeleted ? '#f43f5e' : '#f59e0b'));
            const badgeBg = isCreated ? 'rgba(16, 185, 129, 0.12)' : (isRestoredItem ? 'rgba(56, 189, 248, 0.12)' : (isDeleted ? 'rgba(244, 63, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)'));
            const actionLabel = isCreated ? 'CREATED (New)' : (isRestoredItem ? 'RESTORED' : (isDeleted ? 'DELETED' : 'UPDATED (Replaced)'));
            const rowBg = idx % 2 === 0 ? '#0f172a' : '#131e33';

            return `
            <tr style="background-color: ${rowBg}; border-bottom: 1px solid #1e293b;">
                <td style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: #cbd5e1; font-family: monospace;">
                    ${escapeHtml(e.kind || 'Unknown')}
                </td>
                <td style="padding: 10px 12px; font-size: 12px; color: #94a3b8; font-family: monospace; word-break: break-all;">
                    ${escapeHtml(e.id || e.key || 'N/A')}
                </td>
                <td style="padding: 10px 12px; font-size: 12px; color: #f8fafc; font-weight: 500;">
                    ${escapeHtml(e.name ? `"${e.name}"` : '—')}
                </td>
                <td style="padding: 10px 12px; text-align: right;">
                    <span style="display: inline-block; padding: 3px 8px; font-size: 10px; font-weight: 700; color: ${badgeColor}; background: ${badgeBg}; border: 1px solid ${badgeColor}; border-radius: 4px; text-transform: uppercase;">
                        ${actionLabel}
                    </span>
                </td>
            </tr>`;
        }).join('');

        const overflowNotice = overflowCount > 0 ? `
        <tr>
            <td colspan="4" style="padding: 12px; text-align: center; background-color: #0b101d; font-size: 11px; color: #38bdf8; font-family: monospace; border-top: 1px solid #1e293b;">
                ➕ ... and ${overflowCount} more entities (view complete itemized record in Audit Log)
            </td>
        </tr>` : '';

        entityTableHtml = `
        <div style="margin-top: 24px; margin-bottom: 24px;">
            <div style="font-size: 12px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                📋 Itemization: Exact Entities Processed (${entities.length} Total)
            </div>
            <div style="border: 1px solid #1e293b; border-radius: 8px; overflow: hidden;">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="background-color: #0b1120; border-bottom: 1px solid #334155;">
                            <th style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; font-family: monospace;">Kind</th>
                            <th style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; font-family: monospace;">Entity Key / ID</th>
                            <th style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; font-family: monospace;">Display Name</th>
                            <th style="padding: 10px 12px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; font-family: monospace; text-align: right;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                        ${overflowNotice}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // Rules summary generation
    let rulesTableHtml = '';
    if (rules.length > 0) {
        const ruleItems = rules.map((r, i) => `
            <li style="margin-bottom: 6px; font-size: 12px; color: #e2e8f0; font-family: monospace;">
                <strong>Rule ${i + 1}</strong> [Property: <code style="color: #38bdf8;">${escapeHtml(r.property || r.field || '*')}</code>]: 
                <span style="color: #f43f5e;">"${escapeHtml(r.target || r.find || '')}"</span> ➔ <span style="color: #10b981;">"${escapeHtml(r.replacement || r.replace || '')}"</span>
            </li>
        `).join('');

        rulesTableHtml = `
        <div style="background-color: #0d1527; border: 1px solid #1e3a5f; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px;">
            <div style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                🔄 Find &amp; Replace Transformations Applied (${rules.length})
            </div>
            <ul style="margin: 0; padding-left: 18px;">
                ${ruleItems}
            </ul>
        </div>`;
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${op} Notification</title>
</head>
<body style="margin: 0; padding: 0; background-color: #060911; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9; -webkit-font-smoothing: antialiased;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #060911; padding: 24px 12px;">
        <tr>
            <td align="center">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 640px; background-color: #0b0f19; border-radius: 14px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);">
                    
                    <!-- Header Banner -->
                    <tr>
                        <td style="padding: 24px 28px; background: linear-gradient(135deg, #0b1120 0%, #17153a 100%); border-bottom: 1px solid #1e293b;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td>
                                        <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #00d4ff; text-transform: uppercase; margin-bottom: 4px;">
                                            ☁️ GCP TOOLS PORTAL • OPERATIONAL TELEMETRY
                                        </div>
                                        <div style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
                                            ${op} Notification
                                        </div>
                                    </td>
                                    <td align="right" valign="middle">
                                        <span style="display: inline-block; padding: 6px 14px; font-size: 11px; font-weight: 800; color: ${statusColor}; background: ${statusBg}; border: 1px solid ${statusColor}; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em;">
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

                            <!-- Project Routing Pipeline Banner -->
                            <div style="background-color: #090d16; border: 1px solid #1e293b; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px;">
                                <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px;">
                                    📍 Project Routing Pipeline
                                </div>
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td width="46%" valign="top" style="background-color: #0c192c; border: 1px solid #0284c7; border-radius: 8px; padding: 12px 14px;">
                                            <div style="font-size: 10px; color: #38bdf8; text-transform: uppercase; font-weight: 700;">📤 Source Project</div>
                                            <div style="font-size: 13px; font-weight: 700; color: #ffffff; font-family: monospace; margin-top: 2px; word-break: break-all;">
                                                ${srcProject}
                                            </div>
                                        </td>
                                        <td width="8%" align="center" style="color: #64748b; font-size: 16px; font-weight: bold;">
                                            ➔
                                        </td>
                                        <td width="46%" valign="top" style="background-color: #0c221a; border: 1px solid #059669; border-radius: 8px; padding: 12px 14px;">
                                            <div style="font-size: 10px; color: #34d399; text-transform: uppercase; font-weight: 700;">📥 Destination Project</div>
                                            <div style="font-size: 13px; font-weight: 700; color: #ffffff; font-family: monospace; margin-top: 2px; word-break: break-all;">
                                                ${tgtProject}
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Executive Summary Grid -->
                            <div style="background-color: #0f172a; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; border: 1px solid #1e293b;">
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td width="50%" valign="top" style="padding-bottom: 12px;">
                                            <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">👤 Verified Operator</div>
                                            <div style="font-size: 13px; font-weight: 700; color: #38bdf8; font-family: monospace; margin-top: 2px;">
                                                ${user}
                                            </div>
                                        </td>
                                        <td width="50%" valign="top" style="padding-bottom: 12px;">
                                            <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">🕒 Execution Timestamp</div>
                                            <div style="font-size: 12px; color: #e2e8f0; font-family: monospace; margin-top: 2px;">
                                                ${timestamp}
                                            </div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td colspan="2" style="border-top: 1px solid #1e293b; padding-top: 12px;">
                                            <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">📊 Volume &amp; Status</div>
                                            <div style="font-size: 12px; color: #f8fafc; font-weight: 600; margin-top: 2px;">
                                                ${entities.length > 0 ? `${entities.length} Entities Processed` : op} • Status: <span style="color: ${statusColor}; font-weight: 700;">${status}</span>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Itemized Entities Table -->
                            ${entityTableHtml}

                            <!-- Find & Replace Rules Section -->
                            ${rulesTableHtml}

                            <!-- Comprehensive Execution Summary & Detailed Breakdown -->
                            <div style="margin-bottom: 24px;">
                                <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
                                    📝 Comprehensive Execution Description &amp; Breakdown
                                </div>
                                <div style="background-color: #060911; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 16px; font-size: 12px; line-height: 1.6; color: #cbd5e1; font-family: monospace; white-space: pre-wrap; word-break: break-all;">${details}</div>
                            </div>

                            <!-- Safety & Disaster Recovery Card -->
                            <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 18px 20px; text-align: center;">
                                <div style="font-size: 12px; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">
                                    🛡️ 1-Click Rollback &amp; Audit Trail Available
                                </div>
                                <div style="font-size: 11px; color: #94a3b8; margin-bottom: 14px; font-family: monospace;">
                                    Audit Record ID: <strong style="color: #38bdf8;">${logId}</strong>
                                </div>
                                <div>
                                    <a href="${PORTAL_URL}/datastore-copier/index.html" target="_blank" style="display: inline-block; background-color: #00d4ff; color: #020617; padding: 10px 22px; font-size: 12px; font-weight: 700; text-decoration: none; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.03em;">
                                        🚀 Open Portal &amp; Inspect Audit Trail
                                    </a>
                                </div>
                            </div>

                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 16px 28px; background-color: #060911; border-top: 1px solid #1e293b; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; font-family: monospace;">
                                🔒 Verified via Google Cloud OAuth2 OpenID Connect • Tamper-Proof Telemetry
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;
};

/**
 * Dispatches the mutation alert email using Nodemailer and Gmail SMTP with App Password.
 */
const sendMutationAlertEmail = async (log, options = {}) => {
    const recipient = options.to || process.env.ALERT_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT;
    const sender = options.from || process.env.ALERT_SENDER_EMAIL || DEFAULT_SENDER;

    let transporter = options.transporter;
    if (!transporter) {
        let appPassword = process.env.ALERT_GMAIL_APP_PASSWORD;
        if (!appPassword || typeof appPassword !== 'string' || !appPassword.trim()) {
            return { sent: false, reason: 'ALERT_GMAIL_APP_PASSWORD is not configured' };
        }
        appPassword = appPassword.replace(/\s+/g, '');

        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: sender,
                pass: appPassword
            }
        });
    }

    const mailOptions = {
        from: `"GCP Tools Portal" <${sender}>`,
        to: recipient,
        subject: formatEmailSubject(log),
        html: formatEmailHtml(log)
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { sent: true, messageId: info.messageId };
    } catch (err) {
        return { sent: false, reason: err?.message || 'SMTP delivery failure' };
    }
};

module.exports = {
    escapeHtml,
    formatEmailSubject,
    formatEmailHtml,
    sendMutationAlertEmail,
    extractEntityList,
    extractRulesList,
    formatTimestampDisplay,
    DEFAULT_RECIPIENT,
    DEFAULT_SENDER
};
