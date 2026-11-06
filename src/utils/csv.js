// Export/Import CSV (séparateur « ; » pour Excel en version française, BOM UTF-8).
const cell = v => {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function versCSV(lignes, colonnes) {
  const entete = colonnes.map(c => cell(c.titre)).join(';');
  const corps = lignes.map(l => colonnes.map(c => cell(typeof c.val === 'function' ? c.val(l) : l[c.cle])).join(';'));
  return '﻿' + [entete, ...corps].join('\r\n');
}
export function lireCSV(texte) {
  texte = texte.replace(/^﻿/, '');
  const premiere = texte.split(/\r?\n/, 1)[0] || '';
  const sep = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (q) {
      if (c === '"') { if (texte[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texte[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
  if (!rows.length) return [];
  const cles = rows[0].map(x => x.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(cles.map((k, i) => [k, (r[i] ?? '').trim()])));
}
export function telechargerTexte(nom, contenu, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nom });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
