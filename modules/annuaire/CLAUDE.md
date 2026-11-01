# Module Annuaire – contexte

## Rôle
- Personnes (morales à un niveau : groupe, société, établissement, agence, dépôt… ; particuliers), hiérarchie `per_parent_id`, casquettes (« relations » à l'écran : client, fournisseur…) qui déverrouillent des groupes de la fiche personne.
- Individus (êtres humains), rattachements individu ↔ personne (contacts, salariés, dirigeants, titulaire d'un compte particulier), liens typés entre personnes.
- Coordonnées partagées (une valeur, plusieurs usages) avec historique ; contrôles d'identifiants (SIREN, SIRET, TVA, IBAN, BIC) ; graphe relationnel autour d'une fiche.
- Les fiches personne et individu passent par le module Fiche ; l'annuaire fournit leurs champs gérés.

## Dépendances
- Dépend de : `@logibtp/socle`, `@logibtp/graphe` (format, `parcourirEnLargeur`, `fusionnerGraphes`, `VueGraphe`) ; C# : `LogiBTP.Socle` / `LogiBTP.Socle.Web` (`ExceptionMetier`, `Utilisateur`), EF Core.
- Utilisé par le cœur : `src/LogiBTP.Api/Program.cs` (`AddModuleAnnuaire<SpecialisationAnnuaireBtp>(Base)`, `MapModuleAnnuaire`) ; `Btp/SpecialisationsElements.cs` (types `personne` / `individu` : `ControlerPersonne`, `LireGeres` / `ValiderGeres` / `EcrireGeres`) ; `Btp/SalariesAnnuaire.cs` (salarié ↔ individu) ; `db/140`–`142`, `db/162` (intervenants) ; client : `app/annuaire/annuaire.js` (`creerFournisseurAnnuaire`), `donnees.js`, `salaries.js`, `fiches/fiche-annuaire.js`, `pages/graphe.js`, `pages/parametres-annuaire.js`, `structure/intervenants.js` (tiers et contacts), `panneaux-btp.js` (`individusSociete` : rédacteurs du document).
- N'utilise pas le module Entreprises françaises (le cœur relie les deux dans la fiche personne).

## Structure
- `db/070_annuaire_schema.sql` : schéma complet (tables, triggers, vues) ; `071_annuaire_provisoire.sql` (rejouable) : tiers provisoires (`per_provisoire`, `per_provisoire_par|le`, `per_valide_par|le`), journal `fusion_personne`, `v_annuaire_personnes.per_provisoire`.
- `db/073_annuaire_non_remis.sql` (rejouable) : marque « non remise » d'une coordonnée (`coo_non_remis_le|motif`), posée par la messagerie du cœur, affichée par `EditeurCoordonnees` (⚠, option `effacerNonRemise`), effacée par `PUT /coordonnees/{id}/remise` ou une nouvelle valeur.
- `js/src/identifiants.js` : `compacter`, `luhn`, `sirenValide`, `siretValide`, `cleTva`, `tvaDepuisSiren`, `tvaValide`, `ibanValide`, `bicValide`, `emailValide`, `formaterIban`, `formaterTelephone`, `erreursIdentifiants`.
- `js/src/coordonnees.js` : `NATURES`, `RESEAUX`, `CHAMPS_NATURE`, `CHOIX`, `valeursCoordonnee`, `estVide`, `memesValeurs`, `texteCoordonnee`, `erreurCoordonnee`, `planifierCoordonnees`, `coordonneesParDefaut`, `principale`.
- `js/src/fournisseurs.js` : `FournisseurAnnuaireApi` (base `/api/annuaire`), `FournisseurAnnuaireMemoire` (tests), `ErreurAnnuaire`, `libelleIndividu`, `TAILLE_PAGE_RATTACHEMENTS` (20).
- `js/src/fusion.js` : `planFusion` (valeurs retenues : choix, sinon cible, sinon source pour un vide ; relations réunies ; champs supplémentaires par clé `+clé` ; `conflits`), `texteFusion`, `COLONNES_NON_FUSIONNEES`, `motsDoublon` (mots d'un nom sans formes juridiques ni articles), `MOTS_IGNORES_DOUBLON`.
- `js/src/graphe.js` : `construireGraphe`, `fusionnerGraphes` (règle du résumé de contacts), `enColonneAnnuaire`, `PROFONDEUR_MAX` (5), `ORDRE_INDIVIDU` (1000).
- `js/ui/coordonnees.js` : `EditeurCoordonnees` (usages, partage 🔗, reprise d'une fiche liée, historique), `dialogue`, `coordonneeChangee`, `choixAttendu`.
- `js/ui/partage.js` : `choixRequis`, `demanderChoix` (MODIFICATION / AUTRE à l'enregistrement).
- `js/ui/rattachements.js` : `EditeurRattachements` (vu d'une personne : contacts ; d'un individu : ses personnes).
- `js/ui/liens.js` : `EditeurLiens` (hiérarchie et liens typés, vus des deux côtés).
- `js/ui/provisoire.js` : `creerTiersProvisoire` (raison sociale, SIRET ; doublons proposés : SIRET connu → fiche existante, noms proches → choisir ou créer quand même), `fusionnerTiers` (fiche conservée, valeurs en conflit au choix, champs repris).
- `js/ui/selection.js` : `choisirPersonne`, `choisirIndividu` (recherche, création d'individu), `pastilles` (codes en cases) ; `definirChoixAnnuaire({ personne, individu })` : choix injecté par l'application (le cœur : listes filtrées du module Liste, `client/src/app/annuaire/choix.js`), sans dépendance du module ; création d'un individu demandée depuis la liste (`{ creer }`) : formulaire du module.
- `js/ui/referentiels.js` : `GestionReferentielsAnnuaire` (classe mère du paramétrage) ; `js/ui/graphe.js` : `VueGrapheAnnuaire` ; `js/ui/annuaire.css`.
- `dotnet/LogiBTP.Annuaire/` (pur, sans EF) : `Identifiants.cs`, `PlanCoordonnees.cs` (`Planifier`, `SaisieCoordonnee`, `PlanEnregistrement`, `ChoixRequis`), `GrapheAnnuaire.cs` (`Construire`, `OptionsGraphe`, `DonneesGraphe`), `PlanFusion.cs` (`Calculer`, `MotsDoublon`).
- `dotnet/LogiBTP.Annuaire.Web/ServiceAnnuaire.Provisoires.cs` : `Doublons`, `CreerProvisoire`, `ValiderProvisoire`, `Apercu`, `Fusionner` (une transaction : SIRET du provisoire retiré, valeurs écrites sur la cible, coordonnées sans doublon et un principal par nature, contacts (individu déjà contact : un rattachement, coordonnées reportées), liens, enfants, `ReporterFusionAsync`, journal, suppression du provisoire).
- `dotnet/LogiBTP.Annuaire.Web/Donnees.cs` : entités EF, `AnnuaireDbContext`, DTO (`ResumePersonne`, `ResumeIndividu`, `UsageDto`, `RattachementDto`, `PageRattachementsDto`, `LienDto`, `SaisieRattachement`, `SaisieLien`…).
- `dotnet/LogiBTP.Annuaire.Web/ServiceAnnuaire.cs` : `SpecialisationAnnuaire` + `ServiceAnnuaire` ; `Extensions.cs` : DI et routes.
- `dotnet/LogiBTP.Annuaire.Tests/AnnuaireTests.cs` : parité avec les trois jeux de cas.

## Modèle de données (`db/070`)
- Référentiels : `niveau_personne` (`niv_morale` faux = particulier), `casquette` (`cas_groupes` JSONB = groupes de la fiche déverrouillés), `type_lien` (`tli_libelle_inverse` vu depuis la cible), `role_individu`.
- `personne` : `per_code` (`T` + id sur 6 chiffres par trigger `f_personne_avant`), `per_niv_code`, `per_parent_id`, `per_casquettes` JSONB, identifiants (`per_siren`, `per_siret` unique, `per_tva_intra`, `per_identifiant_etranger`), facturation électronique `per_fe_*`, règlement (`per_iban`, `per_bic`…), `per_societe_base` (une seule), `per_proprietes` JSONB.
- `individu` (`ind_roles` JSONB, `ind_utilisateur` unique) ; `rattachement` (unique `rat_ind_id, rat_per_id` ; `rat_principal`, `rat_titulaire`, dates, `rat_actif`) ; `lien_personne` (unique `lpe_per_id, lpe_cible_id, lpe_tli_code`).
- `coordonnee` (`coo_nature` ADRESSE / TELEPHONE / EMAIL / WEB, `coo_reseau`) + `usage_coordonnee` (exactement un de `uco_per_id`, `uco_ind_id`, `uco_rat_id` ; `uco_usage`, `uco_principal`, `uco_ordre`) ; `coordonnee_historique` alimentée par le trigger `tg_coordonnee_historique`.
- Fonctions / vues : `f_annuaire_normaliser` (recherche sans accents ni casse), `f_texte_coordonnee`, `v_personne_chemin` (Groupe › Société › …), `v_annuaire_usages`, `v_annuaire_personnes`, `v_annuaire_individus` (ensemblistes, `DISTINCT ON`).
- Cœur : `db/140_annuaire.sql` (`ALTER TABLE personne`, `salarie.sal_ind_id`, `tarif_fournisseur.tfo_tiers_id`, vues `v_liste_personnes` / `v_liste_individus`), `db/141` (démo générée), `db/142_annuaire_salaries.sql`.

## Points de spécialisation
- `SpecialisationAnnuaire` (C#, singleton) : `PeutParametrer(Utilisateur)` (admin), `NiveauParticulier` (`PARTICULIER`), `CasquettesParticulier` (`CLIENT`), `PeutValiderTiers` (admin), `NiveauProvisoire` (`SOCIETE`), `ReporterFusionAsync(cnx, tx, source, cible)` (références de l'hôte, dans la transaction de la fusion ; cœur : `SpecialisationAnnuaireBtp`). Mémoire : `reporterFusion(source, cible)` posé par l'hôte.
- Branchement : `AddModuleAnnuaire<TSpecialisation>(options)` (sans type : classe mère) ; le cœur appelle `AddModuleAnnuaire<SpecialisationAnnuaireBtp>(Base)`.
- `ServiceAnnuaire` : méthodes `virtual` (`Referentiels`, `RechercherPersonnes`, `RechercherIndividus`, `PageRattachements`, `CoordonneesProposees`, `LireGeres`, `ValiderGeres`, `EcrireGeres` (transaction), `ControlerPersonne`, `Graphe`, `CreerParticulier`…).
- Fournisseurs JS à interface commune (contrat dans l'en-tête de `fournisseurs.js`) ; mémoire : options du constructeur (référentiels, lignes, `profil`, `utilisateur`, `horloge`), `geres(type)`, `controlerPersonne`, `deriver()` (colonnes de liste recalculées après chaque écriture).
- `VueGrapheAnnuaire` (`CLE_REGLAGES = 'annuaireGraphe'`, réglages `contacts`, `liens`, `max_contacts` = 8) ; options `annuaire`, `referentiels`, `ouvrirFiche` ; nœuds `groupe` non ouvrables.
- `GestionReferentielsAnnuaire(conteneur, { fournisseur, groupes, admin, message })` (utilisée par `PageParametresAnnuaire`).
- Champs gérés : personne → `coordonnees`, `rattachements` (+ `nb_rattachements` en lecture), `liens`, `enfants` ; individu → `coordonnees`, `rattachements` (le cœur ajoute `salarie`).

## Routes HTTP (`/api/annuaire`)
- `GET /referentiels` ; `PUT /{niveaux|casquettes|types-lien|roles}` ; `DELETE /{genre}/{code}` (paramétrage : admin).
- `GET /personnes?recherche=&casquette=&limite=`, `/personnes/{id}`, `/individus?…`, `/individus/{id}` ; `POST /individus/{id}/particulier`.
- `GET /societe` (société de la base), `/siret/{siret}` (doublon), `/rattachements?type=&id=&recherche=&page=&taille=`.
- Tiers provisoires : `GET /doublons?raison_sociale=&siret=&exclure=`, `POST /personnes/provisoire` (409 `DOUBLON_SIRET` / `DOUBLON_NOM` sauf `confirme`), `POST /personnes/{id}/validation`, `GET /personnes/{id}/fusion?cible=` (aperçu), `POST /personnes/{id}/fusion` (`{ cible_id, choix }`, 409 `NON_PROVISOIRE`, `FICHE_UTILISEE`) ; validation et fusion : `PeutValiderTiers` (403 `ACCES_REFUSE`).
- `GET /graphe?type=&id=&profondeur=&contacts=&liens=&max_contacts=` ; `/coordonnees/proposees?type=&id=` ; `/coordonnees/{id}/historique`.

## Règles répliquées JS / C# et jeux de cas (`tests/cas`)
- `01_identifiants.json` : `identifiants.js` ↔ `Identifiants.cs` (Luhn, exceptions La Poste, clé TVA (12 + 3 × (SIREN mod 97)) mod 97, IBAN mod 97, BIC ; erreurs d'une personne dans l'ordre pays, siren, siret, tva, iban, bic : `SIREN`, `SIRET`, `SIRET_SIREN`, `TVA`, `TVA_SIREN`, `IBAN`, `BIC`, `PAYS`).
- `02_coordonnees.json` : `planifierCoordonnees` ↔ `PlanCoordonnees.Planifier` (saisie vide ignorée, usage vidé supprimé ; coordonnée partagée modifiée → choix `MODIFICATION` / `AUTRE`, sinon `CHOIX_REQUIS` ; un principal par nature ; ordre = rang dans la nature ; opérations `SUPPRIMER` / `AJOUTER` / `MAJ`, coordonnée `GARDER` / `MODIFIER` / `NOUVELLE`).
- `03_graphe.json` : `construireGraphe` ↔ `GrapheAnnuaire.Construire` (clés `P<id>`, `I<id>`, `G<id>` « + N contacts » ; niveaux supérieurs du départ toujours présents ; nœuds triés par ordre puis clé, arêtes par clé).
- `04_fusion.json` : `planFusion` ↔ `PlanFusion.Calculer` (cible prioritaire, source pour les vides, booléen jamais vide, nombres sans zéros inutiles, colonnes techniques ignorées, `+clé`) et `mots_doublon` : `motsDoublon` ↔ `PlanFusion.MotsDoublon`.
- `FournisseurAnnuaireMemoire` applique les mêmes règles que `ServiceAnnuaire` (unicité société de la base et SIRET, hiérarchie sans `BOUCLE`, doublons, tiers provisoires et fusion).
- Erreurs serveur : `ExceptionMetier` 422 `VALIDATION` avec détails `{ champ, code, message }` (`UNIQUE`, `BOUCLE`…), 422 `CHOIX_REQUIS` (coordonnée partagée sans choix), 409 si coordonnée modifiée entre-temps (`COORDONNEE_MODIFIEE`) ; côté JS `ErreurAnnuaire(statut, code, message, details)`, paramétrage hors ADMIN → 403 `ACCES_REFUSE` (mémoire).
- Toute règle modifiée : les deux implémentations + le jeu de cas, puis tests JS et .NET.

## Conventions et pièges
- « Casquettes » dans le code et la base, « relations » à l'écran.
- Rattachements lus par page (20) ; la fiche n'envoie que les rattachements modifiés, ajoutés (sans `rat_id`) ou retirés (`supprime: true`) : un absent est inchangé.
- Coordonnée partagée : ne jamais la modifier sans le choix MODIFICATION / AUTRE ; historique par trigger, pas par le code.
- Vues ensemblistes (`DISTINCT ON`), pas de fonction par ligne (volumes de salariés) ; le graphe C# lit tout en une fois puis parcourt en mémoire.
- Compte particulier (`CreerParticulier`) : personne titulaire, coordonnées personnelles partagées (même `coo_id`) ; idempotent.
- Recherche : mots normalisés (`ServiceAnnuaire.Mots`, `f_annuaire_normaliser`), limite 30 par défaut.
- Doublon d'établissement : `parSiret` avant création (fiche personne, reprise depuis l'annuaire des entreprises).
- Tiers provisoire : seul un provisoire se fusionne (dans n'importe quelle autre fiche) ; doublon de nom = tous les `motsDoublon` contenus (sans accents) dans la raison sociale ou le nom commercial, 10 au plus ; un nouveau tiers saisi depuis les intervenants (bouton ＋) est toujours provisoire.
- Salariés : chaque salarié est lié à un individu (`salarie.sal_ind_id`) rattaché à notre société ; synchronisation dans le cœur (`SalariesAnnuaire.cs`, `synchroniserSalarie`).
- Démo : modifier `client/src/app/annuaire/donnees.js` puis `npm run generer-vues-liste --workspace client` (régénère `db/141`).

## Textes, icônes et couleurs (module Personnalisation, lot P3g)
- Textes `annuaire.*` de `js/personnalisation/fr.json` (zones `natures`, `reseaux`, `coordonnees`, `identifiants`, `fournisseur`, `partage`, `liens`, `provisoire`, `fusion`, `selection`, `rattachements`, `referentiels`, `graphe`) ; icônes `annuaire_*` de `images/icones.json` et communes du socle ; couleurs des relations du graphe `--annuaire-relation-<code>` de `theme.css`.
- `NATURES` (libellés, usages par `pairesParCode`), `RESEAUX`, `MESSAGES_COORDONNEES`, `MESSAGES_IDENTIFIANTS` : même forme qu'avant ; utilitaires de texte locaux : `nettoye`.
- Gardés : civilités (valeurs enregistrées), mots ignorés des doublons ; libellé « + N contacts » et icônes des nœuds identiques au jeu `03_graphe.json` (serveur littéral).
- Tests : `js/test/preparation.js` compose socle + module (clé manquante = échec) ; clés du code vérifiées par `client/test/personnalisation.test.js`.

## Tests
- `npm test --workspace modules/annuaire/js` (vitest : jeux partagés, fournisseur mémoire, disposition du graphe).
- `dotnet test modules/annuaire/dotnet/LogiBTP.Annuaire.Tests` (ou `dotnet test LogiBTP.slnx`).
