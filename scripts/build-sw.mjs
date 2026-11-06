// Régénère la liste de précache et la version du service worker à partir des fichiers réels.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCLURE = ['index.html', 'manifest.json', 'assets', 'src', 'vendor'];
const EXCLURE = /(^|\/)(LICENSE|\.DS_Store)$/;
const fichiers = [];
(function parcourir(rel) {
  const abs = path.join(racine, rel);
  if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).sort().forEach(f => parcourir(path.posix.join(rel, f)));
  else if (!EXCLURE.test(rel)) fichiers.push(rel);
})('.');
const liste = fichiers.filter(f => INCLURE.some(i => f === i || f.startsWith(i.replace(/\/?$/, '/')))).map(f => f.replace(/^\.\//, ''));
const hash = crypto.createHash('sha256');
for (const f of liste) { hash.update(f); hash.update(fs.readFileSync(path.join(racine, f))); }
const version = hash.digest('hex').slice(0, 10);
const sw = path.join(racine, 'service-worker.js');
let src = fs.readFileSync(sw, 'utf8');
src = src.replace(/\/\/ <GENERE>[\s\S]*?\/\/ <\/GENERE>/, `// <GENERE>\nconst VERSION = '${version}';\nconst PRECACHE = ${JSON.stringify(['./', ...liste], null, 1).replace(/\n\s*/g, ' ')};\n// </GENERE>`);
fs.writeFileSync(sw, src);
console.log(`service-worker.js : version ${version}, ${liste.length + 1} fichiers en précache`);
