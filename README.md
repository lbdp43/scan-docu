# LBDP Notes de Frais (scan-docu)

PWA de gestion des notes de frais de **La Brasserie des Plantes**, intégrée à **Pennylane** :
scan de tickets → Google Drive → import Pennylane → rapprochement bancaire automatique →
catégorisation analytique (nature + véhicule) → suivi des paiements carte sans justificatif.

## Le flux complet

```
1. Un collaborateur scanne un ticket (OCR) ou fait une saisie manuelle
2. L'app génère un PDF envoyé sur Google Drive
3. Pennylane importe le Drive (~toutes les heures) → facture fournisseur
4. Cron horaire : rapprochement facture ↔ transaction carte (montant + date)
   + catégorisation analytique automatique (nature + véhicule)
   + recalcul du snapshot des "paiements à justifier"
5. Cron quotidien (6h UTC) : idem + notification push à chaque collaborateur
   de SES paiements sans justificatif (cloisonné par carte)
```

## Stack

- **Frontend** : React (Vite + Tailwind), PWA (service worker, push), pages lazy-loadées
- **Backend** : Node/Express, Prisma + PostgreSQL, JWT (rôles user/admin)
- **Déploiement** : Railway (NIXPACKS), auto-deploy sur push `main`
- **Crons** : GitHub Actions → `POST /api/cron/daily` (6h UTC) et `/api/cron/reconcile` (toutes les heures à :20), auth header `x-cron-secret`

## Notions métier importantes

- **Exercice fiscal : 1er juillet → 30 juin** (`backend/src/services/fiscalYear.js`). Tout
  (rapprochement, manquants, stats) travaille sur l'exercice, jamais l'année civile.
- **Les cartes bancaires vivent DANS les véhicules**, pas avec les personnes : la carte du
  Kangoo reste dans le Kangoo ; n'importe qui peut l'utiliser le week-end. L'attribution
  carte→collaborateur sert aux notifications (le responsable du véhicule), l'attribution
  carte→véhicule sert à la catégorisation analytique.
- **Un paiement est "justifié"** s'il a un ticket scan-docu OU une facture Pennylane qui
  matche (montant + fenêtre de dates). Règle : **1 justificatif = 1 paiement**
  (`match.assignJustified`) — un ticket de 80 € ne peut pas justifier deux pleins de 80 €.
  Le ticket scanné et la facture Pennylane issus du même PDF Drive sont fusionnés (même
  nom de fichier) pour ne pas compter double.
- **Factures archivées** (~110 doublons "2 PDF") : laissées archivées dans Pennylane
  (choix assumé), mais **exclues** du pool de justificatifs et du rapprochement.

## Backend — fichiers clés

| Fichier | Rôle |
|---|---|
| `src/services/pennylane.js` | Client API Pennylane v2 (auth, factures, transactions, catégories, mappings cartes) |
| `src/services/match.js` | Logique de matching **pure** (testée) : `cardInfo`, `expenseScore`, `justifiedByInvoice`, `assignJustified` |
| `src/services/missing.js` | Calcul des paiements sans justificatif + **snapshot** en cache (Setting `missing_snapshot`, TTL 90 min) |
| `src/services/cardReconcile.js` | Rapprochement horaire facture↔transaction (idempotent, garde-fous) |
| `src/services/categorize.js` | Catégorisation analytique auto : nature (depuis le ticket) + véhicule (depuis la carte) |
| `src/services/fiscalYear.js` | Exercice comptable (1 juil → 30 juin) |
| `src/services/push.js` | Web-push VAPID (subs multi-appareils dans Setting `push_sub:<userId>`) |
| `src/routes/pennylane.js` | Routes admin : status/config, invoices, transactions, missing, reconcile, stats, cartes (label/user/véhicule), scan detail |
| `src/routes/myPayments.js` | Vue collaborateur : SES paiements à justifier (lit le snapshot) |
| `src/routes/cron.js` | Endpoints cron (reconcile → categorize → snapshot → push) |

### Table `settings` = stockage clé/valeur

| Clé | Contenu |
|---|---|
| `PENNYLANE_API_TOKEN` | Token API (PRIORITAIRE sur la variable d'env — voir CLAUDE.md/Pièges) |
| `PENNYLANE_BANK_ACCOUNT_ID` | Compte Pro (949694) |
| `card_label:<masked>` | Nom d'affichage d'une carte |
| `card_user:<masked>` | Carte → collaborateur (userId) |
| `card_vehicle:<masked>` | Carte → catégorie véhicule Pennylane (id) |
| `push_sub:<userId>` | Abonnements push (tableau, multi-appareils) |
| `cron_reconciled_invoices` | Factures déjà traitées par le cron (idempotence) |
| `missing_snapshot` | Snapshot des manquants (lu par l'accueil + l'admin) |

### IDs Pennylane utiles (catégories analytiques LBDP)

- Nature : Carburant `190533513216` · Restauration et Repas `190538297344` · Péages et Parking `190534152192`
- Véhicules (groupe `12745461760`) : Berlingot `190536069120` · Berlingot Neuf `190536073216` · Ford `190535614464` · Kangoo `190535610368`
- Compte Pro : `bank_account_id 949694` — les transactions carte exposent `pro_account_expense.card_masked_number` + `employee`

### API Pennylane — formats validés par test

- Catégoriser : `PUT /transactions/{id}/categories` body = **tableau** `[{ "id": <catId>, "weight": "1.0" }]` (`PUT []` retire tout ; merger l'existant car le PUT remplace la liste)
- Rapprocher : `POST /supplier_invoices/{id}/matched_transactions` `{transaction_id}` — **idempotent** (rejouer = 204)
- `reconciled` ne passe PAS à true au groupage (état de validation comptable ultérieur)
- `attachment_required` est toujours true → inutilisable pour détecter les justificatifs manquants

## Frontend — pages clés

- `pages/Dashboard.jsx` — accueil : "Mes paiements à justifier" (snapshot → instantané), boutons Scanner/Saisie pré-remplis, activation push
- `pages/Scan.jsx` / `Manual.jsx` — lisent `?amount&date&merchant` (params verrouillés si `fromMissing`)
- `pages/AdminPennylane.jsx` — 5 onglets : Rappro. / Manquants / **Stats** / Factures / Transac. (+ config token, recherche)
- `pages/PennylaneStats.jsx` — tableau de bord analytique : filtres (exercice, collaborateur, carte, catégorie, véhicule), graphiques, transactions filtrées, scans avec PDF + transaction liée

## Variables d'environnement (Railway, service scan-docu)

`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`,
`PENNYLANE_API_TOKEN` (fallback — la valeur dans Settings prime),
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`,
`DRIVE_SETUP_SECRET`, `FRONTEND_URL`.

Token Pennylane — scopes API v2 requis (un seul token lecture+écriture) :
**Factures fournisseurs (L+É)** · **Transactions (L+É)** · **Comptes bancaires (L)**.

## Développement

```bash
# Backend
cd backend && npm install
npx prisma migrate deploy        # 6 migrations versionnées
npm test                         # tests du matching (node --test)
npm run dev

# Frontend
cd frontend && npm install
npm run dev

# Build complet (comme Railway)
npm run build                    # frontend + backend + prisma generate
```

Déploiement : tout push sur `main` déclenche Railway (~2-7 min). Statut visible via
l'API GitHub Deployments. Démarrage prod : `npx prisma migrate deploy && node src/index.js`.
