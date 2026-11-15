# Écrire une mineure de schéma (guide court)

Détail du moteur : [INSTALLATION.md](modules/INSTALLATION.md) ; décisions : [analyse](conception/ANALYSE-VERSIONNEMENT-SCHEMA.md) ; plan : [versionnement-schema](conception/plans/versionnement-schema.md).

## Format
- Fichier `modules/<module>/db/<majeur>.<mineur>_<nom>.sql` (cœur : `db/<majeur>.<mineur>_<nom>.sql`), par exemple `modules/stock/db/1.1_stock_lots.sql`. Le fichier est reconnu par son nom ; la version `1.0` est celle du socle (scripts numérotés actuels, figés dans `db/installation/socle-1.0.txt`).
- Un module n'a jamais deux mineures de même version ; l'ordre dans un module est numérique (`1.9` avant `1.10`).
- En-têtes facultatifs, dans les commentaires de tête : `-- requiert: document 1.2, stock 1.1` (le moteur applique ces versions avant ; module et version doivent exister) et `-- hors-transaction` (exceptionnel : exécuté sans transaction, une seule instruction, signalé au rapport de mise à jour).
- Après tout ajout ou retrait d'une mineure : `npm run manifeste` (régénère `db/installation/scripts.txt`, ne jamais l'éditer à la main) ; un test échoue si le fichier n'est pas à jour.

## Règles d'écriture
- Une mineure publiée est **immuable** : toute correction est une nouvelle mineure. Modifier un script déjà appliqué (empreinte différente au journal) est une erreur avant toute application ; seule issue : `--forcer --motif "…"` (tracé dans `installation_forcage`).
- Une transaction par script : tout ou rien. Pas de `COMMIT`, pas de `CREATE INDEX CONCURRENTLY` hors exception `-- hors-transaction`.
- Écrire pour une base qui contient des données de société : colonne ajoutée nullable ou avec défaut, reprise des données dans la même mineure, jamais de `DROP` sans reprise.
- Ne toucher que les objets du module (ou du cœur pour le cœur) ; les colonnes `x_` et les tables à préfixe d'intégrateur ne sont jamais modifiées.
- Une base montée (socle puis mineures) doit être identique à une base neuve : le test d'intégration compare les instantanés.

## Rejouables
- Un script marqué `rejouable` au manifeste est inscrit au journal avec son empreinte et rejoué à sa place seulement si son empreinte a changé, s'il n'est pas encore inscrit, ou si une mineure de son module (ou d'un module qu'il requiert ; le cœur dépend de tous) vient d'être appliquée dans l'exécution.
- Les rejouables de fin du socle (019n, 176) passent après les mineures : repère `# ---- rejouables de fin du socle` de `socle-1.0.txt`.
- Base installée avant le lot : tous les rejouables sont rejoués une fois puis inscrits.

## Verrou
Une seule mise à jour à la fois par base : verrou consultatif PostgreSQL (`pg_advisory_lock`, clé constante) pris pendant l'application ; une seconde application attend la première.

## Migration de code figée (exceptionnelle)
- Seulement pour une reprise de données **impossible en SQL**. Interface `IMigrationCode` (module Installation : `Module`, `Version`, `Nom`, `ExecuterAsync(NpgsqlConnection, NpgsqlTransaction, CancellationToken)`), déclarée dans `MigrationsCoeur.Liste` (`src/LogiBTP.Api/Btp`), passée à l'installeur avec le manifeste.
- Elle occupe la place d'une mineure : une version d'un module est un fichier SQL **ou** une migration de code, jamais les deux (plan invalide). Le moteur la joue à sa place dans le plan, dans la transaction de la mineure (ne jamais valider ni annuler soi-même ; une exception annule tout), et l'inscrit au journal (`isc_type = mineure`, chemin `code:<module>/<version>_<nom>`, empreinte = empreinte déclarée, sinon nom complet du type + version de l'assembly ; trace seulement, elle ne sert pas à détecter une modification).
- **Figée** : le code ne dépend ni des entités, ni des services, ni des règles ou constantes courantes de l'application (elles changent, pas la migration) : SQL et connexion reçue seulement, valeurs recopiées en dur. Une fois publiée, elle ne change plus ; correction = nouvelle migration ou mineure SQL.
- `scripts.txt` (fichiers SQL) ne la mentionne pas ; elle n'existe qu'au plan calculé avec la liste déclarée. Aucune migration de code réelle à ce jour ; tests : `MineuresTests` (migration fictive).

## Passer un module en majeure (développement, manuel)
- Quand : les mineures d'un module s'accumulent et alourdissent une installation neuve. Décision prise à la main, module par module.
- `dotnet run --project src/LogiBTP.Api -- installation module majeure <module>` produit `modules/<module>/db/<N+1>.0_creation.sql` (cœur : `db/`) : un **squelette**, concaténation ordonnée des scripts du module qu'une base neuve exécute (socle non rejouable ou création courante, puis mineures N.x), régénère `scripts.txt` et archive.
- **À relire avant de publier** : la commande ne fusionne pas le schéma automatiquement (les objets du socle 1.0 ne sont pas étiquetés par module, le cœur modifie les tables des modules par ALTER, des rejouables reprennent les vues). Alléger si besoin (colonne ajoutée puis retirée, vue remplacée), vérifier qu'aucune instruction ne dépend d'une mineure d'un autre module (la création est placée dans le socle), puis lancer le contrôle de publication ci-dessous.
- Effet sur les bases : base neuve → `N+1.0` à la place du socle / de `N.0` et des mineures N.x ; base en N.x → mineures N.x manquantes, puis `N+1.0` inscrit au journal **sans exécution** (`isc_type = majeure`) ; base antérieure au début de la majeure précédente (plancher `N.0`) → refus avec message (passer d'abord par une version publiée intermédiaire).
- Archivage : les scripts de la majeure N-1 et antérieures passent dans `<db>/archive/` (jamais exécutés, hors manifeste, gardés pour la trace) ; les mineures N.x restent en place pour les bases en N.x. Les scripts de démonstration d'un module et les rejouables ne sont ni fusionnés ni archivés. Une migration de code ou une source `-- hors-transaction` refuse la commande.
- Une création publiée est immuable comme une mineure.

## Contrôle de publication (avant chaque version)
- `npm run publier:verifier -- --base <développement> [--depuis <dépôt de la version précédente publiée>] [--demo]` : construit une base neuve par le plan, une base montée depuis la version précédente (dépôt `--depuis` ; à défaut le socle 1.0 de `socle-1.0.txt`, impossible une fois le socle d'un module archivé) puis mise à jour par le plan, compare les deux, puis compare la base de développement à la base neuve (`--demo` si elle porte la démonstration). Les bases temporaires sont supprimées.
- Tout écart non porté par un script (colonne ajoutée à la main, création incomplète, mineure oubliée) ou refus de montée = code de sortie 1 et rapport ; code 0 = conforme. Les modifications manuelles restent admises en développement : le contrôle les attrape avant la publication.
