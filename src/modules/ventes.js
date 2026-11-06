import { db } from '../database/db.js';
import * as ops from '../services/ops.js';
import { stocksAffiches } from '../services/stock.js';
import { peut } from '../services/session.js';
import { ticketVente } from '../services/documents.js';
import { totalVente, totalLigne, quantiteValide } from '../services/calculs.js';
import { uuid } from '../utils/id.js';
import { $, $$, esc, toast, erreurUtilisateur, agir, modal, confirmer, saisie, imprimerHTML, entier, decimal } from '../ui.js';
import { fcfa, qte, nombre, dateHeureFR, LIBELLE_MODE, LIBELLE_UNITE, UNITES_DECIMALES } from '../utils/format.js';

let panier = null;
const nouveauPanier = () => ({ id: uuid(), lignes: [], client_id: null, remise: 0 });

export async function afficher(vue) {
  if (!panier) panier = nouveauPanier();
  vue.innerHTML = `<div class="onglets" role="tablist"><button aria-pressed="true" data-t="pos">Nouvelle vente</button><button aria-pressed="false" data-t="hist">Historique</button></div><div id="zone"></div>`;
  $$('.onglets button', vue).forEach(b => b.onclick = () => { $$('.onglets button', vue).forEach(x => x.setAttribute('aria-pressed', x === b)); b.dataset.t === 'pos' ? afficherPOS($('#zone', vue)) : afficherHistorique($('#zone', vue)); });
  afficherPOS($('#zone', vue));
}

