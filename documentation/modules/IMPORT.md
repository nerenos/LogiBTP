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
   [--reel] [--correspondances F] [--rapport F.md] [--ged RACINE] [--decimales-qte N] [--decimales-prix N]
   [--volume-mde SURFACE|VOLUME]` (simulation par
   défaut, code de sortie 2 en cas d'échec). Décimales des lignes de pièces reprises : MDE 3 (quantités) et 2 (prix) par
   défaut, modifiables à l'écran avant l'import ; OPTIM : celles de la quantité source, prix à 6.
   Écran : `POST /api/reprise/executer` ne fait que les contrôles rapides (connexion saisie, base vide, aucune reprise
   en cours : 409 `REPRISE_EN_COURS`) puis rend la main (202) ; la reprise tourne en **tâche de fond**
   (`TachesReprise`, singleton du cœur, une par base, mémoire du processus, portée `CreerPorteeSociete`, annulée par
   `POST /api/reprise/tache/arreter` → `REPRISE_INTERROMPUE` ou l'arrêt de l'API). L'écran interroge
   `GET /api/reprise/tache` toutes les 2 s (étape `ETAPE_REPRISE` : PREPARATION, COMPTAGE des tables, DOMAINE n / total,
   ENREGISTREMENT, signalée par `OptionsReprise.Avancement`), puis affiche le rapport de l'exécution enregistrée ;
   `GET /api/reprise` renvoie aussi `tache` : une page rechargée reprend le suivi. Avant (24/11/2026), la reprise
   tournait dans la requête HTTP et s'annulait avec elle (navigateur ou proxy qui coupe une longue requête : transaction
   annulée, aucun rapport, page vidée).
   Délais : lectures de la source 600 s (`LecteurAdo.DelaiSecondes`, MDE en READ UNCOMMITTED, équivalent de
   `WITH (NOLOCK)`), commandes sur la base cible 600 s aussi (`RepriseBase.ConnexionCible`, au lieu des 30 s par défaut).
   Erreur inattendue : anomalie bloquante avec le domaine en cours en emplacement, code « enveloppe / origine » et
   messages des exceptions internes (`MoteurReprise.CodeErreur`, `MessageErreur`).
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
- MDE, conditions de paiement (`APIMODEREGLEMENTL.TYPEP`, type d'échéance) : C comptant, N net (NJ jours, ou le JOUR
  suivant si JOUR > 0), F fin de mois, M fin de mois le JOUR (base `FIN_MOIS_JOUR` : date + NJ, fin de mois, puis le JOUR
  du mois suivant) ; mode de paiement : `PMEMODEPAIEMENT` cité par `MODEP` de la première ligne (table `mode_paiement`
  par clé, sinon rapproché par le libellé), sinon par le nom de la condition.
- MDE, marché : `PMEAFFBASEDOC` repris avant les pièces ; une commande copie exacte d'une pièce du marché (même numéro,
  ou pièce d'origine `CLEDOCINIT`) n'est pas reprise une seconde fois (`PieceDejaReprise`, renvoie à la pièce du marché) ;
  un devis d'origine est gardé et lié à la pièce du marché.
- MDE, zones supplémentaires (`SYS_RTCINFOS`) : versées dans le champ existant de la fiche de même libellé ou de même
  code (unités entre parenthèses ignorées, paramétrage `type_fiche`), ou celui de la table `champ_fiche`
  (« type_fiche.code », ou ignorer) ; sinon champ supplémentaire `x_` créé. Un champ existant déjà renseigné par la
  reprise n'est pas écrasé (perte notée).
  Liste de choix (`DATATYPE` « Choix multiple », `PARAMS` « S: M "&Oui;&Non" ») : champ liste, valeurs = lettre qui suit
  « & » (ce que MDE enregistre), libellés sans « & ». Zone de blocage (« Bloqué », « Achat bloqué »…) : usage de la fiche,
  « Ne plus utiliser » si elle vaut Oui (ou cible `personne.usage` de `champ_fiche`).
- MDE, tiers en compte bloqué (`COMM_TIERS.COMPTEBLOQUE`) : fiche en « Ne plus utiliser » (usage N) ; fusion de doublons :
  seulement si tous les rôles fusionnés sont bloqués.
- MDE, données techniques (`PMEELEMENTARTTEC`, par unité de stock) : longueur, largeur, hauteur en m (mm dans LogiBTP),
  poids en kg, `VOLUME` en surface (m², défaut) ou en volume (m³) selon l'option de la reprise (écran, `--volume-mde`) ;
  unités `UNITE*` : M (mètre) et K (kilo) par défaut, tout autre code non converti et signalé `UniteTechnique`.
- MDE, achats : adresse de livraison de l'entête (`NOMLIV`, `ADRLIV`, `CPLIV`, `VILLELIV`, `PAYSLIV`, contact
  `NOMINTERLOCLIV` / `TELINTERLOCLIV`) en saisie libre (`ent_adresse_livraison`, origine LIBRE), même vers notre société
  ou le chantier.
- MDE, traçabilité (`TracabiliteMde.cs`, fin du domaine `ACHATS`) : `TRACABILITEDOC` → `document_lien` entre entêtes
  repris (type eTypeDocument → table d'entête, `CODEDOC*INT`), `TRACABILITE` → `document_ligne_lien` (étape de la
  transformation autorisée entre les deux types, quantité de la source) et `lig_origine_id` de la ligne cible ; lignes
  retrouvées par le registre (`PieceSource.TableLignes` : clé de chaque ligne reprise) ; type inconnu : perte notée.
- Pièces d'avancement (situations, factures d'avancement) : `ent_marche_id` = marché de vente du chantier (un seul par
  chantier dans MDE) ; factures simples et avoirs restent au chantier, sans marché.
- Intérimaires MDE : salarié seul, sans mission d'intérim (souvent d'anciens intérimaires), agence notée perdue ; OPTIM
  (début et fin gérés) : une mission aux dates d'entrée et de sortie de la fiche.
- MDE, compositions des ouvrages : ligne de texte (composant de type texte, ou sans composant ni quantité ni prix)
  reprise en ligne de texte de la composition ; textes standard (`PMETEXTESTANDARD`) : éléments de type texte de la
  bibliothèque par défaut (code, libellé, texte RTF, note en description).
- MDE, métrés des pièces de vente et des marchés (`MetresMde.cs` : `PMEMETRE`, `PMEMETRELIGNE`, `PMEMETREVAR`, lignes par
  `CLEMETRE`) : script LogiBTP par ligne (une formule seule : `Renvoyer expr` ; sinon `local Total`, `Total += expr` des
  lignes de niveau de total non nul, `NOM=expr` ou `VARRESULT` en variable locale totalisée, autres types en commentaire
  signalés) ; affectations du métré de la ligne récapitulative (R, non reprise) et variables `GLOBALE` : **métré du
  document** « Récapitulatif » (`MetresMde.ScriptDocument` : déclaration à la première affectation, réaffectations dans
  l'ordre, valeurs `GLOBALE` en dernier ; variables publiées en `$$NOM`), lues par les formules quelle que soit leur casse
  (`p*0,150` → `$$P*0.150`, virgule décimale → point) ; données de la ligne entre crochets → colonnes de la ligne (`[POIDS]` → `{{lig_poids}}`, `[LONGUEUR]`, `[LARGEUR]`, `[HAUTEUR]`, `[EPAISSEUR]`, `[SURFACE]`, `[VOLUME]` → surface ou volume selon l'option ; `MetresMde.DonneesLigne`), reprises des colonnes POIDS, LONGUEUR, LARGEUR, HAUTEUR, VOLUME des lignes (m, kg) ; donnée inconnue laissée telle quelle et signalée ; anomalies des champs supplémentaires (`SYS_RTCINFOS`) avec le nom affiché du champ ; tranche T : quantité ≠ 0 et ≠ 1 → quantité de tranche (ses lignes
  multipliées), métré cité → métré de tranche (plan metres-tranches-document, lot 7) ; quantité issue du métré
  (`lig_qte_source` M) si son résultat, arrondi à la précision de la ligne, retrouve la quantité source (tranche sans
  quantité : 1), sinon quantité saisie gardée, métré attaché et `MetreEcart` signalé.
- Articles à unités différentes (achat, stock, vente) : rapports de la source repris bruts (RATIOSTOCK direct, RATIOVENTE
  inversé : unités de vente par unité de stock), PA et PV gardés (coefficient
  déduit, PV non imposé), signalés `ConversionBrute` pour correction manuelle.
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
`PayeurInconnu` ; bibliothèque : `PrixImpose`, `ConversionManquante`, `ConversionBrute`, `UniteTechnique`, `ComposanteHorsBibliotheque` ; pièces :
`EcartTtc`, `PieceDejaReprise`, `LigneNonReprise`, `AvancementSansMarche` ; règlements : `EcheancierEcart`, `PointageExcedent` ;
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
