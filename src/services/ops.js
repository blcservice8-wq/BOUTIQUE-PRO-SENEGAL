// Commandes métier. Chaque commande : valide → écrit localement (IndexedDB) → met l'opération en file de synchronisation,
// le tout dans UNE transaction locale. Aucune dépendance réseau.
import { db, getMeta, setMeta } from '../database/db.js';
import { uuid, maintenant, jourCle } from '../utils/id.js';
import { garde, profil, appareil, codeAppareil } from './session.js';
import { stocksAffiches } from './stock.js';
import { totalVente, validerPaiements, totalLigne, quantiteValide, soldeCaisseTheorique, allouerRemboursement, arrondi } from './calculs.js';

export const evenement = (nom, detail) => globalThis.dispatchEvent?.(new CustomEvent(nom, { detail }));

async function contexte() {
  const p = profil(); if (!p) throw new Error('Session non ouverte');
  return { boutique_id: p.boutique_id, user_id: p.user_id, role: p.role, appareil_id: await appareil() };
}
const tx = fn => db.transaction('rw', db.tables, fn);

async function enfiler(ctx, type, payload, touche = []) {
  const seq = (await getMeta('seq_file', 0)) + 1; await setMeta('seq_file', seq);
  await db.file_sync.put({
    op_id: payload.id, kind: 'rpc', type, payload, boutique_id: ctx.boutique_id, appareil_id: ctx.appareil_id, seq,
    statut: 'en_attente', tentatives: 0, stock_integre: 0, touche: [payload.id, ...touche].filter(Boolean), cree_le: maintenant(),
  });
}
const declencher = () => evenement('bps:ops');

// ---------- Caisse ----------
export async function caisseOuverte() {
  const ap = await appareil();
  return (await db.caisses.where('statut').equals('ouverte').toArray()).find(c => c.appareil_id === ap) || null;
}
export async function soldeTheoriqueCaisse(caisseId) {
  return soldeCaisseTheorique(await db.mouvements_caisse.where('caisse_id').equals(caisseId).toArray());
}

export async function ouvrirCaisse(fondsInitial = 0) {
  garde('caisse_ouvrir');
  if (!Number.isInteger(fondsInitial) || fondsInitial < 0) throw new Error('Fonds initial invalide');
  const ctx = await contexte();
  if (await caisseOuverte()) throw new Error('Une caisse est déjà ouverte sur cet appareil');
  const id = uuid(), quand = maintenant();
  await tx(async () => {
    await db.caisses.put({ id, boutique_id: ctx.boutique_id, appareil_id: ctx.appareil_id, ouvert_par: ctx.user_id, ouverte_le: quand, fonds_initial: fondsInitial, statut: 'ouverte' });
    if (fondsInitial > 0) await db.mouvements_caisse.put({ id, boutique_id: ctx.boutique_id, caisse_id: id, type: 'fonds_initial', sens: 1, montant: fondsInitial, document_id: id, libelle: 'Fonds initial', survenu_le: quand });
    await enfiler(ctx, 'ouverture_caisse', { id, fonds_initial: fondsInitial, ouverte_le: quand });
  });
  declencher(); return id;
}

export async function fermerCaisse(montantCompte) {
  garde('caisse_fermer');
  if (!Number.isInteger(montantCompte) || montantCompte < 0) throw new Error('Montant compté invalide');
  const ctx = await contexte(); const c = await caisseOuverte(); if (!c) throw new Error('Aucune caisse ouverte');
  const theo = await soldeTheoriqueCaisse(c.id), quand = maintenant();
  const rapport = { caisse_id: c.id, solde_theorique: theo, montant_compte: montantCompte, ecart: montantCompte - theo, fermee_le: quand };
  await tx(async () => {
    await db.caisses.update(c.id, { statut: 'fermee', fermee_le: quand, solde_theorique: theo, montant_compte: montantCompte, ecart: rapport.ecart });
    await enfiler(ctx, 'cloture_caisse', { id: uuid(), caisse_id: c.id, montant_compte: montantCompte, fermee_le: quand }, [c.id]);
  });
  return rapport;
}

