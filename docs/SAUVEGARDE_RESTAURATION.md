# Sauvegarde et restauration

## Sauvegarde (Paramètres → Exporter une sauvegarde)
Télécharge un fichier JSON contenant **toutes** les données locales : produits, ventes, stock, crédits, caisse, file de synchronisation. Le PIN n'y figure pas. La date de dernière sauvegarde apparaît sur le tableau de bord.
Recommandation : une sauvegarde par jour de travail, copiée hors de l'appareil (clé USB, e-mail, Drive). Sur iPhone/iPad, c'est indispensable (Safari peut effacer les données d'un site peu utilisé).

## Restauration (Paramètres → Restaurer une sauvegarde)
1. Choisir le fichier. L'application vérifie sa validité et sa version.
2. Confirmer : **toutes les données de l'appareil sont remplacées**. Un fichier `avant-restauration.json` est téléchargé automatiquement pour pouvoir revenir en arrière.
3. L'identité de l'appareil et le PIN sont conservés. L'application recharge.

⚠ En mode en ligne, restaurer une ancienne sauvegarde rejoue les opérations non synchronisées qu'elle contient : le serveur ignore celles qu'il connaît déjà (pas de doublon) mais les opérations créées *après* la sauvegarde et jamais envoyées sont perdues. Synchronisez avant de restaurer.

## Côté serveur
Offre gratuite Supabase : pas de sauvegardes automatiques quotidiennes. Utilisez `pg_dump` (Settings → Database → Connection string) ou l'offre payante. Le cloud contient la copie de référence des opérations ; un appareil neuf se reconstitue en se connectant et en synchronisant.
