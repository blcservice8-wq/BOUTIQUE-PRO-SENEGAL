# Migrations de la base de données

Fichiers numérotés dans `supabase/migrations/`, à exécuter **dans l'ordre**, une seule fois chacun (SQL Editor, ou `supabase db push` avec la CLI Supabase).

| Fichier | Contenu |
|---|---|
| `001_schema.sql` | Types, tables, contraintes, index, vues de calcul, triggers de protection, RLS |
| `002_rpc_operations.sql` | `appliquer_operation()` et les 13 opérations métier (idempotentes) |
| `003_sync_membres.sql` | Curseurs `maj_le`, `creer_boutique(nom, id)`, gestion des membres, profil automatique |
| `seed.sql` | `charger_donnees_demo()` (démonstration, propriétaire seulement) |

## Ajouter une évolution
Créer `004_<description>.sql` sans modifier les anciens fichiers. Règles : `create … if not exists` / `create or replace`, jamais de `drop table` sur des données commerciales, nouvelle table = RLS + policies dans le même fichier, nouvelle colonne = valeur par défaut. Lancer `npm test` (les migrations sont rejouées dans PostgreSQL) et `npm run lint` (vérifie la RLS).

## Compatibilité client/serveur
Si une migration change le format d'une opération, conservez l'ancien format accepté par `appliquer_operation` : des appareils hors ligne peuvent encore envoyer d'anciennes opérations plusieurs jours après.