async function mouvementCaisseLocal(ctx, caisse, type, sens, montant, docId, libelle, quand, id) {
  if (!caisse || !(montant > 0)) return;
  await db.mouvements_caisse.put({ id, boutique_id: ctx.boutique_id, caisse_id: caisse.id, type, sens, montant, document_id: docId, libelle, survenu_le: quand });
}

export async function enregistrerDepense({ categorie, montant, mode = 'especes', description = '' }) {
  garde('depense');
  if (!['transport', 'electricite', 'eau', 'loyer', 'telephone', 'reparation', 'salaires', 'autres'].includes(categorie)) throw new Error('Catégorie invalide');
  if (!Number.isInteger(montant) || montant <= 0) throw new Error('Montant invalide');
  const ctx = await contexte(), caisse = await caisseOuverte(), id = uuid(), quand = maintenant();
  if (mode === 'especes' && !caisse) throw new Error('Ouvrez la caisse pour une dépense en espèces');
  await tx(async () => {
    await db.depenses.put({ id, boutique_id: ctx.boutique_id, caisse_id: caisse?.id || null, categorie, montant, mode, description, depense_le: quand, statut: 'valide', cree_par: ctx.user_id });
    if (mode === 'especes') await mouvementCaisseLocal(ctx, caisse, 'depense', -1, montant, id, categorie, quand, id);
    await enfiler(ctx, 'depense', { id, caisse_id: caisse?.id || null, categorie, montant, mode, description, depense_le: quand });
  });
  declencher(); return id;
}

export async function enregistrerRetrait({ montant, libelle }) {
  garde('retrait');
  if (!Number.isInteger(montant) || montant <= 0) throw new Error('Montant invalide');
  const ctx = await contexte(), caisse = await caisseOuverte(), id = uuid(), quand = maintenant();
  if (!caisse) throw new Error('Aucune caisse ouverte');
  const theo = await soldeTheoriqueCaisse(caisse.id);
  if (montant > theo) throw new Error(`Retrait supérieur au solde théorique de la caisse (${theo} FCFA)`);
  await tx(async () => {
    await mouvementCaisseLocal(ctx, caisse, 'retrait', -1, montant, id, libelle || 'Retrait', quand, id);
    await enfiler(ctx, 'retrait', { id, caisse_id: caisse.id, montant, libelle: libelle || 'Retrait', survenu_le: quand });
  });
  declencher(); return id;
}

// ---------- Ventes ----------
async function numeroVente(ctx) {
  const jour = jourCle(), cle = `seq_vente_${jour}`, n = (await getMeta(cle, 0)) + 1;
  await setMeta(cle, n);
  return `${await codeAppareil()}-${jour}-${String(n).padStart(4, '0')}`;
}

// Protection double clic : deux appels simultanés avec le même id de vente partagent la même exécution.
const ventesEnCours = new Map();
export function enregistrerVente(saisie) {
  if (ventesEnCours.has(saisie.id)) return ventesEnCours.get(saisie.id).then(r => ({ ...r, doublon: true }));
  const p = enregistrerVenteInterne(saisie).finally(() => ventesEnCours.delete(saisie.id));
  ventesEnCours.set(saisie.id, p);
  return p;
}

