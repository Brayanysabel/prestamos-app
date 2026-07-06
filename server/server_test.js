// server_test.js - Servidor mínimo para diagnóstico
const http = require('http');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, env: process.env.NODE_ENV }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Server running on port ' + PORT);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[TEST SERVER] Listening on http://0.0.0.0:${PORT}`);
});

process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));
