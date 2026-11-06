import 'fake-indexeddb/auto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { creerDb } from '../src/database/db.js';
import * as DB from '../src/database/db.js';
import { definirProfil } from '../src/services/session.js';
import * as ops from '../src/services/ops.js';
import * as R from '../src/services/rapports.js';
import { exporterSauvegarde, restaurerSauvegarde, verifierSauvegarde } from '../src/services/backup.js';
import { uuid } from '../src/utils/id.js';

let p, cl;
before(async () => {
  DB.utiliserDb(creerDb('rapports')); definirProfil({ mode: 'local', user_id: uuid(), role: 'proprietaire', boutique_id: uuid() });
  p = await ops.sauverProduit({ reference: 'RIZ', nom: 'Riz', unite: 'sac', prix_achat: 16000, prix_vente: 18000, stock_min: 5, stock_initial: 10 });
  cl = await ops.sauverClient({ nom: 'Moussa', telephone: '77' });
  await ops.ouvrirCaisse(0);
  await ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 2, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 36000 }] });
  await ops.enregistrerVente({ id: uuid(), client_id: cl.id, lignes: [{ produit_id: p.id, quantite: 3, prix_unitaire: 18000 }], paiements: [{ mode: 'wave', montant: 20000 }] });
  await ops.enregistrerDepense({ categorie: 'transport', montant: 3000 });
  await ops.rembourserClient(cl.id, 4000, 'especes');
});

test('indicateurs : CA, marge brute, dépenses, bénéfice estimé distincts', async () => {
  const c = await R.chiffres(R.periode('jour'));
  assert.equal(c.nb_ventes, 2); assert.equal(c.ca, 90000);
  assert.equal(c.marge_brute, 10000);                       // 5 sacs × 2000
  assert.equal(c.depenses, 3000); assert.equal(c.benefice_net_estime, 7000);
  assert.equal(c.encaisse_ventes, 56000);                    // le crédit n'est pas encaissé
  assert.equal(c.encaisse_remboursements, 4000);             // distinct des ventes du jour
  assert.equal(c.credit_accorde, 34000);
});
test('créances, stock, alertes', async () => {
  assert.equal((await R.creances()).total, 30000);
  const s = await R.etatStock();
  assert.equal(s.valeur, 5 * 16000); assert.equal(s.alertes.length, 1); assert.equal(s.alertes[0].statut, 'bas');
  const tb = await R.tableauDeBord(); assert.equal(tb.top[0].designation, 'Riz'); assert.equal(tb.jour.ca, 90000);
});
test('tous les rapports se génèrent', async () => {
  for (const t of Object.keys(R.TYPES_RAPPORT)) { const r = await R.rapport(t, R.periode('mois')); assert.ok(r.titre && Array.isArray(r.lignes), t); }
  const m = await R.rapport('marges', R.periode('jour')); assert.match(m.lignes[3].k, /non certifié/);
  const mv = await R.rapport('mouvements', R.periode('jour')); assert.ok(mv.lignes.length >= 3);
});
test('sauvegarde et restauration : aller-retour complet, PIN non exporté', async () => {
  await DB.setMeta('pin', { sel: 's', h: 'h' });
  const s = await exporterSauvegarde(); verifierSauvegarde(s);
  assert.ok(!s.donnees.meta.some(r => r.cle === 'pin'));
  const nb = await DB.db.ventes.count();
  await DB.db.ventes.clear(); await DB.db.lignes_vente.clear();
  await restaurerSauvegarde(JSON.parse(JSON.stringify(s)));
  assert.equal(await DB.db.ventes.count(), nb);
  assert.ok(await DB.db.meta.get('pin'));                    // le PIN local survit à la restauration
  assert.throws(() => verifierSauvegarde({ app: 'autre', donnees: {} }), /invalide/);
  assert.throws(() => verifierSauvegarde({ app: 'boutique-pro-senegal', version: 1, donnees: { x: [] } }), /Table inconnue/);
});
