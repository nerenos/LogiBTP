# Module Import – référence détaillée

Référence lue à la demande (hors contexte par défaut). Les règles que le code doit respecter sont dans
[CLAUDE.md](../../modules/import/CLAUDE.md) ; une règle modifiée l'est là, l'inventaire ici. Analyse :
[ANALYSE-IMPORT-MDE-OPTIM.md](../conception/ANALYSE-IMPORT-MDE-OPTIM.md) ; plan et écarts de chaque lot :
[reprise-mde-optim.md](../conception/plans/reprise-mde-optim.md).

## Deux usages
- **Import d'un devis** (navigateur) : fichier OptimBTP `.optim` → devis neutre → devis vérifié puis créé par le cœur
  (`client/src/app/import/`). Détail dans le `CLAUDE.md` du module.
- **Reprise d'une base** (serveur) : une base MDE (SQL Server) ou OptimBTP (MariaDB) remplit une **base LogiBTP neuve**
  (base non vide refusée), en simulation (transaction annulée, rapport seul) puis en réel.

## Reprise : chaîne d'exécution
1. Entrées : écran `/parametres/reprise` (administrateur, routes `/api/reprise` de `RoutesReprise.cs`) ou commande
   `installation societe importer CODE --source MDE|OPTIM [--connexion C | LOGIBTP_REPRISE_SOURCE] [--societes 1,2]
   [--reel] [--correspondances F] [--rapport F.md] [--ged RACINE] [--decimales-qte N] [--decimales-prix N]` (simulation par
   défaut, code de sortie 2 en cas d'échec). Décimales des lignes de pièces reprises : MDE 3 (quantités) et 2 (prix) par
   défaut, modifiables à l'écran avant l'import ; OPTIM : celles de la quantité source, prix à 6.
2. `RepriseBase.ExecuterAsync(DemandeReprise)` : fichier de correspondances (fourni, sinon `Correspondances/mde.json` ou
   `optim.json`) validé contre les listes de la base cible (`CiblesReprise`), fusions de doublons retenues
   (`import_fusion`), lecteur en lecture seule (`LecteurSqlServer` / `LecteurMariaDb`).
3. `MoteurReprise` : domaines de `DomainesReprise.Pour(source)` ordonnés par dépendances, **une seule transaction** sur
   la base cible ; anomalie bloquante ou exception → annulation, état `ECHEC` ; rapport (`import_reprise.irp_rapport`)
   toujours enregistré ; clés d'origine dans `import_correspondance`.
4. Rapport (`RapportReprise`) : volumes lus / écrits / écartés par table source, valeurs forcées, écarts d'arrondi,
   champs perdus, doublons proposés, anomalies (niveau, code `CODE_ANOMALIE` ou `ERREUR_CORRESPONDANCE`, emplacement
   « table clé »), utilisateurs ; JSON et Markdown.

## Domaines (ordre de la reprise) et tables lues
Classes du cœur dans `src/LogiBTP.Api/Reprise/` ; un domaine par source, même code.

| Code | MDE (SQL Server) | OPTIM (MariaDB) | Cible LogiBTP |
| --- | --- | --- | --- |
| `SOCIETE` | `SYS_DEFSTE` | `ref_societe` (établissements d'un même SIRET regroupés, chrono partagé) | paramètres de la société, décimales |
| `REFERENTIELS` | `PMEUNITEMESURE`, `PMETVA`, `TVA`, `CATEGORIEACHATVENTE`, `APIMODEREGLEMENT(L)`, `APIPAYS`, `APICIVILITE`, `CMP_*` | `z_unite`, `z_parametre`, `svcz_compte`, `ref_famille_type` | unités, taux, modes, conditions, comptes, natures (rapprocher sinon créer) ; analytique MDE en paramètre comptable `reprise_analytique` |
| `CHAMPS` | `SYS_RTCINFOS` | `z_dataspec_bdd` | champs supplémentaires des fiches (colonnes `x_`) |
| `ANNUAIRE` | `PMECLIENT`, `PMEFOURNISSEUR`, `PMESOUSTRAITANT`, `PMEARCHITECTE`, `PMECHARGEAFFAIRE`, `COMM_TIERS*` | `bib_tiers`, `bib_personne`, `z_adresse` | personnes, casquettes, coordonnées, contacts, payeurs (`FACTURER_A`) |
| `RESSOURCES` | `PMESALARIE`, `PMEEQUIPE`, `PMEMATERIEL` | `ref_salarie`, `svh_equipe`, `bib_materiel`, `bib_habilitation`, `z_utilisateur` | salariés (individu), intérim, habilitations, équipes, matériels et visites, calendriers |
| `BIBLIOTHEQUE` | `PMEBIBLIO`, `PMEFAMILLE`, `PMENATUREELEMENT`, `PMEELEMENT*` | `bib_bibliotheque`, `bib_type_prod_prest`, `bib_article*` | bibliothèques, familles, éléments, ouvrages, conversions, tarifs |
| `STRUCTURE` | `PMEAFFAIRE`, `PMECHANTIER`, `PMETYPEMARCHE`, états | `afc_dossier`, `afc_affaire*`, `afc_chantier`, `vte_indice*`, `vte_revision_formule` | projets, affaires, chantiers, marchés, intervenants, révision |
| `PIECES_VENTE` | `PMEDOCDEVCLI`, `PMEDOCCDECLI`, `PMEDOCBLCLI`, `PMEDOCFACCLI` (+ lignes ; IDLIG / IDPARENT = 0 : sans clé, sans parent) ; marché `PMEAFFBASEDOC(LIG)` par chantier (NUMORDRE : base puis avenants, commandes validées) ; `PMEDOCSITTX` | `vte_doc_entete`, `vte_doc_ligne` ; `vte_situation*` | pièces de vente (`PiecesReprise`, moteur BTP, ligne « Écart de reprise »), situations et factures d'avancement |
| `ACHATS` | pièces d'achat et de sous-traitance MDE | `ach_doc_*`, `ach_export_facture_*`, `afc_prestation_st*` | pièces d'achat et de sous-traitance (avoirs en positif) |
| `REGLEMENTS` | `COMM_ECHEANCE`, `FIN_DOCUMENT`, `PMEDOCRETENUE` | `vac_doc_echeance_reglement`, `vac_reglement_*`, `vac_doc_retenue_caution` | échéanciers, règlements, pointages plafonnés, retenues, cautions, état de paiement |
| `EXPLOITATION` | `PMECHTSUIVMOCHT` | `svh_rapport_journalier`, `svhz_*`, `pln_planification`, `pln_affectation` | pointages (couche SAISIE), variables de paie et zones, congés validés, tâches et affectations du planning |
| `STOCK` | `PMEDEPOT`, `PMESTOCKREEL`, `PMECHTSUIVFO`, `PMECHTSUIVMAT` | `bib_article_stock`, `svc_rapport_conso` | inventaire d'ouverture (`stk_comptage`), consommations hors pièce (sorties S_SORTIE + mouvements), heures de matériel (`pointage_materiel` IMPORT) |
| `GED` | `SYS_MDEIMAGES` (images des éléments, photos des salariés), `PMEAFFACTION`, `PMEACTION` | `ged_conteneur`, `ged_document` (base64), `ged_document_entite`, `msg_message_observation` | contenus par empreinte dans le stockage de la société, documents de la GED sur leurs fiches (sinon répertoires « Reprise »), notes du CRM |
| `VALEURS_CHAMPS` | tables des fiches | `z_dataspec_data` | valeurs des champs supplémentaires (toujours en dernier) |

## Règles transverses
- Montants vendus identiques à la source : écart recalculé porté par une ligne « Écart de reprise » au PV fixe ; pièces
  validées en PV fixe ; écart de TTC signalé.
- MDE : regroupements de natures fixes (F fournitures et matériaux, M main-d'œuvre, A matériel, P prestations, S sous-traitance,
  OT / OD ouvrages) ; rôle d'un tiers par sa table quand TYPETIERS est vide ; architecte sans COMM_TIERS repris de sa seule fiche ;
  euro codé EUR, E, € ou déclaré EUR dans APIDEVISEE.
- Tout repris sauf les éléments en sommeil ; valeurs obligatoires absentes posées par défaut et listées (valeurs
  forcées) ; dates ≤ 1900 et chaînes vides lues comme absentes.
- Consommations (Q15) reprises seulement si elles ne viennent pas d'une pièce ; stock (Q18) = inventaire à la date de
  reprise, sans historique des mouvements (les sorties reprises sont antérieures : elles ne changent pas le stock).
- Pointages repris sans validation (la couche VALIDE se refait dans LogiBTP) ; heures supplémentaires fondues dans un
  pointage, recalculées par les règles de paie.

## Correspondances
- Fichier JSON à commentaires (`source`, `version`, `tables`) ; chaque table : `colonne`, `type_parametre` (OPTIM),
  `cibles` (liste nommée), `entrees` `{ source, cible | ignorer + motif, note }`.
- Tables attendues par source : `CorrespondancesReprise.TablesAttendues` ; listes de cibles (`TYPE_DOCUMENT`,
  `TYPE_LIGNE`, `CASQUETTE`, `MODE_REGLEMENT`, `RUBRIQUE_POINTAGE`…) lues dans la base par `CiblesReprise` et, dans les
  tests, dans les scripts du dépôt (`RepriseCorrespondancesTests`).

## Anomalies (`CODE_ANOMALIE` ↔ `CodeAnomalie`)
Référentiels : `REPRISE_DECIMALES`, `REPRISE_SANS_EQUIVALENT`, `REPRISE_VALEUR_INCONNUE` ; annuaire : `SiretPris`,
`PayeurInconnu` ; bibliothèque : `PrixImpose`, `ConversionManquante`, `ComposanteHorsBibliotheque` ; pièces :
`EcartTtc`, `LigneNonReprise`, `AvancementSansMarche` ; règlements : `EcheancierEcart`, `PointageExcedent` ;
exploitation : `PointageNonRepris` ; stock : `ConsommationNonReprise` ; GED : `GedNonReprise` (aussi le décompte des contenus distincts). Valeurs exactes : `modules/import/js/src/codes.js`.

## Tests
- Module : `npm test --workspace modules/import/js` (correspondances, associations, RTF, fusions) ;
  `dotnet test modules/import/dotnet/LogiBTP.Import.Tests` (mêmes jeux, lecteurs, moteur).
- Cœur : `tests/LogiBTP.Calcul.Tests/RepriseCorrespondancesTests.cs` (fichiers par défaut valides) et
  `RepriseBaseTests.cs` (simulation puis reprise réelle sur une base neuve, une vérification par domaine) ; bases
  sources fictives montées par `tests/reprise/monter.sh` (variables `LOGIBTP_TEST_MSSQL`, `LOGIBTP_TEST_MARIADB`,
  `LOGIBTP_TEST_PG_ADMIN`).
- Interface : `e2e/reprise.spec.ts` (écran de reprise).

## Restes (voir `TODO.md`)
Points à confirmer sur une copie des bases réelles (sens de colonnes, unités, codes non documentés) ; reprise exécutée
dans la requête HTTP (une tâche de fond reste à décider pour les grosses bases) ; tables `PP_*` (lot 17).