async function enregistrerVenteInterne(saisie) {
  garde('vente');
  const ctx = await contexte();
  // Protection double clic : l'id de vente est fixé à la création du panier ; un second appel renvoie la même vente.
  const deja = await db.ventes.get(saisie.id);
  if (deja) return { vente: deja, doublon: true };
  if (!saisie.lignes?.length) throw new Error('Le panier est vide');

  const produits = new Map((await db.produits.bulkGet(saisie.lignes.map(l => l.produit_id))).filter(Boolean).map(p => [p.id, p]));
  const stocks = await stocksAffiches();
  const demande = new Map();
  for (const l of saisie.lignes) {
    const p = produits.get(l.produit_id);
    if (!p || p.supprime_le) throw new Error('Produit introuvable ou supprimé');
    if (!quantiteValide(l.quantite, p.unite)) throw new Error(`Quantité invalide pour « ${p.nom} » (${p.unite})`);
    if (!Number.isInteger(l.prix_unitaire) || l.prix_unitaire < 0) throw new Error('Prix invalide');
    demande.set(p.id, (demande.get(p.id) || 0) + l.quantite);
  }
  for (const [pid, q] of demande) {
    const p = produits.get(pid), dispo = stocks.get(pid) || 0;
    if (q > dispo && !p.autoriser_stock_negatif && !saisie.forcer_stock)
      throw new Error(`Stock insuffisant pour « ${p.nom} » : ${dispo} disponible, ${q} demandé`);
  }
  if (saisie.forcer_stock) garde('forcer_stock');

  const { sousTotal, remise, total } = totalVente(saisie.lignes, saisie.remise || 0);
  if (ctx.role === 'caissier' && remise > Math.floor(sousTotal * 0.10)) throw new Error('Remise limitée à 10 % pour un caissier : demandez au gérant');
  const { paye, reste } = validerPaiements(total, saisie.paiements || [], saisie.client_id);
  if (saisie.client_id && !(await db.clients.get(saisie.client_id))) throw new Error('Client introuvable');

  const caisse = await caisseOuverte(), quand = maintenant(), numero = await numeroVente(ctx);
  const venteId = saisie.id, creditId = reste > 0 ? uuid() : null;
  const lignes = saisie.lignes.map(l => ({ id: uuid(), produit_id: l.produit_id, quantite: l.quantite, prix_unitaire: l.prix_unitaire, remise_ligne: l.remise_ligne || 0 }));
  const paiements = (saisie.paiements || []).map(p => ({ id: uuid(), mode: p.mode, montant: p.montant, reference_externe: p.reference_externe || null }));
  const vente = { id: venteId, boutique_id: ctx.boutique_id, numero, appareil_id: ctx.appareil_id, caisse_id: caisse?.id || null, client_id: saisie.client_id || null, caissier_id: ctx.user_id,
    statut: 'valide', sous_total: sousTotal, remise, total, total_paye: paye, reste_a_payer: reste, vendu_le: quand, cree_le: quand };

  let doublon = false;
  await tx(async () => {
    if (await db.ventes.get(venteId)) { doublon = true; return; }
    await db.ventes.put(vente);
    await db.lignes_vente.bulkPut(lignes.map(l => { const p = produits.get(l.produit_id);
      return { ...l, boutique_id: ctx.boutique_id, vente_id: venteId, designation: p.nom, prix_achat_unitaire: p.prix_achat || 0, total_ligne: totalLigne(l.quantite, l.prix_unitaire, l.remise_ligne) }; }));
    await db.paiements_vente.bulkPut(paiements.map(p => ({ ...p, boutique_id: ctx.boutique_id, vente_id: venteId, paye_le: quand })));
    for (const p of paiements) if (p.mode === 'especes') await mouvementCaisseLocal(ctx, caisse, 'vente_especes', 1, p.montant, venteId, `Vente ${numero}`, quand, p.id);
    if (creditId) await db.credits_clients.put({ id: creditId, boutique_id: ctx.boutique_id, client_id: saisie.client_id, vente_id: venteId, montant_initial: reste, echeance: saisie.echeance || null, statut: 'ouvert', cree_le: quand });
    await enfiler(ctx, 'vente', { id: venteId, numero, caisse_id: caisse?.id || null, client_id: saisie.client_id || null, vendu_le: quand, remise, lignes, paiements, credit_id: creditId, echeance: saisie.echeance || null }, [creditId]);
  });
  declencher();
  return { vente, lignes, paiements, doublon };
}

