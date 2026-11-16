// 零依赖静态服务器：node tools/serve.mjs [port] [--lan]
// --lan 绑定 0.0.0.0，供同一 Wi-Fi 下的手机访问（http 局域网在 iPhone 上不算安全上下文，Service Worker 不生效，仅作在线预览）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const lan = args.includes('--lan');
const port = Number(args.find(a => /^\d+$/.test(a))) || 8123;
const host = lan ? '0.0.0.0' : '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}).listen(port, host, () => {
  console.log(`小桃课表 running at http://127.0.0.1:${port}/`);
  if (lan) {
    const ips = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
    ips.forEach(ip => console.log(`同一 Wi-Fi 手机访问: http://${ip}:${port}/`));
  }
});