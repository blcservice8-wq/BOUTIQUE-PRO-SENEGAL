// Contrôles statiques : secrets, clés privilégiées, cohérence du service worker, fichiers requis.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const erreurs = [];
const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');
const parcourir = (d, ext) => fs.readdirSync(path.join(racine, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? parcourir(path.join(d, e.name), ext) : ext.some(x => e.name.endsWith(x)) ? [path.join(d, e.name)] : []);

for (const f of [...parcourir('src', ['.js']), 'index.html', 'manifest.json', 'service-worker.js']) {
  const t = lire(f);
  if (/service_role/i.test(t) && !/jamais|never|interdit|ne l'utilisez|ne collez/i.test(t)) erreurs.push(`${f} : mention de service_role`);
  for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g)) erreurs.push(`${f} : jeton JWT en dur`);
  if (/sb_secret_/.test(t)) erreurs.push(`${f} : clé secrète Supabase`);
}
for (const f of ['index.html', 'manifest.json', 'service-worker.js', 'README.md', 'LICENSE', '.gitignore', 'supabase/migrations/001_schema.sql', 'supabase/migrations/002_rpc_operations.sql', 'supabase/seed.sql'])
  if (!fs.existsSync(path.join(racine, f))) erreurs.push(`fichier manquant : ${f}`);
const man = JSON.parse(lire('manifest.json'));
for (const i of man.icons) if (!fs.existsSync(path.join(racine, i.src))) erreurs.push(`icône manquante : ${i.src}`);
const sw = lire('service-worker.js'); const pre = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
for (const f of pre.filter(x => x !== './')) if (!fs.existsSync(path.join(racine, f))) erreurs.push(`précache : ${f} introuvable`);
for (const f of parcourir('src', ['.js'])) if (!pre.includes(f.replace(/\\/g, '/'))) erreurs.push(`précache incomplet : ${f} (lancez npm run build:sw)`);
// Les migrations doivent activer la RLS sur chaque table créée.
const sql = lire('supabase/migrations/001_schema.sql'); const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map(m => m[1]);
for (const t of tables) if (!new RegExp(`'${t}'`).test(sql.slice(sql.indexOf('-- ============ RLS'))) ) erreurs.push(`RLS non activée pour la table ${t}`);
if (erreurs.length) { console.error('✗ Contrôles échoués :\n - ' + erreurs.join('\n - ')); process.exit(1); }
console.log(`✓ Contrôles statiques OK (${tables.length} tables avec RLS, ${pre.length} fichiers en précache)`);
