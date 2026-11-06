// Serveur statique minimal pour le développement et les tests (http://localhost:8080).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
export function demarrer(port = Number(process.env.PORT) || 8080) {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(racine, p));
    if (!f.startsWith(racine) || /node_modules|supabase\/|tests\/|\.git/.test(p)) { res.writeHead(403); return res.end('Interdit'); }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('Introuvable'); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d); });
  });
  return new Promise(r => s.listen(port, () => { console.log(`http://localhost:${port}`); r(s); }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) demarrer();
