# scan-docu

Application de gestion des notes de frais / justificatifs de La Brasserie des Plantes.
Les collaborateurs scannent leurs reçus (OCR), qui sont rangés sur Google Drive ;
Pennylane récupère ensuite les PDF depuis le Drive pour le rapprochement comptable.

- **backend/** : API Node.js (Express + Prisma + PostgreSQL), auth JWT.
- **frontend/** : PWA React (Vite + Tailwind).
- Déploiement : Railway (`railway.json`).

## Rapprochement Pennylane (lecture seule)

Vue d'administration (`/admin/reconciliation`) qui croise les **transactions des cartes
du Compte Pro Pennylane** avec les justificatifs scannés dans scan-docu, pour identifier,
**par carte**, les paiements qui n'ont pas de justificatif scanné.

- Rapprochement par **montant** (au centime) + **date** (± quelques jours), en privilégiant
  la même carte quand le lien carte → `card_id` scan-docu est renseigné.
- Les cartes sont **auto-découvertes** depuis Pennylane ; leur **intitulé est éditable**
  directement dans l'app.
- Détecte aussi les **scans orphelins** (scannés sans transaction correspondante).

### Configuration

Variable d'environnement à définir (côté Railway notamment) :

| Variable | Requis | Description |
|----------|--------|-------------|
| `PENNYLANE_TOKEN` | oui | Token API Pennylane. Un scope **lecture seule** suffit (`transactions:readonly`, `bank_accounts:readonly`). Généré dans Pennylane > Paramètres > Connectivité > Développeurs. |
| `PENNYLANE_API_URL` | non | Défaut `https://app.pennylane.com/api/external/v2`. |
| `PENNYLANE_PRO_BANK_ACCOUNT_ID` | non | Id du compte bancaire « Compte Pro Pennylane » portant les cartes. Défaut `949694`. |

Sans `PENNYLANE_TOKEN`, l'écran affiche un message d'aide et le reste de l'app fonctionne
normalement.

### Note de déploiement

Le projet n'utilise pas de migrations Prisma versionnées : le schéma est synchronisé au
démarrage via `prisma db push` (additif, non destructif). La table `card_mappings` est
donc créée automatiquement au prochain déploiement.
