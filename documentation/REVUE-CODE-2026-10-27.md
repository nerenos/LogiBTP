# Revue du code du 27/10/2026 : code inutilisé, doublons, constantes

Périmètre : `socle/`, `modules/`, `src/`, `client/` (hors scripts SQL `db/`). Revue en lecture seule : aucune
correction n'est encore faite. Les constats sont regroupés en **lots** à valider un par un (un commit par lot).

Méthode : passe mécanique (exports JS jamais importés, membres cités une seule fois dans le dépôt, corps de fonctions
identiques), puis lecture par périmètre. Les réplications voulues JS ↔ C# (moteurs miroirs, `regles.js` ↔
`Regles*.cs`, jeux de cas partagés) ne sont pas des doublons ; les propriétés d'entités mappées sur le DDL ne sont pas
du code mort. Le code cité dans `TODO.md` ou annoncé « à venir » dans les analyses est marqué **en attente** et
conservé.

Certitude : **sûre** = vérifiée (0 appel, corps identique…) ; **à confirmer** = décision fonctionnelle à prendre.

---

## Lot A — Code mort sûr (suppressions)

> **En attente** (28/10/2026) : des évolutions à venir vont toucher ce code ; lot à reprendre après elles.

| Emplacement | Constat |
|---|---|
| `src/LogiBTP.Api/Btp/LiaisonsBtp.cs:25` | record privé `OrdreAmont` jamais utilisé |
| `modules/annuaire/js/src/identifiants.js:70` | `formaterIban` jamais appelé |
| `modules/document/js/src/types.js:82-83` | `MODES_PIED`, `BASES_PIED` jamais lus |
| `modules/metre/js/src/script-metre.js:8` ↔ `ScriptMetre.cs:13` | `estScript` / `EstScript` jamais appelés (la conversion teste `MtrScript is null` en dur) |
| `modules/installation/.../SocietesInstallation.cs:25` | `CodeBase` jamais appelé, redondant avec `ModeleConnexion.NomBase` du socle |
| `client/src/app/api.js` | `execution.heuresChantier`, `servicesIndividu`, `crm.modifierRappel`, `verrouDocument` jamais appelés |
| `client/src/app/demo-lots.js:260`, `demo.js:114` | `NB_LOTS_DEMO`, `CODES_DEMO` jamais lus |
| `client/src/app/frais-annexes.js:18` | `LIBELLES_CIBLE` jamais lu |
| `client/src/app/crm/crm.js:22` | `libelleNature` jamais lu |
| `using` inutiles | `System.Globalization` (`Acomptes.cs`, `Intervenants.cs`, `MailBtp.cs`, `StockBtp.cs`), `System.Text.Json` (`Structure.cs`) |
| ~75 `export` superflus | symboles utilisés seulement dans leur fichier (`PAYS_TVA`, `MESSAGES_IDENTIFIANTS`, `erreurCoordonnee`, `dynamique`, `composerHtml`, `couleurWindows`, `comparerCle`, `montantsFeuille`, `uniteLigne`, `Fiche*` des fiches…) : retirer le mot `export`, sauf ceux que la documentation cite comme interface (`reidentifier`, `texteEtats`, `lireEtats`) |
| `modules/edition/.../AccesEdition.cs:9` | commentaire « futur module des droits » périmé |

## Lot B — À trancher (code apparemment inutilisé)

> **En attente** (28/10/2026) : des évolutions à venir vont toucher ce code ; lot à reprendre après elles.

