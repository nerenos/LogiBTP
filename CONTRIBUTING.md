# Contribuer à LogiBTP

Merci de l'intérêt que vous portez à LogiBTP ! Ce projet est un logiciel de gestion pensé **par et pour les
professionnels du BTP**, et toute aide compte : un signalement d'erreur, une idée, une maquette, un logo ou une ligne
de code.

> **Le maître mot : c'est au logiciel de s'adapter à l'utilisateur, et non l'inverse.**
>
> Chaque contribution, quelle qu'elle soit, se juge à cette aune : est-ce que l'utilisateur sur le chantier, au bureau
> d'études ou à la comptabilité travaille plus simplement, plus vite, avec moins d'erreurs ?

## Sommaire

- [Philosophie du projet](#philosophie-du-projet)
- [Contribuer sans écrire de code](#contribuer-sans-écrire-de-code)
- [Contribuer au code](#contribuer-au-code)
- [Règles de développement](#règles-de-développement)
- [Proposer une modification (pull request)](#proposer-une-modification-pull-request)
- [Code de conduite](#code-de-conduite)

---

## Philosophie du projet

### Un tronc commun, standard au BTP

LogiBTP repose sur un **tronc commun** évolutif et maintenable, qui couvre ce que partagent toutes les entreprises du
BTP : devis, métrés, chantiers, achats, stock, pointage, facturation, règlements, comptabilité, rentabilité…

Ce tronc commun est organisé en trois couches, chacune ne dépendant que de celle du dessous :

| Couche | Dossier | Rôle |
| --- | --- | --- |
| **Socle** | `socle/` | Briques techniques sans aucun métier : base de données, droits, fenêtres, dates, combos, raccourcis, unité d'écriture… |
| **Modules** | `modules/<nom>/` | Fonctionnalités génériques et réutilisables (document, métré, liste, fiche, GED, stock, planning…), écrites sous forme de classes mères (méthode patron). |
| **Cœur** | `src/`, `client/`, `db/` | Spécialise les modules pour le BTP et les relie entre eux. |

Règles de dépendance :

- un module **ne dépend jamais du cœur** ;
- un module ne dépend pas des autres modules (sauf exceptions documentées dans [MODULES.md](MODULES.md)) : les liens
  entre modules passent par le cœur ;
- le socle ignore tout du métier.

La carte complète des modules et de leurs liens est dans [MODULES.md](MODULES.md).

### Le spécifique va dans un module séparé

Le tronc commun doit rester **standard** : ce qui vaut pour une seule entreprise, ou pour une seule branche du BTP
(électricité, charpente, VRD, désamiantage…), **ne s'y ajoute pas**.

Une règle de gestion, un calcul, un écran ou une édition propre à une société ou à un métier se développe dans
**un module séparé**, qui :

- s'appuie sur le socle et les modules existants en les spécialisant (classes mères, points d'extension, colonnes
  ajoutées par `ALTER TABLE`, dictionnaire de textes, personnalisation) ;
- ne modifie pas le comportement du tronc commun pour les autres utilisateurs ;
- peut vivre dans ce dépôt (module facultatif) ou dans **un projet annexe**, maintenu en parallèle, pour l'ultra
  spécifique.

L'objectif est double : garder un tronc commun **que tout le monde peut faire évoluer sans casser les autres**, et
permettre à chacun d'aller aussi loin que nécessaire dans le spécifique, à côté.

Si un besoin spécifique s'avère partagé par beaucoup, il a vocation à remonter dans le tronc commun : ouvrez une issue
pour en discuter.

> En cas de doute (« est-ce standard ou spécifique ? »), ouvrez une issue avant de coder : la question vaut souvent une
> discussion.

### Paramétrer plutôt que coder en dur

Pour que le logiciel s'adapte à l'utilisateur, tout ce qui peut varier d'une entreprise à l'autre doit être
**paramétrable** : textes, icônes, couleurs, statuts, codes, raccourcis clavier, champs supplémentaires des fiches,
éditions. Aucun texte, aucune icône, aucune couleur n'est écrit en dur dans l'interface.

---

## Contribuer sans écrire de code

### Tester et signaler des erreurs

Vous utilisez LogiBTP, ou vous l'avez essayé sur l'[instance de test](https://logibtp.vercel.app/) ? Vos retours sont
précieux. Ouvrez une [issue](https://github.com/nerenos/LogiBTP/issues) pour :

- **une erreur** (bug) : ce que vous avez fait, ce que vous attendiez, ce qui s'est passé ; l'écran concerné, le
  navigateur, et si possible une capture d'écran ou les étapes pour la reproduire ;
- **une fonctionnalité manquante** : le besoin métier avant la solution (« lors d'une situation de travaux, je dois
  pouvoir… »), avec un exemple concret tiré de votre pratique ;
- **un axe d'amélioration** : une saisie trop longue, un écran peu clair, un calcul qui ne correspond pas aux usages,
  un vocabulaire inadapté… Tout ce qui oblige l'utilisateur à s'adapter au logiciel mérite d'être signalé.

Avant d'ouvrir une issue, vérifiez qu'elle n'existe pas déjà ; si c'est le cas, complétez-la plutôt que d'en créer une
nouvelle. Chaque issue est ensuite **analysée et traitée par les développeurs** : elle peut être reformulée, découpée,
classée dans le tronc commun ou orientée vers un module spécifique.

> ⚠️ L'instance de test est publique : n'y saisissez jamais de données réelles ou confidentielles (clients, prix,
> coordonnées), et n'en joignez pas aux issues.

### Contribuer au graphisme et à la présentation

Les contributions graphiques sont accueillies **avec grand plaisir** :

- logo, icônes, illustrations ;
- thèmes de couleurs (clair, sombre, accessibilité) ;
- maquettes d'écrans, parcours utilisateur ;
- présentations, captures, vidéos de démonstration, supports de formation ;
- documentation utilisateur, tutoriels, relecture et corrections.

Proposez-les dans une issue (avec les fichiers sources si possible : SVG, fichiers de maquette…) ou directement par
pull request. Précisez la licence sous laquelle vous les cédez : par défaut, toute contribution est publiée sous la
licence du projet ([MIT](LICENSE)).

### Partager votre expertise métier

Conducteur de travaux, métreur, économiste, comptable, chef d'entreprise : votre connaissance du terrain est aussi une
contribution. Les discussions sur les règles de calcul, les usages du métier ou les obligations réglementaires
(facture électronique, retenue de garantie, autoliquidation…) aident à faire les bons choix.

---

## Contribuer au code

### Démarrer

Le démarrage de l'environnement de développement est décrit dans le [README](README.md#démarrage) :

```bash
docker compose up -d
```

```bash
dotnet run --project src/LogiBTP.Api --launch-profile http
```

```bash
npm install && npm run dev
```

Documentation de référence :

- [MODULES.md](MODULES.md) : carte des modules et de leurs liens ;
- le `CLAUDE.md` de chaque partie (`socle/`, `modules/<nom>/`, `client/`, `src/`, `db/`) : règles condensées ;
- `documentation/modules/<NOM>.md` : référence détaillée (fichiers, modèle de données, routes) ;
- [documentation/MIGRATIONS.md](documentation/MIGRATIONS.md) : scripts SQL et versionnement du schéma ;
- [TODO.md](TODO.md) : tâches à faire et décisions reportées ; une bonne source pour trouver par où commencer.

### Avant de coder

Pour toute fonctionnalité un peu conséquente, ouvrez d'abord une issue pour en discuter : cela évite de développer une
solution qui ne s'intègre pas à l'architecture, ou qui relève d'un module spécifique plutôt que du tronc commun.

Les chantiers importants sont découpés en **lots** : un lot touche un seul module, a un critère de fin clair et se
termine par des tests au vert.

---

## Règles de développement

### Langue

Le code, les commentaires, les noms et la documentation sont **en français** (sauf API techniques).

### Architecture

- Respecter le sens des dépendances : socle → modules → cœur.
- Un nouveau besoin générique devient un module (ou s'ajoute à un module existant) ; le cœur se contente de le
  spécialiser pour le BTP.
- Un besoin propre à une société ou à une branche se développe dans un module séparé (voir
  [plus haut](#le-spécifique-va-dans-un-module-séparé)).

### Moteurs miroirs JavaScript / C#

Les règles de calcul critiques existent en double, à stricte parité, côté client (JavaScript) et côté serveur (C#).
Toute règle modifiée l'est **dans les deux moteurs**, avec un cas de test ajouté dans les jeux du module
(`modules/*/tests/cas`) ou du cœur (`tests/cas`).

- Jamais de `Number` pour un montant côté JavaScript : `decimal.js`.
- Une seule fonction d'arrondi par moteur (demi vers l'infini).

### Codes

Statuts, natures, états et codes d'erreur ne s'écrivent jamais en dur : ils sont déclarés dans le `codes.js` du module
(objets `Object.freeze`) et son pendant `Codes.cs`, dont la parité est vérifiée par les tests.

### Base de données

- PostgreSQL, schéma géré par scripts SQL (pas de migrations EF) : chaque nouveau script est une mineure
  `<majeur>.<mineur>_<nom>.sql` dans le dossier `db` de son module, puis `npm run manifeste` régénère le manifeste.
- Un script déjà appliqué ne se modifie plus.
- Noms de colonnes en `snake_case` préfixé ; les colonnes métier s'ajoutent dans le cœur par `ALTER TABLE`.
- SQL brut : texte constant, valeurs en paramètres (jamais de chaîne concaténée).

### Serveur

- Toute route `/api` se rattache à un nœud de droits ; toute route d'écriture déclare son type.
- Les transactions passent par l'unité d'écriture du socle (`db.Unite()`).

### Interface

- Aucun texte, aucune icône, aucune couleur en dur : `texte()`, `icone()` et les variables du thème.
- Fenêtres par `<dialog>` (`confirmer`, `alerter`, `saisir`, `ouvrirModale` du socle) ; jamais `alert()`,
  `confirm()` ni `prompt()`.
- Dates par `activerDates` / `completerDate`, listes déroulantes par `creerCombo`, raccourcis par
  `declarerRaccourcis`.
- Préférences d'affichage dans le `localStorage`, pas en base.

### Dépendances externes

Toute dépendance ajoutée ou mise à jour (npm, NuGet, police) doit être justifiée ; relancer ensuite
`npm run rapport-dependances` pour mettre à jour [documentation/DEPENDANCES.md](documentation/DEPENDANCES.md).

### Sécurité

Aucun secret dans le dépôt : ils vont dans `.env` (modèle `.env.exemple`). Une faille de sécurité ne se signale pas
dans une issue publique : contactez le mainteneur directement par GitHub.

---

## Proposer une modification (pull request)

1. Forkez le dépôt et créez une branche depuis `main` au nom explicite.
2. Faites des commits ciblés, avec un message en français qui dit ce qui change et pourquoi.
3. Vérifiez que les tests passent :

   ```bash
   npm test
   ```

   ```bash
   npm run exporter-resultats && dotnet test LogiBTP.slnx
   ```

4. Mettez à jour la documentation concernée (`CLAUDE.md` du module, `documentation/modules/<NOM>.md`, [TODO.md](TODO.md)).
5. Ouvrez la pull request en décrivant le besoin, la solution retenue et la façon de la tester ; liez l'issue
   correspondante (`Corrige #123`).

Une pull request est relue avant d'être fusionnée ; des ajustements pourront vous être demandés, notamment pour
respecter l'architecture modulaire ou la parité des moteurs. Ce n'est jamais un rejet de votre travail, mais le moyen
de garder un tronc commun sain pour tous.

---

## Code de conduite

Soyez bienveillant, patient et constructif. Les contributeurs viennent d'horizons différents (développeurs,
utilisateurs, graphistes, gens du métier) : chaque point de vue est le bienvenu, et aucune question n'est bête.

Merci de contribuer à LogiBTP ! 🏗️
