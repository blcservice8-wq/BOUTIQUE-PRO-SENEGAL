// Sauvegarde complète exportable (JSON) et restauration contrôlée.
import { db, getMeta, setMeta, TABLES_SAUVEGARDE } from '../database/db.js';
import { CONFIG } from '../config.js';
import { maintenant } from '../utils/id.js';

const META_EXCLUES = new Set(['pin']); // le PIN n'est pas exporté

export async function exporterSauvegarde() {
  const donnees = {};
  for (const t of TABLES_SAUVEGARDE) donnees[t] = (await db[t].toArray()).filter(r => !(t === 'meta' && META_EXCLUES.has(r.cle)));
  const sauvegarde = { app: 'boutique-pro-senegal', version: CONFIG.VERSION_SAUVEGARDE, cree_le: maintenant(), nb: Object.fromEntries(Object.entries(donnees).map(([k, v]) => [k, v.length])), donnees };
  await setMeta('derniere_sauvegarde', sauvegarde.cree_le);
  return sauvegarde;
}

export function verifierSauvegarde(s) {
  if (!s || s.app !== 'boutique-pro-senegal' || !s.donnees) throw new Error('Fichier de sauvegarde invalide');
  if (s.version > CONFIG.VERSION_SAUVEGARDE) throw new Error('Sauvegarde créée par une version plus récente de l\'application');
  for (const t of Object.keys(s.donnees)) if (!TABLES_SAUVEGARDE.includes(t)) throw new Error(`Table inconnue dans la sauvegarde : ${t}`);
  return true;
}

// Restauration : remplace TOUTES les données locales. Une sauvegarde de sécurité de l'état actuel est renvoyée pour pouvoir annuler.
export async function restaurerSauvegarde(s) {
  verifierSauvegarde(s);
  const avant = await exporterSauvegarde();
  const pin = await db.meta.get('pin'), appareil = await db.meta.get('appareil_id');
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES_SAUVEGARDE) await db[t].clear();
    for (const [t, rows] of Object.entries(s.donnees)) if (rows.length) await db[t].bulkPut(rows);
    if (pin) await db.meta.put(pin);
    if (appareil) await db.meta.put(appareil);   // l'identité de l'appareil ne change jamais (numérotation des tickets)
  });
  return { sauvegarde_avant: avant };
}
