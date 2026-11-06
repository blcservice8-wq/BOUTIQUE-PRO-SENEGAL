import { db } from '../database/db.js';
import * as ops from '../services/ops.js';
import { dettesFournisseurs } from '../services/rapports.js';
import { $, $$, esc, toast, erreurUtilisateur, modal, entier, decimal } from '../ui.js';
import { fcfa, qte, dateFR, LIBELLE_MODE } from '../utils/format.js';

export async function afficher(vue) {
  vue.innerHTML = `<div class="onglets"><button data-t="cmd" aria-pressed="true">Commandes</button><button data-t="fac" aria-pressed="false">Factures & dettes</button><button data-t="four" aria-pressed="false">Fournisseurs</button></div><div id="z"></div>`;
  const z = $('#z', vue), T = { cmd, fac, four };
  $$('.onglets button', vue).forEach(b => b.onclick = () => { $$('.onglets button', vue).forEach(x => x.setAttribute('aria-pressed', x === b)); T[b.dataset.t](z); });
  cmd(z);
}

async function cmd(z) {
  const [achats, four] = [(await db.achats.toArray()).sort((a, b) => b.commande_le.localeCompare(a.commande_le)), new Map((await db.fournisseurs.toArray()).map(f => [f.id, f.nom]))];
  const ST = { commande: ['warn', 'Commandée'], recu_partiel: ['warn', 'Reçue partiellement'], recu: ['ok', 'Reçue'], annule: ['err', 'Annulée'] };
  z.innerHTML = `<div class="flex"><button class="btn p" id="nv">+ Nouvelle commande</button></div><div class="carte mt"><p class="mini">Une commande n'augmente pas le stock : seule la réception le fait, selon les quantités réellement reçues.</p><div class="table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Fournisseur</th><th class="n">Total</th><th>Statut</th><th></th></tr></thead><tbody>${achats.map(a => `<tr><td>${esc(a.numero)}</td><td>${dateFR(a.commande_le)}</td><td>${esc(four.get(a.fournisseur_id))}</td><td class="n">${fcfa(a.total)}</td><td><span class="badge ${ST[a.statut][0]}">${ST[a.statut][1]}</span></td><td class="flex">${['commande', 'recu_partiel'].includes(a.statut) ? `<button class="btn s p" data-r="${a.id}">Réceptionner</button>` : ''}<button class="btn s" data-f="${a.id}">Facture</button></td></tr>`).join('') || '<tr><td colspan="6" class="vide">Aucune commande</td></tr>'}</tbody></table></div></div>`;
  $('#nv', z).onclick = () => nouvelle(() => cmd(z));
  $$('[data-r]', z).forEach(b => b.onclick = () => reception(b.dataset.r, () => cmd(z)));
  $$('[data-f]', z).forEach(b => b.onclick = () => facture(b.dataset.f, () => cmd(z)));
}

