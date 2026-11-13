# Le Temps d'un Cookie – Caisse

Petite caisse de marché pour téléphone Android (application web installable, PWA) :
ventes par variante de cookies avec grille de prix, autres produits, réductions,
historique, dépenses, exports CSV, sauvegarde et restauration par fichier JSON.

- **Données dans le téléphone** : base IndexedDB, un enregistrement par vente, dépense, commande ou produit (`db.js`).
- **Synchronisation entre appareils** (optionnelle) : via un projet Supabase (région UE) et un compte unique partagé
  (`sync.js`, `supabase/schema.sql`). Sans connexion, l'appli fonctionne seule, comme avant.
- **Seule connexion externe autorisée** : le projet Supabase (voir la politique de sécurité dans `index.html`).
- Utilisable **hors ligne** une fois installée : les saisies partent au retour du réseau.

## Synchronisation : mise en place

1. Supabase → *SQL Editor* : coller et lancer `supabase/schema.sql` (une seule fois, rejouable sans risque).
2. Supabase → *Authentication* : un seul utilisateur (e-mail + mot de passe), inscriptions publiques désactivées.
3. Sur chaque appareil : toucher « ☁ Se connecter » dans le bandeau du haut.
4. **Premier appareil** : il envoie tout. **Deuxième appareil** : à connecter vide (catalogue par défaut) ;
   le catalogue du serveur remplace alors le sien.

L'URL du projet et la clé « publishable » sont dans `sync.js` : elles sont publiques par conception, la protection
vient du compte et des règles d'accès de la base. Ne jamais mettre la clé `service_role` dans le dépôt.
Le plan gratuit de Supabase ne fait pas de sauvegarde automatique : le bouton « Sauvegarder » (JSON) reste utile.

## Pour le développement

- Fichiers : `index.html`, `style.css`, `app.js`, `db.js`, `sync.js`, `version.js`, `manifest.json`, `sw.js`, `logo.png`, `icons/`, `supabase/`.
- **À chaque publication, changer le numéro dans `version.js`** (`APP_VERSION`, format
  MAJEUR.MINEUR.CORRECTIF). Il s'affiche dans le bandeau de l'appli et déclenche la mise à jour
  sur les téléphones. Nouvelle fonctionnalité → MINEUR ; correction → CORRECTIF.
- Tout nouveau fichier de l'appli doit être ajouté à la liste `ASSETS` de `sw.js` (cache hors ligne).
- Ne jamais ajouter au dépôt de sauvegardes ni d'exports (ventes, noms de clients) :
  le `.gitignore` les exclut.
