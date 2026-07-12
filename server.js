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
    
    // Firestore Proxy Endpoints
    if (reqUrl.startsWith('/api/audit_logs')) {
        const https = require('https');
        let targetUrl = '';
        if (reqUrl === '/api/audit_logs/runQuery') {
            targetUrl = 'https://firestore.googleapis.com/v1/projects/gcp-tools-portal/databases/(default)/documents:runQuery';
        } else {
            targetUrl = 'https://firestore.googleapis.com/v1/projects/gcp-tools-portal/databases/(default)/documents/audit_logs';
        }
        
        let bodyData = '';
        req.on('data', chunk => { bodyData += chunk; });
        req.on('end', () => {
            const parsedUrl = new URL(targetUrl);
            const proxyReq = https.request({
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname,
                method: req.method,
                headers: {
                    'Authorization': req.headers['authorization'] || '',
                    'Content-Type': 'application/json'
                }
            }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                proxyRes.pipe(res);
            });
            
            proxyReq.on('error', (e) => {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: ${e.message}`);
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
