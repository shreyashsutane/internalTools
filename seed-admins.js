/**
 * Seeder script for default Admin account
 * Creates the first admin user in Firebase Auth and registers them in Firestore.
 */

const { execSync } = require('child_process');
const https = require('https');

let API_KEY = process.env.FIREBASE_API_KEY || 'YOUR_FIREBASE_API_KEY';
try {
    const fs = require('fs');
    if (fs.existsSync('./firebase-config.js')) {
        const content = fs.readFileSync('./firebase-config.js', 'utf8');
        const match = content.match(/apiKey:\s*["']([^"']+)["']/);
        if (match && match[1]) {
            API_KEY = match[1];
        }
    }
} catch (e) {
    // Ignore
}
const PROJECT_ID = 'gcp-tools-portal';
const DEFAULT_EMAIL = process.env.ADMIN_EMAIL || 'shreyashs14102002@gmail.com';
const DEFAULT_PASS = process.env.ADMIN_PASSWORD;
const DEFAULT_USER = process.env.ADMIN_USERNAME || 'Shreyash';

if (!DEFAULT_PASS) {
    console.error("❌ Error: Please set the ADMIN_PASSWORD environment variable to seed the admin user.");
    console.log("Example: ADMIN_PASSWORD=your_secure_password node seed-admins.js");
    process.exit(1);
}

// Helper to get active GCP access token (for Firestore owner access)
function getGcpAccessToken() {
    try {
        return execSync('gcloud auth print-access-token').toString().trim();
    } catch (e) {
        console.error('❌ Failed to get GCP access token from gcloud. Make sure you are logged in.', e.message);
        process.exit(1);
    }
}

// HTTPS request helper
function makeRequest(url, method, headers, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOpts = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers
        };
        const req = https.request(reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const responseText = data || '{}';
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(responseText));
                    } catch (e) {
                        resolve({ text: responseText });
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${responseText}`));
                }
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function run() {
    console.log(`🔑 Initializing seeding for default admin account: ${DEFAULT_EMAIL}`);

    let uid = '';

    // 1. Try to register the user in Firebase Auth
    try {
        console.log('- Registering user in Firebase Auth...');
        const signupRes = await makeRequest(
            `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
            'POST',
            { 'Content-Type': 'application/json' },
            {
                email: DEFAULT_EMAIL,
                password: DEFAULT_PASS,
                returnSecureToken: true
            }
        );
        uid = signupRes.localId;
        console.log(`✅ Successfully created default user. UID: ${uid}`);
    } catch (e) {
        if (e.message.includes('EMAIL_EXISTS')) {
            console.log('ℹ️ User email already exists in Firebase Auth. Fetching existing account info by signing in...');
            try {
                const loginRes = await makeRequest(
                    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
                    'POST',
                    { 'Content-Type': 'application/json' },
                    {
                        email: DEFAULT_EMAIL,
                        password: DEFAULT_PASS,
                        returnSecureToken: true
                    }
                );
                uid = loginRes.localId;
                console.log(`✅ Successfully signed in. UID: ${uid}`);
            } catch (loginErr) {
                console.error(`❌ Failed to sign in to existing account:`, loginErr.message);
                process.exit(1);
            }
        } else {
            console.error(`❌ Failed to create user in Firebase Auth:`, e.message);
            process.exit(1);
        }
    }

    // 2. Register user as Admin in Cloud Firestore
    const gcpToken = getGcpAccessToken();
    console.log('- Writing admin registration to Firestore collection...');

    try {
        // Document URL: /databases/(default)/documents/admins/{uid}
        const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/${uid}?updateMask.fieldPaths=username&updateMask.fieldPaths=email`;
        
        await makeRequest(
            docUrl,
            'PATCH', // PATCH with updateMask functions as an Upsert (creates or updates fields)
            {
                'Authorization': `Bearer ${gcpToken}`,
                'Content-Type': 'application/json'
            },
            {
                fields: {
                    username: { stringValue: DEFAULT_USER },
                    email: { stringValue: DEFAULT_EMAIL }
                }
            }
        );
        console.log(`🎉 Default Admin account "${DEFAULT_USER}" successfully registered in Firestore database!`);
    } catch (e) {
        console.error(`❌ Failed to write admin mapping to Firestore:`, e.message);
        process.exit(1);
    }
}

run();
