// Rapports et indicateurs : calculés à partir des données réellement enregistrées (IndexedDB).
// Distinction explicite : chiffre d'affaires ≠ encaissements ≠ marge brute estimée ≠ bénéfice net estimé (non comptable).
import { db, getMeta } from '../database/db.js';
import { stocksAffiches } from './stock.js';
import { valeurStock, statutStock, margeBrute } from './calculs.js';
import { soldeClient, resteFacture } from './ops.js';

export const debutJour = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export function periode(type, ref = new Date()) {
  const d = debutJour(ref);
  if (type === 'jour') return [d, new Date(d.getTime() + 864e5)];
  if (type === 'semaine') { const j = (d.getDay() + 6) % 7; const s = new Date(d.getTime() - j * 864e5); return [s, new Date(s.getTime() + 7 * 864e5)]; }
  if (type === 'mois') return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1)];
  if (type === 'annee') return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear() + 1, 0, 1)];
  throw new Error('Période inconnue');
}
const dans = (iso, [a, b]) => iso && Date.parse(iso) >= a.getTime() && Date.parse(iso) < b.getTime();

export async function ventesPeriode(p) {
  const ventes = (await db.ventes.toArray()).filter(v => v.statut === 'valide' && dans(v.vendu_le, p));
  const ids = new Set(ventes.map(v => v.id));
  const lignes = (await db.lignes_vente.toArray()).filter(l => ids.has(l.vente_id));
  return { ventes, lignes };
}

export async function chiffres(p) {
  const { ventes, lignes } = await ventesPeriode(p);
  const ids = new Set(ventes.map(v => v.id));
  const ca = ventes.reduce((s, v) => s + v.total, 0);
  const marge = margeBrute(lignes);
  const depenses = (await db.depenses.toArray()).filter(d => d.statut !== 'annule' && dans(d.depense_le, p)).reduce((s, d) => s + d.montant, 0);
  const encVentes = (await db.paiements_vente.toArray()).filter(x => ids.has(x.vente_id)).reduce((s, x) => s + x.montant, 0);
  const encCredits = (await db.remboursements_clients.toArray()).filter(r => dans(r.rembourse_le, p)).reduce((s, r) => s + r.montant, 0);
  return { nb_ventes: ventes.length, ca, marge_brute: marge, depenses, benefice_net_estime: marge - depenses, encaisse_ventes: encVentes, encaisse_remboursements: encCredits,
    credit_accorde: ventes.reduce((s, v) => s + v.reste_a_payer, 0) };
}

export async function creances() {
  const clients = (await db.clients.toArray()).filter(c => !c.supprime_le);
  const lignes = [];
  for (const c of clients) { const solde = await soldeClient(c.id); if (solde > 0) lignes.push({ client: c, solde }); }
  return { lignes: lignes.sort((a, b) => b.solde - a.solde), total: lignes.reduce((s, l) => s + l.solde, 0) };
}

export async function dettesFournisseurs() {
  const lignes = [];
  for (const f of (await db.factures_fournisseurs.toArray()).filter(f => f.statut === 'ouverte')) {
    const reste = await resteFacture(f.id); if (reste > 0) lignes.push({ facture: f, reste, fournisseur: await db.fournisseurs.get(f.fournisseur_id) });
  }
  return { lignes, total: lignes.reduce((s, l) => s + l.reste, 0) };
}

export async function etatStock() {
  const produits = (await db.produits.toArray()).filter(p => !p.supprime_le), stocks = await stocksAffiches();
  const lignes = produits.map(p => ({ produit: p, stock: stocks.get(p.id) || 0, statut: statutStock(stocks.get(p.id) || 0, p.stock_min) }));
  return { lignes, valeur: valeurStock(produits, stocks), alertes: lignes.filter(l => l.statut !== 'ok'),
    perimes: produits.filter(p => p.date_peremption && Date.parse(p.date_peremption) < Date.now()), bientot: produits.filter(p => p.date_peremption && Date.parse(p.date_peremption) >= Date.now() && Date.parse(p.date_peremption) < Date.now() + 30 * 864e5) };
}

export async function topProduits(p, n = 5) {
  const { lignes } = await ventesPeriode(p), m = new Map();
  for (const l of lignes) { const e = m.get(l.produit_id) || { designation: l.designation, quantite: 0, ca: 0 }; e.quantite += l.quantite; e.ca += l.total_ligne; m.set(l.produit_id, e); }
  return [...m.values()].sort((a, b) => b.ca - a.ca).slice(0, n);
}

