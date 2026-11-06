// Profil local, rôles et droits. Les droits ici masquent l'interface ; la sécurité réelle est appliquée par le serveur (RLS + RPC).
import { db, getMeta, setMeta } from '../database/db.js';
import { uuid } from '../utils/id.js';

const DROITS = {
  proprietaire: '*',
  gerant: new Set(['vente', 'client_creer', 'client_modifier', 'remboursement', 'caisse_ouvrir', 'caisse_fermer', 'depense', 'retrait',
    'produit_ecrire', 'stock_ajuster', 'achat', 'annuler_vente', 'rapports', 'sauvegarde', 'forcer_stock', 'ref_ecrire']),
  caissier: new Set(['vente', 'client_creer', 'remboursement', 'caisse_ouvrir', 'caisse_fermer']),
};
export const LIBELLE_ROLE = { proprietaire: 'Propriétaire', gerant: 'Gérant', caissier: 'Caissier' };

let profilCache = null;
export const profil = () => profilCache;
export function definirProfil(p) { profilCache = p; }
export async function chargerProfil() { profilCache = await getMeta('profil'); return profilCache; }
export async function enregistrerProfil(p) { profilCache = p; await setMeta('profil', p); }

export function peut(action, role = profilCache?.role) {
  const d = DROITS[role];
  return !!d && (d === '*' || d.has(action));
}
export function garde(action) {
  if (!peut(action)) throw new Error('Action non autorisée pour votre rôle');
}

// Mode local : un seul utilisateur propriétaire, boutique créée sur l'appareil (peut être « adoptée » par le cloud plus tard).
export async function creerProfilLocal(nomBoutique) {
  const boutique_id = uuid();
  await enregistrerProfil({ mode: 'local', user_id: uuid(), email: null, role: 'proprietaire', boutique_id, boutique_nom: nomBoutique, nom: 'Utilisateur local' });
  await setMeta('boutique', { id: boutique_id, nom: nomBoutique, telephone: '', adresse: '', pied_ticket: 'Merci de votre visite !', logo: '' });
  return profilCache;
}

export async function appareil() {
  let id = await getMeta('appareil_id');
  if (!id) {
    const code = (uuid().replace(/-/g, '').slice(0, 2)).toUpperCase();
    id = `${code}-${uuid().slice(0, 8)}`;
    await setMeta('appareil_id', id);
  }
  return id;
}
export const codeAppareil = async () => (await appareil()).slice(0, 2);

// --- Verrouillage par PIN (protège l'accès à l'écran, pas un chiffrement des données locales) ---
async function hash(pin, sel) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sel}:${pin}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function definirPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Le PIN doit contenir 4 à 8 chiffres');
  const sel = uuid(); await setMeta('pin', { sel, h: await hash(pin, sel) });
}
export async function supprimerPin() { await db.meta.delete('pin'); }
export const aUnPin = async () => !!(await getMeta('pin'));
export async function verifierPin(pin) {
  const p = await getMeta('pin'); if (!p) return true;
  return (await hash(pin, p.sel)) === p.h;
}
