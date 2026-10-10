# LogiBTP – Module de saisie des documents

Moteur unique de saisie pour tous les types de documents (devis, commande, livraison, facture, avoir, documents d'achat et de stock),
piloté par le paramétrage. Métier BTP : ouvrages avec sous-détail, déboursé, métrés, variables, PV fixes ventilés, lignes de pied, TVA par catégorie.

## Structure

Le projet est découpé en **socle**, **modules complémentaires** et **cœur**. Les modules fournissent des classes mères
(méthode patron : étapes surchargeables) que le cœur spécialise pour le métier BTP. Un nouveau module suit le même schéma :
`modules/<nom>/{js,dotnet,db,tests}`.

| Dossier | Contenu |
| --- | --- |
| `socle/js` (`@logibtp/socle`) | Calcul décimal, formules, références, libellés ; composants d'interface sans métier (grille arborescente, magasin Immer, liste de choix, éditeur de mise en forme, préférences, raccourcis) et `socle.css` |
| `socle/dotnet` | `LogiBTP.Socle` (arrondis, expressions, accès aux colonnes, JSON) et `LogiBTP.Socle.Testing` (lecture des jeux partagés) |
| `modules/document` | Module Document : moteur générique `MoteurDocument` (JS et C#), numérotation, comparaison client / serveur ; `LogiBTP.Documents.Web` (services, persistance EF, routes HTTP génériques, `SpecialisationDocument`) ; UI `EditeurDocument`, `PanneauxDocument`, `ReglesDocument`, `PressePapiers` ; schéma `db/010`–`011` ; jeux `tests/cas` |
| `modules/metre` | Module Métré, indépendant de son hôte : `Portees`, `EvaluateurMetre`, variables (JS et C#) ; UI `PanneauMetre` (interface d'hôte) et `DictionnaireMetre` ; schéma `db/020` (sans clé étrangère vers l'hôte) ; jeux `tests/cas` |
| `src/LogiBTP.Domaine` | Cœur : `DocumentBtp`, `DocumentLigneBtp` (colonnes BTP ajoutées aux entités du module Document) |
| `src/LogiBTP.Calcul` | Cœur : `MoteurDevisBtp`, spécialisation de `MoteurDocument` avec le module Métré ; `ComparateurBtp` |
| `src/LogiBTP.Api` | Cœur : `LogiBtpContext`, `SpecialisationBtp` (métrés, variables, écarts d'arrondi), `Program.cs` |
| `client/src/calcul` | Cœur : `MoteurDevisBtp` JS (réplique exacte du C#), colonnes BTP |
| `client/src/app` | Cœur : `EditeurDevisBtp` (hôte du panneau de métré), `PanneauxBtp`, `ReglesBtp`, `PressePapiersBtp`, `DictionnaireBtp`, accès API, démo |
| `db/` | Cœur : `100_btp.sql` (colonnes BTP, contraintes, clés étrangères du métré), `110_reference.sql` (types de documents, statuts, TVA, unités…) |
| `tests/cas/*.json` | Jeux de test BTP **partagés** rejoués par Vitest et xUnit |

Ordre des scripts SQL (montés par `docker-compose.yml`) : modules `010`, `011`, `020`, puis cœur `100`, `110`.

## Démarrage

```bash
docker compose up -d
```

```bash
dotnet run --project src/LogiBTP.Api --launch-profile http
```

```bash
npm install && npm run dev
```

Les paquets JS sont des workspaces npm (`socle/js`, `modules/*/js`, `client`), installés depuis la racine.

Ouvrir http://localhost:5173. Au premier lancement, un devis de démonstration est créé dans la base.
Sans API joignable, le client passe en **démo hors ligne** : calcul local complet, sans enregistrement.

PostgreSQL écoute sur le port 5433 (`logibtp` / `logibtp`). Les scripts SQL ne s'exécutent qu'à la création du volume :
`docker compose down -v` pour repartir de zéro.

## Tests

```bash
npm test
```

```bash
dotnet test LogiBTP.slnx
```

Parité complète entre les deux moteurs (tous les champs calculés, pas seulement les valeurs attendues) :

```bash
npm run exporter-resultats && dotnet test LogiBTP.slnx
```

Toute règle de calcul se modifie **dans les deux moteurs**, avec un cas ajouté dans les jeux du module concerné (`modules/*/tests/cas`) ou du cœur (`tests/cas`).
Un écart arbitré dans l'interface est capturé dans `calcul_cas_test` ; `GET /api/cas-test/{id}/export` le restitue au format de `tests/cas/`.

## Choix d'implémentation à valider

Points que l'analyse ne tranchait pas, résolus ainsi dans cette première version :

- **Arrondis intermédiaires** : PA, PR et PV sont arrondis à 6 décimales (précision de stockage) à chaque étape ; les arrondis commerciaux restent ceux de la section 9.
- **Métrés** : la première ligne d'un niveau initialise le cumul (`−` donne son opposé, `×` et `÷` sa valeur). Un sous-total pointé recalcule la séquence depuis la ligne qui suit le sous-total pointé.
- **Variables** : les variables de l'onglet Définition d'un métré sont les sorties du métré : elles sont évaluées après ses lignes et après la quantité de la ligne, et peuvent donc reprendre le résultat (`{{@surface}}`), une autre variable ou `{{lig_qte_vendue}}`. Les variables de ligne sont évaluées ensuite. `@@` désigne l'ouvrage de la ligne (la ligne elle-même si c'est un ouvrage) : les composantes sœurs partagent son magasin.
- **Libellés** : une variable inconnue dans un libellé est laissée telle quelle avec un avertissement ; elle ne bloque que les formules de quantité.
- **Lignes de pied** : `PIED_HT` placé avant la TVA modifie la base de TVA (répartie au prorata des taux, ou sur le taux de la ligne) ; `PIED_TTC` jamais. Les bases `TOTAL_HT` et `TOTAL_TTC` désignent les totaux du corps. Sans ligne TVA, la TVA est ajoutée en fin de pied.
- **Ventilation TVA** : une seule ligne TVA positionne la ventilation ; le détail par taux est porté par `document_tva`, et non par une ligne par taux.
- **Frais annexes ventilés** : uniquement en montant (un pourcentage réintroduirait une dépendance circulaire).
- **Autoliquidation** : TVA à 0 sur le document. **Intracommunautaire** : TVA calculée puis annulée (`tva_montant_annulation`).
- **Transformations** : seule une source validée est transformable. Retours et avoirs portent une quantité négative sur l'étape amont, ce qui rouvre le reliquat du document d'origine.
- **Archivage** : pour une ligne, les chemins de transformation sont des alternatives. Elle est close dès qu'une étape obligatoire est entièrement transformée ou soldée (retour et avoir sont facultatifs).

## Reste à faire

- Transfert effectif d'un lot vers la base d'historique : le calcul du lot et de son caractère archivable est fait (`GET /api/documents/{id}/lot-archivage`).
- Authentification : l'utilisateur et le profil passent pour l'instant par les en-têtes `X-Utilisateur` et `X-Profil`.
- Écran de transformation ligne à ligne et saisie des situations d'avancement : l'API les gère (`lignes`, `avancement_pct`), l'interface transforme tout le reliquat.
- Bibliothèque d'articles et d'ouvrages : la saisie d'un code ne déploie pas encore d'ouvrage.
- Seconde phase : procès-verbal de réception, révision de prix, acomptes, décompte général définitif, import Excel.