export async function annulerVente(venteId, motif) {
  garde('annuler_vente');
  if (!motif?.trim()) throw new Error('Motif obligatoire');
  const ctx = await contexte(), v = await db.ventes.get(venteId);
  if (!v) throw new Error('Vente introuvable'); if (v.statut === 'annule') throw new Error('Vente déjà annulée');
  const credit = await db.credits_clients.where('vente_id').equals(venteId).first();
  if (credit && (await db.remboursements_clients.where('credit_id').equals(credit.id).count()) > 0)
    throw new Error('Des remboursements existent sur le crédit de cette vente : annulation impossible');
  const lignes = await db.lignes_vente.where('vente_id').equals(venteId).toArray();
  const pays = await db.paiements_vente.where('vente_id').equals(venteId).toArray();
  const caisse = await caisseOuverte(), id = uuid(), quand = maintenant();
  await tx(async () => {
    await db.ventes.update(venteId, { statut: 'annule', annule_le: quand, motif_annulation: motif });
    if (credit) await db.credits_clients.update(credit.id, { statut: 'annule' });
    const cash = pays.find(p => p.mode === 'especes');
    if (cash && caisse) await mouvementCaisseLocal(ctx, caisse, 'annulation_vente', -1, cash.montant, venteId, `Annulation ${v.numero}`, quand, id);
    await enfiler(ctx, 'annulation_vente', { id, vente_id: venteId, motif, caisse_id: caisse?.id || null, annule_le: quand,
      lignes_stock: lignes.map(l => ({ produit_id: l.produit_id, quantite: l.quantite })) }, [venteId, credit?.id]);
  });
  declencher();
}

// ---------- Clients & crédits ----------
export async function soldeClient(clientId) {
  const credits = (await db.credits_clients.where('client_id').equals(clientId).toArray()).filter(c => c.statut !== 'annule');
  const remb = await db.remboursements_clients.where('client_id').equals(clientId).toArray();
  return credits.reduce((s, c) => s + c.montant_initial, 0) - remb.reduce((s, r) => s + r.montant, 0);
}
export async function creditsOuverts(clientId) {
  const credits = (await db.credits_clients.where('client_id').equals(clientId).toArray()).filter(c => c.statut === 'ouvert');
  const remb = await db.remboursements_clients.where('client_id').equals(clientId).toArray();
  return credits.map(c => ({ ...c, reste: c.montant_initial - remb.filter(r => r.credit_id === c.id).reduce((s, r) => s + r.montant, 0) })).filter(c => c.reste > 0);
}

export async function rembourserClient(clientId, montant, mode = 'especes') {
  garde('remboursement');
  if (!Number.isInteger(montant) || montant <= 0) throw new Error('Montant invalide');
  if (mode === 'credit') throw new Error('Mode de paiement invalide');
  const ctx = await contexte(), caisse = await caisseOuverte();
  if (mode === 'especes' && !caisse) throw new Error('Ouvrez la caisse pour encaisser des espèces');
  const credits = await creditsOuverts(clientId);
  const parts = allouerRemboursement(montant, credits);     // lève une erreur si > dette
  const quand = maintenant(), ids = [];
  await tx(async () => {
    for (const part of parts) {
      const id = uuid(); ids.push(id);
      await db.remboursements_clients.put({ id, boutique_id: ctx.boutique_id, credit_id: part.credit_id, client_id: clientId, montant: part.montant, mode, caisse_id: caisse?.id || null, rembourse_le: quand, cree_par: ctx.user_id });
      if (mode === 'especes') await mouvementCaisseLocal(ctx, caisse, 'remboursement_credit', 1, part.montant, id, 'Remboursement crédit', quand, id);
      const c = credits.find(x => x.id === part.credit_id);
      if (c.reste - part.montant <= 0) await db.credits_clients.update(c.id, { statut: 'solde' });
      await enfiler(ctx, 'remboursement', { id, credit_id: part.credit_id, montant: part.montant, mode, caisse_id: caisse?.id || null, rembourse_le: quand }, [part.credit_id]);
    }
  });
  declencher();
  return { ids, parts, solde_restant: await soldeClient(clientId) };
}

