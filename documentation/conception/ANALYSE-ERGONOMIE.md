# Analyse des évolutions d'ergonomie (demandes du 31/10/2026)

Modules Liste, Document, Ordre, Fiche (salarié, matériel, marché) et interface commune. Analyse seule : aucun
changement du dépôt. Relevé du code sur `main` (`01c5aea`), en tenant compte de deux branches ouvertes :

- **PR #1** (module Personnalisation, `claude/project-thread-m28snk`) : textes par le dictionnaire (`texte('zone.cle')`,
  `fr.json` par module), icônes par le catalogue (`icone('nom')`), couleurs par les variables de `theme.css` (`--liste-*`,
  `--document-*`, `couleurTheme`). Lots P3d (Liste) et P3e (Fiche) déjà passés : **toute proposition ci-dessous écrit
  ses libellés dans `fr.json`, ses icônes dans `icones.json` et ses couleurs en variables de rôle** (jamais de teinte en
  dur, clair et sombre définis ensemble).
- **PR #2** (achats et règlements, `claude/project-thread-olk75x`) : onglet **Règlements** de la page document (Alt+8 :
  échéancier modifiable, règlements, imputations, déductions d'acompte).

Les deux PR modifient `client/src/app/pages/document.js` et `panneaux-btp.js` : les lots qui touchent la page document
(D) se font **après leur fusion**.

Repères : L = Liste, D = Document, O = Ordre, F = Fiche (FS salarié, FM matériel, FK marché), I = interface commune.
Les questions à trancher sont numérotées Q1… et regroupées au § 7, avec ma recommandation.

---

## 1. Module Liste

### L1. Panneau des vues à droite à la place des deux combos

**État actuel.** La barre de `ListeDonnees` (`modules/liste/js/ui/liste.js`, `#construire`) commence par deux combos :
le **thème** (« schéma » dans la demande : regroupement de vues, table `theme_liste`, groupé comme les menus du bandeau
par `groupeTheme`) et la **vue** (`<select class="liste-vues">`). Ouvrir un thème ouvre la dernière vue utilisée dans ce
thème (`prefs.vueParTheme`), sinon la première. Il n'existe pas de « vue par défaut » d'un thème. Un panneau ancrable
existe déjà (segments, ou filtres propres à la vue comme les arbres de la bibliothèque), à droite par défaut.

**Proposition.**
- Nouveau composant du module Liste `PanneauVues` : arbre **groupe de menu › thème › vues enregistrées** (le niveau
  groupe seulement quand l'application fournit `groupeTheme`), recherche en tête, vue courante en surbrillance, pastille
  du partage (personnelle, groupe, tous). Mêmes gestes que le menu latéral du bandeau : largeur au glisser (séparateur du
  socle), réduit en un bouton, état dans les préférences du navigateur (`listeVuesReduit`, `listeVuesLargeur`).
- **Clic sur un thème = sa vue par défaut** ; le triangle déplie les vues sans en charger aucune. Vue par défaut :
  celle que l'utilisateur a marquée ★ (navigateur), sinon celle du thème fixée par l'administrateur
  (`theme_liste.thl_vli_defaut`, nouveau), sinon la première (Q1).
- Actions de l'arbre (clic droit et boutons au survol) : ★ vue par défaut, ✎ modifier, ⧉ enregistrer sous, ＋ nouvelle
  vue dans ce thème ; « Thèmes et vues… » pour l'administrateur (la `GestionThemes` existante).
- Les combos disparaissent ; le titre de la page garde « Thème – Vue » (`#vueChoisie`) et l'URL reste
  `/liste/<thème>?vue=<id>` : aucun lien existant n'est cassé.
- **Décision Q2 : deux panneaux distincts.** Le panneau des vues est à droite ; le panneau des segments (ou des filtres
  propres à la vue) reste un panneau à part, ancrable comme aujourd'hui (gauche, bas ou droite), chacun réductible et
  redimensionnable de son côté. Les deux à droite : le panneau des vues est le plus à droite.

**Impacts.** `liste.js` (barre, `chargerThemes`, `chargerVues`, disposition), `liste.css`, `liste.*` du `fr.json` du
module ; `031_liste_themes.sql` (colonne `thl_vli_defaut`, rejouable) et la gestion des thèmes ; fournisseurs JS et
`ServiceListe.cs` (thèmes avec leur vue par défaut). Écrans à petite largeur : panneau réduit d'office (comme
`gabaritPanneau` sous 900 px).

### L2. Statuts en pastilles à libellé

**État actuel.** La colonne Statut des documents est au format `picto` (emoji seul, libellé en bulle) et la
correspondance se fait **sur le libellé** (`'Validé'`, `'Accepté'`… dans `vues-liste.js`) : les statuts Envoyé,
Approuvé, En facturation, Payé, Remplacé, Non retenue n'ont pas de picto et s'affichent en texte brut. La vue
`v_liste_documents` (`db/182`) n'expose que `std_libelle`. « Refusé » et « Expiré » ne sont pas des statuts : un rejet
est noté par `ent_rejete_le` (colonne Alerte « Rejeté, à annuler »), l'expiration est l'alerte « Validité dépassée »
(règle `VALIDITE_ALERTE`). Le cœur a déjà des pastilles d'état (`client/src/app/pastilles.js`, classe `pastille-compte`).

**Proposition.**
- Nouveau format de cellule `pastille` du module Liste (`FormatsCellule.pastille`, `FORMATS` du modèle) : option
  `{ valeur, libelle, teinte }`, rendu `<span class="liste-pastille teinte-<teinte>">libellé</span>` ; teintes de rôle en
  variables du thème (`--pastille-neutre-fond / -texte`, `-info`, `-envoye`, `-succes`, `-attention`, `-erreur`,
  `-termine`), définies pour le clair et le sombre (contraste AA vérifié dans les deux). Le concepteur propose le
  format et la teinte par valeur.
