// Fonctions pures : aucun accès base de données. Testées unitairement.
export const arrondi = n => Math.round(Number(n) || 0);

export function totalLigne(quantite, prixUnitaire, remiseLigne = 0) {
  const t = arrondi(quantite * prixUnitaire) - arrondi(remiseLigne);
  if (t < 0) throw new Error('La remise dépasse le montant de la ligne');
  return t;
}

export function totalVente(lignes, remise = 0) {
  const sousTotal = lignes.reduce((s, l) => s + totalLigne(l.quantite, l.prix_unitaire, l.remise_ligne), 0);
  remise = arrondi(remise);
  if (remise < 0 || remise > sousTotal) throw new Error('Remise invalide');
  return { sousTotal, remise, total: sousTotal - remise };
}

export function validerPaiements(total, paiements, clientId) {
  const modes = new Set();
  let paye = 0;
  for (const p of paiements) {
    if (p.mode === 'credit') throw new Error('Le crédit n\'est pas un moyen de paiement : laissez le reste à payer');
    if (modes.has(p.mode)) throw new Error('Un seul paiement par mode');
    modes.add(p.mode);
    if (!(p.montant > 0) || !Number.isInteger(p.montant)) throw new Error('Montant de paiement invalide');
    paye += p.montant;
  }
  if (paye > total) throw new Error('Les paiements dépassent le total');
  const reste = total - paye;
  if (reste > 0 && !clientId) throw new Error('Vente à crédit : choisissez un client');
  return { paye, reste };
}

export function margeBrute(lignes) {
  // Marge estimée = (prix de vente − coût d'achat figé) × quantité − remises de ligne. Ce n'est PAS un bénéfice comptable.
  return lignes.reduce((s, l) => s + totalLigne(l.quantite, l.prix_unitaire, l.remise_ligne) - arrondi(l.quantite * (l.prix_achat_unitaire || 0)), 0);
}

// Conditionnement : un carton de N unités n'est jamais confondu avec l'unité.
export function conditionnementVersUnites(nbConditionnements, produit) {
  if (!produit.qte_par_conditionnement) throw new Error('Ce produit n\'a pas de conditionnement défini');
  return nbConditionnements * produit.qte_par_conditionnement;
}
export function prixUnitaireDepuisConditionnement(prixConditionnement, produit) {
  if (!produit.qte_par_conditionnement) throw new Error('Ce produit n\'a pas de conditionnement défini');
  return arrondi(prixConditionnement / produit.qte_par_conditionnement);
}

export function quantiteValide(q, unite) {
  if (!(q > 0)) return false;
  return ['kg', 'litre'].includes(unite) ? Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-9 : Number.isInteger(q);
}

export function valeurStock(produits, stocks) {
  return produits.reduce((s, p) => s + Math.max(0, stocks.get(p.id) || 0) * (p.prix_achat || 0), 0);
}

export const statutStock = (stock, min) => stock <= 0 ? 'rupture' : stock <= min ? 'bas' : 'ok';

export function soldeCaisseTheorique(mouvements) {
  return mouvements.reduce((s, m) => s + m.sens * m.montant, 0);
}

export function allouerRemboursement(montant, credits) {
  // Répartition FIFO sur les crédits ouverts (plus ancien d'abord). Chaque part est liée à son crédit.
  const parts = []; let reste = montant;
  for (const c of [...credits].sort((a, b) => (a.cree_le || '').localeCompare(b.cree_le || ''))) {
    if (reste <= 0) break;
    const du = c.reste;
    if (du <= 0) continue;
    const p = Math.min(du, reste);
    parts.push({ credit_id: c.id, montant: p }); reste -= p;
  }
  if (reste > 0) throw new Error(`Le montant dépasse la dette de ${reste} FCFA`);
  return parts;
}