// ---------- Référentiels (produits, clients, fournisseurs, catégories) ----------
const COLONNES = {
  produits: ['id', 'boutique_id', 'reference', 'code_barres', 'nom', 'categorie_id', 'fournisseur_id', 'unite', 'unite_base', 'qte_par_conditionnement', 'prix_achat', 'prix_vente', 'stock_min', 'autoriser_stock_negatif', 'date_peremption', 'supprime_le'],
  clients: ['id', 'boutique_id', 'nom', 'telephone', 'adresse', 'plafond_credit', 'supprime_le'],
  fournisseurs: ['id', 'boutique_id', 'nom', 'telephone', 'adresse', 'notes', 'supprime_le'],
  categories: ['id', 'boutique_id', 'nom', 'supprime_le'],
};
const DROIT_REF = { produits: 'produit_ecrire', fournisseurs: 'ref_ecrire', categories: 'ref_ecrire' };

async function ecrireRef(table, donnees) {
  const droit = table === 'clients' ? (donnees.id && (await db.clients.get(donnees.id)) ? 'client_modifier' : 'client_creer') : DROIT_REF[table];
  garde(droit);
  const ctx = await contexte();
  const existant = donnees.id ? await db[table].get(donnees.id) : null;
  const row = { ...(existant || { version: 0, cree_le: maintenant() }), ...donnees, id: existant?.id || donnees.id || uuid(), boutique_id: ctx.boutique_id };
  await tx(async () => {
    await db[table].put(row);
    const opId = `ref:${table}:${row.id}`;
    const enAttente = await db.file_sync.get(opId);
    const base = enAttente && ['en_attente', 'erreur', 'conflit'].includes(enAttente.statut) ? enAttente.version_base : (existant?.version ?? 0);
    const seq = enAttente && enAttente.statut === 'en_attente' ? enAttente.seq : (await getMeta('seq_file', 0)) + 1;
    if (!(enAttente && enAttente.statut === 'en_attente')) await setMeta('seq_file', seq);
    await db.file_sync.put({ op_id: opId, kind: 'ref', type: `ref_${table}`, table, row: Object.fromEntries(COLONNES[table].filter(c => c in row).map(c => [c, row[c] ?? null])),
      version_base: base, boutique_id: ctx.boutique_id, appareil_id: ctx.appareil_id, seq, statut: 'en_attente', tentatives: 0, stock_integre: 1, touche: [row.id], cree_le: maintenant() });
  });
  declencher(); return row;
}

export async function sauverProduit(d) {
  const nom = (d.nom || '').trim(); if (!nom) throw new Error('Le nom est obligatoire');
  const ref = (d.reference || '').trim(); if (!ref) throw new Error('La référence est obligatoire');
  if (!['unite', 'kg', 'litre', 'paquet', 'carton', 'sac'].includes(d.unite)) throw new Error('Unité invalide');
  for (const k of ['prix_achat', 'prix_vente']) if (!Number.isInteger(d[k]) || d[k] < 0) throw new Error('Les prix doivent être des montants entiers en FCFA');
  if (d.qte_par_conditionnement != null && !(d.qte_par_conditionnement > 0)) throw new Error('Conditionnement invalide');
  const tous = await db.produits.toArray();
  if (tous.some(p => p.id !== d.id && !p.supprime_le && p.reference.toLowerCase() === ref.toLowerCase())) throw new Error('Cette référence existe déjà');
  if (d.code_barres && tous.some(p => p.id !== d.id && !p.supprime_le && p.code_barres === d.code_barres)) throw new Error('Ce code-barres existe déjà');
  const { stock_initial, ...reste } = d;
  const row = await ecrireRef('produits', { ...reste, nom, reference: ref, code_barres: d.code_barres || null, stock_min: d.stock_min || 0, autoriser_stock_negatif: !!d.autoriser_stock_negatif });
  if (!d.id && stock_initial > 0) await ajusterStock({ produit_id: row.id, quantite: stock_initial, type: 'entree_diverse', motif: 'Stock initial' });
  return row;
}
export const supprimerProduit = async id => { garde('produit_ecrire'); return ecrireRef('produits', { id, supprime_le: maintenant() }); };
export const sauverClient = async d => { if (!d.nom?.trim()) throw new Error('Le nom est obligatoire'); return ecrireRef('clients', { ...d, nom: d.nom.trim() }); };
export const sauverFournisseur = async d => { if (!d.nom?.trim()) throw new Error('Le nom est obligatoire'); return ecrireRef('fournisseurs', { ...d, nom: d.nom.trim() }); };
export const sauverCategorie = async d => { if (!d.nom?.trim()) throw new Error('Le nom est obligatoire'); return ecrireRef('categories', { ...d, nom: d.nom.trim() }); };