| Emplacement | Constat | Proposition |
|---|---|---|
| `socle/.../Droits.cs:51` `ExigeDroit` | jamais appelé, remplacé par `SpecialisationDroitsBtp.Routes` | supprimer |
| `socle/.../Diffusion.cs:44` `NombreAbonnes` | jamais lu | supprimer ou afficher dans `/parametres/installation` |
| `ServiceEtapes.cs:334` `InitialiserAsync` | jamais appelé (`EtapesAsync` crée les étapes à la lecture) | supprimer |
| `Contrats.cs:22` `VersionMoteurClient` | envoyé par le client, jamais lu par le serveur | journaliser ou ne plus l'envoyer |
| `Identifiants.cs:55` `TvaDepuisSiren` (C#) | 0 appel, 0 test (le JS sert à la démo) | ajouter un cas au jeu `01_identifiants` ou supprimer |
| `modules/document/js/ui/parametrage.js:11`, `vues.js:14` | `FournisseurAffichageMemoire`, `FournisseurVuesMemoire` : restes de la démo hors ligne | supprimer |
| `modules/crm/js/src/validations.js:9` `EFFETS_VISA` | jamais lu | brancher sur l'écran des visas ou retirer l'export |
| Routes Document `GET /modeles-document`, `POST /documents/{id}/reference`, `GET /documents/{id}/lot-archivage` | aucun appelant client | garder si un écran est prévu |
| `client/src/app/api.js` `planning.enregistrerVue`, `editions.chartes`, `editions.enregistrerCharte`, `transformerPlusieurs` | jamais appelés (routes serveur existantes) | supprimer côté client ou brancher |
| `RetenuesMarche.cs:57` `LibererAsync(…, Utilisateur u)` | paramètre jamais lu | retirer, ou journaliser la libération |
| `client/scripts/generer-documents-demo.mjs:11` | en-têtes `X-Utilisateur` / `X-Profil` alors que le script se connecte par cookie | retirer |
| `/planning/prototype` | route sans menu (prototype du lot 1) | garder, éventuellement en développement seulement |

**En attente (conservés)** : `definirRegleCompte` (`comptes.js`, TODO Comptabilité — l'entrée `TODO.md:125` est à
reformuler : la ventilation du lot 2 est déjà intégrée), `modifierEcheances` + `PUT /documents/{id}/echeances`
(échéancier à la main), `convertirContenu` (`metre/js/src/conversion.js`, tant que des bases ne sont pas converties),
`ReglesRessources.Manquantes` ↔ `habilitationsManquantes` (règle répliquée ; l'alerte du planning refait le calcul en
SQL dans `SpecialisationPlanningBtp.cs:105` : à brancher dessus).

## Lot C — Dates : une anomalie et une vingtaine de doublons (socle)

> **Fait** (28/10/2026) : `socle/js/src/calcul/dates.js` (`aujourdhui`, `dateLocale`, `ajouterJours`, `ajouterMois`,
> `joursEntre`…) et `formatDate` / `formatDateHeure` / `formatHeure` dans `socle/js/src/ui/format.js` ; date du jour
> locale partout dans le client et les modules Bibliothèque et GED ; copies retirées (Sous-traitance, GED, ressources,
> pointage, borne, CRM…) ; `ReglesConformite.AjouterMois` → `AddMonths`. Gardés volontairement : les calculs des
> modules JS sans dépendance (Calendrier, Pointage, Exécution), les additions de jours en UTC répliquées en C#
> (justes : jour civil), le jour UTC d'un instant dans `authentification/regles.js` et `ged/retention.js` (aligné sur
> le serveur), les formats d'affichage particuliers (jour de la semaine, jour et mois seuls), les scripts de
> démonstration (`client/scripts`).

**Anomalie** : `aujourdhui = () => new Date().toISOString().slice(0, 10)` donne la date **UTC** : entre 0 h et 2 h
(heure de Paris), c'est la veille. Copies dans `comptes/comptes.js:10`, `fiches/fiches.js:14`,
`fiche-structure.js:27`, `crm-diffusion.js:19`, `parametres-calendriers.js:14`, `pages/pointage.js:17`,
`compteurs-ui.js`, `entretiens-ui.js`, `ressources-ui.js`, `sous-traitance/paiements.js`, et en ligne dans
`document.js:633` (date du nouveau document), `devis-a-verifier.js`, `photo.js`, `fiche-element.js`,
`crm-demandes.js`, `crm-plan.js`, `habilitations.js`, `planning.js`, `fiche-annuaire.js`… Seul `pages/reglements.js:9`
calcule la date locale.

