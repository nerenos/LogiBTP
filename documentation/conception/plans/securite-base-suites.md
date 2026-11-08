# Restes du TODO : sécurité de la base (mise à jour et renouvellement du certificat)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1 (Sécurité de la base,
> lot 11 réalisé). Sujet sans analyse détaillée : questions ouvertes à trancher **au démarrage du plan** ; les lots
> suivent la recommandation.
>
> Contexte utile :
> - Certificat de la base (`base.<domaine>`, 730 jours) créé ou renouvelé **à chaque préparation**, 60 jours avant
>   l'échéance : `src/LogiBTP.Api/Btp/CommandeInstallation.cs` (`ExecuterAsync :45`, `Preparer :82`, règle des 60 jours
>   `:284`, `:319-327`, `CertificatBase :354`) ; dossier des certificats du module Installation
>   `modules/installation/dotnet/LogiBTP.Installation/DossierCertificats.cs` (`Infos :39`, `Ecrire :47`).
> - Windows : `modules/installation/windows/MettreAJour-LogiBTP.ps1` (redémarre l'API, `:67`, sans relancer la
>   préparation : aujourd'hui, une base non chiffrée demande de relancer l'installeur) ; tâche planifiée
>   « LogiBTP - certificat » (hebdomadaire, `Installer-LogiBTP.ps1:256-261`, commande `installation certificat renouveler`
>   pour le certificat HTTPS) ; fonctions communes `Commun.ps1`.
> - Linux : `modules/installation/linux/installer-logibtp.sh` (`minuterie() :185`).
> - Tests : `modules/installation/dotnet/LogiBTP.Installation.Tests/`. Les scripts appellent la commande d'installation de
>   l'image installée, comme aujourd'hui : ce n'est pas une dépendance de code du module vers le cœur.
>
> Décisions (08/11/2026) : périmètre retenu (Q1 : tout) ; aucun choix de détail pris, voir ci-dessous.

## Questions ouvertes (à trancher au démarrage)

| N° | Question | Recommandation | Statut |
|---|---|---|---|
| SO1 | Mise à jour : comment savoir que la connexion n'est pas chiffrée ? | Ne pas détecter : relancer toujours la préparation (rejouable) à la mise à jour ; elle rend un code de sortie « certificat de base créé ou renouvelé », et le script ne redémarre la base que dans ce cas. | ✔ Tranché (08/11/2026) : recommandation retenue (code de sortie certificat de base créé ou renouvelé ; la base n'est redémarrée que dans ce cas). |
| SO2 | Renouvellement du certificat de la base : quelle tâche ? | La tâche hebdomadaire « LogiBTP - certificat » existante, qui appelle aussi le renouvellement du certificat de base (même seuil de 60 jours) puis redémarre la base s'il a changé. | ✔ Tranché (08/11/2026) : recommandation retenue. |
| SO3 | Linux : même traitement ? | Oui, par la minuterie existante (`minuterie()`) et le script de mise à jour Linux. | ✔ Tranché (08/11/2026) : recommandation retenue. |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Commande de renouvellement du certificat de base et code de sortie | cœur | SO1, SO2 | FAIT |
| 2 | Windows : mise à jour qui relance la préparation, tâche planifiée | `modules/installation` | 1 | FAIT |
| 3 | Linux : mise à jour et minuterie | `modules/installation` | 1, SO3 | FAIT |

---

## Lot 1 : commande de renouvellement du certificat de base et code de sortie (FAIT le 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `CommandeInstallation.cs` (`ExecuterAsync :45` : sous-commande de renouvellement du certificat de base,
  ou option de `certificat renouveler` ; `Preparer :82` et `CertificatBase :354` : code de sortie distinct quand le
  certificat est créé ou renouvelé ; aide de la commande `:20`), tests C# (`tests/` ou tests du module Installation pour
  `DossierCertificats`).
