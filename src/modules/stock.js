import { db } from '../database/db.js';
import * as ops from '../services/ops.js';
import { etatStock, rapport, periode } from '../services/rapports.js';
import { stocksAffiches } from '../services/stock.js';
import { $, $$, esc, toast, erreurUtilisateur, modal, decimal } from '../ui.js';
import { fcfa, qte, dateFR, dateHeureFR } from '../utils/format.js';

const TYPES = { entree_diverse: 'Entrée (don, retour…)', sortie_diverse: 'Sortie (usage personnel…)', perte: 'Perte / vol', casse: 'Produit endommagé', peremption: 'Produit périmé retiré', ajustement: 'Correction (+/−)' };

export async function afficher(vue) {
  vue.innerHTML = `<div class="onglets"><button data-t="etat" aria-pressed="true">État du stock</button><button data-t="inv" aria-pressed="false">Inventaire physique</button><button data-t="hist" aria-pressed="false">Historique</button><button data-t="per" aria-pressed="false">Péremptions</button></div><div id="z"></div>`;
  const z = $('#z', vue);
  $$('.onglets button', vue).forEach(b => b.onclick = () => { $$('.onglets button', vue).forEach(x => x.setAttribute('aria-pressed', x === b)); ({ etat, inv, hist, per })[b.dataset.t](z); });
  etat(z);
}

async function etat(z) {
  const s = await etatStock(); const l = s.lignes.sort((a, b) => a.produit.nom.localeCompare(b.produit.nom, 'fr'));
  z.innerHTML = `<div class="grille g3"><div class="kpi"><small>Valeur du stock (prix d'achat)</small><b>${fcfa(s.valeur)}</b></div><div class="kpi"><small>Produits en alerte</small><b>${s.alertes.length}</b></div></div>
  <div class="carte mt"><div class="table-wrap"><table><thead><tr><th>Produit</th><th class="n">Stock</th><th class="n">Minimum</th><th class="n">Valeur</th><th>État</th><th></th></tr></thead><tbody>${l.map(x => `<tr><td>${esc(x.produit.nom)}</td><td class="n">${qte(x.stock)}</td><td class="n">${qte(x.produit.stock_min)}</td><td class="n">${fcfa(Math.max(0, x.stock) * x.produit.prix_achat)}</td><td><span class="badge ${x.statut === 'ok' ? 'ok' : x.statut === 'bas' ? 'warn' : 'err'}">${x.statut === 'ok' ? 'OK' : x.statut === 'bas' ? 'Bas' : x.stock < 0 ? 'Négatif' : 'Rupture'}</span></td><td><button class="btn s" data-aj="${x.produit.id}">Mouvement</button></td></tr>`).join('') || '<tr><td colspan="6" class="vide">Aucun produit</td></tr>'}</tbody></table></div></div>`;
  $$('[data-aj]', z).forEach(b => b.onclick = () => mouvement(b.dataset.aj, () => etat(z)));
}

async function mouvement(pid, apres) {
  const p = await db.produits.get(pid);
  modal({ titre: `Mouvement de stock · ${p.nom}`, corps: `<div class="champ"><label for="mt">Type</label><select id="mt">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="champ"><label for="mq">Quantité</label><input id="mq" inputmode="decimal"><p class="mini">Pour une correction, utilisez + ou − (ex. −3). Pour les autres types, le sens est automatique.</p></div><div class="champ"><label for="mm">Motif (obligatoire)</label><input id="mm" maxlength="120"></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, f) => { await ops.ajusterStock({ produit_id: pid, quantite: decimal($('#mq', ov).value), type: $('#mt', ov).value, motif: $('#mm', ov).value }); f(); toast('Mouvement enregistré', 'ok'); apres(); } }] });
}

async function inv(z) {
  const produits = (await db.produits.toArray()).filter(p => !p.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), stocks = await stocksAffiches();
  z.innerHTML = `<div class="carte"><p class="mini">Comptez le stock réel et saisissez-le. Seuls les produits renseignés sont ajustés ; chaque écart devient un mouvement tracé.</p><div class="table-wrap"><table><thead><tr><th>Produit</th><th class="n">Théorique</th><th>Compté</th><th class="n">Écart</th></tr></thead><tbody>${produits.map(p => `<tr><td>${esc(p.nom)}</td><td class="n">${qte(stocks.get(p.id) || 0)}</td><td><input data-c="${p.id}" inputmode="decimal" style="width:100px;min-height:40px"></td><td class="n" data-e="${p.id}"></td></tr>`).join('')}</tbody></table></div>
  <div class="champ mt"><label for="in">Notes</label><input id="in" maxlength="200"></div><button class="btn p" id="valider">Valider l'inventaire</button></div>`;
  $$('[data-c]', z).forEach(i => i.oninput = () => { const e = $(`[data-e="${i.dataset.c}"]`, z); if (!i.value.trim()) { e.textContent = ''; return; } try { const d = decimal(i.value) - (stocks.get(i.dataset.c) || 0); e.textContent = (d > 0 ? '+' : '') + qte(d); e.style.color = d === 0 ? '' : d < 0 ? 'var(--err)' : 'var(--ok)'; } catch { e.textContent = '?'; } });
  $('#valider', z).onclick = async e => { e.target.disabled = true; try { const c = $$('[data-c]', z).filter(i => i.value.trim()).map(i => ({ produit_id: i.dataset.c, quantite_comptee: decimal(i.value) })); const r = await ops.faireInventaire(c, $('#in', z).value); toast(`Inventaire validé : ${r.lignes.filter(l => l.ecart_local).length} écart(s) régularisé(s)`, 'ok'); inv(z); } catch (x) { erreurUtilisateur(x); e.target.disabled = false; } };
}

async function hist(z) {
  const r = await rapport('mouvements', periode('mois'));
  z.innerHTML = `<div class="carte"><h3>Mouvements du mois</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Produit</th><th>Type</th><th class="n">Quantité</th><th>Motif</th></tr></thead><tbody>${r.lignes.slice().reverse().slice(0, 300).map(m => `<tr><td>${dateHeureFR(m.survenu_le)}</td><td>${esc(m.produit)}</td><td>${esc(m.type)}</td><td class="n">${m.quantite > 0 ? '+' : ''}${qte(m.quantite)}</td><td>${esc(m.motif || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="vide">Aucun mouvement</td></tr>'}</tbody></table></div></div>`;
}

async function per(z) {
  const s = await etatStock();
  const tab = (t, l) => `<div class="carte"><h3>${t} (${l.length})</h3>${l.length ? `<table><tbody>${l.map(p => `<tr><td>${esc(p.nom)}</td><td>${dateFR(p.date_peremption)}</td></tr>`).join('')}</tbody></table>` : '<p class="mini">Aucun.</p>'}</div>`;
  z.innerHTML = tab('Périmés', s.perimes) + tab('Expirent sous 30 jours', s.bientot) + '<p class="mini">Retirez un produit périmé via « Mouvement » → « Produit périmé retiré ».</p>';
}
