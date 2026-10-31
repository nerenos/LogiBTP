# Module Liste – contexte

## Rôle
- Listes de données paramétrables, sans métier : chargement par lots au défilement (pagination par clé), recherche « contient » sans casse ni accents et segments appliqués par la base, tri (lignes chargées ou toute la base), filtres de colonnes façon tableur (lignes chargées), colonnes calculées (formules), mise en forme conditionnelle, saisie dans la liste, contrôle périodique des lignes ajoutées / modifiées / supprimées.
- Vues (`vue_liste`) regroupées par thèmes (`theme_liste`) sur des sources déclarées par l'hôte (`source_liste`) ou une requête SELECT saisie par un ADMIN.

## Dépendances
- Dépend de : `@logibtp/socle` (JS : `Dec`, `formatNombre`, `echapper`…), `LogiBTP.Socle.Web` (C# : `Utilisateur`, `ExceptionMetier`, `JsonCalcul`), `LogiBTP.Socle.Testing` (`CasPartages`). Jamais du cœur ni d'un autre module.
- Utilisé par : cœur C# (`SpecialisationListeBtp` dans `src/LogiBTP.Api/Btp/SpecialisationsElements.cs`, `Program.cs` : `AddModuleListe<SpecialisationListeBtp>`, `api.MapModuleListe()`), client (`client/src/app/listes.js` choisit `FournisseurApi` ou `FournisseurMemoire`, `pages/liste.js` = `PageListe` sur `/liste/:theme?`, `structure/filtre-rattachement.js`, `bibliotheque/` (panneau d'arbres, glisser)).

## Structure
- `db/030_liste_schema.sql` : `f_sans_accent`, `source_liste`, `vue_liste` ; `031_liste_themes.sql` : `theme_liste`, `vli_theme` ; `032_liste_saisie.sql` : `sli_modifiable`.
- `js/src/normaliser.js` : `normaliser`, `motsRecherche` (= `f_sans_accent`).
- `js/src/requete.js` : sémantique de référence (`filtrer`, `correspondFiltreVue`, `OPERATEURS_VUE`, `trier`, `lot`, `jusqua`, `comptesSegment`, `cleTri`, `comparerCles`, `texteBrut`, `empreinte`).
- `js/src/formule.js` : `compilerFormule`, `resolveurColonnes`, `ErreurFormule` (SI/ALORS/SINON, ARRONDI, CONCAT… en décimal exact) ; `modele.js` : `ModeleVue`, `normaliserDefinition`, `FORMATS` (texte, nombre, date, coche, combo, picto).
- `js/src/filtres.js` : filtres tableur sur lignes chargées (`OPERATEURS_NOMBRE`, `OPERATEURS_TEXTE`) ; `largeurs.js` : `calculerLargeurs` (fixe / proportionnel / auto, min-max).
- `js/src/fournisseurs.js` : `FournisseurApi` (base `/api/listes`), `FournisseurMemoire` (mêmes règles, `cleStockage` localStorage pour la démo), `ErreurFournisseur`.
- `js/ui/liste.js` : `ListeDonnees` (classe mère, 1 200 lignes) ; `concepteur.js` : `ConcepteurVue` ; `themes.js` : `GestionThemes` ; `formats.js` : `FormatsCellule` ; `menu-filtre.js`.
- `dotnet/LogiBTP.Listes` : `ConstructeurRequete.cs` (SQL), `ValidationRequete.cs` (requête manuelle), `Modeles.cs` (`DefinitionVue`, `DemandeListe`, `SourceResolue`, `DemandeModification`, `ErreurListe`).
- `dotnet/LogiBTP.Listes.Web` : `ServiceListe.cs`, `SpecialisationListe.cs`, `Donnees.cs` (`ListeDbContext`, `CacheSchemas`), `Extensions.cs`.

## Modèle de données
- `source_liste` (`sli_code`, `sli_libelle`, `sli_vue`, `sli_colonne_id`, `sli_colonne_type` ou `sli_type_element`, `sli_actif`, `sli_modifiable`).
- `vue_liste` (`vli_id`, `vli_nom`, `vli_contexte`, `vli_partage` P/G/T, `vli_proprietaire`, `vli_groupe`, `vli_definition` JSONB, `vli_version` verrouillage optimiste, `vli_theme`).
- `theme_liste` (`thl_code`, `thl_libelle`, `thl_icone`, `thl_ordre`, `thl_types` JSONB `[{code, libelle}]` : types d'élément couverts, vide = tous).
- Définition (JSONB) : `source { mode: vue|requete, vue, requete, colonne_id, colonne_type, type_element }`, `colonnes [{ code, calcul, formule, titre, format, options, style, regles, largeur, recherche, modifiable… }]`, `segments`, `tri`, `filtres [{ colonne, op, valeur, valeur2, valeurs }]`, `theme`, `taille_lot`.
- Sources du cœur (`SOURCES_LISTE` dans `client/src/app/vues-liste.js`, vues SQL dans `db/120` et modules) : documents (`v_liste_documents`), projets, affaires, chantiers, marches, salaries et materiels (modifiables), elements, personnes, individus, ged, ressources.
- Lignes renvoyées : colonnes de la vue + `_id`, `_type`, `_h` (empreinte md5).

## Points de spécialisation
- C# `SpecialisationListe` : `RestrictionAsync(source, u)` → `RestrictionListe(TypesRefuses, ColonnesMasquees)` (droits de l'application : lignes de types refusés écartées, colonnes masquées jamais lues, cherchées ni triées, filtre ou segment refusé `COLONNE_CONFIDENTIELLE`), `DelaiRequeteMs` (10 000), `TailleLotMax`, `IdsMax`, `PeutVoir`, `PeutModifier`, `PeutSaisirRequete` (ADMIN), `PeutModifierDonnees`, `ValiderModification` (le cœur refuse 409 `FICHE_EN_MODIFICATION` si la fiche salarie/materiel est verrouillée), `PeutGererThemes`, `Constructeur(...)`. `ConstructeurRequete` et `ServiceListe` : méthodes `virtual`.
- JS `ListeDonnees(racine, options)` : `fournisseur`, `contexte`, `ouvrir({ id, type, ligne, nouvelleFenetre })`, `surVue({ theme, vue })`, `panneau({ vue, conteneur, liste })` (panneau ancrable propre à la vue, ex. `PanneauArbres` de la bibliothèque), `message`, `peutRequete`, `peutGererThemes`, `intervalleControle` (30 000 ms, 0 = jamais), `formats`, `cleVue`, `creation(vue)` → `{ libelle, action }`, `actionsElements(vue)` → `{ consulter, copier, supprimer, autres: [{ code, libelle, icone, titre, max, actif(lignes), action(lignes, e) }] }`, `actionsVue(vue)` → `[{ libelle, icone, titre, action(e) }]` (boutons sur la vue entière, après ⟳ : imprimer), boutons courants en icône seule (libellé dans la bulle), `filtresVue(vue)` → `{ colonne: [valeurs] | null }` (posé après le panneau, avant le chargement), `glisser({ ligne, definition })` → `{ type, valeur, texte, rang }`.
- `ConcepteurVue` : édition de la définition (colonnes, formules, règles, segments, tri, filtres fixes, thème, requête si `peutRequete`) ; `appliquerVue(vue, { nonEnregistree })` pour l'aperçu non enregistré.
- `GestionThemes` (`typesVersTexte`, `texteVersTypes`) : thèmes et types couverts, réservé à `peutGererThemes`. Combo des thèmes de la barre (`creerCombo` du socle, « Toutes les vues ») regroupée par l'option `groupeTheme(theme) → { groupe, ordre }` de l'hôte.
- `FormatsCellule` (dérivable) : rendu par format, `appliquerStyle`, `alignement`.
- Clic droit sur une ligne : menu court (`ouvrirMenuContextuel` du socle) : ouvrir, nouvelle fenêtre, actions de `actionsElements` sur la sélection (mêmes règles que les boutons), rappel des raccourcis.
- Méthodes publiques utiles : `appliquerVue`, `definirFiltreExterne(colonne, valeurs)`, `recharger`, `lignesSelectionnees`, `basculerSaisie`, `trier`, `ouvrir`, `detruire`.

## Routes HTTP (sous `/api/listes`)
- `GET/PUT/DELETE /themes[/{code}]` ; `GET /vues?contexte=&theme=`, `GET|PUT|DELETE /vues/{id}`, `POST /vues`.
- `GET /sources`, `POST /sources/requete` (colonnes d'un SELECT, ADMIN).
- Données (corps `DemandeListe`) : `POST /lot`, `/segments`, `/controle`, `/lignes` ; saisie : `POST /modifier` (`DemandeModification` : `id`, `h`, `valeurs`).
- Erreurs : 422 (`ErreurListe` : DEFINITION, SOURCE, COLONNE_ID, REQUETE_*…), 409 `VERSION` (vue), 409 `LIGNE_MODIFIEE` (avec la ligne actuelle).

## Règles répliquées JS / C# et jeux de cas (`tests/cas`)
- `01_normalisation.json` : `normaliser` ↔ `f_sans_accent` (SQL).
- `02_requete.json` : types du thème, filtres fixes (ET), recherche (chaque mot dans au moins une colonne, `valeur::text`), segments (null = vide ; colonne `ARRAY` : l'une des valeurs, null = tableau vide), tri puis ID croissant, vides en dernier, curseur keyset ; `requete.js` ↔ `ConstructeurRequete.cs` (`OPERATEURS_VUE` ↔ `OperateursVue`).
- `03_formules.json` : formules évaluées sur le poste (JS seul).
- Fiches en sommeil : une source qui a la colonne `usage` masque les lignes `usage = S` (vide gardé), sauf si la vue les montre (`definition.sommeil`, case du concepteur) : `filtresEffectifs` (opérateur interne `sommeil`) ↔ `ConstructeurRequete.MasqueSommeil` (tests de chaque côté).

## Conventions et pièges
- Toute requête de données : sous-requête encadrée, `SET TRANSACTION READ ONLY` + `statement_timeout` ; identifiants jamais pris du client (colonnes connues de la source), valeurs en paramètres.
- Valeurs chiffrées (`chiffre:v1:…`, mots de passe des fiches) jamais renvoyées : `ServiceListe.MasquerSecret` les remplace par `••••••`, seules ou dans un texte (JSONB des champs supplémentaires).
- Requête manuelle : `ValidationRequete.Valider` (SELECT/WITH seul, mots-clés interdits, `$$` refusé) n'est qu'une première barrière.
- Saisie : colonne saisissable = cochée `modifiable` + source `sli_modifiable` + `is_updatable` dans `information_schema` ; ligne verrouillée, empreinte `_h` comparée, UPDATE sur la vue.
- `CacheSchemas` indexé par base (une base par société).
- Vues, sources et thèmes par défaut : modifier `client/src/app/vues-liste.js` puis `npm run generer-vues-liste --workspace client` (régénère `db/121_listes_parametrage.sql`, et aussi `db/131`, 116, 141, 150, 161, 163) ; ne jamais éditer `db/121` à la main.
- Préférences d'affichage (`cleVue`, dock, largeurs, segments réduits par vue `segmentsReduits`) dans le `localStorage`, jamais en base. Segments : comptés par la base (recherche, filtres de la vue, autres segments) ; avec un filtre de colonne actif (lignes chargées), recomptés sur les lignes chargées filtrées (`+` tant que tout n'est pas chargé ; dans un segment filtré, valeurs non retenues avec le compte de la base, en grisé) : colonnes des segments toujours lues avec les lignes (`Selection`, fournisseur mémoire). Tous dépliés par défaut ; le titre replie / déplie (le nombre de valeurs filtrées reste affiché).
- `lignesSelectionnees()` : lignes de `selections` dans l'ordre affiché ; sans sélection multiple, la ligne courante (`selection`). Sert aux boutons Consulter / Copier / Supprimer et aux actions `autres`.
- Saisie des formats combo / picto : `creerCombo` du socle (la saisie filtre ou désigne l'option ; texte inconnu refusé ; choix à la souris = saisie terminée).

## Textes, icônes et couleurs (module Personnalisation, lot P3d)
- Jamais en dur dans `js/src` ni `js/ui` : `js/personnalisation/fr.json` (préfixe `liste.*` : `operateurs`, `operateurs_vue`, `formule` (erreurs de compilation des formules), `fournisseur`, `modele`, `formats`, `themes`, `menu`, `concepteur`, `liste` ; section `erreurs` générée), icônes `liste_*` de `js/personnalisation/images/icones.json`, couleurs `--liste-*` de `js/personnalisation/theme.css` (couleurs proposées des champs couleur du concepteur par `couleurTheme` du socle).
- `OPERATEURS_NOMBRE`, `OPERATEURS_TEXTE`, `OPERATEURS_VUE` : `pairesParCode` avec `[symbole, clé]` (`'='` → `egal`…), même forme qu'avant ; formats du concepteur : `textesParCode`.
- Tests : `js/test/preparation.js` compose socle + module (clé manquante = échec) ; clés du code vérifiées par `client/test/personnalisation.test.js`.

## Tests
- `npm test --workspace modules/liste/js` (vitest) ; `dotnet test LogiBTP.slnx` (projet `LogiBTP.Listes.Tests`).
- Tests SQL des jeux partagés (`f_sans_accent`, lots, segments) : seulement si la variable `LOGIBTP_TEST_PG` (chaîne de connexion PostgreSQL) est définie, sinon ignorés silencieusement.