- Documents : la vue expose le **code** (`statut_code`) et un **état affiché** calculé (`etat`) : `EXPIRE` si la validité
  est dépassée sur un document approuvé ou envoyé, `REFUSE` si rejeté ou non retenu, sinon le code du statut. Les
  colonnes s'ajoutent en fin de vue (règle de `CREATE OR REPLACE VIEW`). La correspondance code → teinte vit dans le
  cœur (`codes.js` : `TEINTE_STATUT`), le libellé dans le dictionnaire (`donnees.statut_document.<code>`, § 8 de
  l'analyse Personnalisation ; `EXPIRE` et `REFUSE` dans `document_btp.etats`).
- Teintes proposées : Brouillon neutre, Approuvé / Validé info, Envoyé bleu, Accepté succès, En facturation et Facturé
  violet (terminé), Payé succès foncé, Expiré attention, Refusé / Non retenue erreur, Annulé / Remplacé neutre barré.
- Même format pour les autres listes à statut (projets, chantiers, marchés, ordres, pointages, contrats des salariés
  aujourd'hui colorés par `regles` avec des couleurs en dur `#fff4e0`…).

**Impacts.** `formats.js`, `modele.js`, concepteur, `liste.css`, `theme.css` du module ; `db/182` (vue), `vues-liste.js`
puis `npm run generer-vues-liste --workspace client` ; mise à jour des vues enregistrées qui utilisent le picto du
statut (script rejouable comme celui de la colonne Alerte). Faut-il faire de Refusé et Expiré de vrais statuts ? (Q3)

### L3. Ligne de total fixée en bas

**État actuel.** Aucune agrégation : la liste charge par lots à curseur (`taille_lot`, « Charger toutes les lignes »),
les filtres de colonne et le tri local portent sur les lignes chargées.

**Proposition.**
- Par colonne numérique de la définition : `total: 'somme' | 'moyenne' | 'compte' | 'min' | 'max'` (concepteur : case
  « Total » ; défaut : somme pour les montants des vues fournies).
- Ligne `<tfoot>` collante en bas du tableau (`position: sticky; bottom: 0`), même largeur de colonnes, compteur de lignes
  dans la première colonne.
- Calcul **par le serveur sur toute la sélection** (vue + recherche + segments + filtres externes), par une requête
  d'agrégat construite comme celle des lignes : `requete.js` ↔ `ConstructeurRequete.cs` avec cas dans
  `modules/liste/tests/cas` (règle de réplication du module), en lecture seule. Quand un filtre de colonne local est
  posé, le total devient celui des lignes affichées, signalé par une marque « lignes affichées » (Q4).

**Impacts.** Modèle et concepteur, `requete.js`, `ConstructeurRequete.cs`, `ServiceListe.cs` (route
`POST /api/listes/totaux` ou totaux renvoyés avec le premier lot), `FournisseurMemoire`, jeux de cas ; droits : même nœud
que la liste (`SpecialisationDroitsBtp.Routes`).

### L4. Bandeau de synthèse (option)

**Proposition.** Indicateurs déclarés **par vue** (`definition.indicateurs`) et calculés par le même mécanisme
d'agrégat que L3 : `[{ code, titre, calcul: 'somme' | 'compte' | 'ratio', colonne, filtre, format, teinte }]`. Bandeau de
trois à cinq cartes au-dessus de la liste, affiché ou masqué par un bouton de la barre (préférence par vue, navigateur).
Un clic sur une carte pose son filtre (« devis à relancer » → la liste n'affiche que ceux-là).

Pour les devis, les trois indicateurs demandés :
- **Total HT en cours** : somme de `total_ht` des devis approuvés ou envoyés, non expirés.
- **Devis à relancer** : nombre de devis envoyés depuis plus de N jours sans réponse (Q5 : N, et « relancé » = une note
  du CRM ?).
- **Taux d'acceptation** : acceptés ÷ (acceptés + refusés + expirés) sur la période de la vue (Q5 : période).

**Impacts.** Modèle (`indicateurs`), concepteur (onglet Indicateurs), agrégats répliqués (L3), vues fournies du cœur.

### L5. Boutons d'action à droite de la recherche, alignés

**État actuel.** Ordre de la barre : thème, vue, ✎, boutons sur la sélection (＋, 👁, ⧉, 🗑, autres), recherche, filtres de
vue, compteur, ⨯, lignes, ⇊, ⟳, actions de l'hôte (🖨), ✎ Saisie. Les boutons sont mêlés et changent de place selon la
vue (boutons masqués).

**Proposition** (avec L1 et I7) : `[🔍 recherche][filtres de vue][compteur] … [＋ Créer] | [👁 ⧉ 🗑 ⇢ 🏷] | [⨯ ≡ ⇊ ⟳] |
[🖨 ✎ Saisie] [◨ panneau]`, calé à droite, groupes séparés (I7), même hauteur de boutons ; boutons inutilisables
**grisés** plutôt que masqués quand la vue les propose mais que la sélection ne le permet pas (la barre ne bouge plus).

---

## 2. Module Document

### D1. Avertissements et filtre des erreurs de saisie

**État actuel : déjà en place pour les avertissements.** `controlesSaisie` (`client/src/calcul/controles-btp.js`) signale
ligne sans unité, coefficient FG ou bénéfice < 1, PA et PV à 0, quantité à 0 ; ils apparaissent dans le dock des
notifications (`NotificationsDocument`), filtrables par gravité, source et **type**, F8 / Maj+F8 pour passer de l'une à
l'autre. Ce qui manque :
- **filtrer la grille** sur les lignes signalées (le filtre d'affichage existe pour une tranche et pour les pastilles :
  `EditeurDocument.filtrer`, `filtrePastilles`) ;
- un repère dans la cellule fautive (aujourd'hui un signal en tête de ligne).

**Proposition.** Bouton « ⧩ Filtrer la grille » dans le dock des notifications : n'affiche que les lignes des
notifications visibles (filtres du dock appliqués) et leurs tranches parentes, avec la barre « Affichage filtré … ✕ Tout
afficher » existante ; cellule fautive soulignée (unité, coefficient, PA / PV, quantité : correspondance code → colonne
dans `controles-btp.js`), couleur du thème `--document-avertissement`. Rien de bloquant (règle du projet).

### D2. Unités de l'article proposées en premier

**État actuel.** La colonne U propose les unités du référentiel puis les unités saisies dans le document
(`suggestionsUnites`), sans tenir compte de l'article. La ligne garde seulement le lien `lig_proprietes.element`
(`id`, `unite`, `ratio`) ; les unités de l'élément (`unite_stock`, `unite_vente`, `ele_unites` avec leurs
correspondances) ne sont pas chargées dans l'éditeur.

**Proposition.** Pour une ligne liée à un élément : groupe « Unités de l'article » en tête (unité de vente, de stock,
unités de `ele_unites` avec l'équivalence « 1 u = 2,5 m² » en détail), puis « Autres unités ». Éléments lus à la demande
et gardés en cache par la page (service de la bibliothèque, déjà utilisé par `AppelBibliotheque`). Composantes d'ouvrage
comprises.

### D3. Prix converti au changement d'unité

**Proposition.** Ligne liée à un élément dont l'unité change vers une unité qui a une correspondance (`ratio` de
`calcul.js`, déjà utilisé par `prixUnite`) : fenêtre `<dialog>` « Convertir le prix ? PA 12,00 €/m² → 30,00 €/u
(1 u = 2,5 m²) » avec trois choix : convertir le prix, convertir le prix **et** la quantité (même quantité physique), ne
rien convertir. Le PV n'est converti que s'il est fixe (sinon il se recalcule par les coefficients). Le lien
`element.unite` / `element.ratio` est mis à jour. Sans correspondance : rien n'est proposé, l'avertissement D1 reste
possible. Une seule étape d'annulation (Ctrl+Z). Q6 : mémoriser le choix (« toujours convertir »).

**Impacts.** `EditeurDevisBtp` (point d'accroche sur `modifierLigne` du champ `lig_unt_code`), `bibliotheque/appel.js`,
dictionnaire `document_btp.editeur.*`. Pas de règle de calcul nouvelle (conversion déjà faite par `ratio`), pas de
changement des moteurs.

### D4. Indentation des niveaux limitée

**État actuel.** `GrilleArbre` (socle) décale la première colonne de `0.4 + profondeur × 1.1 rem` sans limite : six
niveaux mangent 7 rem de la colonne libellé.

**Proposition.** Pas dégressif : 1,1 rem pour les deux premiers niveaux, 0,45 rem ensuite, plafond à 4 rem ; au-delà,
fins traits verticaux de niveau (guides) plutôt que du blanc, et numéro de niveau en bulle. Variables du thème
(`--grille-retrait`, `--grille-retrait-profond`, `--grille-retrait-max`) : réglables par l'installation. Profite aussi à
la bibliothèque et à l'analyse (même grille).

### D5. Totaux du pied plus visibles, sans hauteur supplémentaire

**État actuel.** Pied de la grille (`.pied-lignes`) : Total HT, TVA, TTC, Net à payer en texte courant (seul le net en
gras), suivis de l'aide « Raccourcis ⓘ ».

**Proposition.** Même ligne, même hauteur : totaux calés à droite (sous les colonnes de montant), valeurs en chiffres
tabulaires plus grands (1,15 em), libellés en petites capitales discrètes, Net à payer dans une pastille d'accent
(`--document-total-fond`), séparateurs fins ; « Raccourcis ⓘ » passe à gauche. Un écart (document non calculé, erreur
de calcul) colore le total en attention.

### D6. Légende des couleurs en bas du plan

**Proposition.** Section « Légende » en bas du dock Plan, repliable vers le bas (préférence du navigateur) : étiquettes
de lignes (globales et du document), modes de vente (option, variante, pour mémoire, frais annexes… : seconde couleur de
la pastille), fonds de lignes (titre, section, ouvrage, pied, lignes virtuelles), marques (soldé grisé, frais annexes en
italique, PV imposé). N'affiche que ce qui est **présent dans le document**. Un clic sur une étiquette ou un mode pose le
filtre par pastille existant. Couleurs lues dans les données (étiquettes) ou dans le thème (fonds), jamais recopiées.

### D7. Suivi et Traçabilité dans un même onglet

**Proposition.** Onglet « Suivi » (Alt+6) en deux panneaux superposés : Suivi (CRM : `PanneauSuivi`) en haut,
Traçabilité (`afficherTracabilite`) en bas, séparateur à glisser (`separateur` du socle), bouton pour masquer l'un ou
l'autre ; hauteur et masquage dans le navigateur. Module CRM désactivé : l'onglet ne montre que la traçabilité.
Raccourcis des onglets : décision Q7 au § 7.

### D8. Onglet Options

**État actuel.** L'entête mêle données du document et réglages consultés rarement : modèle de saisie, décimales des
montants, numérotation, calcul des ouvrages, étiquettes du document, textes de l'édition, propriétés paramétrées.

**Proposition (décisions Q7, Q8).** Onglet « Options » en **dernier**. Y passent : décimales, numérotation, modèle
de saisie, mode de calcul des ouvrages, étiquettes du document, options des frais annexes (`ent_fa_lignes`,
`ent_fa_mode`), dépassement autorisé. Restent dans l'entête : identité (objet, date, tiers, références, validité, TVA du
document, rédacteur), rattachement, intervenants, coordonnées, adresse, **textes de l'édition**, blocs métier
(exécution, stock, ARC…). Une option en erreur de validation marque l'onglet (⚠, cf. I2).

**Impacts.** `PanneauxDocument.rendreEntete` (classe mère : sections déplaçables par une méthode `sectionsOptions`),
`PanneauxBtp`, gabarit et raccourcis de la page, dictionnaire.

### D9. Retrait du mode de règlement de l'entête

**État actuel.** Section « Règlement » de l'entête : condition de paiement, mode de règlement et aperçu de l'échéancier
(`sectionReglement`). L'onglet Règlements de la PR #2 montre l'échéancier et le recalcule depuis la condition de la
pièce, **sans** permettre de choisir la condition ni le mode.

**Proposition.** La section quitte l'entête ; condition de paiement et mode de règlement passent **en tête de l'onglet
Règlements** (au-dessus de l'échéancier, avec l'origine : document, tiers, défaut), seul endroit de saisie. L'aperçu de
l'échéancier d'un brouillon y figure déjà. À faire après la fusion de la PR #2.

---

## 3. Module Ordre (Exécution)

### O1. Création depuis les listes

**État actuel.** Les listes d'ordres (source `ordres`) n'ont pas de bouton ＋ : `creationDepuisVue` (`pages/liste.js`) ne
traite que la source `documents`. La création existe depuis les menus (`creation: D('E_DAP', …)`), depuis la fiche du
marché (E_OE) et depuis le terrain (E_SAV, E_DAP).

**Proposition.** Source `ordres` : bouton « ＋ Ordre ▾ » listant les types du thème actifs pour la société (un seul type :
bouton direct), qui ouvre `/document/nouveau?type=<code>`. L'option `creation(vue)` de `ListeDonnees` accepte une liste
de choix (`{ libelle, choix: [{ libelle, action }] }`). Cas particuliers : E_OE demande d'abord le marché (champ de
rattachement par code, puis la création du marché existante) ; E_ENT le matériel. Un ordre sans chantier reste refusé à
la validation (`EXE_CHANTIER`). Même mécanique pour les thèmes de documents à plusieurs types (aujourd'hui : premier type
seulement).

---

## 4. Module Fiche

### F1. Bandeau de synthèse (option)

**État actuel.** Un bandeau d'informations existe (`rendreInformations`, `.fiche-informations`) : salarié = ancienneté,
âge, coût horaire chargé (coefficient 1,45 en dur), sorti ; matériel = âge, en panne, contrôle à faire. Calculé dans le
navigateur à partir des seuls champs de la fiche.

**Proposition.** Point d'accroche serveur du module Fiche `SpecialisationFiche.SyntheseAsync(type, id)` →
`{ indicateurs: [{ code, valeur, unite, niveau }], onglets: { code: { nombre, alerte } } }`, route
`GET /api/fiches/{type}/{id}/synthese` (une requête pour F1 et F2). Bandeau en cartes, affiché ou masqué par un bouton de
la fiche (préférence par type, navigateur). Indicateurs du cœur proposés (Q9) :
- salarié : âge, ancienneté, contrat, heures du mois (pointages retenus) et de la semaine, congés en attente,
  habilitations expirées ou à renouveler, matériel affecté, compte de connexion ;
- matériel : état, affecté à, heures et kilomètres (derniers relevés), prochaine échéance d'entretien, contrôle
  réglementaire, coût du mois ;
- marché, chantier : montant, facturé, reste à facturer, réglé (existe dans l'onglet Gestion).
Le coefficient de charges du coût horaire devient un paramètre (Q9).

### F2. Compteurs sur les onglets

**Proposition.** Badge numérique à droite du titre de l'onglet (`Habilitations 3`, `Pièces jointes 5`, `Missions 1`),
badge d'alerte (teinte erreur, ⚠) quand un élément est en défaut (contrôle expiré, habilitation manquante). Nombres lus
dans la réponse de F1 ; un onglet spécifique peut aussi déclarer `compter()` côté client. Onglet en erreur de saisie :
marque ⚠ actuelle conservée. Onglets vides : titre atténué.

### F3. Champs vides

**Proposition.** En consultation, un champ vide affiche « — » (texte discret, pas une valeur) ; en saisie, un
`placeholder` tiré d'un nouvel attribut `exemple` de la définition (`AA-123-AA`, `06 12 34 56 78`), sinon rien. Les
données de démonstration sont complétées pour remplir les fiches (salariés, matériels : marque, modèle, numéro de série,
dates). Q10 : « valeurs réelles dans la maquette » vise-t-il les données de démonstration ?

### FS. Salarié

- **FS1. Choix d'un individu = champs vides complétés.** Aujourd'hui « … Lier à un individu » ne pose que `ind_id` ; la
  reprise de l'identité n'existe qu'à la création par `?individu=` (`valeursCreation`). Proposition : même reprise au
  choix (nom, prénom, agence, poste, courriel, téléphone, statut intérimaire), **seulement dans les champs vides**,
  avec un message « 4 champs complétés depuis l'annuaire » ; une valeur différente déjà saisie est signalée sans être
  remplacée.
- **FS2. Agences paramétrables.** La liste est en dur (`Lyon`, `Saint-Étienne`…) et l'agence est retrouvée par une table
  de démonstration (`AGENCES_SALARIES` de `annuaire/donnees.js`). Proposition : la liste devient une requête sur les
  niveaux inférieurs de notre société dans l'annuaire (agences et établissements : la société en est déjà la référence
  pour les rattachements et les dépôts), le champ garde le code de l'agence ou passe à son identifiant (Q11). Les
  valeurs par agence (repas de la paie, zones) suivent.
- **FS3. Matricule et code.** Trois identifiants aujourd'hui : `sal_matricule` (obligatoire, saisi à la création),
  `sal_code` (court, facultatif), `sal_matricule_paie`. Proposition : `sal_code` devient l'identifiant obligatoire et
  unique (chrono de fiche possible), `sal_matricule_paie` reste ; reprise rejouable `sal_code := coalesce(sal_code,
  sal_matricule)`, `sal_matricule_paie := coalesce(sal_matricule_paie, sal_matricule)` ; `sal_matricule` sort de la fiche
  et des listes, la colonne reste en base un temps (15 fichiers la lisent : export de paie, import des coûts, pointage,
  magasin, comptes, `SalariesAnnuaire`) puis est retirée (Q12).

### FM. Matériel

- **FM1. Matériel identifié : quantité 1.** En gestion « Identifié », Quantité disponible vaut 1, en lecture seule (et
  l'unité masquée) ; règle aussi côté serveur (`SpecialisationFicheBtp`), le passage Par nombre → Identifié remet 1.
- **FM2. Compteurs à la création et rectification.** Heures et kilomètres sont en lecture seule (derniers relevés de
  `materiel_releve`). Proposition : saisissables à la création (relevé initial de source `REPRISE` à la date d'entrée) ;
  en modification, une valeur changée crée un **relevé de rectification** (nouvelle source `INVENTAIRE`, motif demandé,
  utilisateur et date, comme un inventaire du stock) au lieu d'écrire la colonne : l'historique et la frise de l'onglet
  Compteurs le montrent. Contrôles existants de `ReglesCompteurs` (baisse refusée sans remise à zéro) : la
  rectification est l'exception autorisée, jeu `05_compteurs.json` complété.
- **FM3. État du matériel tracé.** Aujourd'hui `mat_etat` (Disponible, En chantier, En panne, Rebut) est écrasé à chaque
  modification ; les affectations (`materiel_affectation`) n'ont pas d'état. Deux notions à séparer : la **disponibilité**
  (statut actuel) et la **condition** (bon état, usé, endommagé, hors service : liste paramétrable `liste_valeur`
  `ETAT_MATERIEL`). Proposition : table `materiel_etat` (date, statut, condition, motif, ressource liée, auteur) écrite à
  chaque changement ; affectation : condition **au départ** (reprise de la dernière connue) et **au retour** (saisie à la
  fin de l'affectation, commentaire, photo facultative dans la GED du matériel) ; retour endommagé → événement du
  matériel (`materiel_evenement`) et notification au service du matériel. Onglet « Historique » de la fiche. Q13 :
  liste des conditions, retour obligatoire ou non.

### FK. Marché

- **FK1. Réserves non obligatoires.** `reserves` est déclaré `obligatoire: true` (case à cocher marquée « * ») alors que
  la colonne a une valeur par défaut. Proposition : retirer l'obligation ; plus généralement, le module Fiche ne marque
  plus obligatoire un booléen (une case vaut toujours oui ou non : vide = non à l'enregistrement), règle répliquée dans
  `validation.js` ↔ `ValidationFiche.cs` avec un cas du jeu `modules/fiche/tests/cas`.

---

## 5. Interface commune

### I1. Sélection des tiers dans une vraie liste

**État actuel.** Plusieurs sélecteurs différents : `choisirPersonne` / `choisirIndividu` du module Annuaire (fenêtre de
recherche, 40 résultats, filtre par relation seulement), `<datalist>` des intervenants (`structure/intervenants.js`, sans
filtre de fonction), champs de référence des fiches (`tiers`, `individu`, `individu_societe`), combos par requête.

**Proposition.** Composant du module Liste `ChoixListe` (dérivé de `ListeDonnees`, mode sélection : Entrée ou
double-clic = choisir, Échap = annuler, sélection multiple en option, pas de concepteur) dans un `<dialog>`, avec une vue
de liste par contexte d'appel (`vue_liste.vli_contexte` existe déjà : `choix:client`, `choix:fournisseur`,
`choix:sous_traitant`, `choix:conducteur`, `choix:charge_affaires`…). Le cœur fournit le contexte et le **filtre par
défaut** (relation Client, fonction de l'intervenant, individus de notre société au poste voulu), retirable par
l'utilisateur ; ＋ crée un tiers provisoire (contrôle des doublons existant). La saisie directe (code ou nom dans le
champ) reste : F4 / double-clic ouvre la liste, comme `champRattachement`. Le module Annuaire ne dépend pas du module
Liste : le cœur injecte la fonction de choix (méthode patron) dans les fiches et l'annuaire.

### I2. Champs en cause rendus visibles au blocage

**État actuel.** Les fiches marquent déjà les champs en erreur (cadre et message sous le champ, ⚠ sur l'onglet, liste en
tête). La page document non : un refus de validation (`TIERS_OBLIGATOIRE`, `ADRESSE_LIVRAISON`, `MARCHE_OBLIGATOIRE`,
`NATURE_OBLIGATOIRE`…) n'est qu'un message.

**Proposition.** Correspondance code d'erreur → champ(s) de l'entête ou colonne de la grille (table du cœur dans
`codes.js`, codes connus de l'interface) : champ encadré et animé une fois, onglet marqué, lignes en cause listées dans
les notifications (D1). La fenêtre de I4 liste chaque erreur avec « Aller au champ ».

### I3. Saisie des dates abrégée

**État actuel.** 54 champs `type="date"` natifs (et 13 `type="month"`) : le navigateur n'accepte pas une saisie partielle,
rien n'est complété.

**Proposition.** Champ de date du socle (`champDate`), branché d'office sur tous les `input[type=date]` par
`activerDates()` au démarrage (même principe qu'`activerCombos`) : champ texte `jj/mm/aaaa` + bouton calendrier (le
sélecteur natif reste disponible), **même interface** que l'input natif (`value` en ISO, événements `input` / `change`) pour
ne rien changer aux pages. Règle pure `completerDate(saisie, aujourdhui)` dans le socle, testée par un jeu de cas :
`15` → 15/10/2026 ; `16/05` → 16/05/2026 ; `15/05/23` → 15/05/2023 ; `15/05/0023` → 15/05/2023 ; séparateurs `/ . -` et
espace ; date impossible → champ en erreur, valeur non modifiée. Q14 : saisie sans séparateur (`1505`, `150523`), pivot
du siècle pour les dates de naissance (`15/05/65` → 1965 ?), raccourcis (`+3`, `t` = aujourd'hui). Grilles (colonnes de
date des documents et des listes) : même règle dans leur éditeur.

### I4. Erreurs dans une fenêtre qui se ferme seule

**État actuel.** `app.message(texte, 'erreur')` écrit dans la zone de message du bandeau, effacée après 10 s
(`Bandeau.message`).

**Proposition.** Les messages de niveau erreur (et avertissement, Q15) ouvrent une fenêtre `<dialog>` non modale du socle
(`notifier({ titre, message, details, niveau, delai })` dans `dialogue.js`) : barre de décompte (8 s par défaut), le
décompte s'arrête au survol et définitivement au premier clic dans la fenêtre, ✕ et Échap ferment ; plusieurs erreurs
s'empilent. Le bandeau garde une trace (historique des derniers messages au clic). Succès et informations restent dans
le bandeau. Texte par le dictionnaire (`erreurs.<CODE>` de la PR #1), le message du serveur en repli.

### I5. « Fiche incomplète ou incorrecte » détaillé

**Proposition.** Toute erreur `VALIDATION` portant des `details` (`[{ champ, message }]`, déjà renvoyés par
`ServiceFiche`) s'affiche dans la fenêtre de I4 : un élément par champ (libellé du champ, onglet, message), clic = aller
au champ. Même traitement pour les erreurs de validation des documents (liste des messages du moteur et des contrôles) et
pour les avertissements à confirmer (`confirmerAvertissements`). Le titre devient « 3 champs à corriger ».

### I6. Taille confortable par défaut, compact en option

**État actuel.** Taille unique, 13 px (`body` du socle), tableaux compacts (`.tableau-compact`) imposés par page.

**Proposition.** Préférence « Densité » (Confortable / Compacte) à côté du thème clair / sombre : Paramètres › Affichage,
menu Paramètres, navigateur (règle des préférences). `html[data-densite]` lu par des variables du thème (`--taille-texte`
14 px / 13 px, `--hauteur-ligne`, `--espacement`, `--grille-hauteur-ligne`) ; `.tableau-compact` et la grille du
document s'y alignent. Défaut : Confortable ; appliqué avant le premier affichage (`demarrage-theme.js`). Les pages
pensées compactes (synthèse du pointage, planning) restent lisibles dans les deux (contrôle visuel de chaque module).

### I7. Barres d'outils avec séparateurs

**Proposition.** Barre d'outils normalisée du socle : `.barre-outils` faite de `.groupe-outils` séparés par un trait
vertical (`role="separator"`), groupes ordonnés **navigation | édition | affichage | actions | fermer**, actions calées à
droite, débordement replié dans un menu « ⋯ » en petite largeur. Appliquée à la page document, aux listes (L5), aux
fiches, au planning, aux pages du pointage. Variables du thème pour la couleur du trait.

### I8. Infobulles réactives et dans le thème

**État actuel.** Bulles natives `title` (plus de 750 dans le code) : délai du navigateur (≈ 1 s), style du système, pas au
clavier ni au toucher.

**Proposition.** `activerInfobulles()` du socle : délégation sur le document, lit `title` (le retire pendant le survol
pour éviter la bulle native, `aria-describedby` posé), délai 300 ms (aussitôt d'une bulle à la voisine), placement
au-dessus / dessous selon la place, au focus clavier, appui long au toucher ; style par variables (`--bulle-fond`,
`--bulle-texte`), raccourci clavier mis en `kbd`. Aucun `title` à réécrire.

### I9. Mon terrain dans le menu Pointage

**Proposition.** L'entrée « Mon terrain » passe en tête du menu Pointage (séparateur ensuite) et le menu Terrain
disparaît. L'élément garde ses conditions propres (module Planning, droit `terrain`) ; si le module Pointage est désactivé
mais le Planning actif, le menu Pointage n'apparaît que pour cette entrée (Q16).

---

## 6. Personnalisation et thème (règles transverses)

- Libellés : clés `liste.*`, `document.*`, `document_btp.*`, `fiche.*`, `socle.*` (fenêtres, dates, infobulles,
  densité) ; libellés des états de document dans `donnees.statut_document.<code>` ; jamais de texte en dur.
- Couleurs : uniquement des variables de rôle (`--pastille-*`, `--bulle-*`, `--document-total-*`,
  `--grille-retrait-*`, `--densite-*`) définies pour le clair et le sombre dans le `theme.css` du module concerné.
- Icônes : catalogue (`liste_vues`, `liste_vue_defaut`, `document_options`, `fiche_synthese`…).
- Préférences d'affichage dans le navigateur (panneaux, bandeaux de synthèse, densité, vue ★) ; seuls le paramétrage
  administrateur (vue par défaut d'un thème, indicateurs d'une vue, conditions du matériel) va en base.
- Codes nouveaux (`EXPIRE`, `REFUSE`, source de relevé `INVENTAIRE`, formats `pastille`, totaux) : `codes.js` ↔
  `Codes.cs` avec leur test de parité.

## 7. Questions et décisions (31/10/2026)

Décisions de l'utilisateur du 31/10/2026 : **Q2 : deux panneaux** (vues à droite, segments à part) ; **Q7 : ordre
proposé, sauf Règlements à côté de l'Entête et Options en dernier** ; **Q8 : les textes de l'édition restent dans
l'entête** ; **toutes les autres recommandations sont retenues.**

Ordre et raccourcis des onglets du document qui en découlent : Entête Alt+1, Règlements Alt+2, Lignes Alt+3, Analyse
Alt+4, Pièces Alt+5, Suivi (et traçabilité) Alt+6, Options Alt+8 (Alt+7 reste aux notifications) ; raccourcis
personnalisables comme aujourd'hui.

| # | Question | Recommandation (retenue sauf mention) |
|---|---|---|
| Q1 | Vue par défaut d'un thème : ★ de l'utilisateur, puis celle de l'administrateur, puis la première ? Ou la dernière ouverte (comme aujourd'hui) ? | ★ utilisateur > administrateur > première ; la dernière ouverte n'est plus utilisée. |
| Q2 | Panneau des vues et panneau des segments : un seul panneau à droite en deux sections, ou vues à droite et segments à gauche ? | ~~Un seul panneau~~ **Décidé : deux panneaux distincts.** |
| Q3 | Refusé et Expiré : états affichés calculés, ou vrais statuts du document (`REFUSE` posé par « Rejeté… », `EXPIRE` posé chaque nuit) ? | États affichés calculés (aucun changement de statut automatique, règle du projet) ; « Rejeté… » d'un devis passe le devis en Refusé seulement si vous le souhaitez. |
| Q4 | Total de la ligne de pied : toujours sur toute la sélection (serveur), ou sur les lignes chargées ? | Serveur sur toute la sélection, lignes affichées dès qu'un filtre de colonne local est posé (signalé). |
| Q5 | Devis à relancer : envoyés depuis combien de jours, et une relance notée au CRM sort-elle le devis du compte ? Taux d'acceptation : sur quelle période ? | 15 jours, paramètre de la vue ; une note CRM de relance remet le délai à zéro ; période = filtre de date de la vue, sinon 12 mois glissants. |
| Q6 | Conversion d'unité : demander à chaque fois, ou option « toujours convertir » ? | Demander, avec case « ne plus demander pour ce document ». |
| Q7 | Raccourcis des onglets après D7 et D8 (Alt+5 Suivi, Options, Règlements Alt+8) ? | **Décidé : Entête 1, Règlements 2, Lignes 3, Analyse 4, Pièces 5, Suivi 6, Options en dernier (Alt+8).** |
| Q8 | Contenu de l'onglet Options (§ D8) : la liste proposée convient-elle ? Les textes de l'édition y vont-ils ? | **Décidé : liste retenue, textes de l'édition laissés dans l'entête.** |
| Q9 | Indicateurs des bandeaux de synthèse des fiches (§ F1) et coefficient de charges du coût horaire (1,45 en dur) ? | Liste de F1 ; coefficient en paramètre du Pointage (valorisation). |
| Q10 | « Valeurs réelles dans la maquette » : compléter les données de démonstration ? | Oui, plus « — » en consultation. |
| Q11 | Agences : personnes de l'annuaire (niveaux inférieurs de notre société) ou liste de valeurs simple ? | Annuaire (une agence a une adresse, des contacts, des valeurs de paie). |
| Q12 | Matricule : retirer la colonne `sal_matricule` après reprise, ou la garder cachée ? | Reprise puis retrait au lot suivant, une fois les 15 lectures passées sur `sal_code`. |
| Q13 | Conditions du matériel (bon, usé, endommagé, hors service ?) ; état de retour obligatoire pour clore une affectation ? | Liste paramétrable avec ces quatre valeurs ; retour obligatoire pour le matériel identifié seulement. |
| Q14 | Dates : saisie sans séparateur, pivot du siècle (`65` → 1965 ?), raccourcis `+3` / `t` ? | Sans séparateur : oui (`1505`, `150523`) ; pivot : année > année courante + 10 → 19xx ; raccourcis : oui. |
| Q15 | Fenêtre des messages : erreurs seulement, ou aussi avertissements ? Délai ? | Erreurs et avertissements, 8 s ; succès dans le bandeau. |
| Q16 | Mon terrain sans module Pointage : menu Pointage réduit à cette entrée, ou menu Terrain conservé dans ce cas ? | Menu Pointage réduit à Mon terrain. |

## 8. Découpage en lots

Ordre proposé : d'abord les briques communes du socle (elles servent tous les autres), puis les modules. Les lots D
attendent la fusion des PR #1 et #2.

| Lot | Contenu | Dépend de | Taille |
|---|---|---|---|
| E1 | Socle : fenêtre de messages (I4, I5 avec les `details` des fiches et des documents), infobulles (I8), séparateurs de barre (I7, CSS et composant) | PR #1 | M |
| E2 | Socle : champ de date et `completerDate` + jeu de cas (I3), grilles comprises | — | M |
| E3 | Densité confortable / compacte (I6), Mon terrain dans Pointage (I9) | PR #1 (variables) | S |
| E4 | Liste : pastilles de statut (L2 : format, teintes, `statut_code` / `etat` de `v_liste_documents`, vues fournies et vues enregistrées), barre réordonnée (L5), création des ordres (O1) | E1 | M |
| E5 | Liste : panneau des vues (L1, vue par défaut du thème) | E4 | M |
| E6 | Liste : agrégats répliqués JS / C# (totaux L3, indicateurs L4, concepteur) | E4 | L |
| E7 | Fiche : synthèse et compteurs d'onglets (F1, F2 : `SyntheseAsync`, route, badges), champs vides (F3), booléens non obligatoires (FK1) | E1 | M |
| E8 | Salarié : reprise de l'individu (FS1), agences de l'annuaire (FS2), code / matricule (FS3) | E7 | M |
| E9 | Matériel : quantité identifiée (FM1), relevés initiaux et rectification (FM2), historique d'état et conditions d'affectation (FM3) | E7 | L |
| E10 | Document : filtre des notifications et cellules (D1), unités de l'article et conversion (D2, D3), indentation (D4), totaux (D5), légende du plan (D6) | PR #1, PR #2 | M |
| E11 | Document : Suivi + Traçabilité (D7), onglet Options (D8), règlement dans l'onglet Règlements (D9), champs en cause (I2) | E10, PR #2 | M |
| E12 | Sélection en liste (I1 : `ChoixListe`, contextes et vues de choix, injection dans fiches, intervenants, entête) | E5 | L |

S ≈ une demi-journée, M ≈ un à deux jours, L ≈ trois jours ou plus (estimation à revoir après les réponses).

Après chaque lot : `npm test`, `dotnet test LogiBTP.slnx`, contrôle visuel en clair et en sombre, mise à jour du
`CLAUDE.md` du module concerné, de `TODO.md` et des libellés du dictionnaire ; `npm run generer-vues-liste --workspace
client` pour les lots qui changent des vues fournies.

## 9. Réalisation du lot E2 : saisie des dates (31/10/2026)

- **Règle** : `completerDate(saisie, reference)` et `texteDate(iso)` du socle (`socle/js/src/calcul/dates.js`), jeu
  `socle/tests/dates_saisie.json` (29 cas : jour seul, jour et mois, année sur deux ou quatre chiffres, pivot du siècle,
  sans séparateur, `t` / `a`, `+n` / `-n`, dates impossibles). Interface seule : pas de réplique C#.
- **Champ** : `activerDates` / `champDate` (`socle/js/src/ui/champ-date.js`), appelé au démarrage du client après
  `activerCombos` : chaque `<input type="date">` (sauf `data-natif`) devient un champ texte « jj/mm/aaaa » qui garde
  l'interface du champ natif (`value` en ISO, vide pendant une saisie incomplète, `input` émis seulement quand la valeur
  change, avant le `change`) ; aucune page n'a été modifiée. Icône du calendrier dans le champ (clic, F4, Alt+↓ :
  calendrier du navigateur, `min` / `max` repris) ; saisie impossible : champ marqué invalide, valeur vide.
- **Grille des documents** : `lireDateSaisie` (date de livraison des lignes) s'appuie sur `completerDate`.
- **Styles** : `input.champ-date` dans `socle.css` ; les trois règles du cœur qui visaient `input[type="date"]` visent
  aussi `.champ-date`. Libellés (bulle, `jj/mm/aaaa`) à passer au dictionnaire avec le lot du socle de la
  personnalisation.
- **Contrôles** : `npm test`, construction du client ; essai dans le navigateur (fiche du module Fiche en mémoire :
  consultation, saisie « 15/05/23 » → 15/05/2023 enregistrée, calendrier, saisie impossible).
- **Reste** : champs mois (`type="month"`), voir `TODO.md`.

## 10. Réalisation du lot E8 : salariés (31/10/2026)

- **Agences (FS2)** : `salarie.sal_agence_per_id` (`db/247`, rejouable) désigne notre société ou l'un de ses niveaux
  inférieurs dans l'annuaire (vue `v_agences_societe`, hors dépôts, nom court = nom commercial sinon raison sociale) ;
  une agence ajoutée dans l'annuaire est proposée d'office. `sal_agence` garde le nom court, tenu par trigger : il reste
  la clé des zones de déplacement et de la règle de paie REPAS du module Pointage (renommer une agence renomme ces
  clés). Reprise : agence texte → personne (nom, raison sociale ou fin de raison sociale), sinon notre société.
  Le rattachement de l'individu suit l'agence (`SalariesAnnuaire.cs`). Plus de table d'agences de démonstration.
- **Code (FS3)** : le code (`sal_code`, 10 caractères, unique, chrono S) est l'identifiant ; le matricule n'est plus
  saisi (`sal_matricule` recopie le code par trigger, encore lu par quelques requêtes) ; le matricule de paie reprend
  l'ancien matricule là où il était vide (export de paie inchangé). Colonne Matricule retirée des listes de salariés.
- **Reprise de l'individu (FS1)** : lier un individu existant complète les champs vides (nom, prénom, agence, service,
  poste, coordonnées professionnelles du rattachement, intérim) sans rien écraser, avec le nombre de champs complétés.
- **Correction** : « Créer dans l'annuaire » échouait (utilisation de l'individu obligatoire) ; l'individu est créé
  « En service ».
- **Contrôles** : `npm test`, `dotnet test LogiBTP.slnx` ; essai dans le navigateur (création avec agence et individu
  créé, rattachement à l'agence ; liaison d'un individu existant).

## 11. Réalisation du lot E9 : matériel (31/10/2026)

- **Quantité (FM1)** : un matériel identifié a toujours une quantité de 1 (trigger de `db/248`, reprise des
  données) ; dans la fiche, quantité 1 en lecture seule et unité masquée, le passage à « Identifié » remet 1.
- **Compteurs (FM2)** : heures et kilomètres saisissables à la création de la fiche (relevés initiaux de source
  REPRISE à la date d'entrée, par trigger) ; ensuite, onglet Compteurs : relevé ou **rectification** (⚖, source
  INVENTAIRE, motif obligatoire), seule exception à la règle « jamais sous le relevé précédent » ; une rectification
  ne décale pas la série cumulée. Règle `REL_MOTIF` répliquée (`compteurs.js` ↔ `ReglesCompteurs.cs`, jeu
  `tests/ressources/05_compteurs.json`).
- **État (FM3)** : la disponibilité (`mat_etat`, libellé « Disponibilité ») et la condition (`mat_condition`, liste
  paramétrable `ETAT_MATERIEL` : bon état, usé, endommagé, hors service) sont séparées ; chaque changement est tracé
  dans `materiel_etat` (date, valeurs, motif, origine création / fiche / affectation, auteur) et affiché dans l'onglet
  Historique ; un changement dans la fiche demande un motif. Affectations : état au départ (celui du matériel) et au
  retour, obligatoire pour terminer l'affectation d'un matériel identifié (`AFF_RETOUR`, `affectations.js` ↔
  `ReglesAffectations.cs`, jeu `04_affectations.json` ; affectations déjà terminées dispensées) ; le retour devient la
  condition du matériel ; endommagé ou hors service → événement « Sinistre » et notification au responsable du
  service du matériel, sinon aux administrateurs (type `MATERIEL_RETOUR`).
- **Reste** : photo du retour (la GED du matériel, onglet Pièces jointes, l'accueille déjà ; dépôt depuis la ligne
  d'affectation à faire avec l'application de terrain).
- **Contrôles** : `npm test`, `dotnet test LogiBTP.slnx` ; essai dans le navigateur (création avec 120 h, condition
  modifiée avec motif, affectation rendue endommagée, rectification à 100 h, refus sans motif ni état de retour).

## 12. Réalisation du lot E7 : fiches (31/10/2026)

- **Synthèse (F1)** : bandeau d'indicateurs en tête de fiche, calculé par le serveur (point d'accroche
  `SpecialisationFiche.SyntheseAsync`, route `GET /api/fiches/{type}/{id}/synthese`, droit de consultation), relu à
  l'ouverture et après chaque enregistrement ; masquable par 📊 (préférence du navigateur par type). Cœur
  (`Btp/SynthesesFiches.cs`) : salarié (heures du mois et de la semaine, congés, habilitations, matériel confié,
  compte), matériel (affectation en cours, compteurs, prochain entretien, contrôles, coût du mois), marché (montant,
  facturé et pourcentage, reste, avenants), chantier (marchés, montant, facturé, reste). Un indicateur peut porter un
  niveau (alerte, attention) et une adresse.
- **Compteurs d'onglets (F2)** : nombre d'éléments par onglet fourni avec la synthèse (pastille, ⚠ en rouge pour une
  alerte) ; un onglet vide est atténué.
- **Champs vides (F3)** : en consultation, « — » atténué ; en saisie, exemple de saisie (`exemple` du champ :
  immatriculation, téléphone, courriel, numéro de sécurité sociale).
- **Booléens (FK1)** : une case à cocher n'est jamais obligatoire (règle répliquée `validation.js` ↔
  `ValidationFiche.cs`, jeu `01_validation.json`), ni marquée comme telle.
- **Contrôles** : `npm test`, `dotnet test LogiBTP.slnx` ; essai dans le navigateur (fiches salarié, matériel et
  marché).
