# Module Liste – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [LISTE.md](../../documentation/modules/LISTE.md).

## Rôle
- Listes de données paramétrables, sans métier : chargement par lots au défilement (pagination par clé), recherche « contient » sans casse ni accents et segments appliqués par la base, tri (lignes chargées ou toute la base), filtres de colonnes façon tableur (lignes chargées), colonnes calculées (formules), mise en forme conditionnelle, saisie dans la liste, contrôle périodique des lignes ajoutées / modifiées / supprimées.
- Vues (`vue_liste`) regroupées par thèmes (`theme_liste`) sur des sources déclarées par l'hôte (`source_liste`) ou une requête SELECT saisie par un ADMIN.

## Dépendances
- Dépend de : `@logibtp/socle` (JS : `Dec`, `formatNombre`, `echapper`…), `LogiBTP.Socle.Web` (C# : `Utilisateur`, `ExceptionMetier`, `JsonCalcul`), `LogiBTP.Socle.Testing` (`CasPartages`). Jamais du cœur ni d'un autre module.
- Utilisations par le cœur : voir le détail.

## Repères
- Droits : `SpecialisationListe.RestrictionAsync` écarte les lignes des types refusés ; une colonne masquée n'est jamais lue, cherchée ni triée (`COLONNE_CONFIDENTIELLE`).
- Lignes renvoyées : colonnes de la vue + `_id`, `_type`, `_h` (empreinte comparée à la saisie).
- Choix dans une liste : `choisirDansListe` (`ui/choix.js`) ; raccourcis du groupe `liste` ; clic droit par `ouvrirMenuContextuel` du socle.

## Règles répliquées JS / C# et jeux de cas (`tests/cas`)
- `01_normalisation.json` : `normaliser` ↔ `f_sans_accent` (SQL).
- `02_requete.json` : types du thème, filtres fixes (ET), recherche (chaque mot dans au moins une colonne, `valeur::text`), segments (null = vide ; colonne `ARRAY` : l'une des valeurs, null = tableau vide), tri puis ID croissant, vides en dernier, curseur keyset ; `requete.js` ↔ `ConstructeurRequete.cs` (`OPERATEURS_VUE` ↔ `OperateursVue`) ; « agregats » : somme (vides ignorés, ensemble vide 0), moyenne / min / max (ensemble vide null), compte, ratio (null si dénominateur nul), filtres de la requête.
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
- Textes, icônes et couleurs par `js/personnalisation/` (règles et exceptions gardées en littéraux : voir le détail).

## Tests
- `npm test --workspace modules/liste/js` (vitest) ; `dotnet test LogiBTP.slnx` (projet `LogiBTP.Listes.Tests`).
- Tests SQL des jeux partagés (`f_sans_accent`, lots, segments) : seulement si la variable `LOGIBTP_TEST_PG` (chaîne de connexion PostgreSQL) est définie, sinon ignorés silencieusement.
- Totaux et indicateurs (ergonomie L3, L4) : ligne de pied collante calculée par la base sur toute la sélection, ou sur les lignes affichées dès qu'un filtre de colonne est posé (ligne teintée, « affichées ») ; bandeau de cartes au-dessus de la liste (bouton ▦, masquage par vue dans le navigateur), calculé sans l'indicateur cliqué ; clic sur une carte à filtres = filtre de la demande (`filtreIndicateur`), second clic pour le retirer ; concepteur : « Total » d'une colonne numérique, onglet Indicateurs.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Liste : format de cellule `pastille` (options { valeur, libelle, teinte }, teintes de rôle `--pastille-<teinte>-fond / -texte` de `liste.css`) ; documents et ordres : colonnes `statut_code` et `etat` (état affiché : REFUSE, EXPIRE calculés, `db/253`), pastilles du cœur dans `codes.js` (`PASTILLES_ETAT_DOCUMENT`, `PASTILLES_STATUT_STRUCTURE`) ; création par l'option `creation(vue)` : action ou liste de choix `{ libelle, choix }` ; panneau des vues à droite (`PanneauVues` : groupe › thème › vues, vue par défaut ★ du navigateur > `theme_liste.thl_vli_defaut` (`modules/liste/db/033`) > première) ; totaux de pied (`colonne.total`) et bandeau d'indicateurs (`definition.indicateurs`, clic = filtre) calculés par la base (`POST /api/listes/agregats`, `agreger` ↔ `ConstructeurRequete.Agregats`), sur les lignes affichées dès qu'un filtre de colonne est posé ; indicateurs des devis : `jours_envoye`, `age_jours` de `v_liste_documents`, devis acceptés = VALIDE, SOLDE, FACTURATION, FACTURE. La sémantique des requêtes (recherche, segments, tri, curseur, colonnes multivaluées `ARRAY`) est répliquée entre `modules/liste/js/src/requete.js` et `ConstructeurRequete.cs` (jeux `modules/liste/tests/cas`) ; toute requête de données s'exécute en lecture seule. Les vues par défaut se modifient dans `client/src/app/vues-liste.js`, puis `npm run generer-vues-liste --workspace client`.
