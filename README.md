# Boutique Pro Sénégal

Application web progressive (PWA) de gestion d'une boutique d'alimentation générale : ventes, stock, achats, clients à crédit, caisse, dépenses, rapports. **Elle fonctionne sans Internet** après le premier chargement et se synchronise avec une base PostgreSQL (Supabase) quand la connexion revient. Interface en français, devise FCFA.

> État : version 0.1 fonctionnelle et testée (voir [docs/TESTS.md](docs/TESTS.md) pour ce qui a réellement été exécuté et ce qui reste à vérifier sur vos appareils). Lisez [docs/LIMITES.md](docs/LIMITES.md) avant une mise en production.

## Démarrage rapide (sans compte, sans serveur)

```bash
npm install          # uniquement pour les tests ; l'application n'a aucune étape de build
npm run serve        # http://localhost:8080
```

Ouvrez l'adresse, saisissez le nom de la boutique, c'est prêt. Les données restent dans le navigateur de l'appareil.
Pour la synchronisation multi-appareils et les comptes : [docs/CONFIGURATION_SUPABASE.md](docs/CONFIGURATION_SUPABASE.md).

## Ce qui est inclus

| Module | Contenu |
|---|---|
| Tableau de bord | CA jour/semaine/mois, marge brute estimée, dépenses, bénéfice net **estimé**, créances, dettes, valeur du stock, alertes, top produits, état de synchro et de sauvegarde |
| Produits | Fiches, références uniques, code-barres, catégories, unités (unité, kg, litre, paquet, carton, sac), péremption, import/export CSV |
| Ventes | Recherche/scan, panier, remises, paiement mixte, crédit, ticket imprimable, historique, annulation contrôlée avec motif |
| Stock | Mouvements tracés, inventaire physique, pertes/casse/péremption, alertes, valorisation |
| Achats | Fournisseurs, commandes, **réception réelle** (commande ≠ stock), factures, paiements, dettes, échéances |
| Clients | Fiches, crédits, remboursements liés à leur crédit, solde **calculé**, relevé de compte imprimable |
| Caisse | Ouverture, fonds initial, dépenses, retraits, clôture avec écart théorique/compté, rapport |
| Rapports | 10 rapports filtrables par période, impression/PDF (via le navigateur) et export CSV |
| Sécurité | Rôles propriétaire/gérant/caissier appliqués **côté serveur** (RLS + RPC), isolation par boutique, journal, PIN de verrouillage |

## Architecture en bref

- **Offline-first** : chaque action écrit dans IndexedDB (Dexie) et dans une file de synchronisation, dans une seule transaction locale.
- **Synchronisation sûre** : opérations identifiées par un UUID généré sur l'appareil, rejouables sans doublon (table `operations_sync`), nouvelle tentative avec délai croissant, détection des conflits de fiches par numéro de version.
- **Finance et stock en « journal »** : ventes, paiements, mouvements de stock ne sont jamais écrasés ; les totaux sont recalculés (`v_stock_produit`, `v_solde_client`). Le serveur **recalcule les montants** et ne croit pas le client.
- Détails et décisions : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Arborescence

```
index.html · manifest.json · service-worker.js
assets/ (icônes, styles)   vendor/ (Dexie, supabase-js — copies locales pour le mode hors ligne)
src/ app.js, config.js, database/, services/, sync/, modules/, utils/
supabase/ migrations/ (001 schéma, 002 opérations, 003 synchro & membres), seed.sql
tests/ (SQL réel, hors ligne bout en bout, calculs, rapports, navigateur)   scripts/   docs/   .github/workflows/
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm test` | 40 tests : migrations SQL + RLS exécutées dans PostgreSQL (PGlite), client hors ligne, synchro, calculs, rapports, sauvegarde |
| `npm run test:e2e` | Parcours dans un vrai navigateur (Chromium via Playwright), dont le mode avion |
| `npm run lint` | Contrôles statiques : aucun secret, RLS sur toutes les tables, précache complet |
| `npm run build:sw` | Régénère la liste de précache et la version du service worker (**à lancer après toute modification de fichier**) |

## Guides

[Installation](docs/INSTALLATION.md) · [Supabase](docs/CONFIGURATION_SUPABASE.md) · [Déploiement GitHub](docs/DEPLOIEMENT.md) · [Sauvegarde et restauration](docs/SAUVEGARDE_RESTAURATION.md) · [Migrations](docs/MIGRATIONS.md) · [Tests](docs/TESTS.md) · [Limites](docs/LIMITES.md) · [Évolution SaaS](docs/PLAN_SAAS.md)

## Licence

MIT. Dexie.js (Apache-2.0) et supabase-js (MIT) sont inclus dans `vendor/` ; aucune dépendance payante.
