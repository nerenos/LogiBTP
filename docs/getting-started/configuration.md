# Configuration & Secrets

La configuration de LogiBTP est conçue pour séparer strictement les **secrets d'infrastructure**, la **configuration technique** et la **personnalisation métier**.

---

## 🔐 Le fichier d'environnement `.env`

Le fichier `.env` est situé à la racine de l'application (ou dans le volume Docker `logibtp-config` en production). Il contient les paramètres d'exécution et les clés secrètes.

> [!CAUTION] Fichier sensible - Ne jamais versionner
> Le fichier `.env` ne doit en aucun cas être commité dans Git. Un modèle commenté est fourni sous le nom `.env.exemple`. Sauvegardez toujours ce fichier en lieu sûr avec vos sauvegardes de base de données.

### Variables d'environnement principales

| Variable | Exemple / Valeur | Description |
| :--- | :--- | :--- |
| `LOGIBTP_CLE_CHIFFREMENT` | *(Chaîne aléatoire 32+ caractères)* | **Clé maîtresse** utilisée pour chiffrer les données sensibles en base (mots de passe des fiches, clés API). |
| `LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES` | *(Clés séparées par virgules)* | Anciennes clés conservées lors d'une rotation de clé (`installation cle-donnees changer`). |
| `LOGIBTP_DOMAINE` | `batiment.entreprise.fr` | Nom de domaine principal. Chaque société déclarée utilise un sous-domaine de ce domaine. |
| `LOGIBTP_DEPLOIEMENT` | `LOCAL` ou `INTERNET` | `LOCAL` pour réseau interne/TSE. `INTERNET` active HSTS strict et des contrôles de sécurité renforcés. |
| `LOGIBTP_ADRESSES_CONFIANCE` | `192.168.1.0/24,10.0.0.0/16` | Plages IP de confiance exemptées de double facteur (2FA) et de blocage pour échecs répétés. |
| `LOGIBTP_PROXYS` | `10.0.0.1` | Adresses IP des proxys inverses autorisés pour transmettre les en-têtes `X-Forwarded-*`. |
| `LOGIBTP_CORS_ORIGINES` | `http://localhost:5173` | Origines autorisées pour les requêtes cross-domain (généralement vide en production car même origine). |
| `LOGIBTP_JOURNAL_NIVEAU` | `Error`, `Warning`, `Information` | Niveau de verbosité des journaux techniques de l'API. |

### Paramètres de connexion PostgreSQL

| Variable | Description |
| :--- | :--- |
| `LOGIBTP_BASE_HOTE` | Nom d'hôte du serveur PostgreSQL (`postgres` sous Docker, ou IP distante). |
| `LOGIBTP_BASE_PORT` | Port d'écoute de la base (défaut : `5432` en interne Docker, `5433` en dev). |
| `LOGIBTP_BASE_SSL` | Mode TLS (`VerifyCA` en local, `VerifyFull` pour un serveur distant). |
| `LOGIBTP_BASE_RACINE` | Chemin vers le certificat de l'autorité racine validant la connexion PostgreSQL. |
| `LOGIBTP_BASE_MOT_DE_PASSE_ADMIN` | Mot de passe du rôle super-administrateur PostgreSQL (`postgres`). |
| `LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA`| Mot de passe du rôle propriétaire des tables (`logibtp_schema`). |
| `LOGIBTP_BASE_MOT_DE_PASSE_APP`   | Mot de passe du rôle d'exécution de l'API (`logibtp_app`). |
| `LOGIBTP_BASE_MOT_DE_PASSE_LECTURE`| Mot de passe du rôle en lecture seule pour les requêtes de listes optimisées. |

---

## 🛡️ Chiffrement des valeurs du `.env` (`env:v1:`)

En environnement de production, les valeurs sensibles inscrites dans le `.env` peuvent être chiffrées au repos via la clé de construction des binaires :

```bash
# Initialiser le fichier .env selon le mode
docker compose -f docker/api/compose.yml run --rm logibtp-installation installation env initialiser LOCAL

# Chiffrer automatiquement toutes les valeurs sensibles du fichier
docker compose -f docker/api/compose.yml run --rm logibtp-installation installation env chiffrer

# Contrôler la validité du fichier chiffré
docker compose -f docker/api/compose.yml run --rm logibtp-installation installation env verifier
```

Les valeurs chiffrées apparaissent sous le format préfixé `env:v1:AQAAANCMnd8BFd...`.

---

## ⚙️ Configuration applicative (`appsettings.json`)

Le fichier `src/LogiBTP.Api/appsettings.json` gère les options techniques du serveur :

```json
{
  "Societes": {
    "Domaines": [ "localhost", "logibtp.entreprise.fr" ],
    "LibellePrincipale": "Société Principale"
  },
  "Authentification": {
    "Mode": "Session",
    "AdressesConfiance": []
  },
  "Ged": {
    "Repertoire": "stockage-ged",
    "TailleMaxDepotMo": 200,
    "Archivage": {
      "Actif": true,
      "Heure": "02:30",
      "Utilisateur": "archivage_ged"
    }
  },
  "Geocodage": {
    "Actif": true,
    "Adresse": "https://api-adresse.data.gouv.fr/search/",
    "ScoreMin": 0.4
  }
}
```

- **Stockage GED :** Les pièces jointes sont stockées par empreinte SHA-256 dans le dossier dédié. Les doublons de fichiers identiques sont automatiquement dédupliqués physiquement sur disque.
- **Géocodage :** L'intégration native de l'API Adresse officielle française permet l'autocomplétion des adresses des chantiers et des tiers lors de la saisie.

---

## 🎨 Personnalisation visuelle et linguistique

L'un des atouts majeurs de LogiBTP est son principe de **zéro texte ou style en dur**. Vous pouvez surcharger l'apparence de votre instance sans jamais recompiler le code ni recréer l'image Docker :

Placez vos fichiers dans le dossier de personnalisation (volume `/app/config/personnalisation/` ou variable `LOGIBTP_PERSONNALISATION`) :

```
personnalisation/
├── fr.json          # Surcharges de vocabulaire et libellés
├── theme.css        # Surcharges des couleurs, polices et marges
└── images/          # Logo d'entreprise, favicons, illustrations
    ├── logo.svg
    └── logo-sombre.svg
```

### Exemple de personnalisation de vocabulaire (`fr.json`)
```json
{
  "btp.devis": "Proposition commerciale",
  "btp.chantier": "Opération",
  "authentification_btp.connexion.titre": "Espace Collaborateurs ACME BTP"
}
```

### Exemple de personnalisation graphique (`theme.css`)
```css
:root {
  --couleur-primaire: #0055b8;
  --couleur-primaire-survol: #004494;
  --couleur-accent: #ff6600;
  --police-titres: 'Segoe UI', system-ui, sans-serif;
}
```

Ces surcharges sont prises en compte à chaud par le serveur et le client web sans interruption de service.
