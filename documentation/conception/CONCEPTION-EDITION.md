# Module Édition – analyse fonctionnelle et technique

> Document de travail : analyse, aucun développement engagé. Même principe que les autres analyses : pour chaque
> question, la **Proposition** est celle de l'analyse, renseigner **Décision**. Points durs et bloquants au § 3,
> récapitulatif des questions au § 14.

## 0. Demande (reprise fidèle)

- **Un seul moteur** pour le front et le back, en HTML et JS. Données fournies **par l'API**, jamais d'accès direct à
  la base. Le **concepteur** (création, modification des modèles) viendra dans un second temps.
- **Blocs, rapports et sous-rapports réutilisables**, en **copie** ou **liés**. Ex. : un pied de page « ventes / achats »
  avec les mentions obligatoires et un pied « interne » (n° de page, auteur, date), liés à tous les rapports. Dans un
  document de vente, plusieurs **présentations des lignes** (colonnes différentes selon l'information remontée).
- Cibles : **document, fiche, liste** d'abord ; puis vues ou procédures spécifiques (analyses, synthèses).
- **Formats** : A3, A4, A5, A6, **étiquettes** (regroupement sur un autre format), portrait et paysage ; marges par
  défaut et par édition ; format **fixe ou flexible** (ex. pied qui s'adapte de l'A4 à l'A3 en centrant les champs et
  en élargissant les lignes).
- **Blocs en bandes** (lignes d'impression) : bloc **unique, répété, groupe** (rupture, somme, regroupement) ; à
  l'intérieur, **composants flexibles** qui empilent des informations (adresse à droite : champs listés, seuls les
  renseignés affichés ; informations du document à gauche : date, code, chantier…) ; hauteur du bloc = colonne la plus
  haute.
- **Aperçu direct** ; choix du modèle (un modèle par défaut par type de document ; le **dernier modèle utilisé pour
  imprimer** est mémorisé, pas celui de l'aperçu) ; les impressions rangées en **GED sont produites par le
  back-office**.
- **Copier, importer, exporter** les modèles, stockés **en base**.
- **Niveau d'accès** défini à la création, qui limite l'aperçu et l'affichage dans la GED ; lié au futur **module de
  gestion des droits**.
- **Conditions partout** pour limiter le nombre de modèles (bloc « provisoire » ou « interne » selon le statut du
  document ; choix du modèle de ligne utilisé dans le rapport).
- **Images de la GED** choisies par condition (nom de fichier : logo, logo de qualification, pied en image…).
- Blocs de lignes répétées : **entêtes, totaux, bordures** masquables par ligne (ex. la SECTION, sans hiérarchie,
  fusionne de la cellule Hiérarchie jusqu'au Libellé).
- Options : **sauts de page**, bloc **répété sur chaque page**, bloc **forcé en bas de page**, **tableau qui occupe
  toute la page** même avec des lignes vides, éléments à **garder ensemble** si possible.
- **Champs = formules** : texte brut, variables d'édition (sommes, n° de page, auteur, date…), variables de l'API,
  mélangées, avec conditions. Mise en forme sur le champ, **surchargeable dans la formule** (adresse en Arial 10 sauf
  le nom en 11 gras ; « Désignation : » puis texte aligné après les deux-points sur les lignes suivantes).
- Champ **multiligne**, retour à la ligne automatique, **ellipse**…
- Autres éléments : **lignes, cadres, codes-barres, QR codes**, couleurs de trait, de bordure, de fond.
- **Charte graphique** en base (couleurs, formats, polices, tailles) utilisée **par lien** ou en spécifique.

## 1. Existant utilisable

| Besoin | Existant | Écart |
|---|---|---|
| Formules | Socle : `{{…}}`, `evaluerExpression` ↔ `Expression.cs` (numérique seul), `remplacerVariables` (libellés HTML à variables) ; Métré : langage de script typé (décimal, chaîne, booléen, `Si`, fonctions déclarées par l'hôte) | Pas de fonctions de texte, de date, de format, d'agrégat ni de variables de page |
| Texte riche sûr | `htmlSur` (liste blanche alignée sur HtmlSanitizer serveur), `editerLibelle` | Libellés des lignes déjà en HTML : à rendre tels quels dans les cellules |
| Données des documents | Résultat des deux `MoteurDocument` / `MoteurDevisBtp` (pied en tranches, pieds de section, TVA, frais annexes, avancement, déductions) ; coordonnées figées (`ent_contact_client`, `ent_contact_payeur`, `ent_adresse_livraison`) ; textes d'introduction et de conclusion figés à la validation | Pas de « source d'édition » qui rassemble tout en un appel |
| Données des fiches et listes | Module Fiche (définitions, champs supplémentaires, `pcf_confidentiel`), module Liste (requêtes en lecture seule, curseur) | Liste paginée par curseur : une édition de liste veut tout le jeu |
| Images | GED : catégories, `type_element` / `id_element`, accès (`accesAutorise` ↔ `AccesGed`) | Pas de catégorie « ressource d'édition » ni de choix par règle |
| Stockage des éditions | GED, coffre-fort (chaîne de hachage, immuable), pièces « à envoyer » | Pas de production serveur de PDF |
| Droits | `Utilisateur(Code, Profil, Groupe)` lu dans des entêtes, `EstAdmin` ; droits des fiches (`DROITS_FICHE`) ; confidentialité GED (PUBLIC, INTERNE, CONFIDENTIEL, SECRET) | Pas de module de droits ni d'authentification |
| Préférences | `localStorage` (règle : jamais en base) | « Dernier modèle utilisé » : à arbitrer (Q13) |
| Taches en attente du module | Placement des textes et des blocs de coordonnées (lot E, F) ; lignes non éditées (tranches F, non imprimées) ; rapport de ventilation des frais annexes ; récapitulatif des déductions d'avancement | — |

## 2. Principes d'architecture proposés

- **Module `modules/edition`** sans métier (socle seulement), comme les autres : modèle (rapport, bloc, composant,
  champ, charte), langage de formules d'édition, **mise en page paginée** et rendu HTML ; côté .NET : stockage des
  modèles, API, file de production des PDF. Le cœur spécialise : **sources de données** (document BTP, fiches, listes,
  structure), variables du dictionnaire, modèles fournis, conditions métier (statut, famille…). Le module Document ne
  dépend pas du module Édition (le cœur fait le lien).
- **Un moteur JS unique et indépendant du DOM** (décision du 18/10/2026) : il mesure le texte lui-même à partir des
  métriques des polices et produit un **arbre de pages entièrement positionné** (chaque ligne de texte, trait, image
  en mm). Il s'exécute dans le navigateur (aperçu, PDF hors ligne) et sur le serveur dans **Jint** (interpréteur JS
  en .NET, sans navigateur ni binaire natif ; repli : ClearScript V8 si les volumes l'exigent). Le serveur ne
  réimplémente rien en C# : c'est l'**exception assumée** à la règle des moteurs miroirs (tout ce que l'édition
  calcule vient des données de l'API ou du moteur d'édition lui-même).
- **Pipeline** en quatre étapes séparées, testables chacune :
  1. **Données** : `GET /api/editions/sources/<source>/<id>` renvoie un JSON complet et figé (document + résultat du
     calcul + société + tiers + structure + ressources), contrat déclaré par un **dictionnaire** (noms, types,
     libellés) qui servira au concepteur ;
  2. **Évaluation** : modèle + données → arbre de boîtes logiques (formules évaluées, conditions appliquées, groupes
     et ruptures formés, sommes calculées) ;
  3. **Mise en ligne et pagination** : mesure par les métriques des polices, coupure des lignes, découpage en pages
     (sauts, répétitions, bas de page, remplissage, gardés ensemble), puis seconde passe pour les variables de page
     (n° de page / nombre de pages, totaux reportés) ;
  4. **Rendu** du même arbre de pages : aperçu HTML (chaque ligne en position absolue, le DOM ne recalcule aucun
     retour à la ligne) et PDF écrit en JS par **pdf-lib** (+ fontkit : polices intégrées en sous-ensemble), identique
     dans le navigateur et dans Jint.
- **Modèle en JSON versionné** (`edi_version_format`), stocké en base, jamais de HTML libre comme modèle (le HTML est
  produit, pas saisi), pour pouvoir migrer, comparer, exporter et construire le concepteur dessus.

## 3. Points durs et points qui bloqueront plus tard

Classés par gravité. ⛔ = à trancher **avant** d'écrire le moteur ; ⚠ = à prévoir dans le modèle dès le premier lot ;
ℹ = à garder en tête ; ✔ = décidé.

### 3.1 ✔ Moteur indépendant du DOM, exécuté dans Jint côté serveur

Un moteur qui fait mesurer le texte par le DOM imposerait un Chromium sans interface sur le serveur (mémoire, pool
d'onglets, mises à jour de sécurité). **Décision (18/10/2026)** : le moteur mesure lui-même le texte.

- **Métriques des polices en données** : au build, un script extrait de chaque police livrée un JSON (largeur de
  chaque glyphe, paires de crénage, ascendante, descendante, interligne) ; mesurer = additionner, résultat identique
  partout. Les fichiers de police eux-mêmes servent à pdf-lib (intégration) et à l'aperçu (`@font-face`, dessin seul).
- **Mise en ligne propre au module** : mots, espaces insécables, coupure des lignes, justification, ellipse, réduction
  de la police, segments stylés, retrait suspendu, sans césure automatique au premier jet.
- **Côté serveur** : Jint exécute le même paquet JS (moteur + pdf-lib + fontkit + decimal.js) ; le PDF rangé en GED est
  produit par le serveur à partir des données qu'il lit lui-même (appel interne, pas un envoi du client) : le
  navigateur ne transmet jamais de PDF, rien à intercepter ni à substituer. L'API refuse les dépôts du client dans la
  catégorie `edition` ; les pièces comptables entrent au coffre-fort avec leur empreinte.
- **À mesurer au lot 0** : temps de Jint sur un devis de 5 000 lignes (repli ClearScript V8 ou petit service Node,
  toujours sans navigateur).

Conséquence : le **HTML des libellés** n'est plus rendu par le navigateur ; le moteur met en page lui-même la liste
blanche de `htmlSur` (`P, BR, B, STRONG, I, EM, U, S, SUB, SUP, SPAN, UL, OL, LI, H1–H4` ; couleur, fond, graisse,
style, décoration, alignement). Les **tableaux dans un libellé** (`TABLE, THEAD, TBODY, TR, TH, TD`) sont le seul
point coûteux : tableau simple (colonnes égales ou au contenu, sans fusion) ou rendu en texte (Q19).

### 3.2 ✔ Pagination propre au module

Les besoins exprimés (bloc forcé en bas de **la dernière** page, tableau qui remplit la page de lignes vides, entête de
tableau répété, total à reporter / report en haut de page suivante, « page x / y », garder un ouvrage avec ses
composantes, un titre jamais seul en bas de page, première page différente) dépassent `@page` / `break-*` de CSS ;
avec le moteur indépendant du DOM, la pagination est de toute façon la sienne : placement bande par bande, découpe des
bandes « sécables » ligne de texte par ligne de texte.

Coût : c'est le cœur du module (le plus gros lot, avec la mise en ligne) ; sans lui, rien ne fonctionne.

### 3.3 ✔ Polices : Inter par défaut, seules celles dont on a les métriques

**Décision (18/10/2026)** : **Inter** (licence OFL) est la police par défaut de l'application et des éditions.
L'application la charge depuis `@fontsource-variable/inter` (police variable, importée par `client/src/main.js`,
sans CDN). Les éditions ont besoin de fichiers TTF **statiques** (pdf-lib et fontkit intègrent mal une police
variable) : instances de la distribution officielle d'Inter (Regular, Italic, Medium, SemiBold, Bold, Bold Italic),
livrées avec le module, mêmes dessins et mêmes chasses que la police de l'application. Les métriques extraites
comprennent les **chiffres tabulaires** (fonction OpenType `tnum`, chiffres de même largeur) : le moteur les applique
aux colonnes de montants et de quantités, comme `font-variant-numeric: tabular-nums` dans les grilles.

La charte ne propose que les polices livrées (Inter, la police de **codes-barres** du § 3.14, plus tard une police à
empattements et une police à chasse fixe si besoin). Une police de l'entreprise s'importe comme ressource (TTF / OTF
statique, licence à la charge du client) : ses métriques sont extraites à l'import, côté serveur par le même script JS.

### 3.4 ✔ Imprimer = ouvrir le PDF

`window.print()` laisse la main au dialogue du navigateur (mise à l'échelle « ajuster », entêtes et pieds du
navigateur, marges) : les étiquettes et les fenêtres d'enveloppe deviennent fausses. « Imprimer » ouvre donc le PDF
dans la visionneuse du navigateur (impression à 100 %) : PDF du serveur quand l'impression est tracée ou rangée en GED,
PDF produit dans le navigateur pour l'aperçu téléchargé et hors ligne (démo). L'aperçu reste en HTML (rapide,
interactif).

### 3.5 ⛔ Facturation électronique (réforme française, en cours de déploiement)

Depuis septembre 2026, toutes les entreprises doivent pouvoir **recevoir** des factures électroniques, et l'émission
devient obligatoire (grandes et moyennes entreprises en septembre 2026, PME et micro-entreprises en septembre 2027),
par une plateforme agréée. Une facture PDF « imprimée » ne suffit plus : il faut un format structuré (**Factur-X** =
PDF/A-3 avec XML CII embarqué, ou UBL / CII seuls) et des mentions nouvelles (SIREN du client, adresse de livraison,
nature des opérations, option de TVA sur les débits).

pdf-lib permet d'écrire un PDF/A-3 (polices intégrées, profil couleur de sortie, métadonnées XMP, XML en pièce jointe
associée) : la production Factur-X peut se faire dans le même moteur, à valider contre un vérificateur PDF/A (veraPDF)
au lot de la production serveur. Le module **Facturation électronique / PDP** (XML, envoi, statuts) reste distinct.
**À trancher tôt** : l'édition des factures ne doit pas être la seule sortie légale, et les données de la source
« document » doivent déjà porter tout ce que demande le XML. On va faire un module spécifique pour la facture éléctronique, mais les particuliers ne sont pas impacter par la facturation éléctronique donc il faut des impressions PDF.

### 3.6 ⚠ Blocs liés : versions, paramètres, impact

Un bloc lié modifié change **tous** les rapports qui l'utilisent : un pied qui gagne une ligne peut faire passer un
total sur une page de plus partout. Il faut :
- un **graphe des dépendances** (qui utilise quoi), détection des **cycles** (bloc A inclut B qui inclut A), refus de
  supprimer un bloc utilisé, liste des rapports impactés avant enregistrement ;
- des **paramètres de bloc** (le même pied lié avec la mention « Facture » ou « Devis » : entrées déclarées, valeurs
  fournies par le rapport hôte), sinon on recopie ;
- le **découplage** : « détacher » un bloc lié en fait une copie ;
- une **surcharge** locale limitée (marges, visibilité) sans casser le lien — ou aucune (Q5) ;
- des **versions** de modèles : une pièce validée déjà produite reste figée en GED (§ 3.9), mais une réimpression d'un
  document validé doit-elle prendre le modèle du jour ou celui de la validation (Q12) ?

### 3.7 ⚠ Format flexible : modèle de positionnement

« Fixe ou flexible » impose de choisir **dès le modèle** comment on positionne : en mm absolus (fidèle, mais rien ne
s'adapte) ou en **disposition relative** (colonnes en %, ancrages gauche / centre / droite, empilements, largeurs
min / max, colonnes extensibles du tableau). **Proposition** : disposition relative par défaut (flex : rangées,
colonnes, piles), mm absolus réservés aux zones imposées (fenêtre d'enveloppe DL / C5 à 20 mm du bord, étiquettes).
L'adresse dans une **fenêtre d'enveloppe** contredit la règle « hauteur du bloc = plus haute colonne » : il faut une
zone ancrée sur la page, pas dans la bande.

Étiquettes : pagination différente (planche n × m, pas horizontal et vertical, marges de planche, première étiquette
de départ sur une planche entamée) : c'est un **mode de rapport**, pas un format de page.

### 3.8 ⚠ Lignes des documents : un arbre, pas une table

Les lignes sont un arbre typé (SECTION, titres, éléments, ouvrages et composantes, textes, sous-totaux, pied en
tranches et lignes virtuelles, pieds de section, consolidé, frais annexes **jamais imprimés**, options / variantes /
pour mémoire, avancement en cumul ou période). Le « modèle de ligne » doit donc être **choisi par type de ligne et par
condition** (un gabarit de rangée par cas), avec **fusion de cellules conditionnelle** (la SECTION commence dans
Hiérarchie et fusionne jusqu'à Libellé), indentation par niveau, bordures par rangée, libellés HTML, et règles de
masquage fournies par le cœur (lignes non imprimées, composantes masquées selon l'option du document, montants à zéro).
Les sous-totaux viennent **du moteur de calcul**, jamais recalculés par l'édition (sinon deux vérités) ; l'édition ne
calcule que les agrégats de mise en page (total de la page, report).

### 3.9 ⚠ Pièce validée = édition figée

Une facture validée réimprimée doit être identique (obligation légale de conservation à l'identique). **Proposition** :
à la validation (ou au premier envoi), le PDF est produit par le back-office et déposé dans le coffre-fort de la GED
avec le modèle utilisé et l'empreinte des données ; une réimpression ressort ce PDF (« duplicata » en filigrane si
besoin). Les données sont déjà figées (coordonnées, textes) : il reste le modèle, la charte et les images (logo changé
entre-temps). On réimprime normalement en passant par l'impression, pour l'envoie d'un doublons du document on utilisera le document stocker en GED qui n'aura pas été modifié.

### 3.10 ⚠ Données « par l'API seulement » : contrat, volume et identité

- **Contrat** : le modèle référence des chemins de données (`document.entete.ent_numero`,
  `lignes[].lig_libelle_html`, `societe.logo`…). Il faut un **dictionnaire versionné** par source ; un champ renommé
  dans l'API casse les modèles enregistrés (en base, donc invisibles aux tests). Prévoir une vérification des modèles
  contre le dictionnaire (au démarrage, à l'import).
- **Un appel par édition** : l'aperçu ne doit pas enchaîner dix appels (tiers, chantier, marché, échéancier, déductions,
  images…). La source agrège côté serveur.
- **Volume** : une liste de 50 000 lignes ou un devis de 5 000 lignes dans Jint : mémoire et temps. Pagination
  incrémentale (afficher les premières pages pendant le calcul), plafond par édition, production serveur obligatoire au
  delà.
- **Identité côté serveur** : la production du back-office lit les sources l'API **au nom de l'utilisateur** (ou d'un compte
  système) ; avec la confidentialité de la GED, un compte système ne voit pas les pièces SECRET d'autrui (même écueil
  que l'archivage de nuit). Jeton de service à durée courte, société (sous-domaine) transmise.
- **Champs confidentiels** (`pcf_confidentiel`, RGPD, mots de passe chiffrés) : jamais exposés par une source d'édition.

### 3.11 ⚠ Langage de formules

Le socle n'évalue que des nombres ; le langage du métré a des chaînes, des booléens, `Si` et des fonctions de l'hôte.
L'édition a besoin en plus : concaténation, formats (nombre, monnaie, date, `Majuscule`, `Remplir`), conditions en
ligne, présence (`EstVide`, `Premier non vide`), agrégats (`Somme`, `Compte`, `Moyenne` sur un groupe, une page, le
rapport), variables de page (`Page`, `NbPages` : connus seulement après pagination, d'où deux passes), et **mise en
forme dans le résultat** (morceaux stylés : nom en 11 gras, retrait suspendu après « Désignation : »).

**Proposition** : réutiliser l'**analyseur d'expressions du script de métré** (lexeur, typage, fonctions déclarées par
l'hôte, accents normalisés) en mode expression, avec un catalogue de fonctions d'édition ; le résultat d'un champ est
une liste de **segments stylés** (texte + style de charte) et non une chaîne HTML libre. Aucune réplique C# nécessaire
puisque le serveur exécute le même JS. OK

### 3.12 ⚠ Droits : le module n'existe pas

Le niveau d'accès d'une édition « lié au module de droits » ne peut aujourd'hui s'appuyer que sur `Profil` /
`EstAdmin` (entêtes `X-Profil`, sans authentification). **Proposition** : niveau d'accès de l'édition = les quatre
confidentialités de la GED (le PDF déposé en hérite, ce qui règle « l'affichage dans la GED »), plus une liste de
profils autorisés ; un point d'accroche `AccesEdition` que le futur module de droits remplacera. Le contrôle se fait
**côté serveur** (la source refuse les données), l'interface ne fait que masquer. OK

### 3.13 ✔ Images de la GED par condition : PNG et JPEG seulement

Choisir une image « par nom de fichier » est fragile (fichier renommé, doublons, versions). **Proposition** : catégorie
GED `ressource_edition` avec un **code de ressource** (`LOGO`, `LOGO_QUALIBAT`, `PIED_IMAGE`, `SIGNATURE`) et des
attributs (agence, période de validité) ; le modèle demande « la ressource `LOGO` de l'agence du document », la
condition porte sur ces attributs. Le nom de fichier reste un dernier recours. Images fournies par la source (data URI
ou contenu lu par le serveur), cache par version. Ok pour le code

**Décision (18/10/2026) : PNG et JPEG imposés**, les deux formats que pdf-lib intègre tels quels ; contrôlés au dépôt
dans la catégorie `ressource_edition` par le même script JS (refus expliqué) :
- **PNG** (logos, pictogrammes, transparence comprise) et **JPEG** (photos) : dimensions lues dans l'entête du fichier
  (sans décoder l'image), avertissement sous 300 dpi à la taille imprimée ;
- JPEG : orientation EXIF appliquée (photos de téléphone prises en portrait), JPEG CMJN et progressifs à vérifier
  au lot 0 (pdf-lib), sinon refusés au dépôt ;
- **SVG refusé** : un logo vectoriel s'exporte en PNG haute résolution avant le dépôt (pas d'analyseur SVG à écrire).
  Les traits, cadres, codes-barres et QR restent vectoriels (dessinés par le moteur).

### 3.14 ✔ Codes-barres et QR codes

**Codes-barres : Code 39 seul pour l'instant** (décision du 18/10/2026), par police libre **Libre Barcode 39**
(licence OFL), traitée comme les autres polices (métriques extraites, intégrée au PDF). Fonction de formule
`CodeBarre39(texte)` : contrôle les caractères admis (`0-9 A-Z espace - . $ / + %`, minuscules passées en
majuscules, autre caractère = erreur du champ), encadre le texte de `*`. Points de vigilance : largeur du module liée
à la taille de la police (petites étiquettes : vérifier la lecture au lecteur), marges blanches à réserver autour du
code, texte lisible dessous dans une police normale, Code 39 long (≈ 3,5 mm par caractère à petite taille). Code 128
et EAN-13 (encodage et clé de contrôle) plus tard si besoin.

**QR codes (décision du 18/10/2026)** : matrice calculée en JS (bibliothèque sans DOM, ≈ 20 Ko, type
qrcode-generator) et dessinée en carrés vectoriels par le moteur : même rendu dans l'aperçu et le PDF, net à toute
taille, aucun appel à l'API, fonctionne hors ligne. Fonction de formule `QrCode(texte; correction)`. Ce que le serveur
garantit, c'est **le contenu encodé** (lien de vérification d'une pièce, empreinte, QR de paiement SEPA / EPC avec
l'IBAN de la société) : la source d'édition le fournit déjà calculé (et signé si besoin), la formule ne fait que
l'encoder ; le PDF de la GED, produit par le serveur avec ses propres données, ne contient que ce contenu.

### 3.15 ℹ Autres points à garder en tête

- **Première page / pages suivantes / dernière page** différentes (entête complet en page 1, réduit ensuite ; pied
  légal sur la dernière seulement), **recto-verso** (pages paires / impaires), **page blanche** de fin, **annexes PDF**
  ajoutées (CGV, plans de la GED) : fusion de PDF côté serveur.
- **Filigranes** (PROVISOIRE, DUPLICATA, ANNULÉ) : couche de page, pas bloc en bande.
- **Lot / regroupement** : imprimer 30 factures en un seul PDF ou une file d'impression (back-office), numéroter
  « page x / y » par pièce et non par lot.
- **Envoi par courriel** (module Mail à venir) : la pièce produite part en pièce jointe (`dge_a_envoyer`).
- **Langue et formats** : dates et nombres en fr-FR aujourd'hui ; une langue par modèle (factures export) plus tard.
- **Accessibilité / texte du PDF** : texte sélectionnable et indexable par la GED (PdfPig l'extrait déjà).
- **Performance de l'aperçu « direct »** : relancer toute la pagination à chaque frappe dans le futur concepteur est
  coûteux ; prévoir un calcul par bande avec cache et une pagination différée.
- **Tests** : non pas des images (fragiles) mais des **jeux de cas de mise en page** comparant l'arbre de pages
  (pages, bandes, positions arrondies au dixième de mm), rejoués par `npm test` et dans Jint par `dotnet test` (même
  arbre attendu), plus quelques PDF de référence.
- **Sécurité** : le moteur dans Jint n'a ni réseau ni fichiers (tout vient de la source), HTML des libellés passé par
  `htmlSur`, jamais de script dans un modèle ; limites de temps et de mémoire de Jint réglées.

## 4. Vocabulaire proposé

| Terme | Sens |
|---|---|
| **Rapport** | Modèle d'édition complet : source, format, marges, bandes, options, niveau d'accès |
| **Sous-rapport** | Rapport inclus dans une bande, avec sa propre source ou une partie de la source de l'hôte (récap TVA, échéancier, déductions) |
| **Bloc** | Morceau réutilisable (bande ou composant) **lié** (référence) ou **copié** ; peut déclarer des paramètres |
| **Bande** | Zone horizontale de la largeur utile : unique, répétée (une par élément), groupe (entête / pied de rupture) |
| **Composant** | Élément d'une bande : pile, rangée, colonnes, champ, tableau, image, trait, cadre, code-barres, QR |
| **Champ** | Composant dont le contenu est une formule ; style de charte + surcharges dans la formule |
| **Gabarit de ligne** | Présentation d'une rangée de tableau pour un type de ligne et une condition |
| **Présentation** | Jeu de gabarits et de colonnes des lignes (ex. « Détaillée », « Bordereau », « Sans prix »), choisi dans le rapport ou à l'impression |
| **Source** | Fournisseur de données d'édition (document, fiche, liste, puis vues et procédures), avec son dictionnaire |
| **Charte** | Jeux de couleurs, polices, tailles, styles de texte, épaisseurs et marges nommés |
| **Ressource** | Image ou police rangée en GED, désignée par un code |

## 5. Modèle d'un rapport

### Q1. Structure du modèle

**Proposition** : JSON versionné :
```
rapport { code, libelle, source, cible (DOCUMENT | FICHE | LISTE | …), types (V_DEVIS, V_FACTURE…),
          format { papier A3|A4|A5|A6|ETIQUETTE|PERSONNALISE, orientation, flexible: [A4, A3], marges },
          planche? { colonnes, rangees, pas_x, pas_y, marges },  // étiquettes
          charte, niveau_acces, parametres [ { nom, type, defaut } ],
          bandes: [ { type: TITRE_RAPPORT | ENTETE_PAGE | PIED_PAGE | DETAIL | ENTETE_GROUPE | PIED_GROUPE
                       | RESUME | FOND_PAGE, condition, pages: TOUTES|PREMIERE|SUIVANTES|DERNIERE,
                       options { saut_avant, saut_apres, garder_ensemble, garder_avec_suivant,
                                 bas_de_page, remplir_page, secable },
                       contenu: composant | { bloc: code, lie: true, parametres } } ] }
```
Les bandes d'entête et de pied de page sont répétées sur chaque page par nature ; le « bloc répété sur chaque page »
de la demande est une bande ENTETE_PAGE / PIED_PAGE (ou un composant marqué `chaque_page` dans une bande DETAIL ?).

**Décision** : cela peut-etre un bloc comme le libelle des colonnes ou un titre ou sous titre de page. Ok

### Q2. Modes de bande

**Proposition** : UNIQUE (une fois), REPETE (une par élément d'une collection : lignes, échéances, intervenants),
GROUPE (rupture sur une expression : entête et pied de groupe, agrégats du groupe, saut de page par groupe,
regroupement = un seul élément par valeur). Pour les lignes de document, la rupture naturelle est l'**arbre**
(section, titre) : un mode REPETE **arborescent** parcourt l'arbre et applique le gabarit du type de ligne, les
sous-totaux venant du moteur.

**Décision** : Ok

### Q3. Composants flexibles

**Proposition** : PILE verticale (champs listés, les vides retirés avec leur interligne, séparateur conditionnel),
RANGÉE horizontale (colonnes en %, fixe en mm ou « reste »), alignements, ancrage ; hauteur d'une rangée = plus
haute colonne ; option « même hauteur » pour encadrer les colonnes à égalité. Zones **absolues** (mm depuis le bord de
la page) pour la fenêtre d'enveloppe et les étiquettes.

**Décision** : Ok

### Q4. Tableaux de lignes

**Proposition** : colonnes déclarées (clé, titre, largeur %, alignement, format, visible par condition, **extensible**
pour le format flexible) ; entête de tableau répété à chaque page ; gabarits de rangée par type de ligne et condition
(cellules fusionnées `de → à`, bordures haut / bas / gauche / droite par cellule et par rangée, fond, retrait par
niveau) ; ligne de total de page, de report (« À reporter » / « Report ») et de fin ; **remplissage** jusqu'au bas de
la page par des rangées vides ou un cadre étiré (les deux ?) ; garder ensemble un ouvrage et ses composantes, un titre
avec sa première ligne.

**Décision** : Au mieux le cadre étiré. Ok. Attention par défaut les composantes ne sont pas imprimé sauf si indiquer sur le rapport.

## 6. Blocs et réutilisation

### Q5. Lié, copié, surcharge

**Proposition** : un bloc se pose **lié** (par défaut pour les entêtes et pieds) ou **copié** (on le modifie
librement). Un bloc lié accepte ses **paramètres** et une **visibilité** (condition), rien d'autre ; pour changer plus,
on le détache (copie). Contrôles : cycles refusés, suppression d'un bloc utilisé refusée, liste des rapports impactés
affichée avant l'enregistrement d'un bloc lié.

**Décision** : Ok

### Q6. Sous-rapports

**Proposition** : un sous-rapport est un rapport (réutilisable seul ou inclus) dont la source est une **collection de
la source de l'hôte** (TVA par taux, échéances, déductions, intervenants) ou une **autre source** avec un identifiant
calculé (fiche du chantier depuis le document). Pas de sous-rapport de sous-rapport au-delà de trois niveaux ?

**Décision** : Ok pour 3 niveaux. On pourra avoir des sous rapport avec une **collection de la source de l'hôte** mais aussi depuis une autres sources exemple liste des marché et avenant ou situations précédentes ou factures précédente.

### Q7. Présentations des lignes

**Proposition** : la présentation (colonnes + gabarits) est un bloc ; un rapport « Devis » en propose plusieurs
(Détaillée, Sans détail des ouvrages, Bordereau sans prix, Quantitatif), une par défaut, la présentation se choisit
à l'aperçu (comme le modèle). Une présentation peut-elle être imposée par une condition (document d'avancement →
présentation Avancement) ?

**Décision** : Oui, les factures d'avancement sont par défaut avec une présentation Avancement

## 7. Champs, formules et mise en forme

### Q8. Langage

**Proposition** : formules de la forme du métré (`Si(…; …; …)`, `&` pour concaténer, fonctions en français) avec
références aux données (`{{entete.ent_numero}}`, `{{ligne.lig_libelle_html}}`), aux variables d'édition (`Page`,
`NbPages`, `DateImpression`, `Utilisateur`, `Somme(groupe; colonne)`, `ReportPage`), aux paramètres du rapport et du
bloc. Texte brut sans formule = littéral. Erreur de formule = champ vide + alerte dans l'aperçu, jamais d'édition
bloquée ?

**Décision** : Ok pas de bloquage mais avertissement à l'utilisateur et log

### Q9. Mise en forme dans la formule

**Proposition** : le champ a un style (charte : `texte_normal` = Inter 9) ; la formule le surcharge par segments :
`Style("titre_adresse"; {{tiers.nom}})`, `Gras(…)`, `Taille(11; …)`, et `Retrait(« Désignation : »; {{texte}})` pour le
retrait suspendu (le texte suivant aligné après le libellé). Pas de HTML saisi dans les formules ; les libellés HTML
des données (déjà nettoyés) sont rendus tels quels.

**Décision** : Ok

### Q10. Débordements

**Proposition** : par champ : une ligne (ellipse ou coupure), multiligne à hauteur fixe (ellipse sur la dernière
ligne), multiligne extensible (la bande grandit, sécable entre deux pages si la bande l'est), **réduction de la
police** jusqu'à un minimum, retour à la ligne automatique ou sur les seuls sauts de ligne.

**Décision** : Ok

### Q11. Charte graphique

**Proposition** : charte en base (une par société, donc par base ; plusieurs chartes nommées possibles : agence,
marque) : couleurs nommées, styles de texte (police, taille, graisse, couleur, interligne), traits, cadres, marges par
défaut. Un modèle référence `couleur:primaire` ou une valeur en dur ; changer la charte change toutes les éditions non
figées.

**Décision** : Ok Un modèle référence

## 8. Choix du modèle, aperçu, impression

### Q12. Modèle d'une réimpression

_Remplacée par l'annotation du § 3.9, voir § 15.1._ **Proposition initiale** : document non validé → modèle choisi (dernier utilisé pour imprimer, sinon celui par défaut du type) ;
document validé → le PDF figé de la GED (§ 3.9), ou nouvelle production à la demande (« réimprimer avec le modèle
actuel », droit dédié).

**Décision** : Ok

### Q13. « Dernier modèle utilisé pour imprimer »

La règle du projet range les préférences d'affichage dans le navigateur, jamais en base. Or ce choix sert aussi au
back-office (production pour la GED, envoi) et doit suivre l'utilisateur d'un poste à l'autre.

**Proposition** : en base, **sur le document** (`ent_modele_edition` : modèle et présentation de la dernière
impression), car c'est une donnée de la pièce (le back-office et les réimpressions s'en servent) ; par type de
document et par utilisateur dans le navigateur pour le choix proposé à un nouveau document.

**Décision** : Ok

### Q14. Aperçu

**Proposition** : page `/edition?source=&id=&modele=` (nouvelle fenêtre par `app.naviguer`), pages HTML au zoom
choisi, choix du modèle et de la présentation, paramètres du rapport, boutons Imprimer (PDF serveur), Télécharger,
Envoyer (module Mail), Ranger en GED ; alertes (formules en erreur, ressource introuvable, débordement).

**Décision** : Ok

## 9. Production par le back-office et GED

### Q15. Production

**Proposition** : file de production (table `edition_tache` par base : source, id, modèle, demandeur, état, PDF
produit), service de fond qui exécute le moteur dans Jint (instances en parallèle bornées), dépôt en GED sur l'élément (`type_element` = code du type,
`id_element` = groupe des indices du document), catégorie `edition`, confidentialité = niveau d'accès du rapport,
coffre-fort pour les pièces comptables validées. Déclencheurs : validation, envoi, demande explicite, lot.

**Décision** : Ok

## 10. Stockage, copie, import, export

### Q16. Tables

**Proposition** (scripts `modules/edition/db/090…`) : `modele_edition` (rapport ou bloc, code unique, type, JSON,
version, verrou, niveau d'accès, cree / modifie), `modele_edition_lien` (dépendances, pour le graphe et les cycles),
`modele_edition_defaut` (type de document ou de fiche / liste → modèle par défaut), `charte_edition`,
`edition_tache` ; ressources dans la GED. Historique des versions des modèles (comme les prix : par trigger).

**Décision** : Ok

### Q17. Import et export

**Proposition** : export en un fichier `.logibtp-edition` (JSON) contenant le rapport, ses blocs liés, sa charte et
ses ressources (images en base64), avec la version du format et du dictionnaire ; à l'import : collisions de codes
proposées (remplacer, renommer, lier à l'existant), vérification contre le dictionnaire de la base cible. Modèles
fournis par le cœur (devis, facture, situation, BL, commande fournisseur, fiche, liste) livrés de la même façon.

**Décision** : Ok Attention pour les images l'import utilisera par défaut celle de la GED en Base et si elle n'existe pas on créer l'image avec la ressource en Base64.

## 11. Accès

### Q18. Niveau d'accès

**Proposition** : § 3.12 : confidentialité GED + profils autorisés ; point d'accroche `AccesEdition` (serveur), aperçu
et production refusés en 403, PDF déposé avec la même confidentialité. Droits sur les modèles eux-mêmes (créer,
modifier un bloc lié, importer) : profil ADMIN en attendant le module de droits.

**Décision** : Ok

## 11 bis. Questions ouvertes par le moteur sans DOM

### Q19. Tableaux dans les libellés

Les libellés acceptent `TABLE, THEAD, TBODY, TR, TH, TD` (`htmlSur`) ; le moteur doit les mettre en page lui-même.

**Proposition** : tableau simple (largeurs au contenu, puis réparties, bordures fines, pas de fusion de cellules ni
de tableau imbriqué), insécable s'il tient sur une page, coupé entre deux rangées sinon. Les libellés existants qui
utilisent des fusions sont rendus sans fusion (alerte dans l'aperçu).

**Décision** : Ok

### Q20. QR codes

**Décision (18/10/2026)** : § 3.14 : matrice calculée en JS et dessinée en vectoriel ; le contenu sensible (lien de
vérification, QR de paiement) est fourni par la source du serveur.

## 12. Périmètre du premier jet (sans concepteur)

Sans concepteur, les modèles s'écrivent en JSON (fichiers sources du cœur, générés en SQL comme les vues de liste :
`npm run generer-vues-liste`). Le premier jet doit pourtant figer le **format du modèle** que le concepteur éditera :
c'est lui qu'il ne faudra pas casser.

## 13. Lots proposés

| Lot | Contenu | Dépend de |
|---|---|---|
| 0 | **Preuve de faisabilité** : pagination d'un devis réel (tableau arborescent, entête répété, report, pied en bas de dernière page, remplissage) par le moteur sans DOM (métriques des polices, mise en ligne, libellés HTML), PDF par pdf-lib dans le navigateur **et** dans Jint, comparaison des deux arbres de pages et des deux PDF, temps de Jint sur 5 000 lignes | Q1 à Q4, § 3.1 à 3.4 |
| 1 | Format du modèle, charte, langage de formules (segments stylés), évaluation → boîtes ; mise en ligne complète (débordements, libellés HTML) ; jeux de cas | Q8 à Q11, Q19 |
| 2 | Moteur de pagination complet (bandes, groupes, options de page, deux passes) ; jeux de mise en page | lot 1 |
| 3 | Source « document » du cœur (agrégat, dictionnaire), modèles fournis devis / facture / situation, présentations des lignes, page d'aperçu | lot 2, Q7, Q14 |
| 4 | Production serveur (Jint, file, PDF, GED, coffre à la validation, PDF/A-3 vérifié), réimpression figée | lot 3, Q12, Q15 |
| 5 | Blocs liés et paramètres, sous-rapports, import / export, ressources GED par code (PNG, JPEG), Code 39 par police, QR en JS | lot 3, Q5, Q6, Q13, Q17 |
| 6 | Sources « fiche » et « liste », étiquettes (planches) | lot 2 |
| 7 | Concepteur (création, modification) | format stable |
| — | Facturation électronique (Factur-X / PDP) : module à part, à cadrer en parallèle | § 3.5 |

## 14. Récapitulatif des décisions

Toutes les questions Q1 à Q20 et les points du § 15 sont décidés (annotations du 18/10/2026).

| # | Décision | Lot |
|---|---|---|
| § 3.1 – 3.4 | Moteur indépendant du DOM, Jint côté serveur, PDF par pdf-lib ; pagination propre ; Inter ; imprimer = ouvrir le PDF | 0 |
| § 3.5 | Module Facturation électronique à part ; le PDF reste nécessaire (particuliers, non concernés par la réforme) | — |
| § 3.9 | Réimpression = nouvelle production ; envoi d'un double = PDF de la GED, jamais modifié | 4 |
| § 3.13 – 3.14 | Images PNG et JPEG par code de ressource ; Code 39 par police ; QR en JS | 5 |
| Q1 | Tout bloc peut être répété sur chaque page (libellés des colonnes, titre ou sous-titre de page) | 1 |
| Q2 – Q3 | Bandes unique / répétée / groupe (arbre pour les lignes) ; piles, rangées, zones absolues | 1 – 2 |
| Q4 | Remplissage de page par cadre étiré ; **composantes non imprimées par défaut**, sauf si la présentation le demande | 2 – 3 |
| Q5 | Bloc lié : paramètres et visibilité seulement, sinon détaché en copie | 5 |
| Q6 | Sous-rapports sur trois niveaux, sur une collection de l'hôte **ou une autre source** (marché et avenants, situations et factures précédentes) | 5 |
| Q7 | Présentation choisie à l'aperçu ; facture d'avancement : présentation Avancement par défaut | 3 |
| Q8 | Formule en erreur : champ vide, avertissement à l'utilisateur et journal, jamais bloquant | 1 |
| Q9 – Q11 | Segments stylés ; débordements ; charte référencée par les modèles | 1 |
| Q12 – Q14 | Modèle choisi ; dernier modèle imprimé sur le document ; page d'aperçu | 3 – 4 |
| Q15 – Q16 | File de production dans Jint, dépôt en GED ; tables `modele_edition…` | 4 |
| Q17 | Import : image de la GED de la base par code, sinon créée depuis la ressource en base64 du fichier | 5 |
| Q18 | Accès : confidentialité GED + profils, `AccesEdition`, contrôle serveur | 3 |
| Q19 – Q20 | Tableaux simples dans les libellés ; QR en JS | 1, 5 |

## 15. Point avant développement (18/10/2026)

### 15.1 Réimpression d'une pièce validée (Q12 / § 3.9)

L'annotation du § 3.9 remplace la proposition de Q12 : une réimpression **produit à nouveau** l'édition (modèle,
charte et logo du jour, données figées) ; l'envoi d'un double reprend le PDF rangé en GED à la validation. Reste à
décider si une réimpression d'une pièce validée porte une mention (« Copie », « Duplicata ») pour la distinguer de
l'original envoyé.

**Décision (18/10/2026)** : pas de mention sur une réimpression. Une pièce **dévalidée puis revalidée** est produite à
nouveau et déposée comme **nouvelle version** du même document GED (`version_ged` ; le coffre-fort accepte l'ajout
d'une version et en interdit la suppression : l'original reste consultable).

### 15.2 Sous-rapports d'autres sources et « un appel par édition » (Q6 / § 3.10)

Les sous-rapports sur d'autres sources (marchés et avenants, situations, factures précédentes) ne doivent pas
multiplier les appels. **Proposition** (sans question) : le serveur lit le modèle, en déduit les sources nécessaires
(source principale + sources des sous-rapports avec leur identifiant calculé) et renvoie tout en un appel ; chaque
source applique ses propres droits. **Validé (18/10/2026).**

### 15.3 Lignes non imprimées (Q4)

Règle de masquage proposée, appliquée par la source « document » du cœur (pas par le modèle) : jamais les tranches de
frais annexes (F) ni les lignes `lig_is_non_editee` ; composantes d'ouvrage seulement si la présentation le demande
(`composantes: true`) ; les totaux restent ceux du moteur de calcul (une ligne masquée reste comptée). À confirmer :
une ligne « Ne pas imprimer » qui porte un montant reste-t-elle dans les totaux imprimés (oui aujourd'hui) ?

**Décision (18/10/2026)** : oui, une ligne « Ne pas imprimer » reste comptée dans les totaux imprimés.

### 15.4 Données manquantes pour les mentions obligatoires (avant les modèles fournis, lot 3)

Présentes : forme juridique, capital, RCS, NAF, SIRET, TVA de notre société (annuaire), mentions de TVA par taux
(autoliquidation sous-traitance, intracommunautaire), conditions de paiement. Absentes :
- **assurance décennale de notre société** (assureur, coordonnées, n° de police, couverture géographique), obligatoire
  sur les devis et factures du BTP (aujourd'hui seulement pour les sous-traitants : `per_st_decennale_*`) ;
- **pénalités de retard, indemnité forfaitaire de recouvrement (40 €) et escompte** (factures entre professionnels) ;
- pour les **particuliers** : médiateur de la consommation, droit de rétractation (contrat hors établissement), zone
  « Bon pour accord » datée et signée du devis.

**Proposition** : paramètres de la société (onglet de la fiche de notre société ou `/parametres/documents`), ajoutés
au lot 3 avec la source « document ».

**Décision (18/10/2026)** : paramètres de la société, au lot 3.

### 15.5 Risques techniques du lot 0

- pdf-lib et fontkit dans Jint : promesses, `Uint8Array`, `TextEncoder`, compression ; paquet JS unique (esbuild,
  format IIFE) et compléments de l'environnement à écrire ; temps sur 5 000 lignes (repli ClearScript V8).
- Dépendances à ajouter : npm `pdf-lib`, `@pdf-lib/fontkit`, `qrcode-generator` ; NuGet `Jint` ; fichiers TTF
  statiques d'Inter (distribution officielle, OFL) et de Libre Barcode 39 (OFL) à télécharger et livrer avec le
  module.

**Décision (18/10/2026)** : un **rapport des dépendances par module** est généré
(`npm run rapport-dependances` → [DEPENDANCES.md](../DEPENDANCES.md) : paquets npm et NuGet de chaque module avec
version et licence, polices et ressources livrées) et régénéré à chaque ajout de dépendance.

### 15.6 Modèles fournis du lot 3

**Proposition** : devis (présentations Détaillée, Sans composantes, Bordereau sans prix), commande client, facture,
situation et facture d'avancement (présentation Avancement), avoir, bon de livraison, commande fournisseur ; pieds
« Ventes / achats » (mentions obligatoires) et « Interne » liés à tous.

**Décision (18/10/2026)** : validé.
