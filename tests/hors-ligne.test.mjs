// Tests bout en bout : vraie base locale (IndexedDB simulée), vrai code client, vraie synchro, vrai SQL/RLS (PGlite).
import 'fake-indexeddb/auto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { creerDb } from '../src/database/db.js';
import * as DB from '../src/database/db.js';
import { definirProfil, appareil } from '../src/services/session.js';
import * as ops from '../src/services/ops.js';
import { stocksAffiches } from '../src/services/stock.js';
import * as sync from '../src/sync/sync.js';
import { creerServeur, creerClient } from './helpers/pg-client.mjs';
import { uuid } from '../src/utils/id.js';

let pg; const U = uuid(), U2 = uuid(); let B, n = 0;
const etatReseau = { coupe: false, appels: 0 };
const nouvelAppareil = async (nom = `t${++n}`, user = U, role = 'proprietaire') => {
  DB.utiliserDb(creerDb(nom)); definirProfil({ mode: 'cloud', user_id: user, role, boutique_id: B, boutique_nom: 'Test' });
  return nom;
};
const SYNC = () => sync.synchroniser({ manuel: true });
const q = async (sql, p = []) => (await pg.query(sql, p)).rows;

before(async () => {
  pg = await creerServeur();
  for (const [id, e] of [[U, 'a@x.sn'], [U2, 'b@x.sn']]) await pg.query('insert into auth.users(id,email) values ($1,$2)', [id, e]);
  await pg.query(`select set_config('request.jwt.sub',$1,false)`, [U]); await pg.exec('set role authenticated');
  B = (await pg.query(`select creer_boutique('Boutique test', null) as id`)).rows[0].id; await pg.exec('reset role');
  sync.definirClient(null);
});

async function boutiqueAvecProduit(stockInitial = 10) {
  const p = await ops.sauverProduit({ reference: 'R' + uuid().slice(0, 6), nom: 'Riz 50kg', unite: 'sac', prix_achat: 16000, prix_vente: 18000, stock_min: 2, stock_initial: stockInitial });
  return p;
}

test('hors connexion : vente enregistrée, stock déduit, données conservées après fermeture/réouverture', async () => {
  const nom = await nouvelAppareil();
  sync.definirClient(null);
  const p = await boutiqueAvecProduit(10);
  await ops.ouvrirCaisse(5000);
  const r = await ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 2, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 36000 }] });
  assert.equal(r.vente.total, 36000);
  assert.equal((await stocksAffiches()).get(p.id), 8);
  assert.equal(await ops.soldeTheoriqueCaisse((await ops.caisseOuverte()).id), 41000);
  // fermeture / réouverture de l'application
  DB.db.close(); DB.utiliserDb(creerDb(nom));
  assert.equal((await DB.db.ventes.count()), 1);
  assert.equal((await stocksAffiches()).get(p.id), 8);
  assert.ok((await DB.db.file_sync.where('statut').equals('en_attente').count()) >= 4);
});

test('retour de connexion : synchronisation complète, aucun doublon, stock cohérent', async () => {
  await nouvelAppareil(); sync.definirClient(null);
  const p = await boutiqueAvecProduit(10);
  await ops.ouvrirCaisse(0);
  const v = { id: uuid(), lignes: [{ produit_id: p.id, quantite: 3, prix_unitaire: 18000 }], paiements: [{ mode: 'wave', montant: 54000 }] };
  await ops.enregistrerVente(v);
  const avant = (await stocksAffiches()).get(p.id);
  sync.definirClient(creerClient(pg, U, etatReseau));
  const r = await SYNC();
  assert.equal(r.resume.erreur, 0); assert.equal(r.resume.en_attente, 0);
  assert.equal((await q('select count(*)::int n from ventes where id=$1', [v.id]))[0].n, 1);
  assert.equal((await stocksAffiches()).get(p.id), avant);                       // pas de double comptage après pull
  assert.equal(Number((await q('select stock from v_stock_produit where produit_id=$1', [p.id]))[0].stock), 7);
  await SYNC(); await SYNC();                                                      // synchros répétées : rien ne change
  assert.equal((await q('select count(*)::int n from ventes where id=$1', [v.id]))[0].n, 1);
  assert.equal((await stocksAffiches()).get(p.id), 7);
});

