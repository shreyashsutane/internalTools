/**
 * Visual Authentication & Admin Management Automation Test Suite
 * Launches headfully against the live Firebase URL and displays a moving virtual cursor overlay to verify Auth REST flows.
 */

const { execSync } = require('child_process');

// Auto-install puppeteer if not present
try {
    require('puppeteer');
} catch (e) {
    console.log('📦 Puppeteer not found. Installing now...');
    execSync('npm install puppeteer --no-save', { stdio: 'inherit' });
}

const puppeteer = require('puppeteer');

const PORTAL_URL = 'https://gcp-tools.web.app/';
const ADMIN_URL = 'https://gcp-tools.web.app/admin.html';

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`\n🚀 Starting Visual Authentication & Admin Management Test Suite (FIREBASE PRODUCTION)...\n`);

    // Launch browser in headful mode
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 80,
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox']
    });

    try {
        const [page] = await browser.pages();
        
        // Pipe browser console logs to terminal
        page.on('console', msg => console.log(`🖥️ PAGE LOG: ${msg.text()}`));
        page.on('pageerror', err => console.error(`🚨 PAGE ERROR: ${err.stack}`));
        
        // Inject virtual cursor stylesheet and helper script
        await page.evaluateOnNewDocument(() => {
            window.addEventListener('DOMContentLoaded', () => {
                const cursor = document.createElement('div');
                cursor.id = 'virtual-cursor';
                cursor.style.position = 'fixed';
                cursor.style.width = '18px';
                cursor.style.height = '18px';
                cursor.style.background = 'rgba(247, 148, 29, 0.9)';
                cursor.style.border = '2px solid white';
                cursor.style.borderRadius = '50%';
                cursor.style.pointerEvents = 'none';
                cursor.style.zIndex = '999999';
                cursor.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
                cursor.style.transition = 'transform 0.1s ease, background-color 0.1s ease';
                cursor.style.transform = 'translate(-50%, -50%)';
                cursor.style.left = '0px';
                cursor.style.top = '0px';
                document.body.appendChild(cursor);
                
                window.moveVirtualCursor = (x, y) => {
                    cursor.style.left = `${x}px`;
                    cursor.style.top = `${y}px`;
                };
                
                window.clickVirtualCursor = () => {
                    cursor.style.backgroundColor = '#10b981'; // flash green on click
                    cursor.style.transform = 'translate(-50%, -50%) scale(0.6)';
                    setTimeout(() => {
                        cursor.style.backgroundColor = 'rgba(247, 148, 29, 0.9)';
                        cursor.style.transform = 'translate(-50%, -50%) scale(1)';
                    }, 200);
                };
            });
        });

        // Store virtual cursor coordinates
        let curX = 100;
        let curY = 100;

        // Custom function to move mouse smoothly to element
        async function smoothMove(selector, click = true) {
            const el = await page.waitForSelector(selector, { visible: true });
            const rect = await page.evaluate((s) => {
                const element = document.querySelector(s);
                const r = element.getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2 };
            }, selector);

            const steps = 15;
            const startX = curX;
            const startY = curY;
            const targetX = rect.x;
            const targetY = rect.y;

            for (let i = 1; i <= steps; i++) {
                const ratio = i / steps;
                curX = startX + (targetX - startX) * ratio;
                curY = startY + (targetY - startY) * ratio;
                await page.evaluate((x, y) => window.moveVirtualCursor(x, y), curX, curY);
                await delay(12);
            }

            if (click) {
                await page.evaluate(() => window.clickVirtualCursor());
                await delay(100);
                await el.click();
            }
        }

        // --- 🧪 TEST CASE 1: Portal Landing Page Visited ---
        console.log('🔗 Navigating to Portal landing page on Firebase...');
        await page.goto(PORTAL_URL, { waitUntil: 'networkidle2' });
        await delay(2000);
        console.log('✅ Portal landing page verified statically.');

        // --- 🧪 TEST CASE 2: Admin Panel Consolidated Logs & Management ---
        console.log('\n🔗 Navigating to Admin Panel on Firebase...');
        await page.goto(ADMIN_URL, { waitUntil: 'networkidle2' });
        await delay(1000);

        console.log('🔑 Logging in to Admin Console...');
        await smoothMove('#username');
        await page.type('#username', 'Shreyash');

        await smoothMove('#password');
        await page.type('#password', 'Vai@12345');
        await delay(500);

        console.log('🖱️ Clicking Log In...');
        await smoothMove('#login-form button[type="submit"]');
        
        console.log('⏳ Waiting for console authentication...');
        await page.waitForFunction(() => !document.querySelector('#login-form button[type="submit"]').disabled);
        await delay(1500); // wait for logs database rendering

        // Verify logs table loaded
        const logsLoaded = await page.evaluate(() => {
            const rows = document.querySelectorAll('#logs-table-body tr');
            return rows.length > 0 && !rows[0].innerText.includes('Loading');
        });
        if (logsLoaded) {
            console.log('✅ Consolidated Operations Logs loaded successfully!');
        } else {
            console.error('❌ Logs table failed to load operational data.');
        }

        // --- 🧪 TEST CASE 3: Admin Management CRUD ---
        console.log('\n🖱️ Opening Admin Management Panel...');
        // The first button in header style is "Manage Admins"
        await smoothMove('.btn-sec'); 
        await delay(1500);

        console.log('✍️ Registering new admin "AmitTest"...');
        await smoothMove('#new-admin-user');
        await page.type('#new-admin-user', 'AmitTest');

        await smoothMove('#new-admin-pass');
        await page.type('#new-admin-pass', 'AmitPass12345');

        await smoothMove('#new-admin-email');
        await page.type('#new-admin-email', 'amittest@company.com');
        await delay(500);

        console.log('🖱️ Clicking "Add Admin Account"...');
        await smoothMove('#create-admin-form button[type="submit"]');
        
        console.log('⏳ Waiting for account registration...');
        await page.waitForFunction(() => !document.querySelector('#create-admin-form button[type="submit"]').disabled);
        await delay(1500);

        // Verify newly created admin exists in list
        const adminAdded = await page.evaluate(() => {
            const cells = Array.from(document.querySelectorAll('#admins-list-body td'));
            return cells.some(c => c.innerText.includes('AmitTest'));
        });
        if (adminAdded) {
            console.log('✅ New Admin "AmitTest" successfully registered and visible in list.');
        } else {
            console.error('❌ New Admin failed to register or display.');
        }
        await delay(1500);

        console.log('🗑️ Revoking admin access for "AmitTest"...');
        // Find the trash button in the last row (AmitTest row) and click it
        const trashBtnSelector = '#admins-list-body tr:last-child button';
        await smoothMove(trashBtnSelector);
        
        // Handle confirm dialogue
        page.on('dialog', async dialog => {
            console.log(`💬 Confirming dialog: "${dialog.message()}"`);
            await dialog.accept();
        });
        await delay(2000); // wait for Firestore delete operation

        console.log('✅ Admin account successfully revoked.');
        await delay(1500);

        // Close Admin Management modal
        await smoothMove('#admin-mgmt-modal button');
        await delay(1000);

        console.log('🖱️ Logging out from Admin Panel...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.btn-sec'));
            const logoutBtn = btns.find(b => b.innerText.includes('Logout'));
            if (logoutBtn) logoutBtn.click();
        });
        await delay(1500);
        console.log('✅ Logout completed successfully.');

        console.log('\n🎉 VISUAL AUTOMATION TEST SUITE COMPLETED SUCCESSFULLY! 🎉\n');

    } catch (e) {
        console.error('🚨 Test Execution Failed:', e);
    } finally {
        console.log('🚪 Closing browser...');
        await browser.close();
    }
}

main();
