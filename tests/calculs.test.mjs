import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/services/calculs.js';
import { versCSV, lireCSV } from '../src/utils/csv.js';
import { fcfa } from '../src/utils/format.js';

test('totaux de vente et remises', () => {
  const l = [{ quantite: 2, prix_unitaire: 18000 }, { quantite: 1.5, prix_unitaire: 700, remise_ligne: 50 }];
  assert.deepEqual(C.totalVente(l, 1000), { sousTotal: 36000 + 1050 - 50, remise: 1000, total: 36000 });
  assert.throws(() => C.totalVente(l, 999999), /Remise/);
  assert.throws(() => C.totalLigne(1, 100, 500), /remise/);
});
test('paiements : crédit = reste, jamais un mode de paiement', () => {
  assert.deepEqual(C.validerPaiements(1000, [{ mode: 'especes', montant: 400 }], 'c1'), { paye: 400, reste: 600 });
  assert.throws(() => C.validerPaiements(1000, [{ mode: 'especes', montant: 400 }], null), /client/);
  assert.throws(() => C.validerPaiements(1000, [{ mode: 'credit', montant: 400 }], 'c1'), /crédit/);
  assert.throws(() => C.validerPaiements(1000, [{ mode: 'wave', montant: 2000 }], 'c1'), /dépassent/);
  assert.throws(() => C.validerPaiements(1000, [{ mode: 'wave', montant: 1 }, { mode: 'wave', montant: 2 }], 'c1'), /Un seul/);
  assert.deepEqual(C.validerPaiements(1000, [{ mode: 'wave', montant: 600 }, { mode: 'especes', montant: 400 }]), { paye: 1000, reste: 0 });
});
test('marge brute estimée et conditionnement carton/bouteille', () => {
  assert.equal(C.margeBrute([{ quantite: 2, prix_unitaire: 18000, prix_achat_unitaire: 16000 }]), 4000);
  const p = { qte_par_conditionnement: 24 };
  assert.equal(C.conditionnementVersUnites(2, p), 48);
  assert.equal(C.prixUnitaireDepuisConditionnement(6000, p), 250);
  assert.throws(() => C.conditionnementVersUnites(1, {}), /conditionnement/);
});
test('quantités selon l\'unité', () => {
  assert.ok(C.quantiteValide(2, 'sac')); assert.ok(!C.quantiteValide(1.5, 'sac')); assert.ok(C.quantiteValide(1.5, 'kg')); assert.ok(!C.quantiteValide(0, 'kg'));
});
test('remboursement réparti FIFO et lié aux crédits', () => {
  const credits = [{ id: 'b', reste: 5000, cree_le: '2026-02' }, { id: 'a', reste: 3000, cree_le: '2026-01' }];
  assert.deepEqual(C.allouerRemboursement(4000, credits), [{ credit_id: 'a', montant: 3000 }, { credit_id: 'b', montant: 1000 }]);
  assert.throws(() => C.allouerRemboursement(9000, credits), /dépasse/);
});
test('stock : statut et valorisation', () => {
  assert.equal(C.statutStock(0, 2), 'rupture'); assert.equal(C.statutStock(2, 2), 'bas'); assert.equal(C.statutStock(3, 2), 'ok');
  assert.equal(C.valeurStock([{ id: 'x', prix_achat: 100 }, { id: 'y', prix_achat: 50 }], new Map([['x', 3], ['y', -4]])), 300);
});
test('CSV : aller-retour avec ; guillemets et accents', () => {
  const rows = [{ nom: 'Riz "premium"; 50kg', prix: 18000 }, { nom: 'Café\nnoir', prix: 500 }];
  const csv = versCSV(rows, [{ titre: 'Nom', cle: 'nom' }, { titre: 'Prix', cle: 'prix' }]);
  assert.ok(csv.startsWith('﻿'));
  assert.deepEqual(lireCSV(csv), [{ nom: 'Riz "premium"; 50kg', prix: '18000' }, { nom: 'Café\nnoir', prix: '500' }]);
  assert.deepEqual(lireCSV('nom,prix\nA,1\n'), [{ nom: 'A', prix: '1' }]);
});
test('format FCFA sans centimes', () => { assert.equal(fcfa(1234567.6), '1 234 568 FCFA'); });