test('double clic et renvoi après coupure : une seule vente', async () => {
  await nouvelAppareil(); sync.definirClient(creerClient(pg, U, etatReseau));
  const p = await boutiqueAvecProduit(10); await SYNC();
  const v = { id: uuid(), lignes: [{ produit_id: p.id, quantite: 1, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 18000 }] };
  const [a, b] = await Promise.all([ops.enregistrerVente(v), ops.enregistrerVente(v)].map(x => x.catch(e => ({ erreur: e }))));
  assert.equal(await DB.db.ventes.where("id").equals(v.id).count(), 1);
  await SYNC();
  // perte de l'accusé de réception : l'appareil croit l'opération non envoyée et la renvoie
  await DB.db.file_sync.update(v.id, { statut: 'en_attente', stock_integre: 0 });
  await SYNC();
  assert.equal((await q('select count(*)::int n from ventes where id=$1', [v.id]))[0].n, 1);
  assert.equal(Number((await q('select stock from v_stock_produit where produit_id=$1', [p.id]))[0].stock), 9);
  assert.equal((await stocksAffiches()).get(p.id), 9);
});

test('coupure réseau pendant la synchro : opérations conservées, reprise automatique', async () => {
  await nouvelAppareil(); sync.definirClient(creerClient(pg, U, etatReseau));
  const p = await boutiqueAvecProduit(5); await SYNC();
  await ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 1, prix_unitaire: 18000 }], paiements: [{ mode: 'wave', montant: 18000 }] });
  etatReseau.coupe = true; await SYNC();
  assert.equal(sync.lireEtat().etat, 'hors_ligne');
  const attente = await DB.db.file_sync.where('statut').equals('en_attente').toArray();
  assert.equal(attente.length, 1); assert.equal(attente[0].tentatives, 0);        // coupure réseau ≠ échec de l'opération
  etatReseau.coupe = false; await SYNC();
  assert.equal((await DB.db.file_sync.where('statut').equals('synchronise').count()) >= 2, true);
  assert.equal(sync.lireEtat().etat, 'ok');
});

test('erreur métier : isolée, comptée, reprogrammée avec backoff ; les autres opérations passent', async () => {
  await nouvelAppareil(); sync.definirClient(creerClient(pg, U, etatReseau));
  const p = await boutiqueAvecProduit(5); await SYNC();
  // opération invalide injectée (client falsifié) : produit inexistant côté serveur
  await DB.db.file_sync.put({ op_id: uuid(), kind: 'rpc', type: 'vente', boutique_id: B, appareil_id: await appareil(), seq: 9999, statut: 'en_attente', tentatives: 0, stock_integre: 0, touche: [],
    payload: { id: uuid(), numero: 'BAD-1', caisse_id: null, vendu_le: new Date().toISOString(), remise: 0, lignes: [{ id: uuid(), produit_id: uuid(), quantite: 1, prix_unitaire: 100 }], paiements: [{ id: uuid(), mode: 'wave', montant: 100 }] }, cree_le: new Date().toISOString() });
  await ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 1, prix_unitaire: 18000 }], paiements: [{ mode: 'wave', montant: 18000 }] });
  await SYNC();
  const err = await DB.db.file_sync.where('statut').equals('erreur').toArray();
  assert.equal(err.length, 1); assert.equal(err[0].tentatives, 1); assert.match(err[0].derniere_erreur, /Produit inconnu/);
  assert.ok(err[0].prochaine_tentative);
  assert.equal(sync.lireEtat().etat, 'erreur');
  assert.ok(sync.delaiBackoff(3) > sync.delaiBackoff(1));
  await sync.abandonner(err[0].op_id);
  assert.equal((await sync.resume()).erreur, 0);
});

test('conflit de fiche : détecté, jamais écrasé en silence, résolution manuelle', async () => {
  await nouvelAppareil('conflit-A'); sync.definirClient(creerClient(pg, U, etatReseau));
  const p = await boutiqueAvecProduit(1); await SYNC();
  // un autre appareil modifie le prix côté serveur
  await pg.query('update produits set prix_vente = 19000 where id=$1', [p.id]);
  // cet appareil (hors ligne, ancienne version) modifie aussi le prix
  const local = await DB.db.produits.get(p.id);
  await ops.sauverProduit({ ...local, prix_vente: 20000 });
  await SYNC();
  const c = await DB.db.file_sync.where('statut').equals('conflit').toArray();
  assert.equal(c.length, 1);
  assert.equal(Number((await q('select prix_vente from produits where id=$1', [p.id]))[0].prix_vente), 19000); // serveur intact
  await sync.resoudreConflit(c[0].op_id, 'garder_local');
  assert.equal(Number((await q('select prix_vente from produits where id=$1', [p.id]))[0].prix_vente), 20000);
  assert.equal((await DB.db.produits.get(p.id)).prix_vente, 20000);
});

