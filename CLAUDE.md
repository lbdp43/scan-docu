# Guide pour les sessions Claude — scan-docu

Lis d'abord le `README.md` (architecture, flux, IDs Pennylane, notions métier).
Ce fichier ajoute le savoir opérationnel et les pièges connus.

## Workflow de modification / déploiement

1. Modifier le code, puis vérifier localement :
   - backend : `node --check <fichier>` + `cd backend && npm test` (tests du matching)
   - frontend : `cd frontend && npm run build`
2. Commit + `git push origin main` → Railway déploie automatiquement (~2-7 min).
3. Suivre le déploiement : API GitHub Deployments (`/repos/lbdp43/scan-docu/deployments?sha=<sha>`
   puis `/deployments/<id>/statuses`) jusqu'à `success`.
4. Vérifier en prod : `GET /api/health` (200) ; un endpoint protégé qui répond **401 = monté**.
   Juste après un deploy, un 502 transitoire est normal (redémarrage).
5. Tester la chaîne complète : `POST /api/cron/reconcile` avec header `x-cron-secret`
   (secret = variable Railway `CRON_SECRET`, aussi dans les secrets GitHub Actions).

En cas d'échec de déploiement après ~15 min avec build OK dans les logs : c'était un
incident Railway "image push" (déjà vu) — relancer (commit vide), pas un bug du code.

## Pièges connus (vécus)

- **Token Pennylane** : `getToken()` lit la table `settings` (clé `PENNYLANE_API_TOKEN`)
  **avant** la variable d'env. Pour changer de token : écran Admin → Pennylane →
  « Modifier le token API » (écrit le Setting). Mettre à jour seulement la variable
  Railway ne suffit PAS (l'ancien Setting masque → 401 silencieux du cron).
- **Build racine** : `npm install --include=dev` est obligatoire (NODE_ENV=production
  omet les devDeps → `vite: not found`, exit 127).
- **PUT /transactions/{id}/categories remplace TOUTE la liste** : toujours renvoyer
  les catégories existantes + l'ajout (merge), sinon on écrase l'analytique posée à la main.
- **Ne PAS supprimer/désarchiver les ~110 factures archivées** (doublons 2-PDF) :
  choix explicite de Guillaume. Elles sont filtrées partout via `archived_at`.
- **Les montants/scores de matching** sont dans `src/services/match.js` (pur, testé).
  Toute modification du matching passe par là + un test dans `backend/test/match.test.js`.
- Les "erreurs" du bouton admin « Lancer le rapprochement auto » étaient des conflits
  bénins (déjà groupé par le cron) → reclassées `already_reconciled` depuis `ab4eb8e`.
- `Date`/`amount` Pennylane : utiliser `Math.abs(Number(t.amount || t.currency_amount))` ;
  dates comparées en jours via timestamp du `YYYY-MM-DD`.
- Le cron GitHub Actions tourne à :20 (horaire) et 6h UTC (quotidien + push).

## Infra / comptes

- **Railway** : service `scan-docu` (env `scandocu/production`). Un 2e environnement
  `truthful-clarity` existe mais est **dormant** (aucun déploiement récent, supprimable).
- **Postgres Railway** : table orpheline `card_mappings` (résidu d'un ancien déploiement,
  inutilisée — droppable). Les images de tickets sont aussi en `bytea` dans `expenses.receipt_image`.
- **Secrets** : variables Railway + secrets GitHub Actions (CRON_SECRET). Les tokens
  Pennylane de la machine de Guillaume sont dans `~/.claude/.env`
  (`PENNYLANE_API_TOKEN` lecture, `PENNYLANE_API_WRITE_TOKEN` écriture) —
  le Bash tool ne les charge pas : `set -a; source ~/.claude/.env; set +a`.
- **GitHub** : token dans le trousseau macOS via
  `printf "protocol=https\nhost=github.com\n\n" | git credential fill` ; `gh` CLI
  inutilisable (scope read:org manquant) → git + API REST direct.

## Backlog discuté avec Guillaume (non fait, par priorité)

1. **Alerte échec cron** : si reconcile/categorize/snapshot échoue (ex. token expiré →
   401 silencieux), push/mail à l'admin. Petit effort, gros gain de confiance.
2. **Lien exact au scan depuis « à justifier »** (#1 discuté) : passer `transactionId`
   dans les boutons Scanner/Saisie et le stocker sur l'Expense (colonne à créer
   `pennylane_transaction_id` + migration) → matching exact au lieu de montant+date.
3. **Question « quel véhicule ? » au scan spontané** (#2 discuté) : sélecteur optionnel
   (les gens retiennent le véhicule, pas la carte) → matching prioritaire sur cette carte.
   ⚠️ Ne PAS faire de matching « carte du collaborateur » : les cartes restent dans les
   véhicules, n'importe qui peut les utiliser (cf. README).
4. **Mode hors-ligne** (marchés sans réseau) : file d'attente d'upload dans la PWA.
5. **Export CSV/Excel** des stats filtrées + comparaison exercice N vs N-1 + budgets/alertes par véhicule.
6. **Relances progressives** (escalade J+7) au lieu du simple push quotidien.
7. **Factures non-carte** (~127 actives non rapprochées) : hors périmètre carte actuel.
8. **Relevés de péage** : 1 PDF = N paiements (les péages dominent les manquants depuis
   le garde-fou « 1 justificatif = 1 paiement »).
9. **Hygiène** : Node 18 EOL → 20/22, multer 1.x vulnérable → 2.x, `npm audit`,
   purge des blobs `receipt_image` anciens (déjà sur Drive), drop `card_mappings`,
   rotation mot de passe Postgres (pas de console SQL Railway → outil GUI + `ALTER USER`),
   vérifier le partage des liens Drive (`drive_file_url` accessibles sans auth ?).

## Tests

```bash
cd backend && npm test   # node --test test/match.test.js — 14 tests (matching + assignJustified)
```
Toute régression du matching (ex. bug `bestExpense` null, double-justification) a son test.