export async function tableauDeBord() {
  const [jour, semaine, mois] = ['jour', 'semaine', 'mois'].map(t => periode(t));
  const [cj, cs, cm, cr, dt, st, top] = await Promise.all([chiffres(jour), chiffres(semaine), chiffres(mois), creances(), dettesFournisseurs(), etatStock(), topProduits(mois)]);
  return { jour: cj, semaine: cs, mois: cm, creances: cr.total, dettes: dt.total, stock: st, top, derniere_sauvegarde: await getMeta('derniere_sauvegarde'), derniere_synchro: await getMeta('derniere_synchro') };
}

// ---- Rapports tabulaires : { titre, colonnes:[{titre,cle,fmt?}], lignes, totaux? } ----
export async function rapport(type, p) {
  const [a, b] = p;
  switch (type) {
    case 'ventes': {
      const { ventes } = await ventesPeriode(p), clients = new Map((await db.clients.toArray()).map(c => [c.id, c.nom]));
      return { titre: 'Ventes', colonnes: [{ titre: 'N°', cle: 'numero' }, { titre: 'Date', cle: 'vendu_le', fmt: 'dateheure' }, { titre: 'Client', cle: 'client' }, { titre: 'Total', cle: 'total', fmt: 'fcfa' }, { titre: 'Payé', cle: 'total_paye', fmt: 'fcfa' }, { titre: 'Reste', cle: 'reste_a_payer', fmt: 'fcfa' }],
        lignes: ventes.sort((x, y) => x.vendu_le.localeCompare(y.vendu_le)).map(v => ({ ...v, client: clients.get(v.client_id) || '' })), totaux: { total: ventes.reduce((s, v) => s + v.total, 0), total_paye: ventes.reduce((s, v) => s + v.total_paye, 0), reste_a_payer: ventes.reduce((s, v) => s + v.reste_a_payer, 0) } };
    }
    case 'produits': {
      const { lignes } = await ventesPeriode(p), m = new Map();
      for (const l of lignes) { const e = m.get(l.produit_id) || { designation: l.designation, quantite: 0, ca: 0, marge: 0 }; e.quantite += l.quantite; e.ca += l.total_ligne; e.marge += margeBrute([l]); m.set(l.produit_id, e); }
      const rows = [...m.values()].sort((x, y) => y.ca - x.ca);
      return { titre: 'Ventes par produit', colonnes: [{ titre: 'Produit', cle: 'designation' }, { titre: 'Quantité', cle: 'quantite', fmt: 'qte' }, { titre: 'CA', cle: 'ca', fmt: 'fcfa' }, { titre: 'Marge brute estimée', cle: 'marge', fmt: 'fcfa' }], lignes: rows, totaux: { ca: rows.reduce((s, r) => s + r.ca, 0), marge: rows.reduce((s, r) => s + r.marge, 0) } };
    }
    case 'categories': {
      const { lignes } = await ventesPeriode(p), prods = new Map((await db.produits.toArray()).map(x => [x.id, x])), cats = new Map((await db.categories.toArray()).map(c => [c.id, c.nom])), m = new Map();
      for (const l of lignes) { const nom = cats.get(prods.get(l.produit_id)?.categorie_id) || 'Sans catégorie'; const e = m.get(nom) || { categorie: nom, ca: 0, marge: 0 }; e.ca += l.total_ligne; e.marge += margeBrute([l]); m.set(nom, e); }
      const rows = [...m.values()].sort((x, y) => y.ca - x.ca);
      return { titre: 'Ventes par catégorie', colonnes: [{ titre: 'Catégorie', cle: 'categorie' }, { titre: 'CA', cle: 'ca', fmt: 'fcfa' }, { titre: 'Marge brute estimée', cle: 'marge', fmt: 'fcfa' }], lignes: rows, totaux: { ca: rows.reduce((s, r) => s + r.ca, 0), marge: rows.reduce((s, r) => s + r.marge, 0) } };
    }
    case 'achats': {
      const four = new Map((await db.fournisseurs.toArray()).map(f => [f.id, f.nom]));
      const rows = (await db.achats.toArray()).filter(x => x.statut !== 'annule' && dans(x.commande_le, p)).map(x => ({ ...x, fournisseur: four.get(x.fournisseur_id) || '' }));
      return { titre: 'Achats', colonnes: [{ titre: 'N°', cle: 'numero' }, { titre: 'Date', cle: 'commande_le', fmt: 'date' }, { titre: 'Fournisseur', cle: 'fournisseur' }, { titre: 'Statut', cle: 'statut' }, { titre: 'Total', cle: 'total', fmt: 'fcfa' }], lignes: rows, totaux: { total: rows.reduce((s, r) => s + r.total, 0) } };
    }
    case 'depenses': {
      const rows = (await db.depenses.toArray()).filter(d => d.statut !== 'annule' && dans(d.depense_le, p)).sort((x, y) => x.depense_le.localeCompare(y.depense_le));
      return { titre: 'Dépenses', colonnes: [{ titre: 'Date', cle: 'depense_le', fmt: 'dateheure' }, { titre: 'Catégorie', cle: 'categorie' }, { titre: 'Description', cle: 'description' }, { titre: 'Mode', cle: 'mode' }, { titre: 'Montant', cle: 'montant', fmt: 'fcfa' }], lignes: rows, totaux: { montant: rows.reduce((s, r) => s + r.montant, 0) } };
    }
    case 'marges': {
      const { lignes } = await ventesPeriode(p), ca = lignes.reduce((s, l) => s + l.total_ligne, 0), mg = margeBrute(lignes);
      const dep = (await chiffres(p)).depenses;
      return { titre: 'Marges (estimations, non comptables)', colonnes: [{ titre: 'Indicateur', cle: 'k' }, { titre: 'Montant', cle: 'v', fmt: 'fcfa' }], lignes: [{ k: 'Chiffre d\'affaires', v: ca }, { k: 'Marge brute estimée', v: mg }, { k: 'Dépenses', v: dep }, { k: 'Bénéfice net estimé (non certifié)', v: mg - dep }] };
    }
    case 'creances': {
      const c = await creances();
      return { titre: 'Créances clients', colonnes: [{ titre: 'Client', cle: 'nom' }, { titre: 'Téléphone', cle: 'telephone' }, { titre: 'Solde dû', cle: 'solde', fmt: 'fcfa' }], lignes: c.lignes.map(l => ({ nom: l.client.nom, telephone: l.client.telephone || '', solde: l.solde })), totaux: { solde: c.total } };
    }
    case 'dettes': {
      const d = await dettesFournisseurs();
      return { titre: 'Dettes fournisseurs', colonnes: [{ titre: 'Fournisseur', cle: 'f' }, { titre: 'Facture', cle: 'n' }, { titre: 'Échéance', cle: 'e', fmt: 'date' }, { titre: 'Reste dû', cle: 'reste', fmt: 'fcfa' }], lignes: d.lignes.map(l => ({ f: l.fournisseur?.nom || '', n: l.facture.numero, e: l.facture.echeance, reste: l.reste })), totaux: { reste: d.total } };
    }
    case 'mouvements': {
      const prods = new Map((await db.produits.toArray()).map(x => [x.id, x.nom]));
      const rows = (await db.mouvements_stock.toArray()).filter(m => dans(m.survenu_le, p)).map(m => ({ ...m, produit: prods.get(m.produit_id) || '' }));
      const locaux = (await db.file_sync.toArray()).filter(o => o.kind === 'rpc').filter(o => o.statut !== 'synchronise' && o.statut !== 'abandonne');
      const { deltasOp } = await import('./stock.js');
      for (const o of locaux) for (const [pid, q] of deltasOp(o)) rows.push({ id: o.op_id + pid, survenu_le: o.payload.vendu_le || o.payload.recu_le || o.payload.survenu_le || o.payload.annule_le || o.payload.realise_le || o.cree_le, type: o.type + ' (en attente)', quantite: q, produit: prods.get(pid) || '', motif: o.payload.motif || '' });
      rows.sort((x, y) => (x.survenu_le || '').localeCompare(y.survenu_le || ''));
      return { titre: 'Mouvements de stock', colonnes: [{ titre: 'Date', cle: 'survenu_le', fmt: 'dateheure' }, { titre: 'Produit', cle: 'produit' }, { titre: 'Type', cle: 'type' }, { titre: 'Quantité', cle: 'quantite', fmt: 'qte' }, { titre: 'Motif', cle: 'motif' }], lignes: rows };
    }
    case 'caisses': {
      const rows = (await db.caisses.toArray()).filter(c => dans(c.ouverte_le, p)).sort((x, y) => x.ouverte_le.localeCompare(y.ouverte_le));
      return { titre: 'Clôtures de caisse', colonnes: [{ titre: 'Ouverture', cle: 'ouverte_le', fmt: 'dateheure' }, { titre: 'Fonds initial', cle: 'fonds_initial', fmt: 'fcfa' }, { titre: 'Théorique', cle: 'solde_theorique', fmt: 'fcfa' }, { titre: 'Compté', cle: 'montant_compte', fmt: 'fcfa' }, { titre: 'Écart', cle: 'ecart', fmt: 'fcfa' }, { titre: 'Statut', cle: 'statut' }], lignes: rows };
    }
    default: throw new Error('Rapport inconnu');
  }
}
export const TYPES_RAPPORT = { ventes: 'Ventes', produits: 'Par produit', categories: 'Par catégorie', achats: 'Achats', depenses: 'Dépenses', marges: 'Marges', creances: 'Créances clients', dettes: 'Dettes fournisseurs', mouvements: 'Mouvements de stock', caisses: 'Clôtures de caisse' };