test('deux caissiers hors ligne vendent la dernière unité : aucune vente perdue, stock négatif signalé', async () => {
  await nouvelAppareil('gerant'); sync.definirClient(creerClient(pg, U, etatReseau));
  const p = await boutiqueAvecProduit(1); await SYNC();
  await pg.query(`insert into membres_boutiques(boutique_id, utilisateur_id, role) values ($1,$2,'caissier')`, [B, U2]);
  const vendre = async (nom, user, role) => {
    await nouvelAppareil(nom, user, role); sync.definirClient(null);
    // l'appareil a téléchargé le catalogue avant la coupure
    await DB.db.produits.put({ ...(await q('select * from produits where id=$1', [p.id]))[0], prix_achat: 16000, prix_vente: 18000, version: 1 });
    await DB.db.stock_serveur.put({ produit_id: p.id, stock: 1 });
    await ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 1, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 18000 }] });
    sync.definirClient(creerClient(pg, user, etatReseau)); return SYNC();
  };
  await vendre('caisse-1', U, 'proprietaire'); await vendre('caisse-2', U2, 'caissier');
  assert.equal((await q(`select count(*)::int n from ventes where boutique_id=$1`, [B]))[0].n >= 2, true);
  assert.equal(Number((await q('select stock from v_stock_produit where produit_id=$1', [p.id]))[0].stock), -1);
  // le responsable reçoit l'alerte à sa prochaine synchro
  await nouvelAppareil('gerant-2'); sync.definirClient(creerClient(pg, U, etatReseau)); await SYNC();
  assert.ok((await DB.db.alertes.count()) >= 1);
});

test('annulation, crédit et remboursement hors ligne puis synchro', async () => {
  await nouvelAppareil(); sync.definirClient(null);
  const p = await boutiqueAvecProduit(10);
  const cl = await ops.sauverClient({ nom: 'Fatou Ndiaye', telephone: '771234567' });
  await ops.ouvrirCaisse(0);
  const r = await ops.enregistrerVente({ id: uuid(), client_id: cl.id, lignes: [{ produit_id: p.id, quantite: 2, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 10000 }] });
  assert.equal(await ops.soldeClient(cl.id), 26000);
  const rem = await ops.rembourserClient(cl.id, 6000, 'especes');
  assert.equal(rem.solde_restant, 20000);
  await assert.rejects(ops.rembourserClient(cl.id, 50000), /dépasse la dette/);
  const caisse = await ops.caisseOuverte();
  assert.equal(await ops.soldeTheoriqueCaisse(caisse.id), 10000 + 6000);          // crédit ≠ espèces ; remboursement = encaissement distinct
  sync.definirClient(creerClient(pg, U, etatReseau)); await SYNC();
  assert.equal(Number((await q('select solde from v_solde_client where client_id=$1', [cl.id]))[0].solde), 20000);
  assert.equal(await ops.soldeClient(cl.id), 20000);
  const rap = await ops.fermerCaisse(15000); assert.equal(rap.ecart, -1000);
  await SYNC();
  const c = (await q('select statut, ecart from caisses where id=$1', [caisse.id]))[0];
  assert.equal(c.statut, 'fermee'); assert.equal(Number(c.ecart), -1000);
});

test('rôle caissier : droits refusés localement ET par le serveur', async () => {
  await nouvelAppareil('role-p'); sync.definirClient(null); const p = await boutiqueAvecProduit(3);
  await nouvelAppareil('role-c', U2, 'caissier');
  await assert.rejects(ops.sauverProduit({ reference: 'X', nom: 'X', unite: 'unite', prix_achat: 1, prix_vente: 2 }), /non autorisée/);
  await assert.rejects(ops.enregistrerDepense({ categorie: 'transport', montant: 100 }), /non autorisée/);
  await assert.rejects(ops.annulerVente(uuid(), 'x'), /non autorisée/);
  // contournement de l'interface : opération forgée envoyée directement au serveur
  const forge = { id: uuid(), caisse_id: null, categorie: 'transport', montant: 100, depense_le: new Date().toISOString() };
  const r = await creerClient(pg, U2, etatReseau).rpc('appliquer_operation', { p_boutique: B, p_op_id: forge.id, p_type: 'depense', p_appareil: 'X', p_payload: forge });
  assert.match(r.error.message, /Droits insuffisants/);
});

test('stock insuffisant refusé par défaut ; autorisation explicite par produit', async () => {
  await nouvelAppareil(); sync.definirClient(null);
  const p = await boutiqueAvecProduit(1);
  await assert.rejects(ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 2, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 36000 }] }), /Stock insuffisant/);
  await ops.sauverProduit({ ...(await DB.db.produits.get(p.id)), autoriser_stock_negatif: true });
  await ops.enregistrerVente({ id: uuid(), lignes: [{ produit_id: p.id, quantite: 2, prix_unitaire: 18000 }], paiements: [{ mode: 'especes', montant: 36000 }] });
  assert.equal((await stocksAffiches()).get(p.id), -1);
});
