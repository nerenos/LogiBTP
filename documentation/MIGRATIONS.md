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
