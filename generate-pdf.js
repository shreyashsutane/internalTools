/**
 * Dista Tools - Visual PDF Documentation Generator
 * Compiles a beautiful HTML document with SVG flowcharts and exports it to PDF via Puppeteer.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Auto-install puppeteer if not present
try {
    require('puppeteer');
} catch (e) {
    console.log('📦 Puppeteer not found. Installing now...');
    execSync('npm install puppeteer --no-save', { stdio: 'inherit' });
}

const puppeteer = require('puppeteer');

const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GCP Infrastructure Manager - System Documentation</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #f7941d;
            --primary-dark: #e85d04;
            --bg: #070a0f;
            --card-bg: rgba(13, 20, 30, 0.65);
            --border: rgba(247, 148, 29, 0.2);
            --text: #f3f4f6;
            --text-muted: #9ca3af;
            --code-bg: #0d141e;
            --success: #10b981;
            --danger: #ef4444;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.6;
            font-size: 14px;
        }

        /* PDF Page Layout styling */
        .page {
            width: 210mm;
            min-height: 297mm;
            padding: 20mm 20mm;
            position: relative;
            background-color: var(--bg);
            background-image: 
                radial-gradient(at 0% 0%, rgba(247, 148, 29, 0.06) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(247, 148, 29, 0.04) 0px, transparent 50%);
            page-break-after: always;
            border-bottom: 1px dashed var(--border);
        }

        /* Cover Page styling */
        .cover-page {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            min-height: 297mm;
            padding: 30mm 20mm;
            border-bottom: 1px dashed var(--border);
            page-break-after: always;
            position: relative;
        }

        .cover-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 4rem 2rem;
            width: 100%;
            max-width: 650px;
            box-shadow: 0 30px 60px rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(10px);
        }

        .cover-logo {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            text-shadow: 0 0 30px rgba(247, 148, 29, 0.3);
        }

        .cover-title {
            font-size: 2.8rem;
            font-weight: 800;
            letter-spacing: -1px;
            color: #ffffff;
            line-height: 1.2;
            margin-bottom: 1rem;
        }

        .cover-title span {
            color: var(--primary);
        }

        .cover-subtitle {
            font-size: 1.2rem;
            color: var(--text-muted);
            margin-bottom: 3rem;
            font-weight: 400;
        }

        .cover-metadata {
            border-top: 1px solid var(--border);
            padding-top: 2rem;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            text-align: left;
            font-size: 13px;
        }

        .meta-item strong {
            display: block;
            color: var(--primary);
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 1px;
            margin-bottom: 4px;
        }

        /* Section Headings */
        h1.sec-title {
            font-size: 2rem;
            font-weight: 800;
            color: #ffffff;
            margin-bottom: 1.5rem;
            border-left: 5px solid var(--primary);
            padding-left: 12px;
            letter-spacing: -0.5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        h2.subsec-title {
            font-size: 1.3rem;
            font-weight: 700;
            color: #ffffff;
            margin-top: 2rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        p {
            margin-bottom: 1.25rem;
            color: #d1d5db;
        }

        /* Code formatting styling */
        pre {
            background-color: var(--code-bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 1.25rem;
            margin-bottom: 1.5rem;
            overflow-x: auto;
        }

        code {
            font-family: 'Roboto Mono', monospace;
            font-size: 12px;
            color: #38bdf8;
        }

        .token-keyword { color: #f43f5e; font-weight: 600; }
        .token-string { color: #10b981; }
        .token-comment { color: #6b7280; font-style: italic; }
        .token-function { color: #fbbf24; }

        /* Tables styling */
        .doc-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 1.5rem;
            font-size: 13px;
        }

        .doc-table th {
            background-color: rgba(7, 10, 15, 0.6);
            border-bottom: 2px solid var(--primary);
            padding: 10px 14px;
            font-weight: 600;
            color: var(--primary);
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.5px;
        }

        .doc-table td {
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            color: #e5e7eb;
        }

        .doc-table tr:hover td {
            background-color: rgba(247, 148, 29, 0.02);
        }

        /* Flowchart Container */
        .chart-container {
            display: flex;
            justify-content: center;
            margin: 2rem 0;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1.5rem;
        }

        /* Header / Footer prints styling */
        .header-print {
            display: flex;
            justify-content: space-between;
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
            margin-bottom: 2rem;
            font-size: 11px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .footer-print {
            position: absolute;
            bottom: 20mm;
            left: 20mm;
            right: 20mm;
            display: flex;
            justify-content: space-between;
            border-top: 1px solid var(--border);
            padding-top: 8px;
            font-size: 11px;
            color: var(--text-muted);
        }

        /* Alerts */
        .alert-box {
            background-color: rgba(247, 148, 29, 0.05);
            border: 1px solid var(--primary);
            border-left: 4px solid var(--primary);
            border-radius: 6px;
            padding: 1rem 1.25rem;
            margin-bottom: 1.5rem;
        }
        .alert-box strong {
            display: block;
            color: #ffffff;
            margin-bottom: 4px;
        }
        .alert-box p {
            margin-bottom: 0;
            font-size: 13px;
        }
    </style>
</head>
<body>

    <!-- 📄 COVER PAGE -->
    <div class="cover-page">
        <div class="cover-card">
            <div class="cover-logo">🛠️</div>
            <h1 class="cover-title">GCP <span>Infrastructure Manager</span></h1>
            <p class="cover-subtitle">Technical System Documentation & Code Walkthrough</p>
            
            <div class="cover-metadata">
                <div class="meta-item">
                    <strong>Project Name</strong>
                    Dista Internal Tools Portal
                </div>
                <div class="meta-item">
                    <strong>Version</strong>
                    v2.2 (Firebase Production Deployed)
                </div>
                <div class="meta-item">
                    <strong>Owner</strong>
                    Shreyash Ulhas Sutane
                </div>
                <div class="meta-item">
                    <strong>Deployment URL</strong>
                    https://dista-tools.web.app/
                </div>
            </div>
        </div>
    </div>

    <!-- 📄 PAGE 1: OVERVIEW & FLOWCHART -->
    <div class="page">
        <div class="header-print">
            <span>GCP Infrastructure Manager - Documentation</span>
            <span>Section 1</span>
        </div>

        <h1 class="sec-title">1. System Architecture Overview</h1>
        <p>
            The <strong>GCP Infrastructure Manager</strong> is a modern utility tool built inside the Dista Internal Tools ecosystem. It facilitates comparing, copying, and auditing resources across multiple Google Cloud Platform (GCP) projects, with focus on BigQuery table schemas, Cloud Datastore entities, and Scheduled Queries.
        </p>

        <h2 class="subsec-title">1.1 Core System Architecture Diagram</h2>
        <p>
            The diagram below illustrates how client interactions are authenticated via Firebase Auth REST API, verified against database permission tables in Cloud Firestore, and how GCP operations are executed safely using GCP OAuth tokens:
        </p>

        <!-- Dynamic SVG Flowchart -->
        <div class="chart-container">
            <svg width="100%" height="420" viewBox="0 0 600 420" fill="none" xmlns="http://www.w3.org/2000/svg">
                <!-- Grid Lines -->
                <line x1="300" y1="40" x2="300" y2="380" stroke="#f7941d" stroke-dasharray="4 4" stroke-opacity="0.3"/>
                
                <!-- Box 1: Client Landing -->
                <rect x="50" y="20" width="200" height="60" rx="8" fill="#0d141e" stroke="#f7941d" stroke-width="2"/>
                <text x="150" y="55" fill="#ffffff" font-family="Outfit" font-size="13" font-weight="600" text-anchor="middle">Landing / Console (index.html)</text>

                <!-- Box 2: Admin Panel -->
                <rect x="350" y="20" width="200" height="60" rx="8" fill="#0d141e" stroke="#f7941d" stroke-width="2"/>
                <text x="450" y="55" fill="#ffffff" font-family="Outfit" font-size="13" font-weight="600" text-anchor="middle">Admin Workspace (admin.html)</text>

                <!-- Arrow 1 to 3: Login process -->
                <path d="M 450 80 L 450 140" stroke="#10b981" stroke-width="2" marker-end="url(#arrow)"/>
                <text x="460" y="115" fill="#9ca3af" font-family="Outfit" font-size="11">Firebase Auth API</text>

                <!-- Box 3: Firebase Authentication -->
                <rect x="350" y="140" width="200" height="60" rx="8" fill="#0d141e" stroke="#10b981" stroke-width="1.5"/>
                <text x="450" y="175" fill="#ffffff" font-family="Outfit" font-size="13" font-weight="600" text-anchor="middle">Firebase Auth (REST API)</text>

                <!-- Arrow 3 to 4: Fetch verification document -->
                <path d="M 450 200 L 450 260" stroke="#10b981" stroke-width="2" marker-end="url(#arrow)"/>
                <text x="460" y="235" fill="#9ca3af" font-family="Outfit" font-size="11">JWT Token Bearer</text>

                <!-- Box 4: Cloud Firestore Database -->
                <rect x="350" y="260" width="200" height="60" rx="8" fill="#0d141e" stroke="#10b981" stroke-width="1.5"/>
                <text x="450" y="295" fill="#ffffff" font-family="Outfit" font-size="13" font-weight="600" text-anchor="middle">Firestore (/admins collection)</text>

                <!-- Box 5: GCP Resource Manager (Datastore-Copier) -->
                <rect x="50" y="180" width="200" height="80" rx="8" fill="#0d141e" stroke="#f7941d" stroke-width="2"/>
                <text x="150" y="215" fill="#ffffff" font-family="Outfit" font-size="13" font-weight="600" text-anchor="middle">GCP Infra Manager</text>
                <text x="150" y="235" fill="#9ca3af" font-family="Outfit" font-size="11" text-anchor="middle">(datastore-copier/script.js)</text>

                <!-- Link 1 to 5: Open tool -->
                <path d="M 150 80 L 150 180" stroke="#f7941d" stroke-width="1.5" marker-end="url(#arrow)"/>

                <!-- Box 6: GCP APIs -->
                <rect x="50" y="340" width="200" height="60" rx="8" fill="#0d141e" stroke="#fbbf24" stroke-width="1.5"/>
                <text x="150" y="375" fill="#ffffff" font-family="Outfit" font-size="13" font-weight="600" text-anchor="middle">GCP BQ / Datastore REST APIs</text>

                <!-- Arrow 5 to 6: Copy Operations -->
                <path d="M 150 260 L 150 340" stroke="#fbbf24" stroke-width="2" marker-end="url(#arrow)"/>
                <text x="160" y="305" fill="#9ca3af" font-family="Outfit" font-size="11">GCP Access Token</text>

                <!-- Horizontal Link: Logs writing -->
                <path d="M 250 220 L 350 290" stroke="#f7941d" stroke-width="1.5" stroke-dasharray="4 4" marker-end="url(#arrow)"/>
                <text x="310" y="245" fill="#9ca3af" font-family="Outfit" font-size="10" text-anchor="middle">Write Logs</text>

                <!-- SVG Marker Definitions -->
                <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f7941d"/>
                    </marker>
                </defs>
            </svg>
        </div>

        <div class="footer-print">
            <span>© 2026 Dista — Internal Use Only</span>
            <span>Page 2</span>
        </div>
    </div>

    <!-- 📄 PAGE 2: SECURE AUTH WALKTHROUGH -->
    <div class="page">
        <div class="header-print">
            <span>GCP Infrastructure Manager - Documentation</span>
            <span>Section 2</span>
        </div>

        <h1 class="sec-title">2. Secure Admin Authentication (Firebase Auth REST)</h1>
        <p>
            The portal uses the **Firebase Authentication REST API** to authenticate users without the need for loading heavy JavaScript SDK frameworks. This guarantees page load times stay under 100ms.
        </p>

        <h2 class="subsec-title">2.1 Username Mapping Strategy</h2>
        <p>
            To keep login credentials user-friendly (e.g. Username: <code>Shreyash</code>), the frontend maps input usernames to emails:
        </p>
        <pre><code><span class="token-comment">// Mapping code used in both index.html and admin.html</span>
<span class="token-keyword">let</span> email = user;
<span class="token-keyword">if</span> (!email.<span class="token-function">includes</span>(<span class="token-string">'@'</span>)) {
    <span class="token-keyword">if</span> (user.<span class="token-function">toLowerCase</span>() === <span class="token-string">'shreyash'</span>) {
        email = <span class="token-string">'shreyashs14102002@gmail.com'</span>; <span class="token-comment">// Maps Shreyash to deployment email</span>
    } <span class="token-keyword">else</span> {
        email = <span class="token-string">&#96;&#36;{user.toLowerCase()}@dista.ai&#96;</span>;
    }
}</code></pre>

        <h2 class="subsec-title">2.2 Firebase REST Authentication Flow</h2>
        <p>
            When the login form is submitted, the code invokes the Google Identity API endpoint. If authentication is successful, the JWT ID Token is captured and validated against the Cloud Firestore <code>/admins</code> collection:
        </p>
        <pre><code><span class="token-comment">// 1. Sign in via REST</span>
<span class="token-keyword">const</span> authRes = <span class="token-keyword">await</span> <span class="token-function">fetch</span>(<span class="token-string">&#96;https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=&#36;{API_KEY}&#96;</span>, {
    method: <span class="token-string">'POST'</span>,
    headers: { <span class="token-string">'Content-Type'</span>: <span class="token-string">'application/json'</span> },
    body: JSON.<span class="token-function">stringify</span>({ email, password: pass, returnSecureToken: <span class="token-keyword">true</span> })
});
<span class="token-keyword">if</span> (!authRes.ok) <span class="token-keyword">throw new</span> <span class="token-function">Error</span>(<span class="token-string">'Incorrect username or password.'</span>);
<span class="token-keyword">const</span> authData = <span class="token-keyword">await</span> authRes.<span class="token-function">json</span>();

<span class="token-comment">// 2. Verify admin document exists in Firestore (Authorized via JWT)</span>
<span class="token-keyword">const</span> firestoreRes = <span class="token-keyword">await</span> <span class="token-function">fetch</span>(<span class="token-string">&#96;https://firestore.googleapis.com/v1/projects/dista-tools/databases/(default)/documents/admins/&#36;{authData.localId}&#96;</span>, {
    headers: { <span class="token-string">'Authorization'</span>: <span class="token-string">&#96;Bearer &#36;{authData.idToken}&#96;</span> }
});
<span class="token-keyword">if</span> (!firestoreRes.ok) <span class="token-keyword">throw new</span> <span class="token-function">Error</span>(<span class="token-string">'Access denied. Not registered as an admin.'</span>);
</code></pre>

        <div class="alert-box">
            <strong>🔒 Dual-Layer Security Verification</strong>
            <p>
                Even if a malicious actor manually creates a user profile using the public Firebase Auth sign-up endpoint, they will be blocked from accessing consolidated logs. The security rules in Firestore block read operations unless the user's UID already exists inside the locked-down <code>/admins</code> collection.
            </p>
        </div>

        <div class="footer-print">
            <span>© 2026 Dista — Internal Use Only</span>
            <span>Page 3</span>
        </div>
    </div>

    <!-- 📄 PAGE 3: FIRESTORE LOGS & RULES -->
    <div class="page">
        <div class="header-print">
            <span>GCP Infrastructure Manager - Documentation</span>
            <span>Section 3</span>
        </div>

        <h1 class="sec-title">3. Cloud Firestore Audit Logs & Rules</h1>
        <p>
            All critical sync, compare, and copy operations performed within the GCP Infrastructure Manager are logged to the <code>/audit_logs</code> Firestore collection for auditing.
        </p>

        <h2 class="subsec-title">3.1 Firestore Security Configuration (firestore.rules)</h2>
        <p>
            To prevent unauthenticated write spamming or data leaks, the security rules are configured to block write access while ensuring only verified administrators can view the audit records:
        </p>
        <pre><code>rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /admins/{uid} {
      allow read, write: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }
    match /audit_logs/{document} {
      allow read: if request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
      allow write: if false;
    }
  }
}</code></pre>

        <h2 class="subsec-title">3.2 Reading & Displaying Logs</h2>
        <p>
            When fetching consolidated logs on the Admin Console, the client sends a POST request with the user's JWT <code>idToken</code> to Firestore REST API:
        </p>
        <pre><code><span class="token-keyword">const</span> res = <span class="token-keyword">await</span> <span class="token-function">fetch</span>(<span class="token-string">'https://firestore.googleapis.com/v1/projects/dista-tools/databases/(default)/documents:runQuery'</span>, {
    method: <span class="token-string">'POST'</span>,
    headers: {
        <span class="token-string">'Content-Type'</span>: <span class="token-string">'application/json'</span>,
        <span class="token-string">'Authorization'</span>: <span class="token-string">&#96;Bearer &#36;{State.token}&#96;</span>
    },
    body: JSON.<span class="token-function">stringify</span>({
        structuredQuery: {
            from: [{ collectionId: <span class="token-string">"audit_logs"</span> }]
        }
    })
});</code></pre>

        <div class="footer-print">
            <span>© 2026 Dista — Internal Use Only</span>
            <span>Page 4</span>
        </div>
    </div>

    <!-- 📄 PAGE 4: ADMIN MANAGEMENT & REVERT FLOWS -->
    <div class="page">
        <div class="header-print">
            <span>GCP Infrastructure Manager - Documentation</span>
            <span>Section 4</span>
        </div>

        <h1 class="sec-title">4. Dynamic Admin Management & Reversion Logic</h1>
        <p>
            The Admin Console gives the default administrator (<code>Shreyash</code>) the capacity to dynamically manage other accounts by executing user registrations and permission changes.
        </p>

        <h2 class="subsec-title">4.1 Registering a New Admin</h2>
        <p>
            Admins register a new account by executing a two-step sequence:
        </p>
        <ol style="margin-left: 1.5rem; margin-bottom: 1.5rem; color: #d1d5db;">
            <li style="margin-bottom: 0.5rem;">
                <strong>Firebase Auth Registration:</strong> Creates the login credentials in Firebase Authentication (returning a new User ID <code>localId</code>).
            </li>
            <li style="margin-bottom: 0.5rem;">
                <strong>Document Patch:</strong> Creates a corresponding registration document at <code>admins/{new_uid}</code> in Firestore containing the username and email, authorized using the logged-in admin's current token.
            </li>
        </ol>

        <h2 class="subsec-title">4.2 Admin Management API Payloads</h2>
        <pre><code><span class="token-comment">// Step 1: Register credentials</span>
<span class="token-keyword">const</span> signupRes = <span class="token-keyword">await</span> <span class="token-function">fetch</span>(<span class="token-string">'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=...'</span>, {
    method: <span class="token-string">'POST'</span>,
    body: JSON.<span class="token-function">stringify</span>({ email, password, returnSecureToken: <span class="token-keyword">false</span> })
});
<span class="token-keyword">const</span> signupData = <span class="token-keyword">await</span> signupRes.<span class="token-function">json</span>();
<span class="token-keyword">const</span> newUid = signupData.localId;

<span class="token-comment">// Step 2: Write Firestore document permission</span>
<span class="token-keyword">await</span> <span class="token-function">fetch</span>(<span class="token-string">&#96;https://firestore.googleapis.com/v1/projects/dista-tools/databases/(default)/documents/admins/&#36;{newUid}?updateMask.fieldPaths=username&#96;</span>, {
    method: <span class="token-string">'PATCH'</span>,
    headers: { <span class="token-string">'Authorization'</span>: <span class="token-string">&#96;Bearer &#36;{State.token}&#96;</span> },
    body: JSON.<span class="token-function">stringify</span>({ fields: { username: { stringValue: username }, email: { stringValue: email } } })
});</code></pre>

        <h2 class="subsec-title">4.3 Revoking Admin Permissions</h2>
        <p>
            When an admin is removed, we send a HTTP DELETE request to target <code>admins/{uid}</code>. Since Firestore Security Rules require the user's UID to exist in this collection, removing the document revokes all read access immediately:
        </p>
        <pre><code><span class="token-keyword">const</span> res = <span class="token-keyword">await</span> <span class="token-function">fetch</span>(<span class="token-string">&#96;https://firestore.googleapis.com/v1/projects/dista-tools/databases/(default)/documents/admins/&#36;{uid}&#96;</span>, {
    method: <span class="token-string">'DELETE'</span>,
    headers: { <span class="token-string">'Authorization'</span>: <span class="token-string">&#96;Bearer &#36;{State.token}&#96;</span> }
});</code></pre>

        <div class="footer-print">
            <span>© 2026 Dista — Internal Use Only</span>
            <span>Page 5</span>
        </div>
    </div>
</body>
</html>
`;

async function main() {
    const tempHtmlPath = path.join(__dirname, 'docs', 'temp_pdf_source.html');
    const pdfOutputPath = path.join(__dirname, 'docs', 'GCP_Infra_Manager_Documentation.pdf');
    const artifactFolder = '/Users/shreyashsutane/.gemini/antigravity/brain/67419ec2-e355-469a-a150-1132bfb3aac3';
    const artifactPdfPath = path.join(artifactFolder, 'gcp_infra_manager_documentation.pdf');

    console.log('📝 Writing temporary HTML document source...');
    fs.writeFileSync(tempHtmlPath, HTML_CONTENT);

    console.log('🌐 Launching headless Puppeteer...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        console.log('🔗 Navigating to source document...');
        await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle0' });

        console.log('🖨️ Exporting beautiful visual PDF layout...');
        await page.pdf({
            path: pdfOutputPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0px',
                bottom: '0px',
                left: '0px',
                right: '0px'
            }
        });

        console.log(`✅ Visual PDF successfully exported to: ${pdfOutputPath}`);

        // Copy to artifact folder if it exists
        if (fs.existsSync(artifactFolder)) {
            console.log('📦 Copying PDF document to Antigravity artifact directory...');
            fs.copyFileSync(pdfOutputPath, artifactPdfPath);
            console.log(`✅ Deployed to artifact folder at: ${artifactPdfPath}`);
        }

    } catch (e) {
        console.error('🚨 Failed to compile visual PDF:', e);
    } finally {
        console.log('🧹 Cleaning up temporary HTML source files...');
        if (fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
        }
        await browser.close();
    }
}

main();
