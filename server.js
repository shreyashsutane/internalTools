const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0]; // strip query params
    
    // Local development bridge to the secured production audit API.
    if (reqUrl.startsWith('/api/audit_logs')) {
        const https = require('https');
        const allowedPaths = new Set([
            '/api/audit_logs',
            '/api/audit_logs/runQuery',
            '/api/audit_logs/update'
        ]);
        const origin = req.headers.origin || '';
        const isLocalOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
        if (!allowedPaths.has(reqUrl) || req.method !== 'POST' || !isLocalOrigin) {
            res.writeHead(403, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify({ ok: false, error: { message: 'Audit request denied.' } }));
            return;
        }

        const authHeader = req.headers['authorization'] || '';
        if (authHeader === 'Bearer test-token') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            });
            if (reqUrl === '/api/audit_logs/runQuery') {
                res.end(JSON.stringify({ ok: true, logs: [] }));
            } else {
                res.end(JSON.stringify({ ok: true, id: 'mock-log-' + Date.now() }));
            }
            return;
        }
        
        let bodyData = '';
        let bodyTooLarge = false;
        req.on('data', chunk => {
            bodyData += chunk;
            if (Buffer.byteLength(bodyData, 'utf8') > 800_000) {
                bodyTooLarge = true;
            }
        });
        req.on('end', () => {
            if (bodyTooLarge) {
                res.writeHead(413, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                });
                res.end(JSON.stringify({ ok: false, error: { message: 'Audit request is too large.' } }));
                return;
            }
            const proxyReq = https.request({
                hostname: 'gcp-tools-portal.web.app',
                path: reqUrl,
                method: 'POST',
                headers: {
                    'Authorization': req.headers['authorization'] || '',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyData, 'utf8'),
                    'Origin': origin
                }
            }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 500, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                });
                proxyRes.pipe(res);
            });
            
            proxyReq.on('error', (e) => {
                console.error('Secured audit bridge failed:', e);
                res.writeHead(502, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                });
                res.end(JSON.stringify({ ok: false, error: { message: 'Audit service unavailable.' } }));
            });
            
            if (bodyData) {
                proxyReq.write(bodyData);
            }
            proxyReq.end();
        });
        return;
    }

    // Normalize path to prevent directory traversal
    let safeSuffix = path.normalize(reqUrl).replace(/^(\.\.[\/\\])+/, '');
    if (safeSuffix === '\\' || safeSuffix === '/') {
        safeSuffix = '/index.html';
    }
    
    let filePath = path.join(__dirname, safeSuffix);
    
    // Check if filePath is a directory
    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
        
        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('404 Not Found');
                } else {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`500 Internal Server Error: ${err.code}`);
                }
                return;
            }
            
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });
    });
});

let currentPort = PORT;

function startServer(port) {
    server.listen(port, '0.0.0.0');
}

server.on('listening', () => {
    const addr = server.address();
    console.log(`====================================================`);
    console.log(`Internal Tools Portal running locally!`);
    console.log(`Access the application at: http://localhost:${addr.port}`);
    console.log(`Access via IP: http://127.0.0.1:${addr.port}`);
    console.log(`====================================================`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${currentPort} is already in use.`);
        currentPort++;
        console.log(`Retrying on port ${currentPort}...`);
        startServer(currentPort);
    } else {
        console.error('Server error:', err);
    }
});

startServer(currentPort);
