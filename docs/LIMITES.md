# Limitations connues

**Fonctionnel**
- Les paiements Wave / Orange Money sont des **enregistrements manuels** : aucune intégration d'API, aucune vérification automatique de réception.
- Pas de PDF natif : « Imprimer / PDF » utilise la boîte d'impression du navigateur (Enregistrer en PDF).
- Pas de lecteur de code-barres par caméra ; les lecteurs USB/Bluetooth « clavier » fonctionnent.
- Pas de retours partiels de marchandise (annulation de vente entière uniquement), pas de multi-devise, pas de TVA, pas de multi-points de vente.
- Annulation d'une vente impossible si des remboursements existent déjà sur son crédit.
- Les remboursements clients ne peuvent pas être annulés (correction par écriture manuelle côté gérant : non implémentée).
- Conversion carton/unité : un carton et la bouteille sont deux produits distincts (volontaire, pour éviter les erreurs de stock).

**Hors ligne et synchronisation**
- Le stock affiché est celui de la dernière synchronisation + les opérations locales. Deux appareils hors ligne peuvent vendre la dernière unité : les deux ventes sont acceptées, le stock devient négatif et une **alerte** est créée pour régularisation par inventaire.
- Le serveur peut renommer un numéro de ticket en doublon (suffixe) ; le ticket déjà imprimé garde son numéro d'origine.
- Les fiches (produits, clients) modifiées au même moment sur deux appareils déclenchent un **conflit à résoudre manuellement**.
- Pas de synchronisation en arrière-plan sur iOS (uniquement à l'ouverture). Safari peut purger les données d'un site peu utilisé.
- Un rôle ou un accès retiré à un utilisateur n'est effectif côté serveur qu'à sa prochaine synchronisation ; ses données locales restent sur l'appareil.

**Sécurité**
- Les données locales **ne sont pas chiffrées** (limite des navigateurs) ; le PIN protège l'écran, pas le disque. Utilisez le verrouillage de l'appareil.
- Le mode local n'a pas de comptes : quiconque ouvre l'appareil déverrouillé est propriétaire.
- Pas d'authentification à deux facteurs ni de journal des connexions dans cette version.

**Hébergement**
- Quotas et mise en pause de l'offre gratuite Supabase : voir [CONFIGURATION_SUPABASE.md](CONFIGURATION_SUPABASE.md). Aucune garantie de gratuité durable.

**Tests** : voir [TESTS.md](TESTS.md) pour les navigateurs et appareils **non** vérifiés.
