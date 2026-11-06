# Guide d'installation (PC et téléphone)

L'application s'installe depuis le navigateur, sans Play Store ni App Store. **Il faut l'ouvrir une première fois avec Internet** pour que tous les fichiers soient mis en cache ; ensuite elle s'ouvre sans connexion. HTTPS est obligatoire en ligne (GitHub Pages le fournit) ; `localhost` est accepté pour les essais.

| Appareil | Navigateur | Procédure |
|---|---|---|
| Android | Chrome | Ouvrir l'adresse → menu ⋮ → **Installer l'application** (ou bouton « Installer » en haut de l'écran) |
| iPhone / iPad | **Safari uniquement** | Bouton Partager ⬆︎ → **Sur l'écran d'accueil** → Ajouter. Lancer ensuite depuis l'icône |
| Windows 10/11 | Chrome ou Edge | Icône « Installer » dans la barre d'adresse (ou bouton « Installer » de l'application) |
| Ubuntu / Linux | Chrome, Chromium, Edge | Idem Windows. Firefox n'installe pas les PWA de bureau : utilisez-le comme simple site |
| macOS | Safari 17+ | Fichier → **Ajouter au Dock**. Chrome/Edge : icône « Installer » |

## Différences à connaître

- **iOS** : pas de bouton d'installation automatique ; pas de synchronisation en arrière-plan (elle reprend à l'ouverture) ; Safari peut **effacer les données d'un site non utilisé pendant longtemps** — installez l'icône sur l'écran d'accueil, synchronisez et exportez des sauvegardes régulières.
- **Impression** : l'impression de tickets passe par la boîte d'impression du système. Une imprimante thermique USB/réseau fonctionne si elle est installée sur l'appareil ; l'impression Bluetooth directe depuis le navigateur n'est pas garantie.
- Une PWA n'a pas toutes les capacités d'une application native (accès matériel limité, notifications restreintes sur iOS).

## Première utilisation

1. Ouvrir l'adresse, saisir le nom de la boutique (mode local) **ou** se connecter (mode en ligne).
2. Produits → ajouter des produits (ou importer un CSV : `reference, nom, code_barres, categorie, unite, prix_achat, prix_vente, stock, stock_min, date_peremption`).
3. Caisse → ouvrir la caisse avec le fonds initial. Vente → encaisser.
4. Paramètres → définir un PIN et **exporter une première sauvegarde**.
