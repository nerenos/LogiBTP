# LogiBTP – Module de saisie des documents

Moteur unique de saisie pour tous les types de documents (devis, commande, livraison, facture, avoir, documents d'achat et de stock),
piloté par le paramétrage. Métier BTP : ouvrages avec sous-détail, déboursé, métrés, variables, PV fixes ventilés, lignes de pied, TVA par catégorie.

## Structure

| Dossier | Contenu |
| --- | --- |
| `db/` | `001_schema.sql` (DDL consolidé, compléments fusionnés, trigger `lig_chemin`), `002_reference.sql` (types de lignes et de documents, statuts, TVA, transformations, droits) |
| `src/LogiBTP.Domaine` | Entités calquées sur le DDL (`EntId` ↔ `ent_id`) |
| `src/LogiBTP.Calcul` | Moteur de calcul C# : fonction pure, 8 passes (section 13), comparateur d'écarts |
| `src/LogiBTP.Api` | API ASP.NET Core : définitions, enregistrement en un appel, validation et numérotation légale, historique, indices, copies, transformations partielles, reliquats, lot d'archivage, cas de test |
| `client/src/calcul` | Moteur de calcul JS (decimal.js), réplique exacte du moteur C# |
| `client/src/app` | Grille de saisie arborescente (lignes et métrés), raccourcis configurables (`src/config/raccourcis.json`), annulation par patchs Immer, glisser-déposer Pointer Events, presse-papiers JSON |
| `tests/cas/*.json` | Jeux de test **partagés** rejoués par Vitest et xUnit |
| `tests/expressions.json` | Jeu de test de l'analyseur de formules |

## Démarrage

```bash
docker compose up -d
```

```bash
dotnet run --project src/LogiBTP.Api --launch-profile http
```

```bash
npm --prefix client install && npm --prefix client run dev
```

Ouvrir http://localhost:5173. Au premier lancement, un devis de démonstration est créé dans la base.
Sans API joignable, le client passe en **démo hors ligne** : calcul local complet, sans enregistrement.

PostgreSQL écoute sur le port 5433 (`logibtp` / `logibtp`). Les scripts `db/` ne s'exécutent qu'à la création du volume :
`docker compose down -v` pour repartir de zéro.

## Tests

```bash
npm --prefix client test
```

```bash
dotnet test LogiBTP.slnx
```

Parité complète entre les deux moteurs (tous les champs calculés, pas seulement les valeurs attendues) :

```bash
npm --prefix client run exporter-resultats && dotnet test LogiBTP.slnx
```

Toute règle de calcul se modifie **dans les deux moteurs**, avec un cas ajouté dans `tests/cas/`.
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