async function afficherPOS(zone) {
  const [produits, stocks, caisse] = await Promise.all([db.produits.toArray(), stocksAffiches(), ops.caisseOuverte()]);
  const actifs = produits.filter(p => !p.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  zone.innerHTML = `${caisse ? '' : `<div class="alerte">Caisse fermée : les ventes sont enregistrées mais les espèces ne sont pas suivies. <button class="btn s" id="ouvrir-caisse">Ouvrir la caisse</button></div>`}
  <div class="pos"><section class="carte"><div class="champ"><label for="rech">Rechercher un produit ou scanner un code-barres</label><input id="rech" type="search" autocomplete="off" inputmode="search" placeholder="Nom, référence, code-barres…"></div>
    <div class="produits-grille" id="grille"></div></section>
  <section class="carte panier-carte"><h3>Panier</h3><div id="panier"></div></section></div>`;
  $('#ouvrir-caisse', zone)?.addEventListener('click', async e => { const f = await saisie('Ouverture de caisse', 'Fonds initial (FCFA)', { type: 'number', valeur: '0' }); if (f !== null) { try { await ops.ouvrirCaisse(entier(f || 0)); toast('Caisse ouverte', 'ok'); afficherPOS(zone); } catch (x) { erreurUtilisateur(x); } } });

  const grille = $('#grille', zone);
  const dessinerGrille = () => {
    const t = $('#rech', zone).value.trim().toLowerCase();
    const liste = (t ? actifs.filter(p => [p.nom, p.reference, p.code_barres].some(x => (x || '').toLowerCase().includes(t))) : actifs).slice(0, 80);
    grille.innerHTML = liste.length ? liste.map(p => { const s = stocks.get(p.id) || 0; return `<button class="tuile ${s <= 0 && !p.autoriser_stock_negatif ? 'rupture' : ''}" data-id="${p.id}"><b>${esc(p.nom)}</b><span>${fcfa(p.prix_vente)} / ${LIBELLE_UNITE[p.unite]}</span><span>Stock : ${qte(s)}</span></button>`; }).join('') : '<div class="vide">Aucun produit trouvé</div>';
  };
  dessinerGrille();
  $('#rech', zone).addEventListener('input', dessinerGrille);
  $('#rech', zone).addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; const t = e.target.value.trim(); if (!t) return;
    const p = actifs.find(x => x.code_barres === t || x.reference.toLowerCase() === t.toLowerCase()) || (actifs.filter(x => x.nom.toLowerCase().includes(t.toLowerCase())).length === 1 ? actifs.find(x => x.nom.toLowerCase().includes(t.toLowerCase())) : null);
    if (p) { ajouter(p); e.target.value = ''; dessinerGrille(); } else toast('Aucun produit unique trouvé', 'err');
  });
  grille.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) ajouter(actifs.find(p => p.id === b.dataset.id)); });

  function ajouter(p) {
    const l = panier.lignes.find(x => x.produit_id === p.id);
    const pas = UNITES_DECIMALES.has(p.unite) ? 0.5 : 1;
    if (l) l.quantite = Math.round((l.quantite + pas) * 1000) / 1000; else panier.lignes.push({ produit_id: p.id, nom: p.nom, unite: p.unite, quantite: pas === 0.5 ? 1 : 1, prix_unitaire: p.prix_vente, remise_ligne: 0 });
    dessinerPanier();
  }

  const zp = $('#panier', zone);
  function dessinerPanier() {
    let tot = { sousTotal: 0, remise: 0, total: 0 }, err = '';
    try { tot = totalVente(panier.lignes, panier.remise); } catch (e) { err = e.message; }
    zp.innerHTML = panier.lignes.length ? `${panier.lignes.map((l, i) => `<div class="panier-ligne"><div><b>${esc(l.nom)}</b><div class="mini">${fcfa(l.prix_unitaire)} / ${LIBELLE_UNITE[l.unite]} ${peut('gerant') || peut('forcer_stock') ? `· <a href="#" data-prix="${i}">modifier le prix</a>` : ''}</div></div>
      <div class="qte-ctl"><button data-moins="${i}" aria-label="Moins">−</button><input data-q="${i}" value="${l.quantite}" inputmode="decimal" aria-label="Quantité"><button data-plus="${i}" aria-label="Plus">+</button></div>
      <div class="mini">Total ligne</div><div class="droite"><b>${fcfa(totalLigne(l.quantite, l.prix_unitaire, l.remise_ligne))}</b> <button class="btn s" data-sup="${i}" aria-label="Retirer">🗑</button></div></div>`).join('')}
      <div class="ligne mt"><div><label for="remise">Remise (FCFA)</label><input id="remise" inputmode="numeric" value="${panier.remise || ''}" placeholder="0"></div></div>
      ${err ? `<div class="alerte err">${esc(err)}</div>` : ''}
      <div class="mini droite mt">Sous-total ${fcfa(tot.sousTotal)}${tot.remise ? ` − remise ${fcfa(tot.remise)}` : ''}</div><div class="total-gros" id="total">${fcfa(tot.total)}</div>
      <div class="flex mt"><button class="btn gros p" id="encaisser" ${err ? 'disabled' : ''}>Encaisser</button></div><button class="btn s mt" id="vider">Vider le panier</button>` : '<div class="vide">Touchez un produit pour l\'ajouter</div>';
    $$('[data-moins]', zp).forEach(b => b.onclick = () => { const l = panier.lignes[b.dataset.moins], pas = UNITES_DECIMALES.has(l.unite) ? 0.5 : 1; l.quantite = Math.round((l.quantite - pas) * 1000) / 1000; if (l.quantite <= 0) panier.lignes.splice(b.dataset.moins, 1); dessinerPanier(); });
    $$('[data-plus]', zp).forEach(b => b.onclick = () => { const l = panier.lignes[b.dataset.plus], pas = UNITES_DECIMALES.has(l.unite) ? 0.5 : 1; l.quantite = Math.round((l.quantite + pas) * 1000) / 1000; dessinerPanier(); });
    $$('[data-q]', zp).forEach(inp => inp.onchange = () => { const l = panier.lignes[inp.dataset.q]; try { const q = decimal(inp.value); if (!quantiteValide(q, l.unite)) throw new Error(`Quantité invalide (${LIBELLE_UNITE[l.unite]}${UNITES_DECIMALES.has(l.unite) ? '' : ' : nombre entier'})`); l.quantite = q; } catch (e) { toast(e.message, 'err'); } dessinerPanier(); });
    $$('[data-sup]', zp).forEach(b => b.onclick = () => { panier.lignes.splice(b.dataset.sup, 1); dessinerPanier(); });
    $$('[data-prix]', zp).forEach(a => a.onclick = async e => { e.preventDefault(); const l = panier.lignes[a.dataset.prix]; const v = await saisie('Prix unitaire', 'Nouveau prix (FCFA)', { type: 'number', valeur: l.prix_unitaire }); if (v !== null) { try { const n = entier(v); if (n < 0) throw new Error('Prix invalide'); l.prix_unitaire = n; } catch (x) { toast(x.message, 'err'); } dessinerPanier(); } });
    $('#remise', zp)?.addEventListener('change', e => { try { panier.remise = e.target.value ? entier(e.target.value) : 0; } catch { panier.remise = 0; } dessinerPanier(); });
    $('#vider', zp)?.addEventListener('click', async () => { if (await confirmer('Vider le panier ?')) { panier = nouveauPanier(); dessinerPanier(); } });
    $('#encaisser', zp)?.addEventListener('click', () => ouvrirPaiement(tot.total, () => { panier = nouveauPanier(); afficherPOS(zone); }));
  }
  dessinerPanier();
}