Proposition : `socle/js/src/calcul/dates.js` (sans DOM, compatible Jint) avec `aujourdhui()` (locale),
`ajouterJours`, `ajouterMois`, `numeroJour` ; `formatDate` / `formatDateHeure` / `formatJour` dans
`socle/js/src/ui/format.js`. Remplace :
- `ajouterMois` : `client/src/app/ressources/regles.js`, `modules/sous-traitance/js/src/conformite.js:27` (corps
  identiques), `modules/ged/js/src/retention.js:34`, `unAn` de `retenue.js:9` ;
- `ajouterJours` : `entretiens.js:22`, `equipes.js:28`, `pointage.js:18` (`decaler`), `borne.js:45` (`decalerJour`),
  `conformite.js:35`, `paiement-direct.js:24`, `etapes.js`, `echeances.js`, `conges.js:17` (le module Calendrier
  réexporte celle du socle) ;
- formatage : ~48 `toLocale*('fr-FR')` dans 34 fichiers du client et 6 modules (`dateFr`, `dateHeure`, `dateCourte`,
  `horodatage`, `formatDateHeure` du CRM, `dateHeureLocale` du Stock).
- C# : `ReglesConformite.AjouterMois` → `AddMonths` (comme `RegleRetention`).

Les règles répliquées gardent leur pendant C# ; les jeux de cas partagés (conformité, rétention, congés, échéances)
vérifient que rien ne change.

## Lot D — Utilitaires JS en double (socle)