// ---------- Stock ----------
export async function ajusterStock({ produit_id, quantite, type, motif }) {
  garde('stock_ajuster');
  if (!['ajustement', 'perte', 'casse', 'peremption', 'entree_diverse', 'sortie_diverse'].includes(type)) throw new Error('Type de mouvement invalide');
  if (!motif?.trim()) throw new Error('Un motif est obligatoire');
  const p = await db.produits.get(produit_id); if (!p) throw new Error('Produit introuvable');
  if (!quantite || !Number.isFinite(quantite)) throw new Error('Quantité invalide');
  // le signe est imposé par le type, pour éviter les inversions de saisie
  const q = ['perte', 'casse', 'peremption', 'sortie_diverse'].includes(type) ? -Math.abs(quantite) : type === 'entree_diverse' ? Math.abs(quantite) : quantite;
  const dispo = (await stocksAffiches()).get(produit_id) || 0;
  if (dispo + q < 0 && !p.autoriser_stock_negatif) throw new Error(`Stock insuffisant : ${dispo} disponible`);
  const ctx = await contexte(), id = uuid();
  await tx(() => enfiler(ctx, 'ajustement_stock', { id, produit_id, type, quantite: q, motif, survenu_le: maintenant() }));
  declencher(); return id;
}

export async function faireInventaire(comptages, notes = '') {
  garde('stock_ajuster');
  if (!comptages.length) throw new Error('Aucun produit compté');
  const ctx = await contexte(), stocks = await stocksAffiches(), id = uuid();
  const lignes = comptages.map(c => {
    if (!(c.quantite_comptee >= 0)) throw new Error('Quantité comptée invalide');
    return { id: uuid(), produit_id: c.produit_id, quantite_comptee: c.quantite_comptee, ecart_local: c.quantite_comptee - (stocks.get(c.produit_id) || 0) };
  });
  await tx(() => enfiler(ctx, 'inventaire', { id, realise_le: maintenant(), notes, lignes }));
  declencher(); return { id, lignes };
}

// ---------- Achats & fournisseurs ----------
export async function creerAchat({ fournisseur_id, lignes }) {
  garde('achat');
  if (!(await db.fournisseurs.get(fournisseur_id))) throw new Error('Fournisseur introuvable');
  if (!lignes?.length) throw new Error('Ajoutez au moins un produit');
  const ctx = await contexte(), id = uuid(), quand = maintenant();
  const n = (await getMeta('seq_achat', 0)) + 1;
  const numero = `${await codeAppareil()}-ACH-${String(n).padStart(4, '0')}`;
  const lg = lignes.map(l => {
    if (!(l.quantite_commandee > 0) || !Number.isInteger(l.prix_achat_unitaire) || l.prix_achat_unitaire < 0) throw new Error('Ligne d\'achat invalide');
    return { id: uuid(), produit_id: l.produit_id, quantite_commandee: l.quantite_commandee, prix_achat_unitaire: l.prix_achat_unitaire };
  });
  const total = lg.reduce((s, l) => s + arrondi(l.quantite_commandee * l.prix_achat_unitaire), 0);
  await tx(async () => {
    await setMeta('seq_achat', n);
    await db.achats.put({ id, boutique_id: ctx.boutique_id, numero, fournisseur_id, statut: 'commande', total, commande_le: quand, cree_par: ctx.user_id });
    await db.lignes_achat.bulkPut(lg.map(l => ({ ...l, boutique_id: ctx.boutique_id, achat_id: id, quantite_recue: 0 })));
    await enfiler(ctx, 'achat', { id, numero, fournisseur_id, commande_le: quand, lignes: lg });
  });
  declencher(); return id;
}

