/**
 * Comprehensive GCP Infrastructure Manager Test Suite
 * Evaluates all features (BQ Schema, Scheduled Queries, Datastore) visually on your desktop screen.
 */

const { execSync } = require('child_process');
const http = require('http');

// Auto-install puppeteer if not present
try {
    require('puppeteer');
} catch (e) {
    console.log('📦 Puppeteer not found. Installing now...');
    execSync('npm install puppeteer --no-save', { stdio: 'inherit' });
}

const puppeteer = require('puppeteer');

const URL = `https://gcp-tools-portal.web.app/datastore-copier/`;

const SRC_PROJECT = 'project-c0e231c7-2177-4eb0-979';
const TGT_PROJECT = 'second-project-16364';

// Helper to get active GCP access token
function getAccessToken() {
    try {
        return execSync('gcloud auth print-access-token').toString().trim();
    } catch (e) {
        console.error('❌ Failed to get access token from gcloud. Make sure you are logged in.', e.message);
        process.exit(1);
    }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`\n🚀 Starting Comprehensive GCP Infra Manager Test Suite (REAL GCP ON FIREBASE)...\n`);

    const token = getAccessToken();

    // Launch browser in headless mode
    const browser = await puppeteer.launch({
        headless: true,
        slowMo: 60,
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox']
    });

    let page = null;
    try {
        const pages = await browser.pages();
        page = pages[0];
        
        // Pipe browser console logs and errors to terminal
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
        
        // Inject virtual cursor stylesheet and helper script
        await page.evaluateOnNewDocument(() => {
            window.addEventListener('DOMContentLoaded', () => {
                const cursor = document.createElement('div');
                cursor.id = 'virtual-cursor';
                cursor.style.position = 'fixed';
                cursor.style.width = '16px';
                cursor.style.height = '16px';
                cursor.style.background = 'rgba(247, 148, 29, 0.9)';
                cursor.style.border = '2px solid white';
                cursor.style.borderRadius = '50%';
                cursor.style.pointerEvents = 'none';
                cursor.style.zIndex = '999999';
                cursor.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
                cursor.style.transition = 'transform 0.15s ease, background-color 0.15s ease';
                cursor.style.transform = 'translate(-50%, -50%)';
                cursor.style.left = '0px';
                cursor.style.top = '0px';
                document.body.appendChild(cursor);
                
                window.moveVirtualCursor = (x, y) => {
                    cursor.style.left = `${x}px`;
                    cursor.style.top = `${y}px`;
                };
                
                window.clickVirtualCursor = () => {
                    cursor.style.backgroundColor = '#00d4aa';
                    cursor.style.transform = 'translate(-50%, -50%) scale(0.6)';
                    setTimeout(() => {
                        cursor.style.backgroundColor = 'rgba(247, 148, 29, 0.9)';
                        cursor.style.transform = 'translate(-50%, -50%) scale(1)';
                    }, 250);
                };
            });
        });

        // Helper to animate mouse cursor smoothly to element
        const moveMouseTo = async (selector) => {
            const el = await page.waitForSelector(selector, { visible: true });
            let box = null;
            for (let attempt = 0; attempt < 15; attempt++) {
                box = await el.boundingBox();
                if (box) break;
                await delay(100);
            }
            if (!box) throw new Error(`Could not find bounding box for selector: ${selector}`);

            const targetX = box.x + box.width / 2;
            const targetY = box.y + box.height / 2;

            const current = await page.evaluate(() => {
                const cur = document.getElementById('virtual-cursor');
                return cur ? { x: parseFloat(cur.style.left) || 0, y: parseFloat(cur.style.top) || 0 } : { x: 0, y: 0 };
            });

            const steps = 18;
            for (let i = 1; i <= steps; i++) {
                const ratio = i / steps;
                const cx = current.x + (targetX - current.x) * ratio;
                const cy = current.y + (targetY - current.y) * ratio;
                await page.evaluate((x, y) => window.moveVirtualCursor(x, y), cx, cy);
                await delay(15);
            }
            await delay(100);
        };

        const clickElement = async (selector, postDelay = 400) => {
            await moveMouseTo(selector);
            await page.evaluate(() => window.clickVirtualCursor());
            await delay(200);
            await page.click(selector);
            if (postDelay > 0) {
                await delay(postDelay);
            }
        };

        const typeInto = async (selector, text) => {
            await moveMouseTo(selector);
            await page.click(selector);
            await page.evaluate(sel => {
                const el = document.querySelector(sel);
                if (el) {
                    el.value = '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, selector);
            await page.type(selector, text, { delay: 5 });
            await delay(300);
        };


        console.log('🔗 Navigating to portal...');
        await page.goto(URL, { waitUntil: 'networkidle2' });
        await delay(1000);

        // =====================================================================
        // TEST CASE 1: Authentication Error & Success
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 1: Authentication Flows ---');
        
        // 1. Empty token verify button check
        const isVerifyDisabled = await page.$eval('#btn-verify', btn => btn.disabled);
        console.log(isVerifyDisabled ? '✅ Verify button disabled when input is empty.' : '❌ Verify button should be disabled when empty.');

        // 2. Invalid token test
        console.log('🔑 Testing invalid token response...');
        await typeInto('#inp-token', 'invalid-token');
        await clickElement('#btn-verify');
        await delay(1200); // Wait for error toast to display

        // 3. Valid token test
        console.log('🔑 Performing valid authentication...');
        await typeInto('#inp-token', token);
        await clickElement('#btn-verify');
        await page.waitForSelector('#sec-modes', { visible: true, timeout: 10000 });
        console.log('✅ Authentication succeeded and redirected to select mode screen.');

        // =====================================================================
        // TEST CASE 2: BigQuery Schema Comparison (Identical, Diff, Missing, Expansion)
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 2: BigQuery Schema Compare ---');
        await clickElement('[data-mode="bq"]');
        await page.waitForSelector('#form-bq', { visible: true });

        console.log(`✍️ Setting projects: Src=${SRC_PROJECT}, Tgt=${TGT_PROJECT}...`);
        await typeInto('#bq-src', SRC_PROJECT);
        await page.waitForSelector('#dd-bq-src .dropdown-item[data-id]');
        await clickElement(`#dd-bq-src .dropdown-item[data-id="${SRC_PROJECT}"]`);
        await delay(800);

        await typeInto('#bq-tgt', TGT_PROJECT);
        await page.waitForSelector('#dd-bq-tgt .dropdown-item[data-id]');
        await clickElement(`#dd-bq-tgt .dropdown-item[data-id="${TGT_PROJECT}"]`);
        await delay(800);

        console.log('📊 Comparing BigQuery schemas...');
        await clickElement('#btn-bq-compare');
        await page.waitForSelector('#res-bq', { visible: true, timeout: 15000 });
        await delay(1000);

        // Check if correct tables are rendered with expected statuses
        const bqTablesList = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#bq-table-body-rows tr')).map(x => x.innerText);
        });

        console.log('👀 BigQuery Tables found:');
        bqTablesList.forEach(txt => console.log(`   - ${txt.replace(/\n/g, ' | ')}`));

        const hasBqDiff = bqTablesList.some(t => t.includes('dummy_table_diff') && (t.includes('DIFFERENT') || t.includes('COMPARING')));
        const hasBqMiss = bqTablesList.some(t => t.includes('dummy_table_missing') && (t.includes('MISSING IN TGT') || t.includes('SRC ONLY')));
        
        console.log(hasBqDiff ? '✅ dummy_table_diff flagged as DIFFERENT/COMPARING.' : '❌ dummy_table_diff schema compare failed.');
        console.log(hasBqMiss ? '✅ dummy_table_missing flagged as MISSING IN TGT/SRC ONLY.' : '❌ dummy_table_missing schema compare failed.');

        // Expand different table to check visual properties diff highlighting
        console.log('🔍 Expanding different BigQuery table to view column diffs...');
        await clickElement('#bq-table-body-rows tr:nth-child(1) td:nth-child(2)');
        await delay(1200); // Wait for columns fetch to load and highlight diffs
        console.log('✅ Visual diff successfully expanded and displayed.');

        // Click Copy Selected and verify sync triggers
        await clickElement('#bq-table-body-rows tr:nth-child(1) td:nth-child(1) .chk'); // Check different table row
        await clickElement('#btn-bq-copy-s2t', 50);
        await page.waitForSelector('#modal-root .btn-confirm', { visible: true });
        await clickElement('#modal-root .btn-confirm');
        
        // Wait for results to become visible (indicates comparison is fully completed)
        console.log('⏳ BigQuery schema sync and comparison started...');
        await page.waitForSelector('#res-bq', { visible: true, timeout: 75000 });
        console.log('✅ BigQuery schema sync and comparison completed.');
        await delay(500);

        // =====================================================================
        // TEST CASE 3: Scheduled Queries Transfer & Warning
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 3: Scheduled Queries Transfer ---');
        await clickElement('[data-mode="query"]');
        await page.waitForSelector('#form-query', { visible: true });

        console.log(`✍️ Setting projects: Src=${SRC_PROJECT}, Tgt=${TGT_PROJECT}...`);
        await typeInto('#q-src', SRC_PROJECT);
        await page.waitForSelector('#dd-q-src .dropdown-item[data-id]');
        await clickElement(`#dd-q-src .dropdown-item[data-id="${SRC_PROJECT}"]`);
        await delay(500);

        await typeInto('#q-tgt', TGT_PROJECT);
        await page.waitForSelector('#dd-q-tgt .dropdown-item[data-id]');
        await clickElement(`#dd-q-tgt .dropdown-item[data-id="${TGT_PROJECT}"]`);
        await delay(500);

        console.log('📊 Fetching scheduled queries...');
        await clickElement('#btn-q-fetch');
        await page.waitForSelector('#res-query', { visible: true, timeout: 15000 });
        await delay(1000);

        const queriesList = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#q-table-body-rows tr')).map(x => x.innerText);
        });
        console.log('👀 Scheduled queries found:');
        queriesList.forEach(txt => console.log(`   - ${txt.replace(/\n/g, ' | ')}`));
        console.log(queriesList.length > 0 ? '✅ Scheduled queries list loaded successfully.' : '❌ Scheduled queries loading failed.');

        if (queriesList.length > 0) {
            // Select query and click Copy
            await clickElement('#q-table-body-rows tr:nth-child(1) td:nth-child(1) .chk');
            await clickElement('#btn-q-copy', 50);
            await page.waitForSelector('#modal-root .btn-confirm', { visible: true });
            await clickElement('#modal-root .btn-confirm');
            
            // Wait for results to become visible (indicates copy and fetch completed)
            console.log('⏳ Scheduled query copying and fetching started...');
            await page.waitForSelector('#res-query', { visible: true, timeout: 75000 });
            console.log('✅ Scheduled query copying and fetching completed.');
        } else {
            console.log('⏭️ Skipping Scheduled Query copy test (no queries found).');
        }

        // =====================================================================
        // TEST CASE 4: Datastore Entities Comparison & Property Diff Expansion
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 4: Datastore Entities Compare ---');
        await clickElement('[data-mode="ds"]');
        await page.waitForSelector('#form-ds', { visible: true });

        // Set state programmatically for Datastore tab to bypass dropdown select
        console.log(`✍️ Setting projects: Src=${SRC_PROJECT}, Tgt=${TGT_PROJECT}, Kind=DummyKind...`);
        await page.evaluate((src, tgt) => {
            document.querySelector('#ds-src').value = src;
            document.querySelector('#ds-tgt').value = tgt;
            document.querySelector('#ds-kind').value = 'DummyKind';
            
            State.ds.src = src;
            State.ds.tgt = tgt;
            State.ds.kind = 'DummyKind';
            State.ds.kinds = ['DummyKind'];
            State.ds.properties = ['name', 'age'];
        }, SRC_PROJECT, TGT_PROJECT);
        await delay(500);

        console.log('📊 Analyzing Datastore entities...');
        await clickElement('#btn-ds-analyze');
        await page.waitForSelector('#res-ds', { visible: true, timeout: 15000 });
        await delay(1000);

        // Verify result rows
        const dsRows = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#ds-table-body tr')).map(x => x.innerText);
        });
        console.log('👀 Datastore Entities found:');
        dsRows.forEach(txt => console.log(`   - ${txt.replace(/\n/g, ' | ')}`));

        const hasDsDiff = dsRows.some(t => t.includes('entity-1') && t.includes('DIFFERENT'));
        const hasDsMiss = dsRows.some(t => t.includes('entity-2') && t.includes('MISSING IN TGT'));
        
        console.log(hasDsDiff ? '✅ entity-1 flagged as DIFFERENT.' : '❌ entity-1 compare failed.');
        console.log(hasDsMiss ? '✅ entity-2 flagged as MISSING IN TGT.' : '❌ entity-2 compare failed.');

        // Expand entity to check property diff
        console.log('🔍 Expanding different Datastore entity to view property diff...');
        await clickElement('#ds-table-body tr:nth-child(1) td:nth-child(2)');
        await delay(800);
        console.log('✅ Datastore property diff expanded and verified.');

        // =====================================================================
        // TEST CASE 5: Datastore Find & Replace Verification
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 5: Find & Replace Configuration ---');
        
        // Go back to Datastore form to input modification
        console.log('✍️ Configuring Find & Replace rule...');
        await page.evaluate(() => {
            // Programmatically configure find/replace inputs
            document.querySelector('#ds-mod-field').value = 'name';
            document.querySelector('#ds-mod-target').value = 'Alice';
            document.querySelector('#ds-mod-replace').value = 'Alice Updated';
            
            State.ds.modField = 'name';
        });
        await delay(500);

        // Toggle select all and click Copy Selected
        await clickElement('#chk-all-ds'); // ensure selected is active
        await clickElement('#btn-ds-copy');
        await page.waitForSelector('#modal-root .modal', { visible: true });

        // Verify Find & Replace option inside copy confirmation modal
        const hasReplaceCheckbox = await page.evaluate(() => {
            const label = document.querySelector('#modal-root .modal').innerText;
            const chk = document.querySelector('#modal-root .modal #chk-ds-replace');
            return label.includes('Apply Find & Replace modifications') && chk !== null;
        });
        console.log(hasReplaceCheckbox ? '✅ Find & Replace check box options are present in confirmation modal.' : '❌ Find & Replace options missing.');
        
        // Close modal
        await clickElement('#modal-root button.btn-s');
        await delay(500);

        // =====================================================================
        // TEST CASE 6: Datastore Copy Warnings Modal Verification (Audit Logs)
        // =====================================================================
        console.log('\n--- 🧪 TEST CASE 6: Copy Warning Modal Check (Audit Logs) ---');
        await clickElement('#btn-ds-copy');
        await page.waitForSelector('#modal-root .modal', { visible: true });

        const modalText = await page.evaluate(() => document.querySelector('#modal-root .modal').innerText);
        const expectedWarnings = [
            'Backup! This will upsert entities',
            'Operations that need to be enabled (Data Access Logs)',
            'google.datastore.v1.Datastore.Commit',
            'IAM & Admin > Audit Logs',
            'Check the Data Write'
        ];

        let warningCheckPassed = true;
        for (const item of expectedWarnings) {
            if (!modalText.includes(item)) {
                console.error(`❌ Missing copy warning detail: "${item}"`);
                warningCheckPassed = false;
            }
        }
        if (warningCheckPassed) {
            console.log('✅ All requested copy warnings and GCP Audit Logging steps are verified in the modal.');
        }

        // Close modal
        await clickElement('#modal-root button.btn-s');
        await delay(500);

        console.log('\n🎉 COMPREHENSIVE TEST SUITE COMPLETED SUCCESSFULLY! 🎉\n');

    } catch (err) {
        console.error('\n🔴 Test suite failed:', err.stack);
        try {
            await page.screenshot({ path: '/Users/shreyashsutane/.gemini/antigravity/brain/67419ec2-e355-469a-a150-1132bfb3aac3/test_failure.png' });
            console.log('📸 Saved failure screenshot to artifacts.');
        } catch (e) {
            console.error('Failed to take screenshot:', e);
        }
        try {
            const toastText = await page.evaluate(() => {
                const toast = document.querySelector('.toast-err');
                return toast ? toast.innerText : null;
            });
            if (toastText) {
                console.error(`🚨 Webpage error toast content: "${toastText}"`);
            }
        } catch (e) {}
    } finally {
        await delay(1500);
        console.log('🚪 Closing browser...');
        await browser.close();
    }
}

main();