- **Dépendances** : SO1 et SO2 tranchées.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : certificat à plus de 60 jours → code « inchangé » ; à moins de 60 jours ou absent → renouvelé,
  code « changé » ; préparation rejouée deux fois → second passage « inchangé ».
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert.
- **Réalisé** : `CommandeInstallation.RenouvelerCertificatBase` (public, testable avec des chemins factices ; remplace `CertificatBaseLocal`), décision pure `CertificatBaseAEmettre` (seuil de 60 jours), nouvelle sous-commande `installation certificat base-renouveler` (code 10 = `CodeCertificatBaseChange` si créé ou renouvelé, sinon 0), aide mise à jour. Écart : `preparer` ne rend le code 10 que si on lui passe `--code-certificat` (sans l'option, 0 comme avant : `Invoquer-Installation` des installeurs traiterait le code 10 en échec) ; les lots 2 et 3 passent cette option à la mise à jour. Tests : `CertificatBaseTests` (plus de 60 jours inchangé, moins ou absent renouvelé, préparation rejouée : second passage inchangé).

## Lot 2 : Windows, mise à jour et tâche planifiée (FAIT le 08/11/2026)

- **Module** : `modules/installation`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `MettreAJour-LogiBTP.ps1` (préparation relancée avant `:67`, redémarrage de la base sur le code
  « changé »), `Installer-LogiBTP.ps1` (`:256-261`, tâche « LogiBTP - certificat » : renouvellement du certificat de base
  puis redémarrage de la base si changé), `Commun.ps1` (fonction partagée de redémarrage), documentation d'exploitation
  du module (`documentation/modules/INSTALLATION.md`, section mise à jour).
- **Dépendances** : lot 1.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : essai manuel noté dans le lot (installation de développement) : mise à jour sur base non chiffrée
  → base chiffrée sans relancer l'installeur ; tâche lancée à la main avec certificat neuf → pas de redémarrage.
- **Critère de fin** : les deux essais notés dans le lot ; scripts analysés sans erreur (`PSScriptAnalyzer` s'il est
  installé).
- **Réalisé** : `Commun.ps1` (`Invoquer-InstallationCode` : code 0 ou 10 accepté, `Redemarrer-Base`, `Renouveler-CertificatBase`) ; `MettreAJour-LogiBTP.ps1` (étape 3 : préparation avec `--code-certificat` avant les scripts SQL, retour arrière en cas d'échec, base redémarrée sur le code 10) ; nouveau `Renouveler-Certificats-LogiBTP.ps1` (certificat HTTPS puis certificat de la base) lancé par la tâche « LogiBTP - certificat » (`Installer-LogiBTP.ps1`) ; `INSTALLATION.md`. Écarts : script ajouté (la tâche appelait directement docker) ; essais manuels non faits (interdits sur le poste) : tous les scripts passent l'analyse syntaxique, et les fonctions de redémarrage ont été essayées avec un `docker` simulé (code 10 : redémarrage, code 0 : aucun). Une installation existante doit relancer l'installeur une fois pour recréer la tâche et copier le nouveau script dans `outils`. Base distante (rôle Api) : simple message, redémarrage à faire sur le serveur de la base.

## Lot 3 : Linux, mise à jour et minuterie (FAIT le 08/11/2026)

- **Module** : `modules/installation`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/installation/linux/installer-logibtp.sh` (`minuterie() :185`), `mettre-a-jour-logibtp.sh`,
  `commun.sh`, documentation d'exploitation (`documentation/modules/INSTALLATION.md`).
- **Dépendances** : lot 1 ; SO3 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : `shellcheck` des scripts ; essai manuel noté dans le lot comme au lot 2.
- **Critère de fin** : `shellcheck` sans erreur ; essai noté.
- **Réalisé** : `commun.sh` (`installation_code`, `redemarrer_base`, `renouveler_certificat_base`) ; `mettre-a-jour-logibtp.sh` (préparation avec `--code-certificat` avant les scripts SQL, retour arrière en cas d'échec, base redémarrée sur le code 10) ; nouveau `renouveler-certificats-logibtp.sh` lancé par la minuterie `logibtp-certificat` (`installer-logibtp.sh`) ; `INSTALLATION.md`. Écarts : essais manuels interdits sur le poste : `bash -n` et `shellcheck` (avertissements préexistants seulement), fonctions essayées avec un `docker` simulé (code 10 : redémarrage, 0 : aucun, 3 : échec). Une installation existante relance l'installeur une fois pour recréer la minuterie.
