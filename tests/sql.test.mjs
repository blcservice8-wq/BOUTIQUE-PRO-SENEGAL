// Tests SQL réels : migrations exécutées dans PostgreSQL (PGlite, WASM), RLS comprise.
// Lancer : npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const uuid = () => crypto.randomUUID();
const db = new PGlite();

const OWNER = uuid(), OWNER2 = uuid(), CAISSIER = uuid(), GERANT = uuid();
let B1, B2;
const P = {}; // ids de test

async function as(uid, sql, params = []) {
  await db.query(`select set_config('request.jwt.sub', $1, false)`, [uid]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role'); }
}
const op = (uid, b, type, payload, id = uuid(), appareil = 'A1') =>
  as(uid, 'select appliquer_operation($1,$2,$3,$4,$5::jsonb) as r', [b, id, type, appareil, JSON.stringify(payload)]).then(r => r.rows[0].r);
const stock = async (b, prod) => Number((await db.query('select coalesce(sum(quantite),0) s from mouvements_stock where boutique_id=$1 and produit_id=$2', [b, prod])).rows[0].s);
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const now = () => new Date().toISOString();

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
    create role authenticated; create role anon;
    grant usage on schema public, auth to authenticated, anon;`);
  for (const f of fs.readdirSync(dir).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  await db.exec(fs.readFileSync(path.join(dir, '..', 'seed.sql'), 'utf8'));
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated');
  for (const [id, e] of [[OWNER, 'owner@x.sn'], [OWNER2, 'owner2@x.sn'], [CAISSIER, 'caisse@x.sn'], [GERANT, 'gerant@x.sn']])
    await db.query('insert into auth.users(id,email) values ($1,$2)', [id, e]);

  B1 = (await as(OWNER, `select creer_boutique('Boutique 1', null) as id`)).rows[0].id;
  B2 = (await as(OWNER2, `select creer_boutique('Boutique 2', null) as id`)).rows[0].id;
  await as(OWNER, `select ajouter_membre($1, 'caisse@x.sn', 'caissier')`, [B1]);
  await as(OWNER, `select ajouter_membre($1, 'gerant@x.sn', 'gerant')`, [B1]);

  P.prod = uuid(); P.prod2 = uuid(); P.four = uuid(); P.client = uuid();
  await as(OWNER, `insert into fournisseurs(id,boutique_id,nom) values ($1,$2,'Grossiste Sandaga')`, [P.four, B1]);
  await as(OWNER, `insert into produits(id,boutique_id,reference,nom,prix_achat,prix_vente) values ($1,$2,'RIZ-50','Riz 50kg',16000,18000),($3,$2,'HUILE-5','Huile 5L',4000,4800)`, [P.prod, B1, P.prod2]);
  await as(OWNER, `insert into clients(id,boutique_id,nom,telephone) values ($1,$2,'Fatou Ndiaye','771234567')`, [P.client, B1]);
  await op(OWNER, B1, 'ajustement_stock', { id: uuid(), produit_id: P.prod, type: 'entree_diverse', quantite: 10, motif: 'Stock initial', survenu_le: now() });
  await op(OWNER, B1, 'ajustement_stock', { id: uuid(), produit_id: P.prod2, type: 'entree_diverse', quantite: 20, motif: 'Stock initial', survenu_le: now() });
  P.caisse = uuid();
  await op(CAISSIER, B1, 'ouverture_caisse', { id: P.caisse, fonds_initial: 5000, ouverte_le: now() });
});

const vente = (over = {}) => ({
  id: uuid(), numero: 'A1-' + Math.random().toString(36).slice(2, 8), caisse_id: P.caisse, client_id: null, vendu_le: now(), remise: 0,
  lignes: [{ id: uuid(), produit_id: P.prod, quantite: 2, prix_unitaire: 18000, remise_ligne: 0 }],
  paiements: [{ id: uuid(), mode: 'especes', montant: 36000 }], ...over
});

test('isolation : une boutique ne voit pas les données d\'une autre', async () => {
  assert.equal((await as(OWNER2, 'select count(*)::int n from produits')).rows[0].n, 0);
  assert.equal((await as(OWNER2, 'select count(*)::int n from produits where boutique_id=$1', [B1])).rows[0].n, 0);
  assert.equal((await as(OWNER, 'select count(*)::int n from produits')).rows[0].n, 2);
  await assert.rejects(op(OWNER2, B1, 'vente', vente()), /Accès refusé/);
  await assert.rejects(as(OWNER2, `insert into produits(id,boutique_id,reference,nom) values ($1,$2,'X','Intrus')`, [uuid(), B1]));
});

test('vente au comptant : totaux, stock, caisse (espèces seulement)', async () => {
  const v = vente();
  assert.equal(await op(CAISSIER, B1, 'vente', v), 'ok');
  const r = await one('select total,total_paye,reste_a_payer,statut from ventes where id=$1', [v.id]);
  assert.deepEqual([Number(r.total), Number(r.total_paye), Number(r.reste_a_payer), r.statut], [36000, 36000, 0, 'valide']);
  assert.equal(await stock(B1, P.prod), 8);
  const c = await one(`select coalesce(sum(sens*montant),0) s from mouvements_caisse where caisse_id=$1`, [P.caisse]);
  assert.equal(Number(c.s), 5000 + 36000);
  const l = await one('select prix_achat_unitaire from lignes_vente where vente_id=$1', [v.id]);
  assert.equal(Number(l.prix_achat_unitaire), 16000); // coût figé pour la marge
});

test('idempotence : double envoi = aucun doublon', async () => {
  const v = vente({ lignes: [{ id: uuid(), produit_id: P.prod2, quantite: 3, prix_unitaire: 4800 }], paiements: [{ id: uuid(), mode: 'wave', montant: 14400 }] });
  const opId = uuid();
  assert.equal(await op(CAISSIER, B1, 'vente', v, opId), 'ok');
  assert.equal(await op(CAISSIER, B1, 'vente', v, opId), 'deja_applique');
  assert.equal(await op(CAISSIER, B1, 'vente', v, opId), 'deja_applique');
  assert.equal((await one('select count(*)::int n from ventes where id=$1', [v.id])).n, 1);
  assert.equal(await stock(B1, P.prod2), 17);
});

test('paiement mobile : vente enregistrée mais pas d\'espèces en caisse', async () => {
  const avant = Number((await one('select coalesce(sum(sens*montant),0) s from mouvements_caisse where caisse_id=$1', [P.caisse])).s);
  await op(CAISSIER, B1, 'vente', vente({ paiements: [{ id: uuid(), mode: 'orange_money', montant: 36000, reference_externe: 'OM123' }] }));
  const apres = Number((await one('select coalesce(sum(sens*montant),0) s from mouvements_caisse where caisse_id=$1', [P.caisse])).s);
  assert.equal(apres, avant);
});

test('vente à crédit : dette créée, pas d\'espèces encaissées pour la part crédit', async () => {
  const v = vente({ client_id: P.client, paiements: [{ id: uuid(), mode: 'especes', montant: 10000 }] });
  const avant = Number((await one('select coalesce(sum(sens*montant),0) s from mouvements_caisse where caisse_id=$1', [P.caisse])).s);
  await op(CAISSIER, B1, 'vente', { ...v, credit_id: (P.credit = uuid()), echeance: '2026-12-01' });
  const r = await one('select total_paye,reste_a_payer from ventes where id=$1', [v.id]);
  assert.deepEqual([Number(r.total_paye), Number(r.reste_a_payer)], [10000, 26000]);
  const apres = Number((await one('select coalesce(sum(sens*montant),0) s from mouvements_caisse where caisse_id=$1', [P.caisse])).s);
  assert.equal(apres - avant, 10000);
  assert.equal(Number((await one('select solde from v_solde_client where client_id=$1', [P.client])).solde), 26000);
  P.venteCredit = v.id;
});

test('crédit sans client : refusé', async () => {
  await assert.rejects(op(CAISSIER, B1, 'vente', vente({ paiements: [{ id: uuid(), mode: 'especes', montant: 1000 }] })), /client obligatoire/);
});

test('remboursement partiel puis refus du trop-perçu, solde calculé', async () => {
  const rid = uuid();
  await op(CAISSIER, B1, 'remboursement', { id: rid, credit_id: P.credit, montant: 6000, mode: 'especes', caisse_id: P.caisse, rembourse_le: now() });
  assert.equal(Number((await one('select solde from v_solde_client where client_id=$1', [P.client])).solde), 20000);
  await assert.rejects(op(CAISSIER, B1, 'remboursement', { id: uuid(), credit_id: P.credit, montant: 99999, mode: 'especes', caisse_id: P.caisse, rembourse_le: now() }), /supérieur au reste/);
  assert.equal((await one(`select count(*)::int n from mouvements_caisse where type='remboursement_credit'`)).n, 1); // distinct des ventes
  await op(CAISSIER, B1, 'remboursement', { id: uuid(), credit_id: P.credit, montant: 20000, mode: 'wave', rembourse_le: now() });
  assert.equal((await one('select statut from credits_clients where id=$1', [P.credit])).statut, 'solde');
});

test('montants falsifiés : le serveur recalcule et refuse', async () => {
  await assert.rejects(op(CAISSIER, B1, 'vente', vente({ paiements: [{ id: uuid(), mode: 'especes', montant: 999999 }] })), /supérieurs au total/);
  await assert.rejects(op(CAISSIER, B1, 'vente', vente({ lignes: [{ id: uuid(), produit_id: P.prod, quantite: -1, prix_unitaire: 100 }] })), /invalide/);
  await assert.rejects(op(CAISSIER, B1, 'vente', vente({ remise: 10 ** 9 })), /Remise/);
  await assert.rejects(op(CAISSIER, B1, 'vente', vente({ paiements: [{ id: uuid(), mode: 'credit', montant: 36000 }] })), /crédit/i);
});

test('rôles : caissier limité, gérant autorisé, contrôle côté serveur', async () => {
  const dep = { id: uuid(), caisse_id: P.caisse, categorie: 'transport', montant: 2000, description: 'Livraison', depense_le: now() };
  await assert.rejects(op(CAISSIER, B1, 'depense', dep), /Droits insuffisants/);
  await assert.rejects(op(CAISSIER, B1, 'annulation_vente', { id: uuid(), vente_id: P.venteCredit, motif: 'x' }), /Droits insuffisants/);
  await assert.rejects(as(CAISSIER, `insert into produits(id,boutique_id,reference,nom) values ($1,$2,'Z','Z')`, [uuid(), B1]));
  assert.equal((await as(CAISSIER, 'select count(*)::int n from achats')).rows[0].n, 0); // le caissier ne voit pas les achats
  assert.equal(await op(GERANT, B1, 'depense', dep), 'ok');
  assert.equal((await as(CAISSIER, 'select count(*)::int n from depenses')).rows[0].n, 1); // lecture membre
  assert.equal((await as(GERANT, 'select count(*)::int n from membres_boutiques')).rows[0].n, 1); // gérant ne voit que sa ligne
});

test('écritures directes interdites sur les documents financiers', async () => {
  await assert.rejects(as(OWNER, `insert into ventes(id,boutique_id,numero,appareil_id,caissier_id,sous_total,total,vendu_le) values ($1,$2,'HACK','A',$3,1,1,now())`, [uuid(), B1, OWNER]));
  // sans policy UPDATE, la RLS filtre silencieusement : 0 ligne modifiée, montant intact
  const maj = await as(OWNER, `update ventes set total=1 where id=$1`, [P.venteCredit]);
  assert.equal(maj.affectedRows, 0);
  assert.equal(Number((await one('select total from ventes where id=$1', [P.venteCredit])).total), 36000);
  await assert.rejects(db.query(`update ventes set total=1 where id=$1`, [P.venteCredit]), /non modifiables|interdit/);
  await assert.rejects(db.query(`delete from ventes where id=$1`, [P.venteCredit]), /Suppression interdite/);
  await assert.rejects(db.query(`delete from mouvements_stock`), /ajout seul/);
  await assert.rejects(db.query(`update paiements_vente set montant=1`), /ajout seul/);
});

test('annulation de vente : stock réintégré, caisse corrigée, crédit annulé, pas de double annulation', async () => {
  const v = vente({ client_id: P.client, paiements: [{ id: uuid(), mode: 'especes', montant: 10000 }] });
  await op(CAISSIER, B1, 'vente', { ...v, credit_id: uuid() });
  const avantStock = await stock(B1, P.prod);
  await op(GERANT, B1, 'annulation_vente', { id: uuid(), vente_id: v.id, motif: 'Erreur de saisie', caisse_id: P.caisse });
  assert.equal(await stock(B1, P.prod), avantStock + 2);
  assert.equal((await one('select statut from ventes where id=$1', [v.id])).statut, 'annule');
  assert.equal((await one('select statut from credits_clients where vente_id=$1', [v.id])).statut, 'annule');
  await op(GERANT, B1, 'annulation_vente', { id: uuid(), vente_id: v.id, motif: 'encore', caisse_id: P.caisse }); // sans effet
  assert.equal(await stock(B1, P.prod), avantStock + 2);
  await assert.rejects(op(GERANT, B1, 'annulation_vente', { id: uuid(), vente_id: P.venteCredit, motif: '' }), /Motif/);
});

test('achat : seule la marchandise reçue augmente le stock ; dette fournisseur', async () => {
  const achat = uuid(), la = uuid(); const avant = await stock(B1, P.prod);
  await op(GERANT, B1, 'achat', { id: achat, numero: 'ACH-1', fournisseur_id: P.four, commande_le: now(),
    lignes: [{ id: la, produit_id: P.prod, quantite_commandee: 20, prix_achat_unitaire: 15500 }] });
  assert.equal(await stock(B1, P.prod), avant); // commandé ≠ reçu
  await op(GERANT, B1, 'reception', { achat_id: achat, recu_le: now(), lignes: [{ ligne_id: la, quantite_recue: 12 }] });
  assert.equal(await stock(B1, P.prod), avant + 12);
  assert.equal((await one('select statut from achats where id=$1', [achat])).statut, 'recu_partiel');
  await assert.rejects(op(GERANT, B1, 'reception', { achat_id: achat, recu_le: now(), lignes: [{ ligne_id: la, quantite_recue: 9 }] }), /supérieure à la commande/);
  await op(GERANT, B1, 'reception', { achat_id: achat, recu_le: now(), lignes: [{ ligne_id: la, quantite_recue: 8 }] });
  assert.equal((await one('select statut from achats where id=$1', [achat])).statut, 'recu');
  const f = uuid();
  await op(GERANT, B1, 'facture_fournisseur', { id: f, achat_id: achat, fournisseur_id: P.four, numero: 'F-77', montant: 310000, echeance: '2026-11-30', emise_le: now() });
  await op(GERANT, B1, 'paiement_fournisseur', { id: uuid(), facture_id: f, montant: 100000, mode: 'especes', caisse_id: P.caisse, paye_le: now() });
  assert.equal(Number((await one('select reste from v_solde_facture where facture_id=$1', [f])).reste), 210000);
  await assert.rejects(op(GERANT, B1, 'paiement_fournisseur', { id: uuid(), facture_id: f, montant: 999999, mode: 'wave', paye_le: now() }), /supérieur au reste/);
});

test('stock : ajustement justifié, inventaire, conflit de stock signalé sans bloquer la vente', async () => {
  await assert.rejects(op(GERANT, B1, 'ajustement_stock', { id: uuid(), produit_id: P.prod2, type: 'perte', quantite: -1, motif: '', survenu_le: now() }), /Motif/);
  const avant = await stock(B1, P.prod2);
  await op(GERANT, B1, 'ajustement_stock', { id: uuid(), produit_id: P.prod2, type: 'casse', quantite: -2, motif: 'Bidons percés', survenu_le: now() });
  assert.equal(await stock(B1, P.prod2), avant - 2);
  await op(GERANT, B1, 'inventaire', { id: uuid(), realise_le: now(), lignes: [{ id: uuid(), produit_id: P.prod2, quantite_comptee: 10 }] });
  assert.equal(await stock(B1, P.prod2), 10);
  // vente hors ligne au-delà du stock : acceptée, alerte créée
  await op(CAISSIER, B1, 'vente', vente({ lignes: [{ id: uuid(), produit_id: P.prod2, quantite: 15, prix_unitaire: 4800 }], paiements: [{ id: uuid(), mode: 'especes', montant: 72000 }] }));
  assert.equal(await stock(B1, P.prod2), -5);
  assert.ok((await one(`select count(*)::int n from journal_activite where action='conflit_stock'`)).n >= 1);
});

test('clôture de caisse : solde théorique vs compté', async () => {
  const theo = Number((await one('select coalesce(sum(sens*montant),0) s from mouvements_caisse where caisse_id=$1', [P.caisse])).s);
  await op(CAISSIER, B1, 'cloture_caisse', { id: uuid(), caisse_id: P.caisse, montant_compte: theo - 1500, fermee_le: now() });
  const c = await one('select statut,solde_theorique,montant_compte,ecart from caisses where id=$1', [P.caisse]);
  assert.deepEqual([c.statut, Number(c.solde_theorique), Number(c.ecart)], ['fermee', theo, -1500]);
});

test('membres : impossible de retirer le dernier propriétaire', async () => {
  await assert.rejects(db.query(`update membres_boutiques set role='caissier' where boutique_id=$1 and utilisateur_id=$2`, [B1, OWNER]), /au moins un propriétaire/);
  await assert.rejects(as(GERANT, `select ajouter_membre($1,'owner2@x.sn','caissier')`, [B1]), /Réservé au propriétaire/);
});

test('journal d\'activité : actions tracées et non modifiables', async () => {
  assert.ok((await one(`select count(*)::int n from journal_activite where boutique_id=$1`, [B1])).n > 5);
  await assert.rejects(db.query('delete from journal_activite'), /ajout seul/);
});

test('seed : données de démonstration réservées au propriétaire, une seule fois', async () => {
  await assert.rejects(as(GERANT, `select charger_donnees_demo($1)`, [B1]), /Réservé au propriétaire/);
  await assert.rejects(as(OWNER2, `select charger_donnees_demo($1)`, [B1]), /Réservé au propriétaire/);
  await as(OWNER2, `select charger_donnees_demo($1)`, [B2]);
  assert.equal((await as(OWNER2, `select count(*)::int n from produits where reference like 'DEMO-%'`)).rows[0].n, 5);
  assert.equal(Number((await db.query(`select sum(quantite) s from mouvements_stock where boutique_id=$1`, [B2])).rows[0].s) > 0, true);
  await assert.rejects(as(OWNER2, `select charger_donnees_demo($1)`, [B2]), /déjà chargées/);
});

test('collision de numéro de ticket entre appareils : les deux ventes sont acceptées', async () => {
  const a = vente({ numero: 'ZZ-20261028-0001', client_id: null }), b = vente({ numero: 'ZZ-20261028-0001' });
  assert.equal(await op(OWNER, B1, 'vente', a, uuid(), 'A1'), 'ok');
  assert.equal(await op(OWNER, B1, 'vente', b, uuid(), 'A2'), 'ok');
  const r = (await db.query(`select numero from ventes where id in ($1,$2) order by numero`, [a.id, b.id])).rows.map(x => x.numero);
  assert.equal(new Set(r).size, 2); assert.equal(r[0], 'ZZ-20261028-0001');
});
