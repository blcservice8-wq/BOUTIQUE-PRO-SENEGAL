// Stock affiché = stock connu du serveur + effet des opérations locales pas encore intégrées par le serveur.
import { db } from '../database/db.js';

const PAS_ABANDONNE = op => op.statut !== 'abandonne';

export function deltasOp(op) {
  const d = new Map(); const add = (id, q) => d.set(id, (d.get(id) || 0) + q);
  const p = op.payload || {};
  switch (op.type) {
    case 'vente': (p.lignes || []).forEach(l => add(l.produit_id, -l.quantite)); break;
    case 'annulation_vente': (p.lignes_stock || []).forEach(l => add(l.produit_id, l.quantite)); break;
    case 'reception': (p.lignes || []).forEach(l => add(l.produit_id, l.quantite_recue)); break;
    case 'ajustement_stock': add(p.produit_id, p.quantite); break;
    case 'inventaire': (p.lignes || []).forEach(l => add(l.produit_id, l.ecart_local || 0)); break;
  }
  return d;
}

export async function stocksAffiches() {
  const m = new Map();
  for (const s of await db.stock_serveur.toArray()) m.set(s.produit_id, Number(s.stock));
  const enAttente = await db.file_sync.where('stock_integre').equals(0).toArray();
  for (const op of enAttente.filter(PAS_ABANDONNE)) {
    if (op.kind && op.kind !== 'rpc') continue;
    for (const [id, q] of deltasOp(op)) m.set(id, (m.get(id) || 0) + q);
  }
  return m;
}
export async function stockAffiche(produitId) { return (await stocksAffiches()).get(produitId) || 0; }
