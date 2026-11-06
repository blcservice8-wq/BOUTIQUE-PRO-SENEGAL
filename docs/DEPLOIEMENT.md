# Déploiement sur GitHub Pages

GitHub Pages héberge uniquement les fichiers statiques de l'application (HTTPS inclus). Ce n'est **ni une base de données ni un backend** : la partie serveur est Supabase ([guide](CONFIGURATION_SUPABASE.md)).

**Limites GitHub Pages** (docs.github.com, relevées le 28/10/2026) : site publié ≤ 1 Go ; trafic ≈ 100 Go/mois (limite indicative) ; déploiement ≤ 10 min. Largement suffisant : l'application pèse < 1 Mo.

## Publier

1. Créer un dépôt GitHub et y pousser ce dossier :
   ```bash
   git init && git add . && git commit -m "Boutique Pro Sénégal v0.1"
   git branch -M main && git remote add origin https://github.com/<compte>/boutique-pro-senegal.git && git push -u origin main
   ```
2. Dépôt → **Settings → Pages → Source : GitHub Actions**.
3. Chaque `push` sur `main` lance `.github/workflows/deploy.yml` : régénère le service worker, exécute contrôles et tests, publie. Adresse : `https://<compte>.github.io/boutique-pro-senegal/`.
4. Tous les chemins sont relatifs : l'application fonctionne dans un sous-dossier ou sur un domaine personnalisé (Settings → Pages → Custom domain).

## Mises à jour

Après toute modification de fichier : `npm run build:sw` (change la version du cache). Les appareils reçoivent la nouvelle version au prochain démarrage en ligne. Le workflow `ci.yml` échoue si le service worker n'est pas à jour.

## Avant le premier déploiement public

- [ ] Migrations appliquées sur Supabase, URL et clé **anon** renseignées.
- [ ] Confirmation d'e-mail activée côté Supabase.
- [ ] Test complet sur un vrai téléphone Android et un iPhone (voir [TESTS.md](TESTS.md)).
