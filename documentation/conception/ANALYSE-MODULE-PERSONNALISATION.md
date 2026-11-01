

## 36. Réalisation du lot P3w : fiches du cœur (01/11/2026)

- **Périmètre** : spécialisations des fiches du cœur : `fiches/fiches.js` (onglets communs, informations du salarié et
  du matériel, contrôles), `fiche-element.js` (types d'élément, onglets, périodes et modes des coefficients, aides des
  ouvrages et ensembles, image et notice), `fiche-annuaire.js` (informations, onglets, validation et fusion des tiers
  provisoires, actions), `fiche-structure.js` (statuts, raccourcis vers les listes, recherches de tiers et
  d'individus, prospect, liens, règlements, zones de déplacement, onglets ; gestion du marché : récapitulatif,
  situations, factures d'avancement, sous-traitants, engagé et réalisé, avancement réel, acomptes, postes de pied et
  boutons de création).
- **Textes** : `fiches_btp.*` : `onglets`, `salarie`, `infos`, `controles`, `element.*`, `annuaire.*`, `structure.*`
  (`statuts`, `listes`, `liens`, `colonnes` des tableaux de gestion, `gestion`, `engage`, `avancement`, `acomptes`
  avec `deductions`, `postes` avec `types`, `portees`, `modes`, `sens`, `niveaux`, `creations.<type>.libelle|nom|titre`) ;
  listes de choix par `pairesParCode`, statuts par `textesParCode`, nombres par `pluriel`.
