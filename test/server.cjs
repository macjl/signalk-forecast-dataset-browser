// Static test server. Catalogue responses are intercepted per browser test.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../public')
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/') { res.writeHead(302, { Location: '/signalk-forecast-dataset-browser/' }); return res.end() }
  const relative = url.pathname.replace(/^\/signalk-forecast-dataset-browser\/?/, '') || 'index.html'
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end() }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(bytes)
  })
}).listen(4178, '127.0.0.1')