async function ouvrirPaiement(total, apres) {
  const clients = (await db.clients.toArray()).filter(c => !c.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const MODES = ['especes', 'wave', 'orange_money', 'autre_mobile'];
  modal({ titre: 'Encaissement', corps: `<div class="total-gros">${fcfa(total)}</div>
    <p class="mini">Saisissez ce que le client paie. Le reste devient un crédit. Les paiements mobiles sont enregistrés manuellement : vérifiez la réception sur le téléphone.</p>
    <div class="modes">${MODES.map(m => `<div class="champ"><label for="p-${m}">${LIBELLE_MODE[m]}</label><input id="p-${m}" data-m="${m}" inputmode="numeric" placeholder="0"></div>`).join('')}</div>
    <div class="flex"><button class="btn s" id="tout-esp">Tout en espèces</button></div>
    <div class="champ mt" id="ref-box" hidden><label for="ref">Référence de transaction mobile (facultatif)</label><input id="ref" maxlength="40"></div>
    <div id="synthese" class="mt"></div>
    <div id="credit-box" hidden><div class="champ"><label for="cl">Client (obligatoire pour un crédit)</label><select id="cl"><option value="">— Choisir —</option>${clients.map(c => `<option value="${c.id}">${esc(c.nom)}${c.telephone ? ' · ' + esc(c.telephone) : ''}</option>`).join('')}</select></div>
    <div class="champ"><label for="ech">Échéance de paiement</label><input id="ech" type="date"></div></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Valider la vente', classe: 'p', ferme: false, action: async (ov, fermer) => {
      const paiements = $$('[data-m]', ov).filter(i => i.value.trim()).map(i => ({ mode: i.dataset.m, montant: entier(i.value), reference_externe: i.dataset.m !== 'especes' ? ($('#ref', ov).value.trim() || null) : null })).filter(p => p.montant > 0);
      const r = await ops.enregistrerVente({ id: panier.id, lignes: panier.lignes.map(l => ({ produit_id: l.produit_id, quantite: l.quantite, prix_unitaire: l.prix_unitaire, remise_ligne: l.remise_ligne })),
        remise: panier.remise, client_id: $('#cl', ov).value || null, echeance: $('#ech', ov).value || null, paiements });
      fermer(); toast(r.doublon ? 'Vente déjà enregistrée' : `Vente ${r.vente.numero} enregistrée`, 'ok'); await apresVente(r.vente.id); apres();
    } }],
    onMount: ov => {
      const maj = () => {
        let paye = 0; try { paye = $$('[data-m]', ov).reduce((s, i) => s + (i.value.trim() ? entier(i.value) : 0), 0); } catch { }
        const reste = total - paye; $('#credit-box', ov).hidden = reste <= 0;
        $('#ref-box', ov).hidden = !$$('[data-m]', ov).some(i => i.dataset.m !== 'especes' && i.value.trim());
        $('#synthese', ov).innerHTML = paye > total ? `<div class="alerte err">Paiements supérieurs au total de ${fcfa(paye - total)}</div>` : reste > 0 ? `<div class="alerte">Reste à payer (crédit) : <b>${fcfa(reste)}</b></div>` : `<div class="alerte ok">Total réglé</div>`;
      };
      $$('[data-m]', ov).forEach(i => i.addEventListener('input', maj)); $('#tout-esp', ov).onclick = () => { $$('[data-m]', ov).forEach(i => i.value = ''); $('#p-especes', ov).value = total; maj(); };
      $('#p-especes', ov).value = total; maj();
    } });
}

async function apresVente(id) {
  modal({ titre: 'Vente enregistrée', corps: '<p>Imprimer le ticket ?</p>', boutons: [{ texte: 'Non' }, { texte: '🖨 Imprimer le ticket', classe: 'p', action: async () => imprimerHTML(await ticketVente(id), 'Ticket', '76mm') }] });
}

async function afficherHistorique(zone) {
  const ventes = (await db.ventes.toArray()).sort((a, b) => b.vendu_le.localeCompare(a.vendu_le)).slice(0, 300);
  const clients = new Map((await db.clients.toArray()).map(c => [c.id, c.nom]));
  zone.innerHTML = `<div class="carte"><div class="champ"><input id="hf" type="search" placeholder="Filtrer par n° ou client"></div><div class="table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Client</th><th class="n">Total</th><th class="n">Reste</th><th>Statut</th><th></th></tr></thead><tbody id="hb"></tbody></table></div></div>`;
  const dessiner = () => {
    const t = $('#hf', zone).value.toLowerCase();
    const l = ventes.filter(v => !t || v.numero.toLowerCase().includes(t) || (clients.get(v.client_id) || '').toLowerCase().includes(t));
    $('#hb', zone).innerHTML = l.length ? l.map(v => `<tr><td>${esc(v.numero)}</td><td>${dateHeureFR(v.vendu_le)}</td><td>${esc(clients.get(v.client_id) || '')}</td><td class="n">${fcfa(v.total)}</td><td class="n">${v.reste_a_payer ? fcfa(v.reste_a_payer) : ''}</td><td><span class="badge ${v.statut === 'annule' ? 'err' : 'ok'}">${v.statut === 'annule' ? 'Annulée' : 'Valide'}</span></td>
      <td class="flex"><button class="btn s" data-print="${v.id}">🖨</button>${peut('annuler_vente') && v.statut === 'valide' ? `<button class="btn s d" data-ann="${v.id}">Annuler</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="vide">Aucune vente</td></tr>';
    $$('[data-print]', zone).forEach(b => b.onclick = agir(b, async () => imprimerHTML(await ticketVente(b.dataset.print), 'Ticket', '76mm')));
    $$('[data-ann]', zone).forEach(b => b.onclick = async () => { const m = await saisie('Annuler la vente', 'Motif (obligatoire)'); if (m === null) return; try { await ops.annulerVente(b.dataset.ann, m); toast('Vente annulée, stock réintégré', 'ok'); afficherHistorique(zone); } catch (e) { erreurUtilisateur(e); } });
  };
  $('#hf', zone).addEventListener('input', dessiner); dessiner();
}
