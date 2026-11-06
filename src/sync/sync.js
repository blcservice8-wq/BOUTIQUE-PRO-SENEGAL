// Synchronisation bidirectionnelle sûre et traçable.
//  - Envoi : file d'attente ordonnée (seq), idempotente (op_id), nouvelle tentative avec backoff exponentiel.
//  - Réception : curseurs incrémentaux par table (maj_le) avec chevauchement ; ne remplace jamais une ligne en attente d'envoi.
//  - Conflits : jamais d'écrasement silencieux. Finance/stock = événements ajoutés ; fiches = contrôle de version + résolution manuelle.
import { db, getMeta, setMeta } from '../database/db.js';
import { CONFIG } from '../config.js';
import { profil } from '../services/session.js';
import { maintenant } from '../utils/id.js';

let client = null, enCours = false, relancer = false, etat = 'local', detailEtat = '', minuteur = null, debounce = null;
const ecouteurs = new Set();

export const definirClient = c => { client = c; majEtat(); };
export const surChangement = fn => { ecouteurs.add(fn); return () => ecouteurs.delete(fn); };
export const lireEtat = () => ({ etat, detail: detailEtat });
function majEtat(e, detail = '') {
  if (e) etat = e; else etat = !client ? 'local' : (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'hors_ligne' : 'en_ligne';
  detailEtat = detail; ecouteurs.forEach(fn => fn({ etat, detail }));
}

const reseau = err => !!err && (/failed to fetch|networkerror|network request|load failed|fetch failed|timeout|ECONN|ENOTFOUND/i.test(String(err.message || err)) || err.name === 'TypeError');
const sessionExpiree = err => !!err && (err.code === 'PGRST301' || /jwt|not authenticated|non authentifié/i.test(String(err.message || '')));
export const delaiBackoff = n => Math.min(CONFIG.BACKOFF_BASE_MS * 2 ** Math.max(0, n - 1), CONFIG.BACKOFF_MAX_MS);

export async function resume() {
  const ops = (await db.file_sync.toArray());
  const c = s => ops.filter(o => o.statut === s).length;
  return { en_attente: c('en_attente') + c('envoi'), erreur: c('erreur'), conflit: c('conflit'), synchronise: c('synchronise'), derniere_synchro: await getMeta('derniere_synchro') };
}
export const operationsEnAttente = () => db.file_sync.where('statut').anyOf('en_attente', 'envoi', 'erreur', 'conflit').sortBy('seq');

// ---------------- ENVOI ----------------
async function marquer(op, champs) { Object.assign(op, champs); await db.file_sync.update(op.op_id, champs); }

async function envoyerRef(op) {
  const { table, row, version_base } = op;
  if (!version_base) {
    // Nouvelle fiche : insertion idempotente (un renvoi après coupure ne crée pas de doublon).
    const { error } = await client.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    return { error };
  }
  const { id, boutique_id, ...maj } = row;
  const { data, error } = await client.from(table).update(maj).eq('id', id).eq('version', version_base).select('id');
  if (error) return { error };
  if (data?.length) return {};
  // 0 ligne : conflit de version ou droits insuffisants ?
  const { data: srv, error: e2 } = await client.from(table).select('*').eq('id', id).maybeSingle();
  if (e2) return { error: e2 };
  if (!srv) return { error: { message: 'Fiche introuvable sur le serveur' } };
  if (srv.version !== version_base) return { conflit: srv };
  return { error: { message: 'Droits insuffisants pour modifier cette fiche' } };
}

async function envoyer(manuel) {
  const p = profil();
  const maintenantMs = Date.now();
  const ops = (await db.file_sync.where('statut').anyOf('en_attente', 'envoi', 'erreur').sortBy('seq'));
  let envoyees = 0, echecs = 0;
  for (const op of ops) {
    if (op.statut === 'erreur' && !manuel && (op.tentatives >= CONFIG.MAX_TENTATIVES || (op.prochaine_tentative && Date.parse(op.prochaine_tentative) > maintenantMs))) continue;
    await marquer(op, { statut: 'envoi' });
    let res;
    try {
      if (op.kind === 'ref') res = await envoyerRef(op);
      else {
        const { data, error } = await client.rpc('appliquer_operation', { p_boutique: op.boutique_id || p.boutique_id, p_op_id: op.op_id, p_type: op.type, p_appareil: op.appareil_id, p_payload: op.payload });
        res = { error, data };
      }
    } catch (e) { res = { error: e }; }

    if (res.conflit) { await marquer(op, { statut: 'conflit', serveur: res.conflit, derniere_erreur: 'Modifiée ailleurs entre-temps' }); echecs++; continue; }
    if (res.error) {
      if (reseau(res.error)) { await marquer(op, { statut: 'en_attente' }); majEtat('hors_ligne', 'Réseau indisponible'); return { arret: 'reseau', envoyees, echecs }; }
      if (sessionExpiree(res.error)) { await marquer(op, { statut: 'en_attente' }); majEtat('erreur', 'Session expirée : reconnectez-vous'); return { arret: 'session', envoyees, echecs }; }
      const t = (op.tentatives || 0) + 1;
      await marquer(op, { statut: 'erreur', tentatives: t, derniere_erreur: String(res.error.message || res.error), prochaine_tentative: new Date(Date.now() + delaiBackoff(t)).toISOString() });
      echecs++; continue;
    }
    // 'ok' ou 'deja_applique' : dans les deux cas l'opération est définitivement acquise côté serveur.
    await marquer(op, { statut: 'synchronise', synchro_le: maintenant(), derniere_erreur: null, stock_integre: op.kind === 'ref' ? 1 : op.stock_integre });
    envoyees++;
  }
  return { envoyees, echecs };
}

// ---------------- RÉCEPTION ----------------
const TABLES_REF = ['categories', 'fournisseurs', 'clients', 'produits'];
const TABLES_DOC = ['caisses', 'ventes', 'lignes_vente', 'paiements_vente', 'credits_clients', 'remboursements_clients', 'achats', 'lignes_achat',
  'factures_fournisseurs', 'paiements_fournisseurs', 'mouvements_stock', 'inventaires', 'lignes_inventaire', 'mouvements_caisse', 'depenses'];
const NUM = new Set(['montant', 'montant_initial', 'prix_achat', 'prix_vente', 'prix_unitaire', 'prix_achat_unitaire', 'quantite', 'quantite_commandee', 'quantite_recue',
  'quantite_theorique', 'quantite_comptee', 'total', 'sous_total', 'remise', 'remise_ligne', 'total_ligne', 'total_paye', 'reste_a_payer', 'stock_min', 'plafond_credit',
  'qte_par_conditionnement', 'fonds_initial', 'solde_theorique', 'montant_compte', 'ecart', 'cout_unitaire', 'sens', 'version', 'stock']);
const normaliser = r => { const o = { ...r }; for (const k of Object.keys(o)) if (NUM.has(k) && o[k] != null) o[k] = Number(o[k]); return o; };

async function telechargerTable(table, boutiqueId, touches, colonne = 'maj_le') {
  const cle = `curseur_${table}`, curseur = await getMeta(cle);
  const depuis = curseur ? new Date(Date.parse(curseur) - CONFIG.PULL_CHEVAUCHEMENT_MS).toISOString() : '1970-01-01T00:00:00Z';
  let de = 0, max = curseur;
  for (;;) {
    const { data, error } = await client.from(table).select('*').eq('boutique_id', boutiqueId).gt(colonne, depuis).order(colonne, { ascending: true }).order('id', { ascending: true }).range(de, de + 999);
    if (error) throw error;
    if (!data?.length) break;
    // Une ligne modifiée localement et pas encore envoyée n'est jamais écrasée par une version serveur plus ancienne.
    const lignes = data.filter(r => !touches.has(String(r.id))).map(normaliser);
    if (lignes.length) await db[table].bulkPut(lignes);
    for (const r of data) if (!max || r[colonne] > max) max = r[colonne];
    if (data.length < 1000) break; de += 1000;
  }
  if (max) await setMeta(cle, max);
}

async function telechargerStock(boutiqueId) {
  const debut = maintenant();
  const { data, error } = await client.from('v_stock_produit').select('produit_id, stock').eq('boutique_id', boutiqueId);
  if (error) throw error;
  await db.transaction('rw', db.stock_serveur, db.file_sync, async () => {
    await db.stock_serveur.clear();
    await db.stock_serveur.bulkPut(data.map(r => ({ produit_id: r.produit_id, stock: Number(r.stock) })));
    // Les opérations déjà acquises par le serveur AVANT cette lecture sont désormais comptées dans stock_serveur.
    const a = await db.file_sync.where('statut').equals('synchronise').filter(o => o.stock_integre === 0 && (o.synchro_le || '') <= debut).toArray();
    for (const o of a) await db.file_sync.update(o.op_id, { stock_integre: 1 });
  });
}

async function telechargerAlertes(boutiqueId) {
  const cur = await getMeta('curseur_alertes');
  let q = client.from('journal_activite').select('id, entite_id, details, cree_le').eq('boutique_id', boutiqueId).eq('action', 'conflit_stock').order('cree_le', { ascending: true }).limit(200);
  if (cur) q = q.gt('cree_le', cur);
  const { data, error } = await q; if (error) throw error;
  if (!data?.length) return;
  await db.alertes.bulkPut(data.map(r => ({ id: String(r.id), produit_id: r.entite_id, vente_id: r.details?.vente, stock_apres: r.details?.stock_apres, cree_le: r.cree_le, lu: 0 })));
  await setMeta('curseur_alertes', data[data.length - 1].cree_le);
}

async function telecharger() {
  const b = profil().boutique_id;
  const pend = await db.file_sync.where('statut').anyOf('en_attente', 'envoi', 'erreur', 'conflit').toArray();
  const touches = new Set(pend.flatMap(o => (o.touche || []).map(String)));
  for (const t of TABLES_REF) await telechargerTable(t, b, touches);
  for (const t of TABLES_DOC) await telechargerTable(t, b, touches);
  await telechargerStock(b);
  try { await telechargerAlertes(b); } catch { /* lecture réservée à la gestion */ }
}

// ---------------- CYCLE ----------------
export async function synchroniser({ manuel = false } = {}) {
  if (!client || !profil()) { majEtat(); return { ignore: true }; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { majEtat('hors_ligne'); return { ignore: true }; }
  if (enCours) { relancer = true; return { ignore: true }; }
  enCours = true; majEtat('en_cours');
  try {
    const r = await envoyer(manuel);
    if (r.arret) return r;
    await telecharger();
    await setMeta('derniere_synchro', maintenant());
    const s = await resume();
    majEtat(s.erreur || s.conflit ? 'erreur' : 'ok', s.conflit ? `${s.conflit} conflit(s) à résoudre` : s.erreur ? `${s.erreur} opération(s) en erreur` : '');
    return { ...r, resume: s };
  } catch (e) {
    if (reseau(e)) majEtat('hors_ligne', 'Réseau indisponible'); else majEtat('erreur', String(e.message || e));
    return { erreur: e };
  } finally {
    enCours = false;
    if (relancer) { relancer = false; setTimeout(() => synchroniser(), 500); }
  }
}

export function demarrerSyncAuto() {
  if (minuteur) return;
  const go = () => synchroniser();
  globalThis.addEventListener?.('online', () => { majEtat(); go(); });
  globalThis.addEventListener?.('offline', () => majEtat('hors_ligne'));
  globalThis.addEventListener?.('bps:ops', () => { clearTimeout(debounce); debounce = setTimeout(go, 800); });
  minuteur = setInterval(go, CONFIG.SYNC_INTERVALLE_MS);
  go();
}

// ---------------- ACTIONS UTILISATEUR ----------------
export async function reessayer(opId) { await db.file_sync.update(opId, { statut: 'en_attente', tentatives: 0, prochaine_tentative: null }); return synchroniser({ manuel: true }); }
export async function abandonner(opId) { await db.file_sync.update(opId, { statut: 'abandonne', stock_integre: 1 }); majEtat(); }
export async function resoudreConflit(opId, choix) {
  const op = await db.file_sync.get(opId); if (!op || op.statut !== 'conflit') return;
  if (choix === 'garder_local') await db.file_sync.update(opId, { version_base: op.serveur.version, statut: 'en_attente', tentatives: 0, serveur: null });
  else { await db[op.table].put(normaliser(op.serveur)); await db.file_sync.update(opId, { statut: 'abandonne', serveur: null }); }
  return synchroniser({ manuel: true });
}
