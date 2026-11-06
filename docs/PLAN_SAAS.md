# Plan d'évolution vers un SaaS commercial

Principe : la **base gratuite hors ligne reste complète** (vente, stock, caisse, crédits). On ne monétise que ce qui coûte réellement (cloud, support, confort).

| Phase | Contenu | Préparé dans le code |
|---|---|---|
| 1. Pilote (1-5 boutiques) | Déploiement GitHub Pages + Supabase, formation, retours terrain, sauvegardes serveur (offre payante Supabase) | Multi-tenant par `boutique_id`, rôles, RLS, journal |
| 2. Fiabilisation | Tests sur appareils réels, imprimante thermique Bluetooth, import/export enrichi, 2FA, journal de connexions, surveillance des erreurs | `journal_activite`, `etat_synchronisation` |
| 3. Abonnements et licences | Tables `plans`, `abonnements`, `licences` ; fonctions premium (multi-points de vente, rapports avancés, sauvegarde cloud quotidienne) ; vérification côté serveur, tolérance hors ligne (période de grâce) | Chaque boutique = un locataire ; ajouter `plan_id` et un contrôle dans `appliquer_operation` pour les seules fonctions premium |
| 4. Paiements | Abonnement par Wave/Orange Money via API partenaire (contrats requis) ; réconciliation automatique des paiements clients | Champ `reference_externe` déjà stocké |
| 5. Multi-points de vente | Table `points_de_vente`, stock par point, transferts | `appareil_id` et caisses par appareil existent |
| 6. Administration | Portail administrateur séparé (rôle plateforme, fonctions serveur dédiées — jamais de clé privilégiée dans le navigateur), notifications (e-mail/SMS/WhatsApp), statistiques d'usage | — |

À arbitrer avec les futurs clients : tarification, support, conformité (protection des données personnelles des clients des commerçants, obligations fiscales locales — la marge affichée n'est pas une comptabilité certifiée).
