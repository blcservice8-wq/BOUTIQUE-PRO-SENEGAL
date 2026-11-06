# Rapport de tests

Seuls les tests **réellement exécutés** sont marqués ✅. Dernière exécution : 28/10/2026, Node 22, Linux.

## Automatisés (`npm test` → 40/40 ✅, répétés 25 fois sans échec après correction d'un défaut de numérotation découvert par ces tests)

| Domaine demandé | Couvert par | État |
|---|---|---|
| Création / modification de produit | `hors-ligne`, `rapports`, e2e | ✅ |
| Vente, calcul du total, déduction du stock | `sql`, `hors-ligne`, `calculs`, e2e | ✅ |
| Vente à crédit, remboursement partiel, solde calculé | `sql`, `hors-ligne` | ✅ |
| Achat, réception partielle puis complète, dette fournisseur | `sql` | ✅ |
| Dépense, clôture de caisse (écart théorique/compté) | `sql`, `hors-ligne` | ✅ |
| Génération des 10 rapports, sauvegarde/restauration | `rapports` | ✅ |
| Chargement initial, mode avion, vente hors ligne, fermeture/réouverture | `hors-ligne`, e2e (Chromium réel) | ✅ |
| Synchronisation au retour du réseau, **aucun doublon**, double clic, renvoi après perte d'accusé | `hors-ligne` | ✅ |
| Coupure réseau pendant la synchro, erreurs isolées, backoff | `hors-ligne` | ✅ |
| Conflit de fiche, deux caissiers vendant la dernière unité, collision de n° de ticket | `hors-ligne`, `sql` | ✅ |
| Isolation des boutiques, rôles côté serveur, écritures directes interdites, montants falsifiés | `sql`, `hors-ligne` | ✅ |
| Secrets / clé `service_role` absents du code, RLS sur toutes les tables | `npm run lint` | ✅ |

Méthode : les migrations sont exécutées dans un vrai PostgreSQL (PGlite) avec rôles et RLS ; le vrai code client tourne sur IndexedDB (fake-indexeddb) et se synchronise avec ce PostgreSQL via un adaptateur de test. **Non couvert** : le vrai service Supabase (Auth, PostgREST, réseau réel) — l'adaptateur de test reproduit les appels utilisés (`rpc`, `select/insert/upsert/update`), mais un essai de bout en bout sur votre projet Supabase reste indispensable.

## Navigateur réel (`npm run test:e2e` → 15 vérifications ✅)
Chromium (Playwright, Linux) : démarrage, service worker et 47 fichiers en cache, manifest, création de produit, vente, **rechargement en mode avion**, vente hors ligne, conservation après fermeture, tableau de bord, rapports, absence de débordement horizontal, aucune erreur JavaScript.

## Compatibilité — à faire sur vos appareils

| Cible | État |
|---|---|
| Chromium sous Linux (proche de Chrome/Edge/Ubuntu) | ✅ exécuté |
| Chrome et Edge sous Windows 10/11 | ⬜ non testé |
| Navigateurs sous Ubuntu (Firefox, Chrome) | ⬜ non testé (Chromium seul) |
| Safari macOS | ⬜ non testé |
| Chrome Android (installation, mode avion, impression) | ⬜ non testé |
| Safari iPhone / iPad (ajout à l'écran d'accueil, limites de stockage iOS) | ⬜ non testé |
| Imprimante thermique réelle | ⬜ non testé |
| Supabase réel (inscription, RLS, synchro de 2 appareils) | ⬜ non testé |

### Procédure de recette sur appareil (15 min)
1. Ouvrir l'adresse en ligne, installer l'application, la fermer.
2. Couper Internet (mode avion), rouvrir : l'application doit s'ouvrir.
3. Créer un produit, ouvrir la caisse, faire une vente espèces et une vente à crédit, imprimer un ticket.
4. Fermer complètement l'application, la rouvrir : les ventes sont là.
5. Rétablir Internet : l'indicateur passe à « Synchronisé » ; vérifier dans Supabase (table `ventes`) : une seule ligne par vente.
6. Avec un 2ᵉ appareil (rôle caissier) : vérifier qu'il ne peut ni modifier un produit ni annuler une vente.
