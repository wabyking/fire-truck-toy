// Serve dist/ on the local network so a tablet on the same Wi-Fi can play: node tools/serve.mjs [port]
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = +(process.argv[2] || 8080);
http.createServer((req, res) => {
  const f = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('消防车已就绪。在同一个 Wi-Fi 的平板/手机浏览器里打开：'); for (const ip of ips) console.log(`  http://${ip}:${PORT}`);
});
