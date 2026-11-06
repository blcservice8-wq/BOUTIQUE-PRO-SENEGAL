import { rapport, periode, TYPES_RAPPORT } from '../services/rapports.js';
import { versCSV, telechargerTexte } from '../utils/csv.js';
import { getMeta } from '../database/db.js';
import { $, $$, esc, erreurUtilisateur, imprimerHTML } from '../ui.js';
import { fcfa, nombre, qte, dateFR, dateHeureFR } from '../utils/format.js';

const FMT = { fcfa, qte, date: dateFR, dateheure: dateHeureFR };
const aujourdhui = () => new Date().toISOString().slice(0, 10);

export async function afficher(vue) {
  const d = new Date(); const premier = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  vue.innerHTML = `<div class="carte no-print"><div class="ligne"><div><label for="rt">Rapport</label><select id="rt">${Object.entries(TYPES_RAPPORT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div><label for="rp">Période</label><select id="rp"><option value="jour">Aujourd'hui</option><option value="semaine">Cette semaine</option><option value="mois" selected>Ce mois</option><option value="annee">Cette année</option><option value="perso">Personnalisée</option></select></div>
    <div class="perso" hidden><label for="rd">Du</label><input id="rd" type="date" value="${premier}"></div><div class="perso" hidden><label for="rf">Au</label><input id="rf" type="date" value="${aujourdhui()}"></div></div>
    <div class="flex mt"><button class="btn p" id="go">Afficher</button><button class="btn" id="imp">🖨 Imprimer / PDF</button><button class="btn" id="csv">Exporter CSV</button></div></div><div class="carte" id="res"></div>`;
  let courant = null;
  const periodeChoisie = () => { const t = $('#rp', vue).value; if (t !== 'perso') return periode(t); const a = new Date($('#rd', vue).value + 'T00:00:00'), b = new Date($('#rf', vue).value + 'T00:00:00'); if (isNaN(a) || isNaN(b) || b < a) throw new Error('Période invalide'); return [a, new Date(b.getTime() + 864e5)]; };
  const cellule = (c, l) => { const v = l[c.cle]; return v == null || v === '' ? '' : c.fmt ? FMT[c.fmt](v) : esc(v); };
  const generer = async () => {
    try {
      const p = periodeChoisie(); courant = await rapport($('#rt', vue).value, p);
      $('#res', vue).innerHTML = `<h2>${esc(courant.titre)}</h2><p class="mini">Du ${dateFR(p[0])} au ${dateFR(new Date(p[1] - 1))} · ${courant.lignes.length} ligne(s)</p><div class="table-wrap"><table><thead><tr>${courant.colonnes.map(c => `<th class="${c.fmt === 'fcfa' || c.fmt === 'qte' ? 'n' : ''}">${esc(c.titre)}</th>`).join('')}</tr></thead>
        <tbody>${courant.lignes.map(l => `<tr>${courant.colonnes.map(c => `<td class="${c.fmt === 'fcfa' || c.fmt === 'qte' ? 'n' : ''}">${cellule(c, l)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${courant.colonnes.length}" class="vide">Aucune donnée sur cette période</td></tr>`}</tbody>
        ${courant.totaux ? `<tfoot><tr>${courant.colonnes.map((c, i) => `<td class="${c.fmt === 'fcfa' || c.fmt === 'qte' ? 'n' : ''}">${i === 0 && !(c.cle in courant.totaux) ? 'TOTAL' : c.cle in courant.totaux ? FMT[c.fmt || 'fcfa'](courant.totaux[c.cle]) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>
        ${$('#rt', vue).value === 'marges' ? '<p class="mini">Ces montants sont des estimations de gestion calculées à partir des prix d\'achat enregistrés. Ils ne constituent pas un résultat comptable certifié.</p>' : ''}`;
    } catch (e) { erreurUtilisateur(e); }
  };
  $('#rp', vue).onchange = () => $$('.perso', vue).forEach(e => e.hidden = $('#rp', vue).value !== 'perso');
  $('#go', vue).onclick = generer;
  $('#csv', vue).onclick = async () => { if (!courant) await generer(); if (!courant) return; telechargerTexte(`${$('#rt', vue).value}-${aujourdhui()}.csv`, versCSV(courant.lignes, courant.colonnes.map(c => ({ titre: c.titre, val: l => { const v = l[c.cle]; return c.fmt === 'date' ? (v || '').slice(0, 10) : c.fmt === 'dateheure' ? (v || '') : (v ?? ''); } })))); };
  $('#imp', vue).onclick = async () => { if (!courant) await generer(); if (!courant) return; const b = (await getMeta('boutique')) || {};
    imprimerHTML(`<h1>${esc(b.nom || '')}</h1><h2>${esc(courant.titre)}</h2><div class="c">Édité le ${dateHeureFR(new Date().toISOString())}</div><hr>${$('#res table', vue).outerHTML}`, courant.titre, '190mm'); };
  generer();
}