- **Icônes** : `fiches_btp_*` (individu, ouvrage, ensemble, notice, société de la base, provisoire, entreprises,
  valider, fusionner, salarié, particulier, BL, ordre, situation, facture d'avancement, reprise).
- **Hors lot** : les titres des groupes comparés par le code (`groupeVisible` : groupe « Sous-traitance » de la
  définition) suivent les définitions des fiches, rangées avec les données système (§ 8).
- **Contrôles** : `npm test`, analyse des portées ; onglet Gestion d'un marché affiché dans le navigateur.

## 37. Réalisation du lot P3x : structure, documents et hors ligne (01/11/2026)

- **Périmètre** : structure des affaires (`structure/` : adresses des travaux et de livraison, filtre des listes par
  rattachement, graphe de la structure, intervenants, fenêtre du marché d'une commande, liste de choix des
  rattachements, contrôle des intervenants et code déjà pris), documents (`documents/` : fenêtre de transformation,
  options et variantes, documents sources, points à vérifier, onglet Traçabilité), page des règlements
  (`pages/reglements.js`), saisie hors ligne (`hors-ligne/` : états des saisies en attente, libellés des entités,
  messages d'envoi) et page de fusion (`pages/fusion-document.js`).
- **Textes** : `structure_btp.*` (`adresses`, `filtre`, `niveaux`, `graphe`, `intervenants`, `marche_commande`,
  `selection`), `documents_btp.*` (`transformation.etapes|descriptions`, `options`, `sources`, `tracabilite`,
  `avertissements`), `reglements_btp.*`, `hors_ligne_btp.*` (`etats`, `entites`, `envoi`, `fusion`) ; statuts de la liste de
  choix : ceux des fiches de la structure (`fiches_btp.structure.statuts`). Les messages du contrôle des intervenants
  passent par le dictionnaire, en français identiques à `Intervenants.Controler` (test inchangé).
- **Icônes** : `structure_btp_*` (types du graphe, principal, ouvrir), `documents_btp_<type>` des cibles de
  transformation, importé, réimporter, `reglements_btp_page`, `hors_ligne_btp_*` (fusion, garder, copie, fusionner).
- **Couleurs** : nœuds du graphe de la structure et familles de documents par les variables `--graphe-structure-*` du
  thème (lues par `couleurTheme` au dessin, aussi pour l'export SVG).
- **Contrôles** : `npm test`, analyse des portées ; fenêtres de transformation, d'options, de sources, de choix d'un
  rattachement, d'adresse et table des intervenants affichées dans le navigateur.

## 38. Réalisation du lot P3y : ressources et terrain (01/11/2026)

- **Périmètre** : référentiel des ressources (`ressources/` : affectations, compteurs, équipes, entretiens, règles,
  onglets des fiches salarié et matériel), pages `/parametres/ressources` et `/ressources/habilitations`, application de
  terrain (`terrain/` : navigation, opérations hors ligne, actions d'une tâche, SAV, compléments, pointage de la
  journée) et pages `/terrain`, `/terrain/reception/:id`, `/terrain/sav/:id` ; titres de ces routes.
- **Textes** : `ressources_btp.*` (tables par code des états, sources, natures, origines, catégories et domaines par
  `textesParCode` ou libellés en accesseurs ; mois des coûts `couts.mois.<n>`), `terrain_btp.*` (`page` : onglets,
  jours abrégés, tailles des pièces, actions des tâches ; `pointage`, `reception` : états et manques par code, `sav_page`,
  `actions`, `hors_ligne`).
- **Icônes** : `ressources_btp_*` (événements des compteurs, paramètres, à surveiller), `terrain_btp_*` (page, onglets,
  actions des tâches, adresse, itinéraire, contact, appel, pièce, réception, refus, attente, hors ligne…) ; icônes du
  module Pointage (`pointage_repas`, `pointage_equipe`, `pointage_ordre`) et du socle (ajouter, retirer, enregistrer,
  verrou, précédent, suivant) réutilisées.
- **Couleurs** : couleur d'une tâche sans couleur propre par la variable `--terrain-tache` du thème.
- **Contrôles** : `npm test`, analyse des portées ; pointage de la journée (tâches, saisie libre, équipe) affiché dans le
  navigateur, tous les modules migrés chargés sans erreur.

## 39. Réalisation du lot P3z : analyse, frais annexes et bibliothèque du cœur (01/11/2026)

- **Périmètre** : onglet Analyse de la page document (`analyse-coefs.js` : colonnes, arbres des tranches et des
  natures, éléments, rechargement des prix, vue des frais annexes ; `analyse-calcul.js` : montants forçables, valeurs des
  éléments, erreurs et remarques du rechargement), frais annexes (`frais-annexes.js`, `frais-annexes-ui.js`), appel et
  envoi de la bibliothèque (`bibliotheque/appel.js`, `envoi.js`), tarifs d'un fournisseur et leur import CSV
  (`annuaire/tarifs-fournisseur.js`, `import-tarifs.js`), onglet Photo / Logo des fiches de l'annuaire (`annuaire/photo.js`).
- **Textes** : `analyse_btp.*` (colonnes et éléments en accesseurs, coefficients par `textesParCode`, messages et étapes
  d'annulation), `frais_annexes_btp.*` (lignes hors vente, modes, cibles par `textesParCode`, rapport), `bibliotheque_btp.*`
  (`appel` : types, étapes par type d'élément, messages ; `envoi`), `annuaire_btp.*` (`tarifs`, `import_tarifs` : colonnes du
  format par `pairesParCode`, erreurs de lecture ; `photo`). Le titre Logo / Photo est comparé à sa clé
  (`fiches_btp.annuaire.onglets.*`).
- **Icônes** : `analyse_btp_*` (plis, filtres, tri, rechargement, métré, retour), `frais_annexes_btp_*` (plis),
  `bibliotheque_btp_<TYPE>` des éléments et `bibliotheque_btp_page`, `annuaire_btp_tarif_*`, `annuaire_btp_ajouter_image`.
- **Contrôles** : `npm test` (messages de l'analyse et de l'import des tarifs lus dans le dictionnaire des tests),
  analyse des portées (paramètres `texte` renommés : `lireCsvTarifs(contenu)`, `choisir(cherche)`) ; onglet Analyse du
  devis de démonstration et vue des frais annexes affichés dans le navigateur.

## 40. Réalisation du lot P3aa : pages de paramétrage et pages générales (01/11/2026)

- **Périmètre** : pages de paramétrage du cœur (`pages/parametres.js`, `parametres-documents.js`, `-installation.js`,
  `-raccourcis.js`, `-services.js`, `-referentiels.js`, `-modules.js`, `-annuaire.js`, `-bibliotheque.js`, `-ged.js`),
  pages générales (`accueil.js`, `fiche.js`, `introuvable.js`, `ged.js`, `graphe.js`, `liste.js`), titres de toutes les
  routes (`pages/index.js`), arborescence de la GED (`ged/arborescence.js`), paramètres `$` d'une tranche
  (`variables-tranche.js`), contrôle du parent de l'annuaire (`fiches/fiche-annuaire.js`).
- **Textes** : `parametres_btp.*` (natures des services en accesseurs, origines du certificat par `textesParCode`,
  jetons de numérotation et de code par fonctions), `pages_btp.*` (dont `routes.*`), `ged_btp.*` (familles et dossiers
  virtuels), `document_btp.variables_tranche.*`. La syntaxe des échéances (FM, le) et des formats (`{P}`, `{N:5}`) reste
  littérale.
- **Icônes et couleurs** : `parametres_btp_*`, `pages_btp_*` (dont `pages_btp_fiche_<type>`), `ged_btp_*` ; couleur par
  défaut d'une valeur de liste : `--valeur-liste-defaut` du thème (`couleurTheme`).
- **Contrôles** : `npm test`, analyse des portées (paramètres `texte` / `icone` renommés : `lireEcheances(saisie)`,
  `alerte(message)`), page de l'installation rendue dans le navigateur, natures des services et aller-retour des
  échéances vérifiés.

## 41. Réalisation du lot P3ab : écrans de la révision des prix et des règlements (01/11/2026)

- **Périmètre** : écrans arrivés avec la PR #2 et restés en dur après la fusion : paramètres de la révision des prix
  (`pages/parametres-revision.js` : valeurs des index, import CSV, catalogue, modèles de formules), onglet Révision du
  marché (`structure/revision-marche.js`), messages des formules (`structure/revision.js`), marchés à facturer du mois
  (`pages/marches-a-facturer.js`), onglet Règlements du document (`documents/reglements-document.js` : échéancier,
  règlements et imputations, déductions d'acompte, fenêtre d'imputation), colonne Chantier des lignes (`editeur-btp.js`)
  et étape « Mois des travaux » de l'entête (`panneaux-btp.js`).
- **Textes** : `revision_btp.*` (`erreurs.<REV_…>` par `textesParCode`, types de prix et arrondis par code, `marche.*`,
  `parametres.*`), `structure_btp.a_facturer.*` (pluriels par `pluriel`, noms des pièces par `textesParCode`, mois par
  `langue()`), `reglements_btp.document.*` (modes de déduction par `textesParCode`), `document_btp.editeur.chantier.*`.
  La notation des formules (« Cn = … × BT01n / BT010 ») et l'exemple de saisie restent des symboles.
- **Icônes** : `revision_btp_page`, `revision_btp_facture`, `revision_btp_provisoire`, `structure_btp_a_facturer`,
  `structure_btp_creer_avancement`, `structure_btp_sans_avancement`, `structure_btp_en_cours`, `structure_btp_retablir`,
  `reglements_btp_*` (manuel, rafraîchir, imputer, tiers).
- **Contrôles** : `npm test`, clés et icônes statiques relues contre les couches, analyse des portées (paramètres
  `texte` renommés : `lireTermes(saisie)`, `lireCsvIndex(contenu)`, variables locales `formule` et `saisie`) ; page des
  marchés à facturer (API simulée), messages des formules et lecture du CSV vérifiés dans le navigateur.

## 42. Emojis par shortcode (01/11/2026)

- **But** : des pictogrammes identiques sur tous les appareils (les emojis Unicode changent d'une plateforme à
  l'autre). Un code texte `:nom:` placé dans un texte (libellé de `fr.json`, note, donnée saisie) est remplacé à
  l'affichage par une image fixe, comme Slack ou Discord (`:casque:`).
- **Découpage** : celui des textes. Chaque couche (socle → modules → cœur, puis l'installation) peut fournir
  `images/emojis.json` (catalogue `{ "nom": "emojis/<fichier>.svg" }`, fusionné clé par clé : la couche suivante
  l'emporte) et ses images sous `images/emojis/`. Composition par `composer` (`emojis`), servi en développement et par
  l'API (`FichiersPersonnalisation`, fusion avec l'installation), préchargé par `index.html`, intégré au dictionnaire de
  secours. Exemples fournis : `valide` et `attention` (socle), `casque` (cœur) ; la liste se complète à la main.
- **Résolution** (socle, `@logibtp/socle/dictionnaire`, fonctions pures dans `dictionnaire/emojis.js`) : nom = une lettre
  puis minuscules, chiffres, `_` ou `-` ; seul un nom du catalogue est remplacé (`:inconnu:`, une heure `10:30:00`
  restent du texte). `emoji(nom)` → `<img class="emoji">` ; `emojisHtml(texte)` (texte brut échappé) ;
  `avecEmojis(html)` (HTML sûr, jamais dans une balise ni un attribut) ; `texteEmojis(cle, valeurs)` (= `texteHtml` +
  emojis) ; `appliquerEmojis(racine)` et `observerEmojis(racine)` (remplacement automatique dans le DOM, nœuds de texte
  seulement : jamais dans les champs de saisie, `textarea`, `code`, `pre`, SVG, zones éditables ni `.sans-emojis` /
  `[data-sans-emojis]`). Le client appelle `observerEmojis(document.body)` au démarrage (`main.js`) : tout texte
  affiché est concerné sans changer les écrans. Texte de remplacement et info-bulle = le shortcode (copier-coller,
  lecteurs d'écran).
- **Présentation** : `img.emoji` dans `socle.css`, taille et alignement par les variables du thème `--emoji-taille`,
  `--emoji-decalage`, `--emoji-marge`.
- **Ajouter un emoji** : déposer `images/emojis/<nom>.svg` dans la couche voulue (socle pour un pictogramme général,
  module pour le sien, `client/personnalisation` pour le BTP, ou le dossier de l'installation) et ajouter la ligne
  `"<nom>": "emojis/<nom>.svg"` à son `images/emojis.json`. Le test du client vérifie que chaque image existe.
- **Suites** : remplacer progressivement les emojis Unicode des textes et de `images/icones.json` par des shortcodes ou
  des images ; sélecteur d'emojis dans les zones de saisie (`nomsEmojis()`) ; éditions PDF et courriels côté serveur.
