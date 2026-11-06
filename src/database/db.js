// Base locale IndexedDB (Dexie). Source de vérité hors connexion.
import Dexie from '../../vendor/dexie.mjs';

export const SCHEMA_V1 = {
  meta: 'cle',                                   // paramètres, curseurs, compteurs, profil
  categories: 'id, nom',
  fournisseurs: 'id, nom',
  clients: 'id, nom, telephone',
  produits: 'id, reference, code_barres, nom, categorie_id',
  stock_serveur: 'produit_id',                    // stock connu du serveur (dernier pull)
  ventes: 'id, numero, vendu_le, client_id, statut',
  lignes_vente: 'id, vente_id, produit_id',
  paiements_vente: 'id, vente_id',
  credits_clients: 'id, client_id, vente_id, statut',
  remboursements_clients: 'id, credit_id, client_id',
  achats: 'id, fournisseur_id, statut',
  lignes_achat: 'id, achat_id',
  factures_fournisseurs: 'id, fournisseur_id, statut',
  paiements_fournisseurs: 'id, facture_id',
  mouvements_stock: 'id, produit_id, survenu_le',  // historique téléchargé
  inventaires: 'id',
  lignes_inventaire: 'id, inventaire_id',
  caisses: 'id, statut',
  mouvements_caisse: 'id, caisse_id',
  depenses: 'id, depense_le',
  alertes: 'id, lu',                              // conflits de stock signalés par le serveur
  // File d'attente de synchronisation. statut : en_attente | envoi | synchronise | erreur | conflit
  file_sync: 'op_id, seq, statut, stock_integre, *touche',
};

export function creerDb(nom = 'boutique_pro_senegal', options = {}) {
  const db = new Dexie(nom, options);
  db.version(1).stores(SCHEMA_V1);
  return db;
}

export const TABLES_SAUVEGARDE = Object.keys(SCHEMA_V1);

// Instance par défaut (navigateur). Les tests passent leur propre instance.
export let db = typeof indexedDB !== 'undefined' ? creerDb() : null;
export function utiliserDb(autre) { db = autre; return db; }

// --- Meta helpers ---
export const getMeta = async (cle, defaut = null) => (await db.meta.get(cle))?.valeur ?? defaut;
export const setMeta = (cle, valeur) => db.meta.put({ cle, valeur });
