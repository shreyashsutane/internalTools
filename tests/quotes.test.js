const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Quotes dataset contains all 24 thought-leader quotes', () => {
    const quotesJsonPath = path.join(__dirname, '../datastore-copier/src/quotes-data.json');
    assert.ok(fs.existsSync(quotesJsonPath), 'quotes-data.json must exist');

    const quotes = JSON.parse(fs.readFileSync(quotesJsonPath, 'utf-8'));
    assert.equal(quotes.length, 24, 'Must have exactly 24 quotes from the spreadsheet');

    for (const q of quotes) {
        assert.ok(q.name && q.name.trim().length > 0, 'Every quote must have an author name');
        assert.ok(q.role && q.role.trim().length > 0, 'Every quote must have a designation/role');
        assert.ok(q.netWorth && q.netWorth.trim().length > 0, 'Every quote must have estimated net worth');
        assert.ok(q.category && q.category.trim().length > 0, 'Every quote must have a category');
        assert.ok(q.quote && q.quote.trim().length > 0, 'Every quote must have quote text');
    }
});

test('Dynamic waiting time algorithm calculates accurate duration based on word count', () => {
    function getDynamicDuration(quoteText) {
        const words = quoteText.trim().split(/\s+/).filter(Boolean).length;
        const sec = Math.max(8, Math.min(24, Math.round(5 + (words * 0.35))));
        return { words, sec };
    }

    const shortQ = 'The hottest new programming language is English.';
    const shortDyn = getDynamicDuration(shortQ);
    assert.equal(shortDyn.words, 7);
    assert.equal(shortDyn.sec, 8, 'Short 7-word quote must clamp to minimum 8s');

    const medQ = 'AI is not likely to replace you, but someone using AI better than you might.';
    const medDyn = getDynamicDuration(medQ);
    assert.equal(medDyn.words, 15);
    assert.equal(medDyn.sec, 10, 'Medium 14-word quote must calculate to 10s');

    const stdQ = 'AI will change the way people work, learn, travel, get health care, and communicate with each other. Entire industries will reorient around it. Businesses will distinguish themselves by how well they use it.';
    const stdDyn = getDynamicDuration(stdQ);
    assert.equal(stdDyn.words, 33);
    assert.equal(stdDyn.sec, 17, 'Standard 34-word quote must calculate to 17s');

    const longQ = 'If you can produce 30 percent more code with the same number of people, are you going to get more code written or less? It is a tool. If the quality that everybody produces becomes better using these tools, then even for the consumer, now you are consuming better-quality products.';
    const longDyn = getDynamicDuration(longQ);
    assert.equal(longDyn.words, 50);
    assert.equal(longDyn.sec, 23, 'Long 49-word quote must calculate to 22s');

    const hugeQ = new Array(100).fill('word').join(' ');
    const hugeDyn = getDynamicDuration(hugeQ);
    assert.equal(hugeDyn.sec, 24, 'Extremely long quote must clamp to maximum 24s');
});

test('index.html contains Welcome quote card and Loading dynamic quote card', () => {
    const indexPath = path.join(__dirname, '../datastore-copier/index.html');
    const html = fs.readFileSync(indexPath, 'utf-8');

    assert.match(html, /id="welcome-quote-box"/, 'Must contain welcome-quote-box');
    assert.match(html, /id="welcome-quote-text"/, 'Must contain welcome-quote-text');
    assert.match(html, /id="welcome-quote-author"/, 'Must contain welcome-quote-author');
    assert.match(html, /id="welcome-quote-role"/, 'Must contain welcome-quote-role');
    assert.match(html, /id="welcome-quote-networth"/, 'Must contain welcome-quote-networth');
    assert.match(html, /id="welcome-quote-shuffle"/, 'Must contain welcome-quote-shuffle button');

    assert.match(html, /id="loading-quote-card"/, 'Must contain loading-quote-card');
    assert.match(html, /id="loading-quote-text"/, 'Must contain loading-quote-text');
    assert.match(html, /id="loading-quote-author"/, 'Must contain loading-quote-author');
    assert.match(html, /id="loading-quote-role"/, 'Must contain loading-quote-role');
    assert.match(html, /id="loading-quote-networth"/, 'Must contain loading-quote-networth');
    assert.match(html, /id="loading-quote-timer"/, 'Must contain loading-quote-timer');
    assert.match(html, /id="loading-quote-word-count"/, 'Must contain loading-quote-word-count');
    assert.match(html, /id="loading-quote-progress-bar"/, 'Must contain loading-quote-progress-bar');
    assert.match(html, /id="btn-next-loading-quote"/, 'Must contain btn-next-loading-quote');
});
