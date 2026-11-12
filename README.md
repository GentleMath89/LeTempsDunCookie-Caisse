# Le Temps d'un Cookie – Caisse

Petite caisse de marché pour téléphone Android (application web installable, PWA) :
ventes par variante de cookies avec grille de prix, autres produits, réductions,
historique, dépenses, exports CSV, sauvegarde et restauration par fichier JSON.

- **Aucun serveur, aucun compte** : toutes les données restent dans le téléphone.
- **Aucune connexion vers l'extérieur** (voir la politique de sécurité dans `index.html`).
- Utilisable **hors ligne** une fois installée.

## Pour le développement

- Fichiers : `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`, `logo.png`, `icons/`.
- **À chaque modification de l'appli, augmenter `VERSION` dans `sw.js`** : c'est ce qui
  déclenche la mise à jour sur les téléphones.
- Ne jamais ajouter au dépôt de sauvegardes ni d'exports (ventes, noms de clients) :
  le `.gitignore` les exclut.
