// Authentification et gestion de boutique via Supabase (clé publique uniquement). Optionnel : l'app marche sans.
import { CONFIG, cloudConfigure } from '../config.js';
import { db, getMeta, setMeta } from '../database/db.js';
import { profil, enregistrerProfil } from './session.js';
import { definirClient, synchroniser } from '../sync/sync.js';

let sb = null;
export const supabase = () => sb;

export function initialiserCloud() {
  if (!cloudConfigure() || !globalThis.supabase?.createClient) return null;
  sb = globalThis.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return sb;
}
export const activerSync = () => definirClient(sb);

export async function connexion(email, motDePasse) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw new Error(traduire(error.message));
  return data.user;
}
export async function inscription(email, motDePasse, nom) {
  const { data, error } = await sb.auth.signUp({ email, password: motDePasse, options: { data: { nom_complet: nom } } });
  if (error) throw new Error(traduire(error.message));
  if (!data.session) throw new Error('Compte créé. Confirmez votre e-mail puis connectez-vous.');
  return data.user;
}
export async function deconnexion() { await sb?.auth.signOut(); }

// Boutiques accessibles + rôle
export async function mesBoutiques() {
  const { data, error } = await sb.from('membres_boutiques').select('boutique_id, role, boutiques(nom)').eq('actif', true);
  if (error) throw new Error(error.message);
  return data.map(m => ({ id: m.boutique_id, role: m.role, nom: m.boutiques?.nom || 'Boutique' }));
}
export async function creerBoutiqueDistante(nom, idLocal = null) {
  const { data, error } = await sb.rpc('creer_boutique', { p_nom: nom, p_id: idLocal });
  if (error) throw new Error(traduire(error.message));
  return data;
}
export async function choisirBoutique(user, boutique) {
  const ancien = profil();
  await enregistrerProfil({ mode: 'cloud', user_id: user.id, email: user.email, role: boutique.role, boutique_id: boutique.id, boutique_nom: boutique.nom, nom: user.user_metadata?.nom_complet || user.email });
  // Changement de boutique sur le même appareil : on repart d'une base propre pour ne jamais mélanger deux boutiques.
  if (ancien && ancien.boutique_id !== boutique.id) {
    const garder = ['appareil_id', 'profil'];
    await db.transaction('rw', db.tables, async () => { for (const t of db.tables) if (t.name === 'meta') await t.filter(r => !garder.includes(r.cle)).delete(); else await t.clear(); });
    await setMeta('boutique', { id: boutique.id, nom: boutique.nom, telephone: '', adresse: '', pied_ticket: 'Merci de votre visite !' });
  }
  activerSync(); return synchroniser({ manuel: true });
}
export const membres = async b => { const { data, error } = await sb.rpc('lister_membres', { p_boutique: b }); if (error) throw new Error(error.message); return data; };
export const ajouterMembre = async (b, email, role) => { const { error } = await sb.rpc('ajouter_membre', { p_boutique: b, p_email: email, p_role: role }); if (error) throw new Error(traduire(error.message)); };

function traduire(m = '') {
  if (/invalid login/i.test(m)) return 'E-mail ou mot de passe incorrect';
  if (/already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail';
  if (/password/i.test(m) && /6|short|weak/i.test(m)) return 'Mot de passe trop court (6 caractères minimum)';
  if (/failed to fetch|network/i.test(m)) return 'Pas de connexion Internet';
  return m;
}
