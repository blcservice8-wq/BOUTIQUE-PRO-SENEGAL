# Configuration de la base distante (Supabase)

Facultatif : sans serveur, l'application fonctionne en mode local sur un seul appareil.

## Quotas de l'offre gratuite (relevés le 28/10/2026 sur supabase.com/pricing — **à revérifier**, ils peuvent changer)

| Ressource | Offre gratuite |
|---|---|
| Base de données | 500 Mo par projet |
| Trafic sortant | 5 Go (+ 5 Go en cache) |
| Utilisateurs actifs / mois | 50 000 |
| Stockage de fichiers | 1 Go |
| Projets actifs | 2 |
| **Mise en pause** | **Après 1 semaine d'inactivité** |

Conséquence : une boutique fermée plus d'une semaine peut voir son projet **mis en pause** ; l'application continue de fonctionner hors ligne et les opérations restent en file, mais la synchronisation reprendra seulement après réactivation du projet dans le tableau de bord Supabase. Pour un usage commercial réel, prévoyez l'offre payante (sauvegardes automatiques, pas de pause). Les sauvegardes quotidiennes automatiques ne font pas partie de l'offre gratuite : exportez vos propres sauvegardes.

## Étapes

1. Créer un compte et un projet sur supabase.com. Noter le mot de passe de la base.
2. **SQL Editor** : exécuter, dans l'ordre, `supabase/migrations/001_schema.sql`, `002_rpc_operations.sql`, `003_sync_membres.sql`. (Optionnel : `supabase/seed.sql`, puis `select charger_donnees_demo('<id_boutique>');`.)
3. **Authentication → Providers** : e-mail activé. Pour un essai rapide, désactivez « Confirm email » ; en production, gardez-le activé et configurez l'envoi d'e-mails.
4. **Project Settings → API** : copier l'**URL du projet** et la clé **publique (anon / publishable)**. **Ne jamais copier la clé `service_role`** : l'application la refuse, et elle contourne toute la sécurité.
5. Dans l'application : écran de connexion → « Configurer le serveur distant » → coller l'URL et la clé anon. Créer un compte, puis une boutique.
6. Ajouter des utilisateurs : ils créent d'abord leur compte, puis le propriétaire les ajoute (Paramètres → Utilisateurs) avec un rôle.
7. Pour imposer l'URL à tous les appareils d'un déploiement, renseignez `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `src/config.js` (valeurs publiques uniquement), puis `npm run build:sw`.

## Sécurité en place

- RLS activée sur les 25 tables ; contrôle `est_membre / est_gestion / est_proprietaire` sur chaque lecture.
- **Aucune écriture directe** sur ventes, paiements, stock, caisse : tout passe par `appliquer_operation()` (SECURITY DEFINER) qui vérifie le rôle, recalcule les montants et refuse les doublons.
- Tables financières en ajout seul (triggers) ; une vente validée n'est ni supprimable ni modifiable (annulation = écritures inverses).
- Les fonctions internes `_op_*` ne sont pas appelables par les clients.
- À faire avant la production : activer la protection des mots de passe divulgués et la limitation de débit d'authentification dans Supabase, et lancer l'outil « Security Advisor » du tableau de bord.