| Doublon | Copies | Regroupement |
|---|---|---|
| `normaliser` (table `SPECIAUX` + NFD + minuscules) | `liste/normaliser.js:6`, `annuaire/fournisseurs.js:97`, `ged/recherche.js:5` (identiques) | `socle/js/src/calcul` |
| Tables d'accents partielles | `authentification/regles.js:104`, `edition/formules.js:13`, `mail/reconnaissance.js:5`, `document/moteur-document.js:17`, `socle/ui/liste-deroulante.js:3` | pointer sur la table explicite du socle (à confirmer : vérifier les jeux 08/09 Document et 01 Mail) |
| `Erreur*` + `appel(methode, url, corps)` | `fournisseurs.js` de annuaire, bibliotheque, fiche, ged, liste, entreprises-fr ; `ErreurApi` de `client/api.js` | `ErreurApi` + `appelApi` dans le socle |
| Deux échappeurs HTML | `socle/calcul/libelles.js:6`, `socle/ui/format.js:89` (`echapper` n'échappe pas `'`) | une seule fonction |
| `localStorage` JSON + try/catch | `navigation/preferences.js:5`, `bibliotheque/ui/arbres.js:39`, `liste/ui/liste.js:608`, `liste/fournisseurs.js:97` | classe `Preferences` du socle, clé en paramètre |
| IndexedDB `ouvrir` / `operation` | `hors-ligne/attente.js:57`, `import/depot-import.js:9` (identiques) | `magasinIdb(base, magasin, schema)` |
| Export CSV (BOM, Blob, `<a download>`) | `stock/etat.js:95`, `stock/magasin.js:185`, `pages/pointage.js:953`, `tarifs-fournisseur.js:18`, `parametres-editions.js:129` | `telechargerCsv(nom, lignes)` |
| `nombre()` local au lieu de `lireNombre` | `stock/magasin.js:11`, `inventaires.js:18`, `approvisionnement.js:13`, `tarifs-fournisseur.js:12` | `lireNombre` du socle |
| `f = v => v == null ? '' : formatNombre(v, 2)` | `consultation.js:12`, `paiements.js:13`, `execution.js:24` | `formatNombre` directement |
| `prix()` | `bibliotheque/appel.js:20`, `fiche-element.js:20` | `formatPrix` exporté par la Bibliothèque |
| Pastilles d'état (état → classe + libellé) | 13 fois dans 9 fichiers (`pastilleMessage` ≡ `pastilleCompteMail`) | `pastilleEtat(etat, options)` dans `client/src/app` |
| Panneau latéral réductible / séparateur | `pages/pointage.js:413` (`gabaritPanneau`, référence), `planning.js:352`, `edition.js:90`, `analyse-coefs.js:165` ; `separateur()` de `ged/ui` | `separateur` dans le socle, `panneau-lateral.js` dans le client |
| `<dialog>` construits à la main | 17 fois dans 15 fichiers (`sources.js`, `transformation.js`, `envoi.js`, `appel.js`, `structure/*`…) | `ouvrirDialogue` / `ouvrirModale` (cas par cas) |
| `opt()` + `<select>` bruts | `document/ui/panneaux.js`, `vues.js`, annuaire, bibliotheque, graphe, navigation, `socle/editeur-riche.js` | `creerCombo` (élargir l'entrée « derniers `<select>` » du TODO) |
| `appel()` HTTP à cookies tournants | `generer-documents-demo.mjs:16`, `generer-modules-demo.mjs:19` | `client/scripts/api-demo.mjs` |

## Lot E — Utilitaires et constantes C# du socle

> **Fait** (29/10/2026) : `Utilisateur.ExigerAdmin()` et `ExceptionMetier.ParametrageRefuse()` (`Web.cs`, ≈ 60 refus du
> paramétrage, aide `Exiger` d'OAuth retirée) ; `Codes.cs` du socle ↔ `socle/js/src/codes.js` (parité `CodesTests`) :
> `Profils` ↔ `PROFIL` (ADMIN, BORNE), `ActionsDroits` ↔ `ACTION_DROIT` (actions du modèle, propres aux nœuds et noms
> des modules ; `Cascade` = `ReglesDroits.Actions`, liste `ACTIONS` de `droits/js/src/regles.js` vérifiée par
> `ReglesDroitsTests`), `NiveauConfidentialite` ↔ `NIVEAU_CONFIDENTIALITE` (constantes d'`AccesGed` et liste de
> `ClassificationGed` retirées ; Édition, cœur, `ged/acces.js`, fournisseur mémoire et explorateur de la GED) ;
> `LogiBTP.Droits` et `LogiBTP.Ged` référencent désormais `LogiBTP.Socle`. Côté JS : profil ADMIN des fournisseurs
> mémoire (Annuaire, Bibliothèque, Fiche, GED) et du client. `ExtensionsConfiguration.ChiffrementDepuis` /
> `ClesPrecedentes` et `VariablesEnv.CleChiffrementPrecedentes` (socle et commandes d'installation). Options JSON :
> `JsonCalcul.Web` (web + snake_case : diffusion, planning, paie, synthèse du pointage), `JsonCalcul.Options`
> (authentification), `JsonSerializerOptions.Web` au lieu d'instances recréées. `LectureJson.Texte` / `TexteNonVide`
> du socle (adresses des documents, courriels, intervenants ; MailBtp retire désormais les espaces de bord).
> Gardé : les mots VALIDER / MODIFIER / SUPPRIMER qui sont des codes d'opération propres (coordonnées de l'annuaire,
> congés, synthèse du pointage, étapes de l'exécution, `ActionEtape`) ; ServiceEtapes garde ses options JSON
> (`WhenWritingNull`) ; `Texte` des Entreprises françaises (accepte les nombres) et des valeurs de fiche ou de liste
> (conversion de toute valeur) ; OAuth (règles sans dépendance au socle). Reporté : tables d'accents (voir TODO).

| Sujet | Constat | Proposition |
|---|---|---|
| `AccesRefuse("PARAMETRER")` | ~50 fois dans ~35 fichiers, souvent précédé de `if (!u.EstAdmin)` | `Utilisateur.ExigerAdmin()` / `ExceptionMetier.ParametrageRefuse()` |
| Profil `"ADMIN"`, `"BORNE"` | 8 fichiers C# des modules, 3 du cœur, 6 JS | `Profils.Admin`, `Profils.Borne` (C#) et `PROFIL_ADMIN` (JS) dans le socle |
| Actions CONSULTER / MODIFIER / CREER / VALIDER / SUPPRIMER / RGPD | ~100 occurrences ; `ReglesDroits.Actions` et `DocumentService.ActionsDocument` en sont deux copies | `ActionsDroits` à côté de `IDroits`, parité avec `ACTIONS` de `droits/js/src/regles.js` |
| Options JSON snake_case | redéclarées dans `ServiceAuthentification`, `ServiceEtapes`, `ServicePlanning`, `ServicePaie`, `ServiceSynthese`, `Diffusion` | `JsonCalcul.Options` (ou variante Web) |
| `new Chiffrement(cle, …_PRECEDENTES)` | 4 constructions (`CommandeInstallation.cs` ×3, `Configuration.cs`) | `ChiffrementDepuis(config)` |
| Niveaux PUBLIC / INTERNE / CONFIDENTIEL / SECRET | GED (`AccesGed`, `ClassificationGed`), Édition (`AccesEdition`, `ServiceEdition`), cœur `MailBtp`/`EditionsBtp` en dur | `NiveauxConfidentialite` dans le socle (+ miroir JS de `ged/acces.js`) |
| Tables d'accents C# | `NormalisationGed.cs:38` (complète), `MoteurDocument.cs:975`, `ReconnaissanceMail.cs:42` (partielles) | `Normalisation.cs` du socle (à confirmer par les jeux) |
| Lecture `Texte(JsonElement, nom)` | 3 variantes divergentes dans le cœur, plus Entreprises françaises et OAuth | une seule lecture dans le socle |

## Lot F — Requêtes en double dans le cœur serveur

| Sujet | Copies | Proposition |
|---|---|---|
| Comptes administrateurs actifs | 9 (`MailBtp`, `NotificationsBtp` ×7, `SpecialisationAuthentificationBtp`, `OAuthBtp`) | `DestinatairesBtp.AdministrateursAsync` |
| Membres d'un service (id, code ou nature) | 6 variantes (`MailBtp`, `NotificationsBtp`, `OAuthBtp`) | `DestinatairesBtp.MembresAsync` |
| Individu / salarié du compte connecté | `AtelierBtp:93` ≡ `SpecialisationPointageBtp:56` ; `SpecialisationCrmBtp:153` vs `SpecialisationExecutionBtp:116` (`LIMIT 1` d'un côté seulement) ; `lower(ind_utilisateur)` dans `MailBtp`/`OAuthBtp` seulement | `ComptesBtp` (unifier la casse) |
| Responsable d'un service | `Equipes:255` ≡ `SpecialisationPlanningBtp:178` ; variantes `StockBorneBtp:38`, `SpecialisationPointageBtp:275` | fonction commune |
| Auteur à la borne (`salarie:<id>`, profil BORNE) | `AtelierBtp:100`, `StockBorneBtp:113` | `BorneBtp.AuteurAsync` |
| Calendrier / service principal d'un salarié | `CalendriersBtp:38`, `SpecialisationPlanningBtp:75`, `SpecialisationPointageBtp:35` | passer par `CalendriersBtp` ou vue `v_salarie_service` |
| Chantiers du jour = tâches du planning | `AtelierBtp:58`, `SpecialisationPointageBtp:345` | fragment unique dans `LiaisonsBtp` |
| Ordres E de référence ouverts | 6 copies, listes de statuts différentes | vue `v_ordres_ouverts` |
| Union des ressources (salarié, intérim, matériel, sous-traitant, équipe) | 5 versions, libellés « prénom nom » / « nom prénom » incohérents ; `CASE sal_statut='INTERIM'` ×6 | vue `v_ressource` (aussi le point d'accroche du TODO « Ne plus utiliser ») |
| `Json(db, sql, ct, params)` | 6 copies identiques (`AffectationsMateriel`, `CompteursMateriel`, `EntretiensMateriel`, `ModulesServices`, `Ressources`, `UtilisationsElement`) | une méthode d'extension |
| `P(nom, valeur, type)` paramètres nullables | 5 copies + ~66 `?? DBNull.Value` en ligne | `ParametresSql.P` / `Recherche(q)` |
| Identifiant / code d'un type de document | 5 + 2 copies | `TypesDocumentBtp.IdAsync`, `CodeAsync` |
| Adresse → lignes de texte | `EditionsBtp:240,350,566`, `AdressesDocument:112` | `LignesAdresse` |
| Chantier technique (affaire MATERIEL / DOTATIONS) | `CoutsMateriel:57`, `MagasinBtp:60` (collision de code non gérée par le Magasin : `ON CONFLICT DO UPDATE` peut reprendre le chantier d'une autre affaire) | `ChantiersTechniques.CreerAsync` (à confirmer) |
| Date-heure du planning `ToString("yyyy-MM-dd")+"T00:00"` sans culture invariante | 7 fois (`LiaisonsBtp`, `SpecialisationPointageBtp`) | `ReglesPlanning.Ecrire` du module |
| Prédicat « pièce vivante » (`std_code NOT IN ('ANNULE','REMPLACE'…)`) | `'ANNULE'` 40 fois dans 18 fichiers, 7 listes différentes | constante interpolée ou `f_document_vivant` |

## Lot G — Constantes de chaque module (JS + C#, parité testée)

> **Fait** (28/10/2026) : un `codes.js` par module (objets figés `Object.freeze`) ↔ `Codes.cs` (classes de constantes),
> parité vérifiée par un `CodesTests` par module (`Constantes.Ecarts` de `LogiBTP.Socle.Testing`). Socle :
> `NIVEAU_NOTIFICATION` ↔ `NiveauNotification` (utilisé par Mail, OAuth, Planning, Notifications et le cœur). Document :
> `FAMILLE_DOCUMENT`, `STATUT_DOCUMENT`, `STATUTS_HORS_VIGUEUR`, `noeudDroitsDocument` ↔ `FamillesDocument` (constantes,
> `NoeudDroits`), `StatutsDocument`. Exécution : `ETAT_ORDRE`, `STATUT_ORDRE` (copie déclarée des statuts, vérifiée par
> `client/test/codes.test.js`) ; `ExecutionBtp.Etats` retiré. CRM : `NATURE_NOTE`, `ETAT_NOTE`. Bibliothèque :
> `GESTION_ELEMENT` (`GESTIONS` et la fiche élément en dérivent). Pointage : `ETAT_CONGE`. Planning : sujet
> `DIFFUSION_PLANNING`. Erreurs testées par l'interface : `ERREUR_ANNUAIRE`, `ERREUR_FICHE`, `ERREUR_LISTE` (le
> `HORS_LIGNE` 501 de la liste devient `REQUETE_HORS_LIGNE`), `ERREUR_POINTAGE`, `ERREUR_AUTHENTIFICATION`,
> `ERREUR_MAIL` ; `"mail_fond"` lu de `ServiceReceptionMail.Fond`. Navigation : l'état d'affichage du routeur
> (`sessionStorage`) devient `logibtp.etat-affichage` ; clés des scripts `public/demarrage-*.js` vérifiées par un test.
> Gardé : les statuts et natures écrits dans le SQL des requêtes (prédicat « pièce vivante » : lot F) ;
> `FICHE_UTILISEE` de l'Annuaire (le module ne dépend pas du module Fiche).

Un fichier de codes par module (`codes.js` ↔ `Codes*.cs`), dont une section `ERREURS` pour les codes testés par
l'interface ; le cœur importe ces constantes au lieu de réécrire les chaînes.

| Module | Codes |
|---|---|
| Document | statuts BROUILLON / VALIDE / ENVOYE / ANNULE / REMPLACE / SOLDE ; familles (`FamillesDocument.Vente`, `Achat`, `Execution`, `SousTraitance`… ; seule `Toutes` existe) ; `NoeudDroits(famille, code)` (réécrit dans `SpecialisationDroitsBtp:39`, `SpecialisationsElements:196`) |
| Exécution | `ETATS_ORDRE` / `EtatsOrdre` jamais lus, recopiés par `ExecutionBtp.cs:23` ; statuts de documents recopiés (copie déclarée + test) |
| CRM | `NatureNote` (`TACHE`…), `EtatNote` (`A_FAIRE`…) : 6 fichiers du cœur + 3 du module |
| Bibliothèque | `GESTIONS` / `Gestions` jamais lus ; `'STOCK'` recopié dans `definitions.js:207`, `fiche-element.js:187` et le SQL du cœur |
| Notifications | niveaux `ATTENTION` / `INFO` / `URGENT` (faute de frappe = repli silencieux en INFO) |
| Mail | `ServiceReceptionMail.Fond` réécrit `"mail_fond"` dans `MailBtp.cs:29,571` ; `MAIL_CONFIRMATION` |
| Planning | sujet de diffusion `"planning"` (`ServicePlanning.cs:178` ↔ `pages/planning.js:461`) |
| Annuaire, Fiche, Liste, Pointage, Authentification | erreurs `DOUBLON_SIRET`, `DOUBLON_NOM`, `VERROU_PERDU`, `FICHE_EN_MODIFICATION`, `FICHE_UTILISEE`, `LIGNE_MODIFIEE`, `POI_VALIDE`, `BORNE_JETON`, `SESSION_REQUISE`, `MDP_A_CHANGER` |
| Pointage | `ETATS_CONGE` existe mais `pages/pointage.js` et `pointage/conges.js` testent `'DEMANDE'` / `'VALIDE'` en dur |
| Liste ↔ PWA | `HORS_LIGNE` a deux sens (501 requête SQL de liste, 503 PWA) et la file hors ligne ne regarde que le code : renommer celui de la liste (`REQUETE_HORS_LIGNE`) |
| Navigation / socle | clé `logibtp.affichage` utilisée dans deux stockages (`localStorage` du socle, `sessionStorage` du routeur) ; `logibtp.navigation`, `logibtp.apercu` recopiées dans `client/public/demarrage-*.js` |

## Lot H — Constantes du cœur : `src/LogiBTP.Api/Btp/Codes.cs` ↔ `client/src/app/codes.js`

> **Fait** (28/10/2026) : `client/src/app/codes.js` ↔ `src/LogiBTP.Domaine/Codes.cs` (dans le Domaine pour que
> `tests/LogiBTP.Calcul.Tests/CodesTests.cs` vérifie la parité) : `TYPE_FICHE` ↔ `TypesFiche` (comparaisons, `case`,
> propriétés `type` / `type_element`, appels des fournisseurs de fiches ; égal aux clés de `TYPES_FICHE`, test client),
> `urlFiche(type, id)` et `urlDocument(id)` (≈ 90 adresses), `TYPE_DOCUMENT` ↔ `TypesDocument` (hors SQL), listes
> `TYPES_ARC` ↔ `TypesDocument.Arc` et `TYPES_SOUS_TRAITABLES` ↔ `SousTraitables` (parité des listes :
> `Constantes.ListeJs`), `TYPE_POSTE_MARCHE` ↔ `TypesPosteMarche`, `TYPE_RESSOURCE` ↔ `TypesRessource` (`TypesConnus` du
> planning retiré : `ReglesAffectations.Types`), `MODULE_FACULTATIF` ↔ `ModulesFacultatifs` (`moduleActif`, `module:`,
> `EstActifAsync`, `ExigeModule`), `SUJET_FENETRE` (sujets entre fenêtres), `ETAT_ATTENTE` de `hors-ligne/attente.js`.
> Serveur seulement : `CategoriesGed` (edition, ressource_edition, mail) ; `VariablesEnv` du socle (variables
> `LOGIBTP_*` du socle, de l'Installation et du cœur ; les tests gardent les leurs).
> Gardé : SQL des requêtes (affaires techniques MATERIEL / DOTATIONS, services, `cha_statut 'OUVERT'`, articles stockés :
> la vue `v_articles_stock` est un changement de `db/`, hors périmètre), fichiers de données (`donnees.js`,
> `vues-liste.js`, `definitions.js`), libellés et paramètres d'URL qui ressemblent à un type de fiche.

Test de parité (comme pour les colonnes). Contenu proposé, par ordre d'utilité :

1. **Listes déjà recopiées entre les deux côtés** (parité aujourd'hui non testée) : `Structure.TypesArc` ↔
   `TYPES_ARC` (`panneaux-btp.js:56`), `SousTraitanceAssistant.Sources` ↔ `TYPES_SOUS_TRAITABLES`
   (`sous-traiter.js:9`), `PostesMarche.Types` ↔ `TYPES` (`fiche-structure.js:661`), types de ressources
   (`SpecialisationPlanningBtp.TypesConnus` réécrit `ReglesAffectations.Types`).
2. **Types de fiches** `chantier` (92 occurrences / 27 fichiers JS), `marche`, `affaire`, `personne`, `projet`,
   `salarie`, `individu`, `element`, `materiel` : dérivés des clés de `TYPES_FICHE`, avec `urlFiche(type, id)` et
   `urlDocument(id)` (~63 URL construites à la main) et les URL de listes tirées de `LISTE_PAR_TYPE`.
3. **Types de documents** `V_COMMANDE`, `T_COMMANDE`, `A_COMMANDE`, `E_OE`, `E_ENT`, `V_SITUATION`, `T_FACTURE_AVT`,
   `A_FACTURE`, `V_FACTURE`, `V_DEMANDE_ACOMPTE`, `S_TRANSFERT`, `S_SORTIE`, `S_ENTREE`, `S_RESERVATION` ; tests de
   famille en dur (`tyd_famille === 'E'`… dans `document.js:596`, `panneaux-btp.js:494`, `transformation.js`,
   `graphe-structure.js`, `ComptabiliteExportBtp.cs:130`) → constantes du module Document (lot G).
4. **Modules facultatifs** `crm`, `execution`, `planning`, `pointage`, `stock`, `sous_traitance`, `reglement` :
   `moduleActif` ×24 + `module:` ×12 (client), `ActifAsync` ×24 + `f_module_actif` ×12 + `ExigeModule` ×10 (serveur).
5. **Sujets de diffusion entre fenêtres** `crm` (21), `enregistre` (20), `session`, `mail` (sur le modèle de
   `SUJET_ATTENTE`) ; états de la file hors ligne `ATTENTE` / `CONFLIT` / `ERREUR` / `FUSION` exportés par
   `attente.js`.
6. **Divers serveur** : affaires techniques `MATERIEL` / `DOTATIONS`, services (`LOGISTIQUE`, `ADMINISTRATIF`,
   `ACHAT`, `CHANTIER`), catégories GED (`mail`, `edition`, `ressource_edition`), `cha_statut 'OUVERT'`, articles
   stockés (`ele_gestion='STOCK' AND ele_type='ARTICLE'` ×5 → vue `v_articles_stock`), variables d'installation
   `LOGIBTP_*` (constantes du module Installation).

Non retenu (pas assez répété) : nœuds de droits, groupes de raccourcis, catégories GED du client, clés de préférences
confinées à leur fichier.

---

## Ordre proposé

1. **Lot C** (contient une anomalie réelle : date de la veille entre 0 h et 2 h).
2. **Lot A** (suppressions sûres), puis **Lot B** une fois tranché.
3. **Lots G puis H** (constantes avec tests de parité : c'est là qu'une faute de frappe casse sans erreur visible).
4. **Lots E, F, D** (regroupements, plus longs ; D peut se faire par morceaux).

Après chaque lot : `npm test`, `npm run exporter-resultats` si un moteur est touché, `dotnet test LogiBTP.slnx`.
