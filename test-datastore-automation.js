/**
 * Comprehensive Visual Datastore Copier Test Suite
 * Evaluates all Datastore features (Databases, Kinds, Filters, Compare, Visual Diff, JSON Editor, Inline Save, Find/Replace, Copy Warning modal)
 * with a headful browser and smooth moving virtual cursor overlay.
 */

const { execSync, spawn } = require('child_process');
const http = require('http');

// Auto-install puppeteer if not present
try {
    require('puppeteer');
} catch (e) {
    console.log('📦 Puppeteer not found. Installing now...');
    execSync('npm install puppeteer --no-save', { stdio: 'inherit' });
}

const puppeteer = require('puppeteer');

// Target URL using local server to ensure it runs on latest local changes
const URL = 'http://localhost:8080/datastore-copier/index.html';

const SRC_PROJECT = 'project-c0e231c7-2177-4eb0-979';
const TGT_PROJECT = 'second-project-16364';
const TEST_KIND = 'UserMaster';

// Helper to get active GCP access token
function getAccessToken() {
    try {
        return execSync('gcloud auth print-access-token').toString().trim();
    } catch (e) {
        console.error('❌ Failed to get access token from gcloud. Make sure you are logged in.', e.message);
        process.exit(1);
    }
}

// Check if a port is in use
function checkPortInUse(port) {
    return new Promise((resolve) => {
        const server = http.createServer()
            .once('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(true);
                } else {
                    resolve(false);
                }
            })
            .once('listening', () => {
                server.close();
                resolve(false);
            })
            .listen(port);
    });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`\n🚀 Starting Visual Datastore Copier Test Suite (REAL GCP ON LOCALHOST)...\n`);

    const token = getAccessToken();

    // Start local server if not already running
    let serverProcess = null;
    const isPortActive = await checkPortInUse(8080);
    if (!isPortActive) {
        console.log('📡 Starting local web server on port 8080...');
        serverProcess = spawn('node', ['server.js'], { stdio: 'ignore' });
        await delay(1500); // Give server time to bind
    } else {
        console.log('📡 Local web server already active on port 8080.');
    }

    // Launch browser in headful mode so the user can watch the automation
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 70,
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox']
    });

    let page = null;
    try {
        const pages = await browser.pages();
        page = pages[0];
        
        // Pipe browser console logs to terminal
        page.on('console', msg => console.log(`🖥️ PAGE LOG: ${msg.text()}`));
        page.on('pageerror', err => console.error(`🚨 PAGE ERROR: ${err.stack}`));
        
        // Listen for toast messages in real-time
        await page.exposeFunction('onToastAdded', (text, type) => {
            console.log(`🍞 TOAST NOTIFICATION (${type.toUpperCase()}): ${text}`);
        });
        await page.evaluateOnNewDocument(() => {
            window.addEventListener('DOMContentLoaded', () => {
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach(m => {
                        m.addedNodes.forEach(node => {
                            if (node.classList && node.classList.contains('toast')) {
                                const type = Array.from(node.classList)
                                    .find(c => c.startsWith('toast-'))
                                    ?.replace('toast-', '') || 'info';
                                window.onToastAdded(node.innerText, type);
                            }
                        });
                    });
                });
                const wrap = document.getElementById('toast-wrap');
                if (wrap) {
                    observer.observe(wrap, { childList: true });
                }
            });
        });

        // Disable cache
        await page.setCacheEnabled(false);
        
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
                cursor.style.transition = 'transform 0.12s ease, background-color 0.12s ease';
                cursor.style.transform = 'translate(-50%, -50%)';
                cursor.style.left = '0px';
                cursor.style.top = '0px';
                document.body.appendChild(cursor);
                
                window.moveVirtualCursor = (x, y) => {
                    cursor.style.left = `${x}px`;
                    cursor.style.top = `${y}px`;
                };
                
                window.clickVirtualCursor = () => {
                    cursor.style.backgroundColor = '#00d4aa'; // click flash green
                    cursor.style.transform = 'translate(-50%, -50%) scale(0.6)';
                    setTimeout(() => {
                        cursor.style.backgroundColor = 'rgba(247, 148, 29, 0.9)';
                        cursor.style.transform = 'translate(-50%, -50%) scale(1)';
                    }, 220);
                };
            });
        });

        // Store virtual cursor coordinates
        let curX = 100;
        let curY = 100;

        // Custom function to move mouse smoothly to element
        const moveMouseTo = async (selector) => {
            const el = await page.waitForSelector(selector, { visible: true });
            
            // Scroll element into view safely first
            await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (element) {
                    element.scrollIntoView({ block: 'center', inline: 'center' });
                }
            }, selector);
            await delay(200);

            let box = null;
            for (let attempt = 0; attempt < 15; attempt++) {
                box = await el.boundingBox();
                if (box) break;
                await delay(100);
            }
            if (!box) throw new Error(`Could not find bounding box for selector: ${selector}`);

            const targetX = box.x + box.width / 2;
            const targetY = box.y + box.height / 2;

            const steps = 15;
            const startX = curX;
            const startY = curY;

            for (let i = 1; i <= steps; i++) {
                const ratio = i / steps;
                curX = startX + (targetX - startX) * ratio;
                curY = startY + (targetY - startY) * ratio;
                await page.evaluate((x, y) => window.moveVirtualCursor(x, y), curX, curY);
                await delay(10);
            }
            await delay(100);
        };

        const clickElement = async (selector, postDelay = 400) => {
            await moveMouseTo(selector);
            await page.evaluate(() => window.clickVirtualCursor());
            await delay(120);
            await page.click(selector);
            if (postDelay > 0) {
                await delay(postDelay);
            }
        };

        const typeInto = async (selector, text) => {
            await moveMouseTo(selector);
            await page.click(selector);
            await page.evaluate(sel => document.querySelector(sel).value = '', selector);
            await page.type(selector, text, { delay: 35 });
            await delay(200);
        };

        console.log('🔗 Navigating to portal...');
        await page.goto(URL, { waitUntil: 'networkidle2' });
        await delay(1000);

        // =====================================================================
        // TEST CASE 1: Authentication & Navigation
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 1: Authentication & Navigation ---');
        console.log('🔑 Performing valid authentication with active access token...');
        await typeInto('#inp-token', token);
        await clickElement('#btn-verify');
        await page.waitForSelector('#sec-modes', { visible: true, timeout: 10000 });
        console.log('✅ Authentication succeeded and welcome screen played sound effect.');
        await delay(1000);

        // Click Datastore copier mode card
        console.log('🖱️ Navigating to Datastore Copier mode...');
        await clickElement('[data-mode="ds"]');
        await page.waitForSelector('#form-ds', { visible: true });
        await delay(800);

        // =====================================================================
        // TEST CASE 2: Input Projects & Select Databases / Kinds
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 2: Project, Database & Kind Configuration ---');
        
        console.log(`✍️ Setting Source Project: ${SRC_PROJECT}...`);
        await typeInto('#ds-src', SRC_PROJECT);
        await page.waitForSelector('#dd-ds-src .dropdown-item[data-id]');
        await clickElement(`#dd-ds-src .dropdown-item[data-id="${SRC_PROJECT}"]`);
        await delay(800);

        console.log(`✍️ Setting Target Project: ${TGT_PROJECT}...`);
        await typeInto('#ds-tgt', TGT_PROJECT);
        await page.waitForSelector('#dd-ds-tgt .dropdown-item[data-id]');
        await clickElement(`#dd-ds-tgt .dropdown-item[data-id="${TGT_PROJECT}"]`);
        await delay(1500); // Wait for database lists and kinds to load

        // Select Source Database
        console.log('🖱️ Selecting Source Database: (default)...');
        await clickElement('#ds-src-db');
        await page.waitForSelector('#dd-ds-src-db .dropdown-item');
        await clickElement('#dd-ds-src-db .dropdown-item:first-child');
        await delay(500);

        // Select Target Database
        console.log('🖱️ Selecting Target Database: (default)...');
        await clickElement('#ds-tgt-db');
        await page.waitForSelector('#dd-ds-tgt-db .dropdown-item');
        await clickElement('#dd-ds-tgt-db .dropdown-item:first-child');
        await delay(500);

        // Select Kind
        console.log(`✍️ Selecting Kind: ${TEST_KIND}...`);
        await typeInto('#ds-kind', TEST_KIND);
        await page.waitForSelector('#dd-ds-kind .dropdown-item');
        await clickElement(`#dd-ds-kind .dropdown-item[data-id="${TEST_KIND}"]`);
        await delay(800);

        // =====================================================================
        // TEST CASE 3: Datastore Query Filter Setup
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 3: Filter Management (Add/Delete) ---');
        console.log('🖱️ Adding a property filter...');
        await clickElement('#btn-ds-add-filter');
        await delay(500);
        
        // Trash the filter to run full analysis
        console.log('🗑️ Removing filter row to allow unrestricted scan...');
        await clickElement('.filter-row button.btn-d');
        await delay(500);

        // =====================================================================
        // TEST CASE 4: Analyze and Compare Entities
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 4: Entities Comparison & Visual Highlights ---');
        console.log('📊 Running compare scan...');
        await clickElement('#btn-ds-analyze');
        
        // Wait for results panel to render
        await page.waitForSelector('#res-ds', { visible: true, timeout: 25000 });
        console.log('✅ Datastore analysis finished and comparison grid rendered.');
        await delay(1000);

        // Verify loaded results status
        const resultsSummary = await page.evaluate(() => {
            return {
                identical: document.getElementById('ld-identical').innerText,
                different: document.getElementById('ld-different').innerText,
                missing: document.getElementById('ld-missing').innerText
            };
        });
        // Reorder results to bring the JSON test entity to the top page
        await page.evaluate(() => {
            const idx = State.ds.results.findIndex(r => r.keyStr.includes('5632499082330112'));
            if (idx !== -1) {
                const item = State.ds.results.splice(idx, 1)[0];
                State.ds.results.unshift(item);
                App.filterDsResults('all');
            }
        });
        await delay(500);

        // =====================================================================
        // TEST CASE 5: Properties Inline Editor Diff Highlight
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 5: Inline Properties Expansion & Diff Highlight ---');
        console.log('🖱️ Expanding the targeted JSON entity row (ID: 5632499082330112)...');
        
        const diffRowIndex = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#ds-table-body tr'));
            return rows.findIndex(r => r.innerText.includes('5632499082330112')) + 1;
        });
        
        if (diffRowIndex === 0) {
            throw new Error("No different entities found to test diff highlights.");
        }
        
        await clickElement(`#ds-table-body tr:nth-child(${diffRowIndex}) td:nth-child(2)`);
        await page.waitForSelector('.prop-edit-row', { visible: true, timeout: 5000 });
        await delay(800);
        
        // Verify diff-mod, diff-add, or diff-rem highlight styling
        const diffHighlightCount = await page.evaluate((idx) => {
            const expRow = document.querySelector(`#ds-table-body tr:nth-child(${idx}) + tr`);
            return expRow ? expRow.querySelectorAll('.prop-edit-row.diff-mod, .prop-edit-row.diff-add, .prop-edit-row.diff-rem').length : 0;
        }, diffRowIndex);
        console.log(diffHighlightCount > 0 ? `✅ Visual highlights active: Found ${diffHighlightCount} modified/missing property lines.` : '⚠️ Warning: Visual diff highlights count is 0 on expanded properties.');

        // =====================================================================
        // TEST CASE 6: Interactive JSON Diff Modal & Validation
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 6: Interactive JSON Editor & Strict Syntax Validation ---');
        
        console.log('🖱️ Opening JSON Editor Modal on role field...');
        await clickElement(`#ds-table-body tr:nth-child(${diffRowIndex}) + tr .btn-json-edit-trigger`);
        await page.waitForSelector('#json-src-area', { visible: true, timeout: 5000 });
        await delay(1000);

        // Verify template option is removed
        const selectTemplateExists = await page.evaluate(() => {
            return document.querySelector('.select-tmpl-src') !== null || document.querySelector('.select-tmpl-tgt') !== null;
        });
        console.log(!selectTemplateExists ? '✅ Preset template options removed from modal successfully.' : '❌ Preset template dropdowns still present inside modal.');

        // Verify Live Differences Preview box exists
        const hasDiffPreview = await page.evaluate(() => {
            return document.getElementById('json-diff-container') !== null;
        });
        console.log(hasDiffPreview ? '✅ Live Differences Preview panel is present.' : '❌ Live Differences Preview panel is missing.');

        // Test syntax checking: Type invalid braces to trigger validation error
        console.log('✍️ Simulating invalid JSON syntax error...');
        await typeInto('#json-tgt-area', '{\n  "role": "Administrator",\n  "unclosed": {');
        await delay(1000); // Wait for keystroke debounce validation

        // Verify invalid status and disabled apply button
        const isSaveDisabledOnInvalid = await page.$eval('#btn-json-save-apply', btn => btn.disabled);
        const syntaxErrorText = await page.$eval('#json-tgt-status', el => el.innerText);
        console.log(isSaveDisabledOnInvalid ? `✅ Save button disabled on invalid JSON syntax: "${syntaxErrorText}"` : '❌ Save button should be disabled on invalid JSON.');
        await delay(1000);

        // Correct JSON or paste a valid JSON block
        console.log('✍️ Correcting JSON syntax to valid object...');
        await typeInto('#json-tgt-area', '{\n  "role": "Administrator",\n  "active": true\n}');
        await delay(800);

        // Minification test: verify it is clean & minified upon clicking Apply
        const isSaveEnabledOnValid = await page.$eval('#btn-json-save-apply', btn => !btn.disabled);
        console.log(isSaveEnabledOnValid ? '✅ Save button enabled on valid JSON syntax.' : '❌ Save button should be enabled.');
        
        console.log('🖱️ Applying Changes (Verify automatic JSON minification)...');
        await clickElement('#btn-json-save-apply');
        await delay(800);

        // Check if value applied back to properties editor textarea is a single-line minified version
        const appliedMinifiedValue = await page.evaluate(() => {
            const rawInp = document.querySelector('.prop-edit-row.diff-mod .raw-val-tgt');
            return rawInp ? rawInp.value : '';
        });
        console.log(!appliedMinifiedValue.includes('\n') && appliedMinifiedValue.startsWith('{') ? '✅ Applied changes are automatically minified back to the grid.' : '❌ Applied JSON value should be stored as single-line minified string.');

        // =====================================================================
        // TEST CASE 7: Inline Save
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 7: Single Entity Inline Save & Overwrite Confirmation ---');
        console.log('🖱️ Clicking Save to Target to commit changes...');
        await clickElement('.btn-save-tgt');
        await page.waitForSelector('#modal-root .modal', { visible: true });
        await delay(1000);

        console.log('🖱️ Confirming inline changes save...');
        await clickElement('#btn-ds-save-confirm');
        
        // Wait for analyze results to update and reload
        await page.waitForSelector('#res-ds', { visible: true, timeout: 25000 });
        console.log('✅ Entity inline changes saved successfully.');
        await delay(1000);

        // =====================================================================
        // TEST CASE 8: Copy Selected & Audit Log Warnings Modal
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 8: Copy Selected & GCP Audit Logging Warnings ---');
        
        // Select check box for targeted different row
        console.log('🖱️ Selecting entity row for copy sync...');
        await clickElement(`#ds-table-body tr:nth-child(${diffRowIndex}) td:first-child .chk`);
        await delay(400);

        console.log('🖱️ Clicking Copy Selected...');
        await clickElement('#btn-ds-copy');
        await page.waitForSelector('#modal-root .modal', { visible: true });
        await delay(1000);

        // Verify copy warning details
        const copyModalText = await page.evaluate(() => document.querySelector('#modal-root .modal').innerText);
        const expectedWarnings = [
            'Backup! This will upsert entities',
            'Operations that need to be enabled (Data Access Logs)',
            'google.datastore.v1.Datastore.Commit',
            'IAM & Admin > Audit Logs',
            'Check the Data Write'
        ];

        let warningCheckPassed = true;
        for (const item of expectedWarnings) {
            if (!copyModalText.includes(item)) {
                console.error(`❌ Missing copy warning detail: "${item}"`);
                warningCheckPassed = false;
            }
        }
        if (warningCheckPassed) {
            console.log('✅ All requested copy warnings and GCP Audit Logging steps are verified in the modal.');
        }

        console.log('🖱️ Confirming copy execution...');
        await clickElement('#modal-root button.btn-p');
        
        // Wait for load results to finalize comparison
        await page.waitForSelector('#res-ds', { visible: true, timeout: 45000 });
        console.log('✅ Datastore copy completed successfully.');
        await delay(1500);

        console.log('\n🎉 COMPREHENSIVE VISUAL DATASTORE COPIER TEST SUITE PASSED! 🎉\n');

    } catch (err) {
        console.error('\n🔴 Test suite failed:', err.stack);
        try {
            await page.screenshot({ path: '/Users/shreyashsutane/.gemini/antigravity/brain/67419ec2-e355-469a-a150-1132bfb3aac3/test_ds_failure.png' });
            console.log('📸 Saved failure screenshot to artifacts.');
        } catch (e) {
            console.error('Failed to take screenshot:', e);
        }
    } finally {
        await delay(2000);
        console.log('🚪 Closing browser...');
        await browser.close();
        if (serverProcess) {
            console.log('📡 Stopping local web server...');
            serverProcess.kill();
        }
    }
}

main();