export async function receptionnerAchat(achatId, receptions) {
  garde('achat');
  const ctx = await contexte(), achat = await db.achats.get(achatId);
  if (!achat || !['commande', 'recu_partiel'].includes(achat.statut)) throw new Error('Achat introuvable ou déjà clos');
  const lignesAchat = await db.lignes_achat.where('achat_id').equals(achatId).toArray();
  const lignes = [];
  for (const r of receptions) {
    if (!(r.quantite_recue > 0)) continue;
    const la = lignesAchat.find(x => x.id === r.ligne_id); if (!la) throw new Error('Ligne inconnue');
    if (la.quantite_recue + r.quantite_recue > la.quantite_commandee) throw new Error('Réception supérieure à la commande');
    lignes.push({ ligne_id: la.id, produit_id: la.produit_id, quantite_recue: r.quantite_recue, date_peremption: r.date_peremption || null });
  }
  if (!lignes.length) throw new Error('Saisissez au moins une quantité reçue');
  const id = uuid(), quand = maintenant();
  await tx(async () => {
    for (const l of lignes) { const la = lignesAchat.find(x => x.id === l.ligne_id); await db.lignes_achat.update(la.id, { quantite_recue: la.quantite_recue + l.quantite_recue });
      await db.produits.update(la.produit_id, { prix_achat: la.prix_achat_unitaire }); }
    const restant = lignesAchat.reduce((s, la) => s + la.quantite_commandee - la.quantite_recue - (lignes.find(l => l.ligne_id === la.id)?.quantite_recue || 0), 0);
    await db.achats.update(achatId, { statut: restant <= 0 ? 'recu' : 'recu_partiel', recu_le: quand });
    await enfiler(ctx, 'reception', { id, achat_id: achatId, recu_le: quand, lignes }, [achatId, ...lignes.map(l => l.ligne_id)]);
  });
  declencher(); return id;
}

export async function enregistrerFacture({ achat_id, fournisseur_id, numero, montant, echeance }) {
  garde('achat');
  if (!numero?.trim()) throw new Error('Numéro de facture obligatoire'); if (!Number.isInteger(montant) || montant <= 0) throw new Error('Montant invalide');
  const ctx = await contexte(), id = uuid(), quand = maintenant();
  await tx(async () => {
    await db.factures_fournisseurs.put({ id, boutique_id: ctx.boutique_id, achat_id: achat_id || null, fournisseur_id, numero: numero.trim(), montant, echeance: echeance || null, statut: 'ouverte', emise_le: quand });
    await enfiler(ctx, 'facture_fournisseur', { id, achat_id: achat_id || null, fournisseur_id, numero: numero.trim(), montant, echeance: echeance || null, emise_le: quand });
  });
  declencher(); return id;
}

export async function resteFacture(factureId) {
  const f = await db.factures_fournisseurs.get(factureId); if (!f) return 0;
  return f.montant - (await db.paiements_fournisseurs.where('facture_id').equals(factureId).toArray()).reduce((s, p) => s + p.montant, 0);
}

export async function payerFournisseur({ facture_id, montant, mode = 'especes' }) {
  garde('achat');
  if (!Number.isInteger(montant) || montant <= 0) throw new Error('Montant invalide');
  const reste = await resteFacture(facture_id); if (montant > reste) throw new Error(`Paiement supérieur au reste dû (${reste} FCFA)`);
  const ctx = await contexte(), caisse = await caisseOuverte(), id = uuid(), quand = maintenant();
  if (mode === 'especes' && !caisse) throw new Error('Ouvrez la caisse pour un paiement en espèces');
  await tx(async () => {
    await db.paiements_fournisseurs.put({ id, boutique_id: ctx.boutique_id, facture_id, montant, mode, paye_le: quand, cree_par: ctx.user_id });
    if (reste - montant <= 0) await db.factures_fournisseurs.update(facture_id, { statut: 'soldee' });
    if (mode === 'especes') await mouvementCaisseLocal(ctx, caisse, 'paiement_fournisseur', -1, montant, id, 'Paiement fournisseur', quand, id);
    await enfiler(ctx, 'paiement_fournisseur', { id, facture_id, montant, mode, caisse_id: caisse?.id || null, paye_le: quand }, [facture_id]);
  });
  declencher(); return id;
}