async function nouvelle(apres) {
  const fo = (await db.fournisseurs.toArray()).filter(f => !f.supprime_le), pr = (await db.produits.toArray()).filter(p => !p.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (!fo.length) return toast('Créez d\'abord un fournisseur', 'err');
  if (!pr.length) return toast('Créez d\'abord des produits', 'err');
  const lignes = [];
  modal({ titre: 'Nouvelle commande', corps: `<div class="champ"><label for="cf">Fournisseur</label><select id="cf">${fo.map(f => `<option value="${f.id}">${esc(f.nom)}</option>`).join('')}</select></div>
    <div class="ligne"><div class="champ"><label for="cp">Produit</label><select id="cp">${pr.map(p => `<option value="${p.id}" data-pa="${p.prix_achat}">${esc(p.nom)}</option>`).join('')}</select></div><div class="champ"><label for="cq">Quantité</label><input id="cq" inputmode="decimal" value="1"></div><div class="champ"><label for="cx">Prix d'achat unitaire</label><input id="cx" inputmode="numeric"></div><div class="fixe"><button class="btn" id="ca" type="button">Ajouter</button></div></div>
    <div id="cl"></div><div class="total-gros" id="ct"></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer la commande', classe: 'p', ferme: false, action: async (ov, f) => { await ops.creerAchat({ fournisseur_id: $('#cf', ov).value, lignes }); f(); toast('Commande enregistrée', 'ok'); apres(); } }],
    onMount: ov => {
      const px = () => { $('#cx', ov).value = $('#cp', ov).selectedOptions[0].dataset.pa; }; px(); $('#cp', ov).onchange = px;
      const dessiner = () => { $('#cl', ov).innerHTML = lignes.map((l, i) => `<div class="flex"><span class="espace">${esc(pr.find(p => p.id === l.produit_id).nom)} × ${qte(l.quantite_commandee)} à ${fcfa(l.prix_achat_unitaire)}</span><button class="btn s" data-x="${i}">✕</button></div>`).join(''); $('#ct', ov).textContent = fcfa(lignes.reduce((s, l) => s + Math.round(l.quantite_commandee * l.prix_achat_unitaire), 0)); $$('[data-x]', ov).forEach(b => b.onclick = () => { lignes.splice(b.dataset.x, 1); dessiner(); }); };
      $('#ca', ov).onclick = () => { try { const q = decimal($('#cq', ov).value), x = entier($('#cx', ov).value); if (!(q > 0) || x < 0) throw new Error('Quantité ou prix invalide'); lignes.push({ produit_id: $('#cp', ov).value, quantite_commandee: q, prix_achat_unitaire: x }); dessiner(); } catch (e) { erreurUtilisateur(e); } };
    } });
}

async function reception(id, apres) {
  const a = await db.achats.get(id), ls = await db.lignes_achat.where('achat_id').equals(id).toArray(), pr = new Map((await db.produits.toArray()).map(p => [p.id, p]));
  modal({ titre: `Réception ${a.numero}`, corps: `<p class="mini">Saisissez les quantités réellement reçues (le reste pourra être reçu plus tard).</p><div class="table-wrap"><table><thead><tr><th>Produit</th><th class="n">Commandé</th><th class="n">Déjà reçu</th><th>Reçu maintenant</th><th>Péremption</th></tr></thead><tbody>${ls.map(l => `<tr><td>${esc(pr.get(l.produit_id)?.nom)}</td><td class="n">${qte(l.quantite_commandee)}</td><td class="n">${qte(l.quantite_recue)}</td><td><input data-q="${l.id}" inputmode="decimal" value="${l.quantite_commandee - l.quantite_recue}" style="width:90px;min-height:40px"></td><td><input data-p="${l.id}" type="date" style="min-height:40px"></td></tr>`).join('')}</tbody></table></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Valider la réception', classe: 'p', ferme: false, action: async (ov, f) => { await ops.receptionnerAchat(id, ls.map(l => ({ ligne_id: l.id, quantite_recue: $(`[data-q="${l.id}"]`, ov).value.trim() ? decimal($(`[data-q="${l.id}"]`, ov).value) : 0, date_peremption: $(`[data-p="${l.id}"]`, ov).value || null }))); f(); toast('Marchandise réceptionnée, stock mis à jour', 'ok'); apres(); } }] });
}

async function facture(achatId, apres) {
  const a = await db.achats.get(achatId);
  modal({ titre: `Facture fournisseur · ${a.numero}`, corps: `<div class="ligne"><div class="champ"><label for="fn">N° de facture</label><input id="fn" maxlength="40"></div><div class="champ"><label for="fm">Montant (FCFA)</label><input id="fm" inputmode="numeric" value="${a.total}"></div><div class="champ"><label for="fe">Échéance</label><input id="fe" type="date"></div></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, f) => { await ops.enregistrerFacture({ achat_id: achatId, fournisseur_id: a.fournisseur_id, numero: $('#fn', ov).value, montant: entier($('#fm', ov).value), echeance: $('#fe', ov).value || null }); f(); toast('Facture enregistrée', 'ok'); apres(); } }] });
}

async function fac(z) {
  const d = await dettesFournisseurs();
  z.innerHTML = `<div class="kpi"><small>Dettes fournisseurs</small><b>${fcfa(d.total)}</b></div><div class="carte mt"><div class="table-wrap"><table><thead><tr><th>Fournisseur</th><th>Facture</th><th>Échéance</th><th class="n">Reste dû</th><th></th></tr></thead><tbody>${d.lignes.map(l => { const retard = l.facture.echeance && Date.parse(l.facture.echeance) < Date.now(); return `<tr><td>${esc(l.fournisseur?.nom)}</td><td>${esc(l.facture.numero)}</td><td>${l.facture.echeance ? `<span class="badge ${retard ? 'err' : ''}">${dateFR(l.facture.echeance)}</span>` : ''}</td><td class="n">${fcfa(l.reste)}</td><td><button class="btn s p" data-p="${l.facture.id}" data-r="${l.reste}">Payer</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="vide">Aucune dette</td></tr>'}</tbody></table></div></div>`;
  $$('[data-p]', z).forEach(b => b.onclick = () => modal({ titre: 'Paiement fournisseur', corps: `<div class="ligne"><div class="champ"><label for="pm">Montant (reste ${fcfa(b.dataset.r)})</label><input id="pm" inputmode="numeric" value="${b.dataset.r}"></div><div class="champ"><label for="pmo">Mode</label><select id="pmo">${['especes', 'wave', 'orange_money', 'autre_mobile'].map(m => `<option value="${m}">${LIBELLE_MODE[m]}</option>`).join('')}</select></div></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Payer', classe: 'p', ferme: false, action: async (ov, f) => { await ops.payerFournisseur({ facture_id: b.dataset.p, montant: entier($('#pm', ov).value), mode: $('#pmo', ov).value }); f(); toast('Paiement enregistré', 'ok'); fac(z); } }] }));
}

async function four(z) {
  const l = (await db.fournisseurs.toArray()).filter(f => !f.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  z.innerHTML = `<div class="flex"><button class="btn p" id="nf">+ Fournisseur</button></div><div class="carte mt"><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Téléphone</th><th>Adresse</th><th></th></tr></thead><tbody>${l.map(f => `<tr><td>${esc(f.nom)}</td><td>${esc(f.telephone)}</td><td>${esc(f.adresse)}</td><td><button class="btn s" data-e="${f.id}">Modifier</button></td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucun fournisseur</td></tr>'}</tbody></table></div></div>`;
  const form = (f = {}) => modal({ titre: f.id ? 'Modifier le fournisseur' : 'Nouveau fournisseur', corps: `<div class="champ"><label for="n">Nom *</label><input id="n" value="${esc(f.nom)}" maxlength="80"></div><div class="champ"><label for="t">Téléphone</label><input id="t" inputmode="tel" value="${esc(f.telephone)}"></div><div class="champ"><label for="a">Adresse</label><input id="a" value="${esc(f.adresse)}"></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, c) => { await ops.sauverFournisseur({ ...f, nom: $('#n', ov).value, telephone: $('#t', ov).value, adresse: $('#a', ov).value }); c(); toast('Fournisseur enregistré', 'ok'); four(z); } }] });
  $('#nf', z).onclick = () => form(); $$('[data-e]', z).forEach(b => b.onclick = () => form(l.find(f => f.id === b.dataset.e)));
}
