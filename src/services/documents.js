// Tickets, reçus et relevés imprimables (HTML simple, compatible imprimante thermique 80 mm ou A4).
import { db, getMeta } from '../database/db.js';
import { esc, fcfa, qte, dateHeureFR, dateFR, LIBELLE_MODE } from '../utils/format.js';

async function entete() {
  const b = (await getMeta('boutique')) || {};
  return { b, html: `<h1>${esc(b.nom || '')}</h1>${b.adresse ? `<div class="c">${esc(b.adresse)}</div>` : ''}${b.telephone ? `<div class="c">Tél : ${esc(b.telephone)}</div>` : ''}<hr>` };
}
export async function ticketVente(venteId) {
  const v = await db.ventes.get(venteId); if (!v) throw new Error('Vente introuvable');
  const lignes = await db.lignes_vente.where('vente_id').equals(venteId).toArray();
  const pays = await db.paiements_vente.where('vente_id').equals(venteId).toArray();
  const client = v.client_id ? await db.clients.get(v.client_id) : null, { b, html } = await entete();
  return `${html}<div>Ticket : <b>${esc(v.numero)}</b></div><div>${dateHeureFR(v.vendu_le)}</div>${client ? `<div>Client : ${esc(client.nom)}</div>` : ''}${v.statut === 'annule' ? '<h2>*** ANNULÉ ***</h2>' : ''}<hr>
  <table>${lignes.map(l => `<tr><td colspan="2">${esc(l.designation)}</td></tr><tr><td>${qte(l.quantite)} × ${fcfa(l.prix_unitaire)}${l.remise_ligne ? ` (−${fcfa(l.remise_ligne)})` : ''}</td><td class="n">${fcfa(l.total_ligne)}</td></tr>`).join('')}</table><hr>
  <table>${v.remise ? `<tr><td>Remise</td><td class="n">−${fcfa(v.remise)}</td></tr>` : ''}<tr class="g t"><td>TOTAL</td><td class="n">${fcfa(v.total)}</td></tr>
  ${pays.map(p => `<tr><td>${esc(LIBELLE_MODE[p.mode])}</td><td class="n">${fcfa(p.montant)}</td></tr>`).join('')}
  ${v.reste_a_payer ? `<tr class="g"><td>Reste à payer (crédit)</td><td class="n">${fcfa(v.reste_a_payer)}</td></tr>` : ''}</table><hr><div class="c">${esc(b.pied_ticket || 'Merci de votre visite !')}</div>`;
}
export async function recuPaiement(clientId, montant, mode, soldeApres) {
  const c = await db.clients.get(clientId), { html } = await entete();
  return `${html}<h2>REÇU DE PAIEMENT</h2><div>${dateHeureFR(new Date().toISOString())}</div><div>Client : <b>${esc(c.nom)}</b></div><hr>
  <table><tr><td>Montant reçu (${esc(LIBELLE_MODE[mode])})</td><td class="n g">${fcfa(montant)}</td></tr><tr><td>Reste dû</td><td class="n">${fcfa(soldeApres)}</td></tr></table><hr><div class="c">Merci</div>`;
}
export async function releveClient(clientId) {
  const c = await db.clients.get(clientId), { html } = await entete();
  const credits = (await db.credits_clients.where('client_id').equals(clientId).toArray()).filter(x => x.statut !== 'annule');
  const remb = await db.remboursements_clients.where('client_id').equals(clientId).toArray();
  const ventes = new Map((await db.ventes.toArray()).map(v => [v.id, v]));
  const mouv = [...credits.map(x => ({ d: x.cree_le, lib: `Achat à crédit ${ventes.get(x.vente_id)?.numero || ''}`, debit: x.montant_initial, credit: 0 })),
    ...remb.map(r => ({ d: r.rembourse_le, lib: `Remboursement (${LIBELLE_MODE[r.mode]})`, debit: 0, credit: r.montant }))].sort((a, b) => (a.d || '').localeCompare(b.d || ''));
  let s = 0;
  return `${html}<h2>RELEVÉ DE COMPTE</h2><div>Client : <b>${esc(c.nom)}</b> ${c.telephone ? '· ' + esc(c.telephone) : ''}</div><div>Édité le ${dateFR(new Date().toISOString())}</div><hr>
  <table><tr><th>Date</th><th>Opération</th><th class="n">Dû</th><th class="n">Payé</th><th class="n">Solde</th></tr>
  ${mouv.map(m => { s += m.debit - m.credit; return `<tr><td>${dateFR(m.d)}</td><td>${esc(m.lib)}</td><td class="n">${m.debit ? fcfa(m.debit) : ''}</td><td class="n">${m.credit ? fcfa(m.credit) : ''}</td><td class="n">${fcfa(s)}</td></tr>`; }).join('')}</table><hr>
  <table><tr class="g t"><td>SOLDE À PAYER</td><td class="n">${fcfa(s)}</td></tr></table>`;
}
export async function rapportCaisseHTML(caisseId) {
  const c = await db.caisses.get(caisseId), { html } = await entete();
  const mv = await db.mouvements_caisse.where('caisse_id').equals(caisseId).toArray();
  const LIB = { fonds_initial: 'Fonds initial', vente_especes: 'Ventes en espèces', remboursement_credit: 'Remboursements de crédit', depense: 'Dépenses', retrait: 'Retraits', apport: 'Apports', paiement_fournisseur: 'Paiements fournisseurs', annulation_vente: 'Annulations de ventes' };
  const par = new Map(); for (const m of mv) par.set(m.type, (par.get(m.type) || 0) + m.sens * m.montant);
  const theo = mv.reduce((s, m) => s + m.sens * m.montant, 0);
  return `${html}<h2>RAPPORT DE CAISSE</h2><div>Ouverte : ${dateHeureFR(c.ouverte_le)}</div>${c.fermee_le ? `<div>Fermée : ${dateHeureFR(c.fermee_le)}</div>` : ''}<hr>
  <table>${[...par].map(([k, v]) => `<tr><td>${LIB[k] || k}</td><td class="n">${fcfa(v)}</td></tr>`).join('')}<tr class="g"><td>Solde théorique</td><td class="n">${fcfa(theo)}</td></tr>
  ${c.montant_compte != null ? `<tr><td>Montant compté</td><td class="n">${fcfa(c.montant_compte)}</td></tr><tr class="g"><td>Écart</td><td class="n">${fcfa(c.ecart)}</td></tr>` : ''}</table>
  <hr><div class="mini">Les ventes à crédit et paiements mobiles ne sont pas des espèces en caisse.</div>`;
}
