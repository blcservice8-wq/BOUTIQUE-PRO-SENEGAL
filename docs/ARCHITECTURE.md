# Boutique Pro Sénégal — Architecture

## 1. Principes
- **Offline-first** : toute opération s'écrit d'abord dans IndexedDB (Dexie), jamais dans localStorage.
- **Journal d'opérations (event log)** : chaque action métier = une opération immuable avec `op_id` (UUID v4 généré localement), `boutique_id`, `appareil_id`, `type`, `payload`, `cree_le`.
- **Idempotence** : le serveur refuse un `op_id` déjà traité (table `operations_sync`, clé unique `(boutique_id, op_id)`). Double clic ou renvoi = aucun doublon.
- **Stock = registre** : `mouvements_stock` en ajout seul. La quantité du produit est une valeur dérivée, jamais écrasée par le client.
- **Multi-tenant** : `boutique_id` sur chaque table, isolation par RLS PostgreSQL. Aucune clé `service_role` côté navigateur (clé `anon` uniquement).
- **Suppressions** : suppression logique (`supprime_le`) ; documents financiers validés non supprimables (trigger + absence de policy DELETE). Annulation = écriture inverse.

## 2. Pile technique
| Couche | Choix | Limite à connaître |
|---|---|---|
| Front | HTML5/CSS3/JS ES modules, sans build obligatoire | Pas de framework : discipline modulaire requise |
| Local | IndexedDB via Dexie.js | Quota navigateur ; iOS peut purger les données d'un site peu utilisé (7 jours sans visite sur Safari non installé) |
| Hors ligne | Service Worker (cache-first pour la coquille, réseau pour l'API) | Pas de Background Sync sur iOS : la synchro repart à l'ouverture |
| Distant | Supabase (PostgreSQL + Auth + RLS) | Offre gratuite : quotas de base, de bande passante et mise en pause après inactivité — à vérifier sur la page officielle des tarifs |
| Hébergement | GitHub Pages (statique, HTTPS) | Pas de backend ; tout le serveur = Supabase |
| PDF | jsPDF (MIT) chargé en cache local | Mise en page basique |

## 3. Structure
```
boutique-pro-senegal/
├── index.html · manifest.json · service-worker.js
├── assets/{icons,images,styles}
├── src/{app.js,config.js,database/,modules/,services/,sync/,utils/}
├── supabase/{migrations/,seed.sql}
├── tests/ · scripts/ · .github/workflows/ · docs/
```

## 4. Synchronisation
1. Écriture locale transactionnelle Dexie : vente + lignes + paiements + mouvements de stock + entrée `file_sync` dans **une seule transaction**.
2. Envoi : un worker lit `file_sync` (statut `en_attente`), appelle la fonction RPC `appliquer_operation(op)` ; en cas de succès → `synchronise`, sinon `tentatives++` avec backoff exponentiel (2 s, 4 s … plafonné à 5 min), statut `erreur` après 8 échecs (conservée, relançable).
3. Réception : pull incrémental par `maj_le > dernier_curseur` par table, filtré par RLS.
4. Indicateur d'état : en ligne / hors connexion / en cours / réussie / erreur.

### Conflits
- **Données financières et stock** : jamais d'écrasement. Ce sont des événements ajoutés ; le total est recalculé. Deux caissiers vendant le même produit hors ligne produisent deux sorties de stock qui s'additionnent.
- **Stock insuffisant à la synchro** : la vente reste valide (marchandise déjà remise) ; le stock passe en négatif, une alerte « conflit de stock » est créée pour le responsable, qui régularise par inventaire.
- **Fiches modifiables (produit, client)** : champ `version` ; mise à jour acceptée seulement si `version` locale = version serveur. Sinon, conflit signalé et résolu manuellement (garder local / distant).
- **Numérotation** : références de ticket préfixées par l'appareil (`A1-20261028-0007`) pour éviter les collisions sans coordination.

### Plusieurs caissiers
Chaque appareil reçoit un `appareil_id` et une caisse propre (ouverture/clôture par caissier). Aucune séquence globale partagée. Limite : le stock affiché est celui de la dernière synchro ; deux appareils hors ligne peuvent vendre la dernière unité simultanément (cas traité ci-dessus).

## 5. Sécurité
- Rôles : `proprietaire` (tout), `gerant` (commerce, rapports, pas de gestion des membres), `caissier` (ventes, encaissements, lecture produits/clients).
- Appliqués par RLS côté serveur ; l'interface ne fait que masquer.
- Montants validés par contraintes `CHECK`. Journal d'activité sur actions sensibles.
- Données locales : non chiffrées par défaut (limite des navigateurs) ; verrouillage de session par PIN + déconnexion.

## 6. Limites assumées
- Paiements Wave/Orange Money : enregistrement **manuel** uniquement.
- PWA ≠ application native (impression Bluetooth, notifications iOS, stockage plus limités).
- Bénéfice affiché = **marge estimée**, pas un résultat comptable certifié.

## 7. Plan
1. Architecture + SQL ✅
2. Squelette PWA, Dexie, file de synchro
3. Ventes, stock, produits
4. Achats, fournisseurs, clients/crédits
5. Caisse, dépenses, rapports
6. Sync complète + conflits
7. Sécurité, tests (unitaires puis manuels sur appareils)
8. CI GitHub Actions, guides, plan SaaS (abonnements, licences, multi-points de vente)
