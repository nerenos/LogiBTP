# LogiBTP

Application en mode test sur [https://logibtp.vercel.app/](https://logibtp.vercel.app/)
```
login : visiteur
mdp : visitlogibtp2026
```
> Remise à zéro des données : La réinitialisation ou le purgeage des données de test restera possible à tout moment pour poursuivre les phases de recette.

> ⚠️ **État du projet : Version Alpha (Test)**
> Ce projet est actuellement en phase d'alpha et mis à disposition à des fins de test. L'application est en évolution constante et nous souhaitons activement recevoir vos avis, signalements de bugs et suggestions pour son amélioration. N'hésitez pas à nous faire part de vos retours !

Documentation développeur simplifié sur [https://logibtp.vercel.app/documentation/](https://logibtp.vercel.app/documentation/)

## Présentation

LogiBTP est une application web modulaire de gestion d'entreprise (ERP) taillée pour les professionnels du Bâtiment et des Travaux Publics (BTP). Conçue pour être robuste, rapide, utilisable partout (y compris sans connexion réseau) et tout support (Windows, Linux, Mac, Android et IOS pour les clients et Windows/Linux pour la partie serveur), elle couvre l'intégralité du cycle de vie d'un chantier, du devis initial jusqu'à la facturation, la comptabilité et l'analyse de rentabilité.

Captures : Thème Clair https://github.com/nerenos/LogiBTP/issues/9#issue-6232817397 / Thème Sombre https://github.com/nerenos/LogiBTP/issues/10#issue-6232840500

## Principes Architecturaux

Le projet se distingue par des choix techniques forts visant la maintenabilité, la fiabilité et la performance :

* **Architecture Modulaire Stricte :** Découpage en trois couches (`socle/` → `modules/` → `coeur/`). Le socle ignore le métier, les modules sont indépendants (par ex. le module Métré n'a pas connaissance du module Document), et le cœur spécialise l'ensemble pour le BTP.
* **Moteurs Miroirs C# / JS :** Les règles métier critiques (calculs de devis, droits, validation de fiches, règles de paie, etc.) sont écrites et testées à stricte parité entre le serveur (C#) et le client (JavaScript Vanilla).
* **Base de Données Maîtrisée :** Modèle relationnel sous PostgreSQL géré intégralement par scripts SQL (aucun ORM/EF pour les migrations). Les requêtes sont optimisées et le schéma est rigoureusement typé (colonnes en `snake_case`, requêtes en lecture seule pour les listes).
* **Aucun code en dur :** Tous les textes, icônes, statuts, erreurs et couleurs sont gérés par un système de dictionnaire dynamique (i18n) et de personnalisation, permettant une surcharge complète lors de l'installation.

## Fonctionnalités Principales

### Gestion Commerciale et Études

* **Documents complets :** Devis, commandes, bons de livraison, situations de travaux et factures d'avancement.
* **Bibliothèque de prix :** Gestion des articles, ouvrages, ensembles paramétrables, gestion des tarifs fournisseurs.
* **Métrés :** Langage de script intégré pour le calcul des quantités complexes avec actualisation en temps réel.
* **Révision des prix :** Moteur de révision et d'actualisation selon des formules (a + Σ bi × In/I0).

### Exécution, Chantier et Terrain

* **Application Mobile PWA :** Interface "Terrain" pensée pour tablette/smartphone permettant de consulter les dossiers, les plans et de saisir en mode **hors-ligne** (fusion et synchronisation automatique au retour du réseau).
* **Pointage & Borne d'atelier :** Saisie des heures par les salariés ou chefs d'équipe, pointage sur borne tactile partagée, validation par niveaux, gestion des congés et des absences.
* **Planning & Exécution :** Moteur de planification temps réel (affectations, dépendances, charges), gestion des ordres d'exécution, jalons calculés, et vues synchronisées dynamiquement.

### Ressources et Stocks

* **Parc matériel :** Suivi des équipements, entretiens, compteurs, localisation sur chantiers et calcul des coûts.
* **Stocks et Magasin :** Multi-dépôts, inventaires à date-heure, réévaluations au PMP, gestion des dotations (EPI, outillage), et projection des ruptures.

### Suivi, GED et CRM

* **Coffre-fort GED :** Gestion documentaire structurée, règles de conservation, archivage et classification automatique.
* **CRM Intégré :** Fil d'actualité par chantier, gestion des tâches, rappels, demandes de prix, et suivi des visas.
* **Client Mail :** Synchronisation OAuth/IMAP, rattachement automatique des courriels grâce à l'analyse sémantique, et envois lissés par files d'attente.

### Rentabilité et Comptabilité

* **Analyse de rentabilité :** Comparatif temps réel budget / engagé / déboursé / facturé mis à jour automatiquement via des clichés historiques.
* **Comptabilité :** Plan de comptes, règles de ventilation complexes, gestion de la TVA (incluant l'autoliquidation), édition de traites et export natif vers Sage 100.
* **Règlements :** Gestion des cautions, retenues de garantie, pointages et relances.

## Déploiement et Technologie

* **Serveur :** API .NET (C#) tournant sous Kestrel (HTTPS).
* **Frontend :** JavaScript, HTML et CSS purs (Zéro dépendance framework lourde pour garantir la longévité). Utilisation de Web Components et de CSS Grid/Variables.
* **Déploiement automatisé :** Scripts Windows (PowerShell) et Linux (Bash) fournis, conteneurisation Docker native, génération automatique de certificats Let's Encrypt, sauvegardes chiffrées.

---

**Vos retours sont précieux !**
En tant qu'utilisateur de cette version alpha, vous pouvez signaler toute anomalie, proposer des évolutions d'ergonomie, ou demander des ajouts fonctionnels directement via le système de suivi du projet.

---
---

## Structure

Le projet est découpé en **socle**, **modules complémentaires** et **cœur**. Les modules fournissent des classes mères
(méthode patron : étapes surchargeables) que le cœur spécialise pour le métier BTP. Un nouveau module suit le même schéma :
`modules/<nom>/{js,dotnet,db,tests}`.

| Dossier | Contenu |
| --- | --- |
| `socle/js` (`@logibtp/socle`) | Calcul décimal, formules, références, libellés ; composants d'interface sans métier (grille arborescente, magasin Immer, liste de choix, éditeur de mise en forme, préférences, raccourcis) et `socle.css` |
| `socle/dotnet` | `LogiBTP.Socle` (arrondis, expressions, accès aux colonnes, JSON) et `LogiBTP.Socle.Testing` (lecture des jeux partagés) |
| `modules/document` | Module Document : moteur générique `MoteurDocument` (JS et C#), numérotation, comparaison client / serveur ; `LogiBTP.Documents.Web` (services, persistance EF, routes HTTP génériques, `SpecialisationDocument`) ; UI `EditeurDocument`, `PanneauxDocument`, `ReglesDocument`, `PressePapiers` ; schéma `db/010`–`011` ; jeux `tests/cas` |
| `modules/metre` | Module Métré, indépendant de son hôte : `Portees`, langage de script des métrés et conversion des anciens métrés (JS et C#) ; UI `PanneauMetre` (interface d'hôte) et `DictionnaireMetre` ; schéma `db/020`, `021` (sans clé étrangère vers l'hôte) ; jeux `tests/scripts`, `tests/conversion` |
| `modules/liste` | Module Liste : liste chargée par lots (pagination par clé), recherche « contient » sans casse ni accents et segments appliqués par la base, tri sur les lignes chargées ou sur toute la base, filtres de colonnes façon tableur (valeurs distinctes, conditions numériques et texte, mise en forme), colonnes calculées et mise en forme conditionnelle (formules), rafraîchissement ciblé et contrôle périodique des lignes ajoutées / modifiées / supprimées, concepteur de vues en deux onglets (mise en forme, colonnes et source) ; `LogiBTP.Listes` (construction SQL, validation des requêtes manuelles), `LogiBTP.Listes.Web` (vues, exécution en lecture seule, routes `/api/listes`) ; schéma `db/030` ; jeux `tests/cas` |
| `modules/fiche` | Module Fiche : fiche d'un élément ouverte par type et ID, modes (consultation, modification, création, copie) changeables une fois ouverte, droits par profil et par type (VOIR, MODIFIER, DEBLOQUER, CONFIDENTIEL), verrou de modification avec battement, expiration et reprise de la main, champs obligatoires du programme et par paramétrage, champs confidentiels masqués (affichage à la demande ou pour la session, accès journalisé), champs supplémentaires paramétrés (JSONB par table), onglet Pièces jointes (option `ged`, vue simplifiée de la GED) ; `LogiBTP.Fiches` (validation partagée, construction SQL), `LogiBTP.Fiches.Web` (routes `/api/fiches/{type}`) ; schéma `db/040` ; jeux `tests/cas` |
| `modules/ged` | Module GED : documents stockés sur le serveur (contenus rangés par empreinte SHA-256), versions de deux genres (étapes de validation, envoi, signature… toutes conservées ; éditions, 5 dernières conservées), aperçu des images, PDF, textes et mails (contenu chargé à l'affichage), dépôt par sélection ou glisser-déposer avec date, auteur, titre et élément lié pré-remplis, mails `.eml` / `.msg` (objet, expéditeur, destinataires, message, pièces jointes enregistrées à côté du mail), résumé et notes, coffre-fort (journal chaîné horodaté, document verrouillé, vérification d'intégrité), suppression par masquage, purge par un administrateur (jamais au coffre-fort) ; `LogiBTP.Ged` (chaîne du coffre, règle des versions, stockage), `LogiBTP.Ged.Web` (routes `/api/ged`) ; UI `ExplorateurGed`, `DialogueDepot` ; schéma `db/050` (triggers d'immuabilité) ; jeux `tests/cas` |
| `modules/bibliotheque` | Module Bibliothèque : plusieurs bibliothèques (code d'appel BIB:CODE), familles en arborescence, natures (axe analytique, comptes, regroupements personnalisables), types de gestion, éléments (articles, ouvrages) identifiés par un ID interne et un code unique par bibliothèque, prix PA / FG / PR / bénéfice / PV / remise sur PV avec scénarios de prix d'achat (fixe, fournisseur principal, dernier PA, meilleur prix min / max, PMP), multi-unité (unité de stock et correspondances par formule sur les données techniques), tarifs fournisseurs, historique des prix (trigger) ; `LogiBTP.Bibliotheque` (calcul partagé), `LogiBTP.Bibliotheque.Web` (routes `/api/bibliotheque`) ; UI `GestionReferentiels`, `OngletPrix`, `OngletUnites`, `OngletTarifs` ; schéma `db/060` ; jeux `tests/cas` |
| `modules/navigation` | Module Navigation (JS) : `Routeur` (URL par écran, historique du navigateur, garde avant de quitter une page modifiée, pages conservées), `GestionFenetres` (fenêtres séparées, liste des fenêtres par BroadcastChannel, mise au premier plan, signalement, fermeture et restauration de session), `Preferences` ; UI `Bandeau` (menus déroulants façon Windows), `PanneauFenetres`, `AccueilBase` (raccourcis et widgets personnalisables), widgets indicateurs, alertes, tableau, graphique |
| `socle/dotnet/LogiBTP.Socle.Web` | Utilisateur courant (en-têtes `X-Utilisateur`, `X-Profil`, `X-Groupe`), erreurs métier traduites en réponses HTTP, société courante (une base par sous-domaine : `AddSocietes`, `UseSocietes`) |
| `src/LogiBTP.Domaine` | Cœur : `DocumentBtp`, `DocumentLigneBtp` (colonnes BTP ajoutées aux entités du module Document) |
| `src/LogiBTP.Calcul` | Cœur : `MoteurDevisBtp`, spécialisation de `MoteurDocument` avec le module Métré ; `ComparateurBtp` |
| `src/LogiBTP.Api` | Cœur : `LogiBtpContext`, `SpecialisationBtp` (métrés, variables, écarts d'arrondi), `Program.cs` |
| `client/src/calcul` | Cœur : `MoteurDevisBtp` JS (réplique exacte du C#), colonnes BTP |
| `client/src/app` | Cœur : `Application` (services, routeur, fenêtres, bandeau), pages (`pages/` : accueil, liste, fiche, document, GED, paramètres), menus et widgets (`navigation/`), `EditeurDevisBtp` (hôte du panneau de métré), `PanneauxBtp`, `ReglesBtp`, `PressePapiersBtp`, `DictionnaireBtp`, accès API, démo |
| `db/` | Cœur : `100_btp.sql` (colonnes BTP, contraintes, clés étrangères du métré), `110_reference.sql` (types de documents, statuts, TVA, unités…), `120_listes.sql` (vues SQL des listes, données de démonstration : 5 000 salariés, 3 000 matériels), `130_fiches.sql` (colonnes des fiches de démonstration), `131_fiches_parametrage.sql` (types de fiches, droits, paramétrage, **généré** depuis `client/src/app/fiches/definitions.js`), `121_listes_parametrage.sql` (sources et vues par défaut, **généré** par `npm run generer-vues-liste --workspace client` depuis `client/src/app/vues-liste.js`) |
| `tests/cas/*.json` | Jeux de test BTP **partagés** rejoués par Vitest et xUnit |

Ordre des scripts SQL (montés par `docker-compose.yml`) : modules `010`, `011`, `012`, `020`, `030`, `031`, `032`, `040`, `050`, `060`, `061`, `062`, puis cœur `100`, `110`, `115`, `116`, `120`, `121`, `130`, `131`, et `900_societe_demo.sh` (base `logibtp_demo` de la société « demo »).

Base déjà créée avant le module Liste : appliquer les nouveaux scripts sans recréer le volume :

```bash
for f in modules/liste/db/030_liste_schema.sql modules/liste/db/031_liste_themes.sql modules/liste/db/032_liste_saisie.sql modules/fiche/db/040_fiche_schema.sql modules/ged/db/050_ged_schema.sql db/120_listes.sql db/121_listes_parametrage.sql db/130_fiches.sql db/131_fiches_parametrage.sql; do docker compose exec -T postgres psql -U logibtp -d logibtp -v ON_ERROR_STOP=1 < $f; done
```

### Navigation, fenêtres et sociétés

L'application est une application web : chaque écran a son URL (`/`, `/liste/salaries?vue=2`, `/fiche/salarie/12`,
`/document/5`, `/ged/3`, `/parametres`). Par défaut, on navigue comme sur un site (accueil → liste → fiche → ✕ ou Échap :
retour à la liste, retrouvée à l'identique ; Précédent / Suivant du navigateur). Ctrl+clic, Maj+clic, clic milieu ou ⧉ dans
les menus ouvrent l'écran dans une **fenêtre séparée**, à déplacer sur un autre moniteur (Paramètres : ouvrir par défaut
les fiches et documents dans une nouvelle fenêtre). Quitter une page ou fermer une fenêtre qui a des modifications non
enregistrées demande confirmation (● dans le titre).

Le **bandeau** fin en haut de chaque page porte les menus (Alt + lettre soulignée, ou Alt seul puis flèches) : Ressources,
Ventes, Achats, Documents, Paramètres, Fenêtres ; la société et le profil à droite, puis le logo. Menu **Fenêtres** (ou
Ctrl+Maj+F) : fenêtres ouvertes de la session (via BroadcastChannel), remise au premier plan ou signalement (🔔 cadre et
titre clignotants), fermeture de la fenêtre, **fermeture de la session** (contrôle des modifications dans toutes les
fenêtres, puis fermeture de toutes). L'accueil propose ensuite **« Restaurer ma session précédente »** (aussi après un
navigateur fermé sans fermer la session) : chaque fenêtre est rouverte par `window.open` à sa position. Les navigateurs ne
laissent ouvrir qu'une fenêtre par clic sans autorisation : autoriser les pop-up pour le site, sinon l'accueil propose de
rouvrir les fenêtres bloquées une à une.

L'**accueil** affiche des raccourcis et un tableau de bord (chiffres clés, alertes, derniers documents, répartitions) :
✎ Personnaliser pour ajouter, retirer, réordonner (glisser) les raccourcis et les widgets et changer leur taille ; ces
choix restent dans le navigateur.

**Une base par société** : le sous-domaine désigne la société (`demo.localhost:5173` en développement, `acme.logibtp.fr` en
production), sans sous-domaine la base principale. L'API la résout depuis l'en-tête Host (section `Societes` de
`appsettings.json` : domaines de base et connexion de chaque société ; sous-domaine inconnu : 404). Le stockage GED a un
répertoire par société, nommé comme sa base (`stockage-ged/logibtp`, `stockage-ged/logibtp_demo`). Le localStorage et le BroadcastChannel étant propres à chaque origine, deux sociétés ouvertes en
même temps ne partagent ni fenêtres, ni session, ni préférences.

### Listes

Menus Ressources, Ventes, Achats (ou `/liste/<thème>`) : vues partagées (Documents, Salariés et Matériels de démonstration). La barre de recherche et les
segments interrogent la base ; les filtres de colonnes (▾) portent sur les lignes chargées ; le tri (⇵) aussi, sauf si le
bouton ⇅ du coin « Trier toute la base » est actif (ou via le menu de la colonne). Double-clic ou Entrée : ouverture de la
fiche d'après l'ID et le type d'élément de la ligne (les documents s'ouvrent dans l'éditeur). Le concepteur (✎ / ＋) définit la
mise en forme et les colonnes ; la requête manuelle (SELECT encadré, lecture seule, délai maximal) est réservée au profil ADMIN.
Les vues sont regroupées par **thème** (sélecteur à gauche de la barre ; ⚙ pour les gérer, profil ADMIN). Un thème déclare
les types d'élément qu'il couvre : plusieurs (Ressources : équipe, salarié, intérim, matériel, sous-traitant, sur la source
`v_liste_ressources`) ou un seul pour filtrer une source plus large (Devis : `V_DEVIS` parmi tous les documents) ; ses vues
ne montrent que des lignes de ces types, sans type = tous. La liste des thèmes (`theme_liste`) n'est pas figée.
Les colonnes se déplacent à la souris en glissant leur en-tête.
**Saisie dans les listes** (bouton ✎ Saisie) : clic sur une cellule modifiable (fond hachuré), Entrée ligne suivante,
Tab colonne suivante, Échap annule ; une case à cocher ou une liste s'enregistre au premier geste. Sont saisissables les
colonnes cochées « Modifiable » dans la vue, d'une source déclarée modifiable (`source_liste.sli_modifiable`) et que
PostgreSQL déclare modifiables (vue simple sur une table, colonne non calculée : `information_schema.columns.is_updatable`).
L'écriture est un UPDATE sur la vue, ligne verrouillée : si l'empreinte de la ligne a changé depuis sa lecture (modification
par un autre poste), la saisie est refusée (409) et la ligne actuelle réaffichée. Points de spécialisation :
`SpecialisationListe.PeutModifierDonnees` et `ValiderModification` (contrôles métier avant écriture).
Les filtres fixes d'une vue (onglet « Colonnes et source » du concepteur, ex. « actif est coché » pour la vue Salariés actifs)
sont appliqués par la base, toujours, et rappelés par la pastille ⚑ de la barre. Les colonnes se redimensionnent à la souris
(bord droit de l'en-tête, double-clic pour revenir à la largeur de la vue) et le bouton ⇔ / ⇕ force l'affichage sur une ligne
ou multiligne : ces réglages sont propres à l'utilisateur, gardés dans le navigateur, et le concepteur peut reprendre les
largeurs ajustées comme largeurs fixes de la vue.
### Fiches

Double-clic sur une ligne de liste (salarié, intérimaire, matériel, ressource) ou bouton ＋ Salarié / ＋ Matériel : la fiche
s'ouvre en consultation. Peu d'onglets, des groupes de champs en cadres titrés : pour le salarié, Entreprise (identité, emploi
avec agence et type de main-d'œuvre, coordonnées professionnelles, rémunération, note professionnelle), Privé (RGPD :
état civil, coordonnées personnelles, personne à prévenir, note personnelle, tout en confidentiel), Informations
complémentaires (champs paramétrés) et Pièces jointes (GED). ✎ Modifier prend le verrou (renouvelé toutes les 30 s, libéré à l'enregistrement, à l'annulation ou
à la fermeture, expiré au bout de 2 minutes sans battement) ; si quelqu'un modifie déjà la fiche, un bandeau l'indique et
propose « Reprendre la main » avec le droit DEBLOQUER. Une saisie dans une liste est refusée tant que la fiche de la ligne est
en modification (`SpecialisationListeBtp`). Champs : `*` obligatoire pour le programme, `◆` obligatoire par paramétrage,
`🔒` confidentiel. Les informations confidentielles ne sont envoyées qu'aux profils ayant le droit CONFIDENTIEL, masquées
jusqu'à « Afficher » (ou l'option « Confidentiel visible (session) »), et chaque affichage est journalisé
(`journal_confidentiel`). ⚙ (ADMIN) : rendre des champs obligatoires et définir des champs supplémentaires (texte, numérique,
oui / non, date, liste ; formats e-mail, téléphone, code postal, masque 999.99, regex), stockés dans la colonne JSONB du type.
L'enregistrement contrôle le verrou, l'empreinte de la ligne et la fiche complète (règles des champs puis
`SpecialisationFiche.ValiderMetier`). Démo hors ligne : profil (ADMIN / SAISIE) dans Paramètres, bouton
« Simuler un autre utilisateur » dans la fiche.

### Bibliothèque

**Paramétrage** (menu Bibliothèque) : familles éditées en arbre (＋ crée une famille racine en fin de liste, ou une
sous-famille sous la famille sélectionnée), natures avec leurs **types** à cocher (main-d'œuvre, engin, matériaux,
sous-traitance, frais, facturation interne, amortissement, divers) et un regroupement libre (ex. « Fabrication » : natures de
main-d'œuvre et de sous-traitance), **coefficients de frais généraux et de bénéfice par période**, globaux ou propres à une
nature (une période commencée n'est plus modifiable : on en crée une nouvelle, l'historique reste ; les éléments
concernés sont recalculés). Un élément prend les coefficients de sa nature en vigueur, sinon les coefficients globaux,
sinon ceux par défaut, sauf s'il impose les siens (cases « imposé » de l'onglet Prix).

Menu **Bibliothèque** : listes Articles, Ouvrages et Tous les éléments, avec un panneau ancrable en deux parties (délimiteur
déplaçable) : arbre des familles par bibliothèque et arbre des natures par regroupement, sélection multiple (cocher un
parent retient tous ses enfants), comptes selon la recherche et les filtres, « Masquer vides » ; segments bibliothèque, type
et gestion ; Nouvel article, Nouvel ouvrage, paramétrage (bibliothèques, familles, natures, regroupements, scénarios de prix
d'achat autorisés et par défaut, coefficients par défaut). La fiche d'un élément (module Fiche) a les onglets :

- **Article** : bibliothèque, code (unique dans la bibliothèque, sans « : »), type, famille, nature, gestion (stock, achat,
  sous-traitance, non géré), libellé mis en forme (stocké mis en forme et en texte brut), données techniques par unité de
  stock (poids, surface, surface à peindre, volume, hauteur, largeur, épaisseur), isolation (R, λ, U) pour une nature
  « isolant », image de l'élément et notices techniques (catégorie GED « Notice technique (DOE) »).
- **Prix** : scénario de PA parmi ceux autorisés pour l'élément, PA fixe, dernier PA et PMP (alimentés plus tard par les
  modules Achats et Stock), coefficients, PV fixe, remise sur PV ; résultat par unité ; **historique des prix** (chaque
  changement de PA, PR, PV, coefficient ou remise, avec date, auteur et commentaire, enregistré par un trigger).
- **Unités** : unité de stock (valorisation), unités d'achat et de vente, correspondances par formule sur les données
  techniques et les champs supplémentaires : acier stocké au ml, acheté à la tonne (`1000 / {{poids}}`), vendu au kg ;
  plaque de plâtre stockée au m² (`{{hauteur}} * {{largeur}} / 1000000`).
- **Tarifs fournisseurs** (articles) : plusieurs tarifs d'un ou plusieurs fournisseurs, tarif principal, validité, lien ;
  chaque enregistrement recalcule le prix de l'élément (le module de gestion des tarifs viendra plus tard).
- **Composition** (ouvrages) : l'éditeur de devis sur les composantes (métrés par F4, articles de la bibliothèque) ; le
  prix de l'ouvrage est calculé par le moteur de devis (mode déboursé ou somme des PV), côté client et côté serveur.

Prix calculés par le serveur à l'enregistrement (`SpecialisationFicheBtp`, `CalculElement`, `MoteurDevisBtp`), aperçu
identique côté client.

**Appel dans les documents** (devis, factures… et composition d'un ouvrage) : chaque document a une bibliothèque (entête,
« Par défaut » sinon). Dans la colonne **Code**, un code seul est cherché dans cette bibliothèque, `BIB:CODE` dans une
autre ; un code inconnu ouvre la recherche. **F3** (ou 📚 Bibliothèque) recherche par code ou libellé. Un article remplit la
ligne : code d'appel, libellé, unité de vente, PA converti dans cette unité, coefficients, PV fixe, remise, nature et lien
vers l'élément (`lig_art_id`) ; quantité et métré de la ligne sont conservés. Un ouvrage est déployé avec ses composantes,
ses métrés et ses variables (son prix suit alors le mode de calcul des ouvrages du document). Les prix sont copiés dans le
document ; « ⟳ Prix bibliothèque » les reprend pour les lignes sélectionnées.

### Verrous et utilisateurs fantômes

- **Fiches** : verrou renouvelé toutes les 30 s ; sans battement pendant 2 minutes (connexion perdue, navigateur
  fermé, poste arrêté), il est considéré comme libre et purgé automatiquement à la prise de verrou suivante.
- **Documents** : verrou posé à l'ouverture d'un document modifiable, **sans expiration** : un document resté ouvert
  reste bloqué (bandeau « ouvert en modification par… », lecture seule, enregistrement refusé par l'API) jusqu'à sa
  fermeture ou un **déverrouillage manuel** par un administrateur (`SpecialisationDocument.PeutDeverrouiller`).
- Dans les deux cas, un utilisateur qui revient sur un élément qu'il avait lui-même verrouillé (autre fenêtre, onglet
  fermé) reprend son verrou sans avertissement. Fermer l'onglet libère le verrou (requête `keepalive` à la sortie de la page).

### GED

Menu Documents (GED, coffre-fort) ou onglet Pièces jointes d'une fiche (documents de l'élément). Déposer par ＋ Ajouter ou
en glissant des fichiers : le dialogue pré-remplit titre, date, auteur et élément lié ; un mail `.eml` / `.msg` est décodé
(objet, expéditeur, destinataires, message) et ses pièces jointes sont enregistrées comme documents liés au mail. Une
catégorie administrative (devis signé, factures, contrat) coche « Coffre-fort » : le document est alors scellé (empreinte
SHA-256 et horodatage ajoutés au journal chaîné, que la base interdit de modifier), verrouillé (seuls résumé et notes
changent) et ne peut jamais être purgé ; seul un administrateur peut le masquer. Les étapes (validation, envoi, signature…)
s'affichent dans « Rechercher une version antérieure ». Les documents se recherchent aussi dans les listes (thème 📎
Documents). Contenus stockés dans `Ged:Repertoire` (`appsettings.json`, `stockage-ged` par défaut).

Hors ligne, la démo simule les modifications d'un autre poste (bouton sous la liste) pour éprouver le contrôle périodique.

Les tests d'intégration PostgreSQL du module Liste (jeux partagés exécutés sur la base) s'activent avec la variable
`LOGIBTP_TEST_PG` (chaîne de connexion), par exemple `Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp`.

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

Ouvrir http://localhost:5173 (base principale) ou http://demo.localhost:5173 (société « demo »). Le devis de démonstration (menu Ventes) est créé dans la base à sa première ouverture.
Sans API joignable, le client passe en **démo hors ligne** : calcul local complet, sans enregistrement.

PostgreSQL écoute sur le port 5433 (`logibtp` / `logibtp`). Les scripts SQL (manifeste `db/installation/scripts.txt`) ne
s'exécutent qu'à la création du volume : `docker compose down -v` pour repartir de zéro.

### Installation Linux (Debian)

[Tuto](documentation/INSTALLATION-DEBIAN.md)

### Installation chez un client (Docker)

Deux conteneurs indépendants : l'API (qui sert le client web) et PostgreSQL ; détail dans `modules/installation/CLAUDE.md`
et l'[analyse](documentation/conception/ANALYSE-MODULE-INSTALLATION.md).

```bash
docker build --secret id=cle_construction,src=cle-construction.secret -t logibtp/api:latest .
```

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

