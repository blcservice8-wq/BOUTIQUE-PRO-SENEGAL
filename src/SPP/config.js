// Configuration. Aucune clé secrète ici : seule la clé PUBLIQUE « anon » de Supabase est utilisée
// (la sécurité repose sur les politiques RLS du serveur). Ne jamais mettre la clé « service_role » dans ce fichier.
const surcharge = (() => {
  try { return JSON.parse(globalThis.localStorage?.getItem('bps_config') || '{}'); } catch { return {}; }
})();

export const CONFIG = {
  NOM_APP: 'Boutique Pro Sénégal',
  DEVISE: 'XOF',
  SUPABASE_URL: surcharge.SUPABASE_URL || 'https://mdykuiczqszbumxgocct.supabase.co',          // vide = mode local (aucune synchronisation)
  SUPABASE_ANON_KEY: surcharge.SUPABASE_ANON_KEY || 'sb_publishable_2NPoLMHtHlewDXhgSJ0vUg_ill4lhVh',
  SYNC_INTERVALLE_MS: 30_000,
  MAX_TENTATIVES: 8,
  BACKOFF_BASE_MS: 2_000,
  BACKOFF_MAX_MS: 300_000,
  VERROU_INACTIVITE_MIN: 5,
  PULL_CHEVAUCHEMENT_MS: 120_000,                      // marge de sécurité du curseur de téléchargement
  VERSION_SAUVEGARDE: 1,
};

export function enregistrerConfigDistante(url, anonKey) {
  localStorage.setItem('bps_config', JSON.stringify({ SUPABASE_URL: url.trim(), SUPABASE_ANON_KEY: anonKey.trim() }));
}
export const cloudConfigure = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
