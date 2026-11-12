# Le Temps d'un Cookie – Caisse

Petite caisse de marché pour téléphone Android (application web installable, PWA) :
ventes par variante de cookies avec grille de prix, autres produits, réductions,
historique, dépenses, exports CSV, sauvegarde et restauration par fichier JSON.

- **Aucun serveur, aucun compte** : toutes les données restent dans le téléphone.
- **Aucune connexion vers l'extérieur** (voir la politique de sécurité dans `index.html`).
- Utilisable **hors ligne** une fois installée.

## Pour le développement

- Fichiers : `index.html`, `style.css`, `app.js`, `version.js`, `manifest.json`, `sw.js`, `logo.png`, `icons/`.
- **À chaque publication, changer le numéro dans `version.js`** (`APP_VERSION`, format
  MAJEUR.MINEUR.CORRECTIF). Il s'affiche dans le bandeau de l'appli et déclenche la mise à jour
  sur les téléphones. Nouvelle fonctionnalité → MINEUR ; correction → CORRECTIF.
- Tout nouveau fichier de l'appli doit être ajouté à la liste `ASSETS` de `sw.js` (cache hors ligne).
- Ne jamais ajouter au dépôt de sauvegardes ni d'exports (ventes, noms de clients) :
  le `.gitignore` les exclut.
