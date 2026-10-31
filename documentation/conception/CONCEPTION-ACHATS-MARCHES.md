# Chaîne des achats et gestion des marchés – analyse fonctionnelle

> Document de travail : analyse de conception, aucun développement engagé. Pour chaque question : la **Proposition**
> est celle de l'analyse ; renseigner **Décision** (« ok », correction ou précision). La liste récapitulative des
> décisions à valider est au § 12.

## 0. Demande (reprise fidèle)

**Achats.** Les documents se transforment l'un après l'autre : demande de prix (Ddp) → commande (Cde) → bon de
livraison (BL) → facture.

- Une demande de prix transformée en commande ou en facture reprend toutes les lignes, avec leurs quantités et leurs
  prix.
- Une commande transformée en BL ou en facture reprend toutes les lignes et les prix. Chaque ligne affiche en plus deux
  colonnes : la quantité du parent, et la quantité restant à solder. Ce reste déduit les autres documents du même type
  issus de la même commande, ainsi que la quantité saisie dans le document en cours.
- Une colonne (case à cocher) permet de solder la ligne à la main sans attendre. La ligne est aussi soldée
  automatiquement quand le reste passe sous un seuil : 0 par défaut, réglable globalement dans les paramètres. Exemple :
  l'acier est commandé à la tonne au poids théorique, puis livré et facturé au poids mesuré, d'où un écart de quelques
  dixièmes.
- Une facture transformée en avoir reprend toutes les lignes, avec leurs quantités et leurs prix.

**Ventes.**

- Un devis se transforme en commande ou directement en facture. Lors de la transformation, l'utilisateur répond pour
  chaque option et chaque variante : soit elle est convertie en prix vendu, soit elle n'a pas été retenue et elle est
  supprimée.
- Nouveau module de gestion complète des marchés, pour les BL, les situations et les factures d'avancement :
  - À la validation d'une commande, un marché est créé avec cette commande comme document du marché. D'autres devis
    validés en commande peuvent s'ajouter au marché comme avenants.
  - Les BL, situations et factures d'avancement se créent depuis le marché. Ils prennent les commandes du marché
    acceptées au moment de la création, et chargent toutes les lignes de chaque commande, avec la section et le bloc de
    pied.
  - Quand le document contient plusieurs commandes, un pied global s'ajoute. Il est composé de sous-totaux qui
    reprennent toutes les lignes de chaque pied de document, en regroupant les lignes de même nature et de même libellé.
  - BL : même fonctionnement que les BL d'achat (quantité de la commande, reste à solder, case pour solder la ligne).
    Les lignes de composante d'ouvrage ne sont pas modifiables.
  - Situations et factures d'avancement : l'avancement se saisit en %, en quantité ou en montant global de la ligne. La
    référence est le montant (le % pour une ligne sans prix) ; les deux autres valeurs sont recalculées à partir du
    montant facturé et du montant de la commande.
  - On peut revenir en arrière sur l'avancement de chaque ligne. Si le total devient négatif, un avoir est créé à la
    place d'une facture.
  - Par défaut, le montant du marché ne peut pas être dépassé. Une option du marché permet de relever cette limite (cas
    des travaux publics, où le marché s'adapte selon les conditions).
  - Les situations sont des documents d'information, non comptables. Elles se modifient en créant des révisions alpha,
    et seule la version de référence est affichée.
  - Une facture d'avancement s'annule par un avoir. Un avoir sur une facture d'avancement suivie d'autres factures
    entraîne un avoir pour chacune de ces factures. Les factures ainsi annulées sont marquées non visibles dans
    l'avancement de facturation, avec une possibilité de les réafficher pour contrôle.

## 1. Existant

### 1.1 Transformation (module Document)

- Types (`db/110_reference.sql`, `db/160`) : ventes `V_DEVIS`, `V_COMMANDE`, `V_RECEPTION` (BL), `V_RETOUR`,
  `V_SITUATION` (non comptable, `db/160`), `V_FACTURE`, `V_FACTURE_AVT` (handler `FactureAvancement`), `V_AVOIR` ;
  achats `A_DEVIS` (« Demande de prix »), `A_COMMANDE`, `A_RECEPTION` (« BL fournisseur »), `A_RETOUR`, `A_FACTURE`,
  `A_FACTURE_AVT` (« Situation fournisseur »), `A_AVOIR`. Statuts BROUILLON, VALIDE, SOLDE, ANNULE (+ FACTURE, ACCEPTE
  selon le type).
- `transformation_autorisee` : couple source → cible, étape (`COMMANDE`, `RECEPTION`, `SITUATION`, `FACTURATION`,
  `RETOUR`, `AVOIR`) et étapes sautées couvertes (`tra_vaut_etapes`, ex. `A_COMMANDE → A_FACTURE` vaut aussi
  `RECEPTION`). **Absent** : `A_DEVIS → A_FACTURE`.
- `TransformationService.Transformer` (C#) : une seule source validée ; par défaut **tout le reliquat** de l'étape ; API
  ligne à ligne déjà prête (`lignes: [{ lig_id, qte, avancement_pct }]`) mais l'interface transforme tout
  (`client/src/app/documents/transformation.js`, README « écran ligne à ligne à venir »). Lignes gardées : lignes de
  prix retenues + sous-arbre + titres ancêtres + pied + tranches F + sous-totaux de pied. Composantes absolues au
  prorata. `SpecialisationBtp.AjusterLigneTransformee` : quantité saisie (`S`), perte à 1. Ventilation des frais figée
  en clés de ligne.
- Traçabilité : `document_lien` (documents), `document_ligne_lien` (`lil_etape`, `lil_qte` — négative pour retour ou
  avoir, `lil_montant_ht`, `lil_avancement_pct` / `qte`), `document_ligne_solde` (solde d'un reliquat **sans
  document** : quantité, étape, motif, utilisateur ; `POST /lignes/{ligId}/soldes`). Un avoir ou un retour écrit aussi
  une quantité négative sur les étapes amont : il **rouvre le reliquat** du document d'origine.
- `Suivi` : pour chaque ligne de prix **vendue** (`lig_type_prix = 'V'`, hors composantes) et chaque étape :
  transformé, soldé, reliquat. Les options, variantes et lignes pour mémoire ne sont **pas** suivies : elles
  disparaissent aujourd'hui à la transformation (seules les lignes retenues et leurs ancêtres sont gardées).
- Points à noter :
  - la quantité du lien est écrite **au moment de la transformation** : si l'utilisateur modifie ensuite la quantité
    dans le document cible (brouillon), `lil_qte` n'est pas mise à jour. Non si on fait une modification on met forcement à jour `lil_qte` ;
  - le reliquat compte les documents cibles **brouillons compris** (le lien existe dès la création) ;
  - le suivi est par **étape**, pas par type de document : une facture issue directement d'une commande consomme aussi
    l'étape RECEPTION (`tra_vaut_etapes`). Oui ;
  - une facture issue d'un BL est liée aux lignes du BL, pas à celles de la commande (pas de remontée transitive). On met le lien direct vers les lignes du BL mais il faudrait faire un chemin pour remonter jusqu'a l'origine.
- `HandlerFactureAvancement.QuantiteCible` : cumul % × quantité − déjà transformé ; refuse un % hors 0–100.
- Indices (« révisions alpha ») : `ent_groupe_id`, `ent_indice` A, B…, un seul `ent_is_reference` par groupe ;
  `CreerIndice`, `DesignerReference`.

### 1.2 Structure des affaires (cœur, `db/160`)

- `marche` : `mar_cha_id` **obligatoire** (chantier), `mar_ent_id` = **une** commande d'origine, `mar_montant_ht`
  (saisi, « avenants compris » en commentaire seulement), `mar_retenue_pct`, `mar_nature` P/U, `mar_statut`.
- Documents rattachés par `ent_marche_id` ; facturé = factures + factures d'avancement − avoirs validés
  (`v_facturation_document`).
- À la validation d'une commande client sans marché, la page document **propose** un marché
  (`structure/marche-commande.js` : créer ou rattacher, pour valider la comande le marché est obligatoire) ; le chantier est obligatoire.
- Transformations directes existantes `V_DEVIS → V_SITUATION`, `V_COMMANDE → V_SITUATION`,
  `V_SITUATION → V_FACTURE_AVT`, `V_COMMANDE → V_FACTURE_AVT`.

### 1.3 Moteurs et document

- Une SECTION est à la racine (`SECTION_RACINE`) ; **les lignes de pied sont à la racine** (`PIED_RACINE`) : un
  document n'a qu'**un** pied, après le corps. Plusieurs sections à la racine ne sont pas interdites mais partagent ce
  pied unique. Non pour les situations et factures d'avancement on peut avoir plusieurs pieds dans la section racine, un par section et le pied de la racine reprend toutes les lignes des pieds des autres sections en regroupant par type et libelle. On ajoutera aussi la déduction des situations ou factures précèdentes (Il faut prèvoir de tracer la déduction des documents précédent dans le document)
- Pied en tranches : totaux calculés, groupes HT / TVA / TTC, sous-totaux de pied, bases (CUMUL, TOTAL_HT, HT_NET,
  TOTAL_TTC, LIGNE = sous-total de pied), modes P / M / C.
- Types de prix V / O (option) / M (pour mémoire) / A (variante, `lig_variante_de_id`) / F (frais annexes) ; options
  et variantes hors totaux ; ventilation des frais sur les options selon `ent_fa_lignes` / `ent_fa_mode`.
- Nature (`lig_nat_id`) : sur les lignes de prix seulement ; les lignes de pied n'en ont pas.
- Pas de table de paramètres globaux pour le module Document (il existe `parametre_ged`, `parametre_bibliotheque`). à créer

## 2. Vocabulaire

| Terme | Définition proposée | Décision |
|---|---|---|
| Document parent | Document dont les lignes sont reprises (source de la transformation, ou commande du marché). | source de la transformation avec un chemin jusqu'a l'origine |
| Quantité du parent | Quantité vendue de la ligne source (`lig_qte_vendue`). | oui |
| Reste à solder | Quantité du parent − quantités des autres documents du même type issus du même parent − quantité du document en cours − quantités soldées. | oui |
| Solder | Clore le reste d'une ligne sans document supplémentaire (à la main ou par le seuil). | oui |
| Marché | Contrat suivi par la gestion des marchés : une commande de base et ses avenants. | oui |
| Avenant | Commande issue d'un autre devis, ajoutée au marché après la commande de base. | oui |
| Cumul / période | Avancement cumulé depuis le début du marché / différence avec le cumul déjà facturé. | oui |
| Pied de commande / pied global | Bloc de pied repris de chaque commande / pied qui consolide ces blocs dans un document à plusieurs commandes. | oui |

## 3. Achats : Ddp → Cde → BL → facture → avoir

### Q1. Transformations à déclarer

Il manque `A_DEVIS → A_FACTURE`.

**Proposition** : ajouter `A_DEVIS → A_FACTURE`, étape FACTURATION, vaut `{COMMANDE, RECEPTION}` (comme
`V_DEVIS → V_FACTURE`). Garder les transformations existantes (`A_COMMANDE → A_FACTURE_AVT`, retours…), non
concernées par la demande.

**Décision** : oui

### Q2. Quantités reprises dans le BL et la facture issus d'une commande

« Reprend toutes les lignes et les prix » : la demande ne dit pas quelle quantité est pré-remplie.

- a) le reste à solder (comportement actuel : tout le reliquat) ;
- b) 0, l'utilisateur saisit ce qui est livré ou facturé ;
- c) le reste, mais les lignes déjà soldées ou à reste nul sont reprises à 0 (pour mémoire) au lieu d'être omises.

**Proposition** : a) + c) : toutes les lignes sont reprises (même soldées, à 0 et grisées) pour garder la structure de
la commande ; quantité = reste à solder.

**Décision** : OK

### Q3. Calcul du reste à solder

« Les autres documents du même type issus de la même commande » ; l'existant raisonne par **étape**.

Cas : une commande a une facture directe (vaut RECEPTION) et un BL.

- a) par type (règle littérale) : le BL ne déduit que les BL, la facture que les factures ;
- b) par étape (existant) : la facture directe consomme aussi la livraison.

**Proposition** : b) par étape, qui est la règle littérale dans les cas courants (BL ↔ RECEPTION, facture ↔
FACTURATION) et évite de livrer deux fois ce qui a été facturé sans BL.

**Décision** : OK

### Q4. Facture issue d'un BL : reste par rapport à quoi ?

Commande de 10 t, deux BL (4 t et 6,3 t), puis une facture depuis chaque BL. Le reste de la facture se calcule-t-il
sur le BL (parent direct) ou sur la commande ?

**Proposition** : les deux colonnes portent sur le **parent direct** (le BL) ; la commande d'origine est remontée par
les liens (`lig_origine_id` en chaîne) pour le suivi global (onglet Traçabilité, reste à facturer de la commande).
Écrire aussi le lien FACTURATION vers la ligne de la commande (remontée transitive) pour que le reliquat de la commande
soit juste.

**Décision** : ok

### Q5. Documents brouillons dans le reste

**Proposition** : le reste déduit **tous** les documents non annulés (brouillons compris, comme l'existant), pour
éviter deux BL en parallèle sur la même quantité ; la colonne affiche en info-bulle la part des brouillons.

**Décision** : oui

### Q6. Quantité modifiée dans le document cible

Aujourd'hui `lil_qte` est figée à la transformation.

**Proposition** : à chaque enregistrement du document cible, `lil_qte` (et `lil_montant_ht`) sont recalculées depuis
la ligne cible (`lig_origine_id`) ; une ligne supprimée supprime son lien. Le reste affiché par le client se calcule
avec la quantité en cours de saisie, sans enregistrer.

**Décision** : ok

### Q7. Solder la ligne (case à cocher)

L'existant (`document_ligne_solde`) solde un reliquat sans document, depuis le parent. La demande place la case **dans
le document en cours** (BL ou facture).

**Proposition** :

- colonne « Soldé » (`lig_solde`, booléen, sur la ligne cible) ;
- à la **validation** du document cible, une ligne soldée écrit un `document_ligne_solde` sur la ligne parente, pour le
  reste restant (`lso_qte` = reste, `lso_cible_lig_id` = ligne du document cible, motif « Soldé à la main » ou « Soldé
  sous le seuil ») ;
- l'annulation (avoir) ou la suppression du document cible retire ce solde ;
- un reste négatif (livré plus que commandé, cas de l'acier) solde aussi la ligne, sans écriture de solde (rien à
  clore), et l'excédent reste visible dans le suivi.

**Décision** : OK

### Q8. Seuil de solde automatique

« Le reste passe sous un seuil, 0 par défaut » : un seuil absolu n'a pas le même sens en tonnes et en pièces.

- a) quantité absolue (dans l'unité de la ligne) ;
- b) pourcentage de la quantité du parent ;
- c) les deux (soldé si l'un des deux est atteint).

Comparaison : reste ≤ seuil (0 par défaut : soldé seulement quand tout est livré).

**Proposition** : b) pourcentage, global (`parametre_document.pdo_seuil_solde_pct`, page `/parametres/documents`),
appliqué à la **validation** du document cible (la case se coche seule et reste décochable avant validation). Faut-il
un seuil par unité ou par type de document (achats / ventes) ?

**Décision** : c) avec un seuil par type de document (achats / ventes)

### Q9. Avoir sur facture d'achat

« Reprend toutes les lignes avec leurs quantités et leurs prix » = comportement actuel (tout le reliquat de l'étape
AVOIR).

**Proposition** : inchangé, avec la même grille (quantité du parent, reste) pour un avoir partiel. Question : l'avoir
doit-il **rouvrir** le reste à facturer de la commande (comportement actuel : quantité négative sur les étapes amont) ?
Proposition : oui pour un avoir sur quantité (erreur de facturation), non pour un avoir commercial (remise) ; d'où un
choix « nature de l'avoir » (annulation / quantité / commercial), cf. Q24.

**Décision** : Oui mais on garde seulement les avoirs comptable (Oui pour un avoir sur quantité (erreur de facturation)) donc pas de choix de nature. Si on veut faire une remise une correction de quantité on fait un avenant.

### Q10. Une facture fournisseur pour plusieurs BL

« Les documents se transforment l'un après l'autre » (une source). En pratique, un fournisseur facture souvent
plusieurs BL du mois.

**Proposition** : hors périmètre de cette étape (une source par transformation) ; à prévoir ensuite avec la création
« depuis plusieurs documents » des marchés (§ 5.2), qui sait déjà charger plusieurs sources.

**Décision** : on ajoute le cas des factures fournisseurs. on peut partir d'un BL pour transformer en facture, on pourra aussi ajouter un ou plusieurs autres BL. Ou on créer une facture et on charge les documents source, il faudra ajouter une interface pour choisir les commandes et BL en attente de facturation. on reprend le mêmes principe pour les factures d'avancement pour les pieds.

## 4. Ventes : devis → commande ou facture, options et variantes

### Q11. Choix des options et variantes

Aujourd'hui les options et variantes ne sont pas suivies et disparaissent à la transformation.

**Proposition** : à la transformation d'un devis (vers commande, facture, et situation s'il en reste), une fenêtre
liste les options et variantes (tranche ou ligne, montant) avec pour chacune « Retenue (prix vendu) » / « Non
retenue (supprimée) ». Une option retenue passe en type V dans la cible avec son prix ; une non retenue n'est pas
reprise. Le choix est enregistré sur le lien (traçabilité : `lil_choix` R / N, ou propriété du lien document).

**Décision** : OK

### Q12. Variante retenue : que devient la ligne de base ?

Une variante (`lig_variante_de_id`) est une alternative à une ligne de base.

**Proposition** : retenir une variante **remplace** sa ligne de base (la base n'est pas reprise). Choix exclusif par
groupe de variantes (base ou une seule variante). Faut-il autoriser base et variante ensemble ?

**Décision** : c'est le à l'utilisateur de choisir ce qu'il garde.

### Q13. Lignes pour mémoire et tranches F

**Proposition** : les lignes pour mémoire (M) sont reprises telles quelles (toujours hors total) ; les tranches F
restent conservées (décision 13.15 de la ventilation des frais).

**Décision** : Ok

### Q14. Frais annexes et options retenues

Les prix sont figés à la transformation (ventilation figée en clés de ligne). Une option retenue garde donc son PV
(mode b : frais déjà inclus ; mode a : déjà dans la base).

**Proposition** : aucun recalcul de la ventilation dans la cible ; le prix de l'option retenue est celui du devis.
L'écart possible sur la tranche F de la cible (`FA_ECART`) est informatif.

**Décision** : Oui

### Q15. Statut du devis transformé

**Proposition** : devis → ACCEPTE à la création de la commande (FACTURE s'il est facturé directement) ; options non
retenues tracées dans le lien.

**Décision** : Pour le devis facturé direct on créer une commande entre les deux pour définir le budget. Les analyses seront créer dans un future module.

## 5. Gestion des marchés

### 5.1 Marché, commande de base et avenants

### Q16. Création automatique du marché

« À la validation d'une commande, un marché est créé. » Aujourd'hui il est **proposé** (« Plus tard » possible) et
exige un chantier.

**Proposition** :

- la validation d'une commande client crée le marché (code `M-<chantier>-<rang>`, libellé = objet, tiers, montant =
  total HT), sauf si l'utilisateur choisit de rattacher la commande comme **avenant** d'un marché existant du même
  chantier / client ;
- sans chantier : a) le chantier devient obligatoire pour valider une commande ; b) `mar_cha_id` devient facultatif
  (marché sans chantier) ; c) un chantier est créé automatiquement.

Proposition : b) pour ne pas bloquer une petite commande sans chantier.

**Décision** : a) et c) si aucun chantier

### Q17. Avenants

**Proposition** :

- table `marche_document` (`mdo_mar_id`, `mdo_ent_id`, `mdo_role` BASE / AVENANT, `mdo_rang` 0, 1, 2…, `mdo_date`) ;
  `mar_ent_id` reste la commande de base (compatibilité) ;
- un avenant est une **commande validée** (issue d'un autre devis) ajoutée au marché ; `mar_montant_ht` devient
  **calculé** (somme des commandes du marché) au lieu d'être saisi ;
- un avenant en moins-value (montant négatif, travaux retirés) : à autoriser ? Proposition : oui, par une commande
  négative ou des lignes négatives ;
- un avenant peut-il modifier une ligne existante de la commande de base (quantité, prix) ou seulement ajouter des
  lignes ? Proposition : seulement ajouter (un avenant = un document séparé) ; une modification passe par une ligne
  négative + une ligne nouvelle.

**Décision** : Ok

### Q18. « Commandes acceptées au moment de la création »

**Proposition** : commandes du marché à l'état VALIDE (ou au-delà, non annulées) à la date de création du document ;
un avenant validé plus tard n'entre que dans les documents créés après. Faut-il pouvoir **ajouter** un avenant à une
situation en cours (brouillon) ?

**Décision** : oui

### Q19. Transformations directes vers situation et facture d'avancement

Elles existent (`V_DEVIS/V_COMMANDE → V_SITUATION`, `V_COMMANDE → V_FACTURE_AVT`, `V_DEVIS → V_FACTURE_AVT`).

**Proposition** : une commande rattachée à un marché ne se transforme plus directement en BL, situation ou facture
d'avancement : le bouton renvoie vers la création depuis le marché. `V_DEVIS → V_SITUATION / V_FACTURE_AVT` sont
supprimées (un marché suppose une commande). La facture simple (`V_COMMANDE → V_FACTURE`) reste possible hors marché.

**Décision** : Ok

### 5.2 Documents créés depuis le marché

### Q20. Structure d'un document à plusieurs commandes

Chaque commande apporte sa SECTION et son bloc de pied. Or le module Document n'admet qu'un pied, à la racine
(`PIED_RACINE`). **Contradiction avec l'existant.**

- a) **pied de section** : une SECTION peut porter son propre pied (lignes de pied filles de la section, après son
  corps) ; le moteur calcule les totaux de chaque section, puis le pied global à la racine. Changement des deux
  `MoteurDocument` (nouveau jeu `08_pieds_sections.json`), de la grille et du plan ;
- b) **pied unique reconstruit** : chaque pied de commande est recopié dans le pied racine, chaque bloc introduit par un
  sous-total de pied (base LIGNE) ; pas de changement de moteur, mais le pied global « regroupé » n'est plus distinct
  des blocs, et la consolidation (Q21) devient délicate ;
- c) un document par commande, rassemblés pour l'impression et le suivi par le marché.

**Proposition** : a), c'est la seule qui correspond à la demande (section + bloc de pied par commande, puis pied
global). Avec une seule commande : pas de pied global, le pied de la commande reste à la racine (comme aujourd'hui).

**Décision** : a) ok

### Q21. Pied global : regroupement « même nature, même libellé »

Les lignes de pied n'ont pas de nature (`lig_nat_id` n'existe que sur les lignes de prix).

**Proposition** : « nature » d'une ligne de pied = son type (`lig_tyl_id` : PIED_HT, TVA, PIED_TTC, SOUS_TOTAL) + mode
(P / M / C) + sens ; deux lignes de pied se regroupent si nature et libellé brut (sans balises, sans accents ni casse)
sont égaux. La ligne globale = somme des montants des lignes regroupées (base = somme des bases, taux affiché seulement
s'il est commun). TVA : regroupée par taux. Totaux du pied global = somme des totaux des sections. À valider avec un
exemple (remise 2 % sur la commande, remise 3 % sur l'avenant → une ligne « Remise » de montant cumulé, sans taux ?).

**Décision** : Ok c'est cela

### Q22. Retenue de garantie, révision de prix, compte prorata

Ces lignes portent sur le marché, pas sur chaque commande (`mar_retenue_pct`).

**Proposition** : lignes de pied **globales** propres au marché (retenue de garantie, compte prorata), ajoutées
après la consolidation ; la révision de prix (index BT) est hors périmètre (§ 11). À confirmer.

**Décision** : OK il faut partir sur ce principe et on pauffinera cette gestion dans un second temps

### 5.3 BL de vente depuis le marché

### Q23. Fonctionnement

**Proposition** : mêmes règles que les achats (Q2 à Q8 : quantité de la commande, reste, solde, seuil) ; les
composantes d'ouvrage sont en lecture seule et suivent la quantité de l'ouvrage (relatives : automatiquement ;
absolues : au prorata, comme `Filtrer` aujourd'hui).

**Décision** : On laisse les quantités des lignes comme tel et on recalcul les Qte_total en fonction des quantité des parents.

### 5.4 Situations et factures d'avancement

### Q24. Saisie de l'avancement : %, quantité ou montant

Référence = montant cumulé facturé de la ligne (`M`), sauf ligne sans prix (référence = %). Montant de la ligne dans
la commande = `Mc` (montant HT net de la ligne : remise, frais annexes et prorata compris), quantité = `Qc`.

**Proposition** (cumul, répliqué dans les deux moteurs) :

- saisie en montant : `M` saisi ; `% = M / Mc × 100` ; `Q = Qc × M / Mc` (arrondi à la précision de quantité) ;
- saisie en % : `M = arrondi(Mc × % / 100)` ; `Q` comme ci-dessus ;
- saisie en quantité : `M = arrondi(Mc × Q / Qc)` ; `%` comme ci-dessus ;
- ligne sans prix (`Mc = 0`) : `%` saisi ou déduit de `Q / Qc` ; `M = 0` ;
- seul `M` est stocké comme référence (`lig_avt_montant_cumul`), avec le mode de saisie (`lig_avt_mode` P / Q / M) et
  la valeur saisie pour réafficher ce que l'utilisateur a tapé ; montant de la période = `M − M précédent`. Pour faire des analyses rapide ont enregistrera les % en base à titre indicatif.
- ouvrage : l'avancement se saisit sur l'ouvrage, les composantes suivent (non saisissables) ; en mode bordereau (B),
  idem ;
- titres et sections : saisie d'un % sur une tranche appliqué à toutes ses lignes (aide à la saisie) ? Oui

Faut-il distinguer « cumul » et « période » à l'écran (colonnes : % précédent, % cumul, montant précédent, montant
cumul, montant période) ? Proposition : oui.

**Décision** : Oui

### Q25. Situation, facture d'avancement : lequel porte la saisie ?

L'existant : situation (cumul, non comptable) transformée en facture d'avancement du delta.

- a) la situation est obligatoire : saisie dans la situation, validation, puis facture d'avancement générée (delta) ;
- b) les deux se créent depuis le marché ; la facture d'avancement se saisit directement en cumul, la situation est
  facultative (pour accord du client ou du maître d'œuvre).

**Proposition** : b) ; une facture d'avancement créée depuis une situation reprend son cumul.

**Décision** : OK

### Q26. Retour en arrière et avoir automatique

« Si le total devient négatif, un avoir est créé à la place d'une facture. »

**Proposition** :

- une ligne peut avoir un cumul inférieur au précédent (période négative) ;
- une facture d'avancement peut contenir des lignes positives et négatives ; seul le **total HT de la période**
  détermine le type : négatif → le document devient un `V_AVOIR` (nature « avoir d'avancement », signes inversés à
  l'impression), sinon facture d'avancement ;
- le basculement se fait à la validation (numérotation continue : le numéro est attribué à ce moment) ;
- total nul : document refusé (`RIEN_A_FACTURER`) ou validé à 0 ?

**Décision** : Ok avec un total nul, on créer le document mais il faudra marquer le document comme envoyé en compta (Module de compta à créer plus tard)

### Q27. Dépassement du montant du marché

**Proposition** :

- contrôle par **ligne** (cumul ≤ 100 % du montant de la ligne) **et** par marché (cumul total ≤ montant du marché,
  avenants compris) ; dépassement bloquant à la validation (`MARCHE_DEPASSE`, `LIGNE_DEPASSEE`) ;
- option du marché `mar_depassement_autorise` (booléen) ; faut-il un plafond (`mar_depassement_max_pct`, ex. 10 %) ?
- en travaux publics (marché au bordereau, quantités réelles), le dépassement se fait par la quantité (> `Qc`) au prix
  unitaire du marché ; une ligne nouvelle (non prévue) passe par un avenant.

**Décision** : Ok

### Q28. Pied, frais en montant et retenue dans une situation

Le pied de la commande peut contenir des montants fixes (remise de 500 €, forfait).

**Proposition** : en situation et facture d'avancement, une ligne de pied en % s'applique à la base de la période ; une
ligne en montant fixe est appliquée **au prorata de l'avancement global** de la section (cumul / montant de la
commande), puis en période (cumul − précédent). La retenue de garantie s'applique au cumul TTC de la période. À
valider sur un exemple chiffré.

**Décision** : Ok sauf pour les montants fixe on propose le montant en fonction du % global mais l'utilisateurs à le choix de modifier et on indique le montant marché, le montants cumulé précédent et le montant restant à solder et on bloque pour ne pas dépasser le montant marché.

### Q29. Révisions alpha des situations

**Proposition** : réutiliser les indices (`CreerIndice`, `ent_is_reference`) : modifier une situation validée crée
l'indice B, désigné référence. Seule la référence apparaît dans l'avancement du marché et (par défaut) dans les listes
(filtre `reference = vrai`). Une situation déjà transformée en facture d'avancement ne peut plus être révisée (la
correction passe par la situation suivante). Numéro de situation par marché (`ent_rang_avancement` : situation n° 1,
2…) en plus du numéro du document ?

**Décision** : Ok si une facture à été annulé par un avoir on peut modifier la situation. On ajoute bien Numéro de situation par marché et on pourra modifier ce numéro (Exemple reprise de facturation d'un autre logiciel)

### Q30. Avoir d'annulation d'une facture d'avancement et cascade

Factures F1 (cumul 30 %), F2 (cumul 50 %), F3 (cumul 80 %). Annuler F2 : F3 est un delta calculé sur F2, donc fausse.

**Proposition** :

- l'avoir d'annulation de F2 reprend F2 entière (lignes, quantités, prix) ; le système crée aussi l'avoir de F3
  (toutes les factures d'avancement postérieures du même marché, et de la même section ?) Oui ;
- F2, F3 et leurs avoirs passent au statut ANNULE (existant, terminal) et sont **masqués** de l'avancement de
  facturation (`ent_masque_avancement`, ou déduit du statut) ; une case « Afficher les factures annulées » les réaffiche
  pour contrôle ;
- le « déjà facturé » de la prochaine facture ignore les factures annulées : elle repart du cumul de F1 ;
- les situations liées à F2 et F3 : restent valables (information) ou annulées aussi ? On les conserve et on créer une révision alpha en les remettant en cours et on garde les avancement saisie, l'utilisateur repart de c'est situation pour créer les facture
- un avoir **partiel** sur une facture d'avancement (geste commercial) ne déclenche pas de cascade ; Pas de geste comercial dans les factures d'avancement on ne fait que des avoirs complet.
- confirmation avant création (liste des avoirs générés), écriture dans une seule transaction.

**Décision** : Ok

### Q31. Factures d'avancement et commandes multiples

**Proposition** : le « déjà facturé » se calcule par ligne de commande (tous documents d'avancement du marché
confondus) ; un avenant ajouté après F1 apparaît dans F2 avec un précédent à 0.

**Décision** : Ok

## 6. Architecture : où ranger le module des marchés ?

### Q32. Module ou cœur

Un module ne dépend ni du cœur ni du module Document ; la table `marche` est dans le cœur (`db/160`, liée au
chantier).

- a) nouveau module `modules/marche` (JS + C#) **sans SQL ni dépendance** : règles pures (avancement Q24, consolidation
  du pied Q21, cascade Q30, contrôles Q27) avec jeux de cas partagés ; tables et services dans le cœur ;
- b) tout dans le cœur (`client/src/app/structure/`, `src/LogiBTP.Api/Structure`) ;
- c) module complet avec ses tables (déplacement de `marche` hors du cœur, ce qui oblige à rendre le chantier
  facultatif).

**Proposition** : a) pour les règles ; la partie générique de l'avancement (trio %, quantité, montant ; pied de
section) va dans le **module Document** (`MoteurDocument`, puisqu'il porte déjà `HandlerFactureAvancement`), le reste
dans le cœur.

**Décision** : Ok

## 7. Impacts

### 7.1 SQL

| Script | Contenu |
|---|---|
| `modules/document/db/015_transformation.sql` (rejouable) | `parametre_document` : quatre seuils de solde, en % et en quantité, achats et ventes (Q8) ; `document_ligne.lig_solde` ; `document_ligne_solde.lso_cible_lig_id` ; choix des options et variantes, base et variante pouvant être retenues ensemble (`document_ligne_lien.lil_choix` ou équivalent, Q11, Q12) ; colonnes d'avancement génériques (`lig_avt_mode`, `lig_avt_valeur`, `lig_avt_montant_cumul`, `lig_avt_montant_precedent`, `lig_avt_pct` enregistré pour les analyses, Q24), aussi sur les lignes de pied (13.10) ; bloc de déduction tracé (`document_deduction` : document, document déduit, montants HT et TTC, 13.7) ; état comptable (`ent_etat_compta`, 13.9) ; pieds de section permis dans les documents à plusieurs sources (13.6) ; nature d'avoir des ventes (`ent_nature_avoir` ANNULATION / AVANCEMENT, `ent_annule_par_id` ; pas d'avoir commercial, Q9 et Q30) ; transformation `A_DEVIS → A_FACTURE`. |
| `db/168_marches.sql` (rejouable) | `marche_document` ; chantier obligatoire, pré-rempli (Q16, 13.2), sauf commande issue d'un « devis → facture » direct, sans marché (13.1) ; type de document non comptable de reprise d'avancement (13.11) ; rattachement par section dans une facture sur plusieurs documents (13.4 bis d, à confirmer) ; `mar_depassement_autorise` (+ plafond ?) ; `ent_rang_avancement`, `ent_masque_avancement` ; suppression des transformations directes vers situation (Q19) ; vues `v_avancement_marche` (par ligne de commande : montant, cumul facturé, situations de référence) ; `v_liste_marches` : montant calculé, facturé hors annulées. |
| `db/161` (démo) | Marché avec avenant, situations et factures d'avancement (généré depuis `structure/donnees.js`). |

### 7.2 Moteurs (miroir JS / C#)

- `MoteurDocument` (module) : pied de section (Q20 a, erreur `PIED_RACINE` assouplie pour une SECTION), totaux par
  section et pied global, consolidation (Q21) ; avancement (Q24) : trio %, quantité, montant, période ; contrôles
  `LIGNE_DEPASSEE`. Jeux `modules/document/tests/cas/08_pieds_sections.json`, `09_pied_global.json`,
  `10_avancement.json`, `11_avancement_retour.json`.
- `MoteurDevisBtp` (cœur) : avancement des ouvrages et composantes, mode bordereau ; jeux `tests/cas/24_avancement_ouvrage.json`,
  `25_avancement_bordereau.json`.
- Règle du reste à solder (fonction pure `resteASolder` ↔ `ResteASolder`, seuil compris) : module Document, jeu
  `12_reste_solde.json`.
- Module marché (Q32 a) : cascade d'annulation, contrôle du montant du marché ; jeux `modules/marche/tests/cas`.

### 7.3 Serveur

- `TransformationService` : choix des options (Q11), reprise de toutes les lignes (Q2), lien transitif (Q4),
  recalcul des liens à l'enregistrement (Q6), soldes à la validation (Q7, Q8).
- Nouveau service de création depuis le marché (plusieurs sources : sections + pieds, liens par commande) ; avoir
  automatique (Q26) ; cascade d'annulation (Q30) ; validation de commande → marché (Q16).
- `HandlerFactureAvancement` : remplacé par le calcul en montant (Q24), cumul négatif autorisé.

### 7.4 Client

- Grille : colonnes « Qté parent », « Reste à solder », « Soldé » (BL, factures issues d'une commande) ; colonnes
  d'avancement (précédent, cumul %, quantité, montant, période) ; vues par défaut dans `vues-document.js` (puis
  `npm run generer-vues-liste`).
- `documents/transformation.js` : fenêtre des options et variantes (Q11, Q12).
- Fiche marché : onglet Documents (commande, avenants, BL, situations, factures, avoirs), onglet Avancement (par
  ligne, factures annulées masquables), boutons « Nouveau BL / situation / facture d'avancement ».
- Page document : pieds de section, pied global, plan (sections + pieds).
- `/parametres/documents` : seuil de solde.
- Démo hors ligne : `FournisseurStructureMemoire` (marchés, avenants, avancement).

### 7.5 Documentation

`CLAUDE.md` (racine), `modules/document/CLAUDE.md`, `db/CLAUDE.md`, `client/CLAUDE.md`, `MODULES.md` (module marché),
`TACHES.md` (phase 2 de la structure).

## 8. Contrôles et messages

| Code | Cas | Bloquant ? | Décision |
|---|---|---|---|
| `RESTE_NEGATIF` | Quantité saisie > reste (livré plus que commandé) | Non (avertissement) | Ok |
| `LIGNE_DEPASSEE` | Cumul d'une ligne > 100 % sans dépassement autorisé | Oui à la validation | Ok |
| `MARCHE_DEPASSE` | Cumul du marché > montant du marché | Oui à la validation | Ok |
| `OPTION_NON_TRAITEE` | Option ou variante sans choix à la transformation | Oui | Ok |
| `RIEN_A_FACTURER` | Période nulle | À décider (Q26) | Ok mais on ne creer pas de numérotation situation |
| `CASCADE_AVOIRS` | Annulation entraînant d'autres avoirs | Confirmation | Ok |

## 9. Jeux de cas à écrire (parité JS / C#)

- [ ] Reste à solder : deux BL, quantité en cours, solde manuel, seuil, reste négatif.
- [ ] Avancement en montant, %, quantité ; ligne sans prix ; arrondis.
- [ ] Retour en arrière : période négative sur une ligne, total positif ; total négatif (avoir).
- [ ] Ouvrage et composantes ; mode bordereau.
- [ ] Deux commandes : sections, pieds de section, pied global regroupé (même nature et libellé, libellés différents).
- [ ] Pied en montant fixe au prorata de l'avancement.
- [ ] Dépassement interdit / autorisé (ligne et marché).
- [ ] Cascade d'annulation F1 / F2 / F3.

## 10. Ordre de réalisation proposé

1. Achats (Q1 à Q10) : transformations, colonnes du reste, solde, seuil (module Document + cœur), sans moteur.
2. Options et variantes à la transformation (Q11 à Q15).
3. Marché : création, avenants, `marche_document` (Q16 à Q19).
4. Pieds de section et pied global (Q20 à Q22) : moteurs.
5. BL depuis le marché (Q23).
6. Avancement, avoirs automatiques, dépassement, révisions (Q24 à Q29, Q31) : moteurs.
7. Annulation en cascade (Q30).

## 11. Hors périmètre / plus tard

- Déduction du paiement direct des sous-traitants (phase 2, gestion de la sous-traitance).
- Révision de prix (index BT), avance forfaitaire et remboursement, pénalités, décompte général définitif (DGD).
- Situations fournisseur (`A_FACTURE_AVT`). (La facture fournisseur sur plusieurs BL est **dans** le périmètre : Q10.)
- Conversion d'unités entre commande et livraison (commandé en t, livré en kg).
- Écran de transformation ligne à ligne hors marché (choix des lignes à transformer).

## 12. Décisions à faire valider avant le développement (récapitulatif)

> Toutes les questions Q1 à Q32 ont reçu une décision (relecture du 16/10/2026) ; les intitulés ci-dessous sont ceux
> des propositions initiales. Les points ouverts par ces décisions sont au § 13.

1. **Q1** – Ajouter `A_DEVIS → A_FACTURE` (vaut commande et réception).
2. **Q2** – Quantité pré-remplie dans le BL / la facture : reste à solder ; lignes soldées reprises à 0.
3. **Q3** – Reste calculé par étape (existant) plutôt que par type de document.
4. **Q4** – Facture issue d'un BL : reste sur le BL, lien transitif vers la commande.
5. **Q5** – Les brouillons comptent dans le reste.
6. **Q6** – Liens recalculés à chaque enregistrement du document cible.
7. **Q7** – Case « Soldé » dans le document cible, solde écrit à sa validation, retiré à son annulation.
8. **Q8** – Seuil en % (ou absolu, ou les deux), global, appliqué à la validation.
9. **Q9** – Avoir d'achat : rouvre-t-il le reste à facturer de la commande ? Nature de l'avoir.
10. **Q10** – Facture regroupant plusieurs BL : plus tard.
11. **Q11** – Fenêtre des options et variantes à la transformation du devis, choix tracé.
12. **Q12** – Variante retenue = remplace sa ligne de base (choix exclusif).
13. **Q13** – Pour mémoire repris, tranches F conservées.
14. **Q14** – Prix des options retenues = prix du devis, pas de nouvelle ventilation.
15. **Q15** – Statut du devis après transformation.
16. **Q16** – Marché créé automatiquement à la validation ; marché sans chantier autorisé.
17. **Q17** – Avenants : table `marche_document`, montant du marché calculé, moins-values, ajout seulement.
18. **Q18** – Commandes prises en compte = validées à la date de création.
19. **Q19** – Plus de transformation directe vers BL / situation / facture d'avancement pour une commande d'un marché.
20. **Q20** – Pieds de section dans le moteur (contredit `PIED_RACINE`) ou autre solution.
21. **Q21** – Définition de la « nature » d'une ligne de pied et règle de regroupement.
22. **Q22** – Retenue de garantie et compte prorata : lignes globales du marché.
23. **Q23** – BL de vente : mêmes règles que les achats, composantes en lecture seule.
24. **Q24** – Formules de l'avancement, valeur stockée, colonnes cumul / période, saisie sur une tranche.
25. **Q25** – Situation facultative ; facture d'avancement saisie en cumul.
26. **Q26** – Avoir automatique selon le total de la période ; période nulle.
27. **Q27** – Dépassement : contrôle par ligne et par marché, plafond éventuel.
28. **Q28** – Lignes de pied en montant fixe au prorata de l'avancement ; retenue.
29. **Q29** – Révisions des situations par indices ; situation facturée non révisable ; numéro de situation.
30. **Q30** – Cascade d'annulation : périmètre, statut ANNULE, sort des situations, avoir partiel sans cascade.
31. **Q31** – « Déjà facturé » par ligne de commande, avenants tardifs.
32. **Q32** – Architecture : règles dans un module `marche` sans SQL, avancement et pieds de section dans le module
    Document, tables dans le cœur.

## 13. Points restant à trancher (relecture du 16/10/2026)

> Contradictions ou trous relevés à la relecture des décisions ci-dessus. Même principe : **Proposition**, puis
> **Décision** à renseigner.

### 13.1 Devis facturé directement : la commande intermédiaire déclenche-t-elle un marché ?

Q15 : un devis facturé directement passe par une commande intermédiaire (budget). Q16 : valider une commande crée
obligatoirement un marché, et un chantier s'il n'y en a pas. Une petite facture directe créerait donc un chantier et un
marché. De plus Q19 garde `V_COMMANDE → V_FACTURE` « hors marché », alors qu'avec Q16 aucune commande client n'est
hors marché.

**Proposition** :
- « Devis → facture » reste proposé à l'écran, mais crée en une étape une commande **validée automatiquement** puis la
  facture ; la commande reçoit son marché et son chantier comme toute commande (Q16) : un seul chemin, des
  statistiques homogènes ;
- dans un marché, la **facture simple** (`V_FACTURE`) est permise depuis la commande ou depuis un ou plusieurs BL du
  marché (vente de fournitures), en plus des factures d'avancement ; les deux alimentent le « déjà facturé » de la
  ligne de commande (même étape FACTURATION) ;
- statut du devis : ACCEPTE à la création de la commande (la question de Q15 n'a pas reçu de réponse).

Achats : la même règle s'applique-t-elle à `A_DEVIS → A_FACTURE` (Q1 : commande fournisseur intermédiaire) ?

**Décision** : Cas particulier : une commande créée par un « devis → facture » direct n'exige pas de marché (ni de chantier). Les autres commandes client restent soumises à Q16.

### 13.2 Chantier créé automatiquement

Q16 a) + c) : chantier obligatoire, créé s'il n'y en a aucun.

**Proposition** : à la validation, la fenêtre du marché (sans bouton « Plus tard ») propose le chantier de la commande,
sinon celui du projet obtenu (`cha_prj_id`), sinon la création d'un chantier pré-rempli (code automatique, libellé =
objet de la commande, client, adresse de chantier du document, affaire du document si elle existe). L'utilisateur peut
choisir un autre chantier ouvert du client.

**Décision** : Pré-remplir avec les valeurs du document, de l'affaire ou du projet ; l'utilisateur complète les informations du chantier pour valider.

### 13.3 Correction de quantité ou remise côté achats

Q9 : pas d'avoir commercial ; « une remise ou une correction de quantité se fait par un avenant ». L'avenant n'existe
que pour les marchés de vente.

**Proposition** : côté achats, une correction passe par une **commande fournisseur complémentaire** (lignes positives
ou négatives) liée à la commande d'origine ; côté ventes hors avancement, par un avenant au marché. L'avoir (achat ou
vente) reprend toujours la facture en quantité et rouvre le reste à facturer.

**Décision** : Achats : ni correction ni avenant, on crée de nouvelles commandes.

### 13.4 Facture à partir de plusieurs documents (Q10)

Q10 entre dans le périmètre : facture fournisseur depuis un BL, complétée par d'autres BL ou commandes, ou créée vide
puis alimentée par une fenêtre « Documents en attente de facturation ».

**Proposition** :
- sources proposées : commandes et BL **validés** du même fournisseur, avec un reste à facturer, toutes affaires
  confondues (filtre par chantier possible) ;
- une même ligne ne peut pas être facturée deux fois : une ligne de commande déjà livrée par un BL choisi n'est reprise
  que pour son reste non livré (facture sans BL, qui vaut réception) ;
- une section et un bloc de pied par document source, pied global regroupé (Q20, Q21) ; une seule source : pas de
  section ajoutée ;
- « Charger » ajoute des sources à une facture brouillon ; retirer une section supprime ses liens ;
- même fenêtre pour les factures de vente depuis des BL (13.1) et pour charger un avenant dans un document du marché
  (Q18).

**Décision** : À approfondir : voir 13.4 bis.

### 13.5 Contrôle de la facture fournisseur

Le fournisseur facture parfois à un autre prix que la commande (hausse, erreur).

**Proposition** : dans la facture fournisseur, les prix restent **modifiables** (écart affiché par ligne par rapport au
parent) ; l'entête porte la référence et le montant TTC de la facture reçue (`ent_reference_externe` existant, montant
reçu à ajouter), avec l'écart au total calculé, bloquant à la validation au-delà d'une tolérance (0,05 € ?).

**Décision** : Prix modifiables, avec un avertissement, un marqueur de couleur sur la ligne et le prix de référence dans l'info-bulle.

### 13.6 Documents qui portent des pieds de section

§ 1.3 : « pour les situations et factures d'avancement on peut avoir plusieurs pieds ». La demande prévoit aussi la
section et le bloc de pied dans les **BL** du marché, et 13.4 dans les factures sur plusieurs sources.

**Proposition** : le pied de section est permis dans tout document **créé depuis plusieurs sources** (BL, situation,
facture d'avancement, facture, facture fournisseur) ; il n'est pas saisissable à la main dans un devis ou une commande
(erreur `PIED_SECTION_INTERDIT`). Réglage porté par le type de document (`tyd_pieds_sections`) ou par le document
(présence de plusieurs sources) ?

**Décision** : Oui : pieds de section dans tout document créé depuis plusieurs sources.

### 13.7 Déduction des factures précédentes (§ 1.3)

« On ajoutera la déduction des situations ou factures précédentes, tracée dans le document. »

**Proposition** :
- le document d'avancement présente le **cumul** (lignes en cumul, pied calculé sur le cumul), puis une ligne de pied
  « À déduire : factures précédentes » (montant TTC cumulé des factures d'avancement non annulées, moins leurs avoirs
  d'avancement), puis le net de la période ;
- traçabilité : table `document_deduction` (`ded_ent_id`, `ded_deduit_ent_id`, `ded_montant_ht`, `ded_montant_ttc`) :
  la liste des documents déduits est imprimable et figée à la validation ;
- les situations (non comptables) ne déduisent rien : elles affichent le cumul et, pour information, le déjà facturé ;
- la retenue de garantie se calcule sur le cumul, puis se déduit comme le reste (cohérent avec Q22).

Ceci remplace-t-il la présentation « période » de Q24 dans le corps (lignes en période) ou s'y ajoute-t-il (colonnes
cumul et période dans le corps, pied en cumul avec déduction) ?

**Décision** : Un bloc de déduction, avec en sous-détail les factures précédentes.

### 13.8 Composantes absolues dans un BL (Q23)

Q23 : les quantités des lignes restent telles quelles, les quantités totales sont recalculées depuis les parents. Une
composante **absolue** (`lig_qte_type = A`) ne dépend pas de la quantité de son ouvrage : livrer la moitié de l'ouvrage
livrerait toute la composante. L'existant (`Filtrer`) la proratise.

**Proposition** : les composantes absolues sont proratisées à la création (existant) puis suivent le même rapport
quand la quantité de l'ouvrage change dans le BL (lecture seule pour l'utilisateur).

**Décision** : Non : on livre les quantités unitaires des composantes de l'ouvrage multipliées par les quantités des parents.

### 13.9 Facture d'avancement à 0

Q26 : un document à total nul est créé, « marqué comme envoyé en compta » ; § 8 : il ne prend pas de numéro de
situation.

**Proposition** : facture d'avancement validée normalement (numéro de facture de la numérotation continue, obligatoire
pour une facture émise), sans rang de situation ; colonne `ent_etat_compta` (À transférer / Transféré / Sans écriture)
préparée pour le module Comptabilité, valeur « Sans écriture » pour un total nul. Ou bien : pas de facture du tout,
seulement une situation ?

**Décision** : OK. Précision : l'absence de numéro concerne les situations. Pour une période, on propose à l'utilisateur les marchés à facturer ; il peut indiquer qu'il n'y a pas eu d'avancement (aucune situation créée, aucun numéro de situation consommé).
Réalisé le 31/10/2026 (lot E) : page « Marchés à facturer » (mois civil ; marchés de vente en cours non soldés sans pièce
d'avancement validée du mois ; création d'un clic ou groupée ; « pas d'avancement » mémorisé par marché et par mois,
`marche_sans_avancement`).

### 13.10 Lignes de pied en montant fixe (Q28)

Le montant proposé au prorata est modifiable ; on affiche montant marché, cumul précédent et reste ; on bloque le
dépassement.

**Proposition** : le plafond est le montant de la ligne de pied dans la commande (somme des commandes si regroupées),
y compris quand le dépassement du marché est autorisé (Q27 porte sur les lignes de prix). Les lignes de pied d'un
document d'avancement portent donc aussi des colonnes d'avancement (cumul saisi, précédent). Proposition calculée par
les moteurs (jeu dédié), saisie libre ensuite.

**Décision** : Le plafond est 100 % du montant du marché ; une colonne % aide au calcul.

### 13.11 Reprise de facturation d'un autre logiciel (Q29)

Le numéro de situation est modifiable « pour une reprise de facturation d'un autre logiciel ». Il faut alors aussi
reprendre le **déjà facturé** de chaque ligne, sans facture dans LogiBTP.

**Proposition** : document « Reprise d'avancement » (situation de reprise validée, non comptable, sans déduction) qui
fixe le cumul précédent de chaque ligne et le cumul facturé TTC à déduire ; il compte comme facture précédente pour le
calcul du précédent et de la déduction (13.7). Une seule reprise par marché, avant toute facture d'avancement.

**Décision** : Oui : document non comptable qui reprend le cumul précédent à déduire, sans impact sur la comptabilité.

### 13.12 Périmètre de la cascade (Q30)

Réponse « Oui » à « même marché, et même section ? ». Une facture d'avancement couvre toutes les commandes du marché :
la section n'a pas de sens séparé.

**Proposition** : cascade sur toutes les factures d'avancement **et avoirs d'avancement** (Q26) postérieurs, du même
marché, non annulés. Un avoir d'avancement postérieur est annulé par une **facture** d'annulation (sens inverse).
L'ordre est celui des numéros de situation (rang), puis de la date de validation.

**Décision** : À approfondir : voir 13.12 bis.

### 13.13 Report des décisions dans les impacts (§ 7)

Ce point n'était pas une question : certaines décisions créent des colonnes ou des paramètres qui manquaient au § 7.
Ils y sont maintenant reportés (aucune décision à prendre) :

- Q8 : quatre seuils au lieu d'un (en % et en quantité, pour les achats et pour les ventes) ;
- Q12 : base et variante peuvent être retenues ensemble ;
- Q24 : le % d'avancement est enregistré pour les analyses ;
- 13.1, 13.7, 13.9, 13.11 : commande sans marché, bloc de déduction, état comptable, document de reprise.

### 13.4 bis Facture sur plusieurs documents : approfondissement

**Exemple.** Fournisseur Aciers du Sud, fin de mois :

| Document | Ligne | Commandé | Livré | Remarque |
|---|---|---|---|---|
| Commande CF-1 (chantier A) | Acier HA | 10 t | BL RF-1 : 4 t, BL RF-2 : 6,3 t | soldée (reste négatif) |
| | Treillis | 50 u | BL RF-2 : 50 u | |
| Commande CF-2 (chantier B) | Sable | 20 t | aucun BL | livré directement, facturé sans BL |

Le fournisseur envoie **une** facture qui couvre RF-1, RF-2 et CF-2.

**Deux façons de la saisir** (décision Q10) :

1. depuis le BL RF-1 : « Transformer en facture », puis dans la facture « Ajouter des documents » (RF-2, CF-2) ;
2. « Nouvelle facture fournisseur », choix du fournisseur, puis la même fenêtre « Documents en attente de
   facturation ».

Questions à trancher :

**a) Documents proposés dans la fenêtre.**
**Proposition** : BL et commandes **validés** du même fournisseur, qui ont encore un reste à facturer. Pour une
commande, le reste à facturer ne compte que ce qui n'a pas été livré par un BL : CF-1 n'est **pas** proposée (tout est
livré par RF-1 et RF-2), CF-2 l'est (20 t). On ne peut donc pas facturer deux fois l'acier (une fois par CF-1, une fois
par RF-1). Filtres : chantier, période, numéro.
**Décision** : La facture est multi-chantiers : pas de chantier dans l'entête, le lien se fait par le code chantier des lignes.

**b) Découpage de la facture en sections.**
- 1) une section par document choisi (RF-1, RF-2, CF-2), chacune avec son pied ;
- 2) une section par **commande d'origine** (CF-1 regroupe les lignes de RF-1 et RF-2, CF-2), avec le pied de la
  commande : la remise du fournisseur sur CF-1 s'applique une seule fois à toutes les livraisons de CF-1.

**Proposition** : 2), plus proche de la facture du fournisseur et du pied de la commande (remises, port) ; à l'intérieur
de la section, un titre par BL (« BL RF-1 du 03/10 ») garde la trace des livraisons.
**Décision** : Une section par document (commande et BL), et des tranches par commande pour regrouper les BL (voir 13.14 a).

**c) Pied global.** Comme Q21 : sous-totaux qui regroupent les lignes de pied de même nature et de même libellé, TVA
par taux, total à comparer à la facture reçue (13.5).
**Décision** : OK.

**d) Chantiers différents.** CF-1 est sur le chantier A, CF-2 sur le chantier B. L'entête n'a qu'un rattachement.
**Proposition** : le rattachement (projet, affaire, chantier, marché) est porté par **chaque section** (celui de la
commande d'origine) ; l'entête garde le rattachement commun s'il existe, sinon il reste vide. Les coûts restent
affectés au bon chantier.
**Décision** : OK, avec en plus la ventilation par chantier de chaque ligne, pour les analyses.

**e) Liens et reste.** Chaque ligne de la facture est liée à sa ligne source (ligne du BL ou de la commande), avec la
remontée jusqu'à la commande (Q4). Retirer une section supprime ses liens ; le reste des sources revient aussitôt.
**Décision** : OK, on garde les liens.

**f) Ventes.** Même fenêtre pour une facture client sur plusieurs BL d'un même client (hors avancement), et pour
charger un avenant dans un document du marché (Q18).
**Décision** : OK.

### 13.12 bis Annulation en cascade : approfondissement

**Exemple.** Marché de 10 000 € HT ; documents validés dans l'ordre :

| N° situation | Document | Cumul | Montant de la période |
|---|---|---|---|
| 1 | Facture F1 | 30 % | + 3 000 |
| 2 | Facture F2 | 50 % | + 2 000 |
| 3 | Avoir d'avancement A3 (retour en arrière, Q26) | 45 % | − 500 |
| 4 | Facture F4 | 80 % | + 3 500 |

L'utilisateur annule **F2**. F2 a servi de « précédent » à A3 et F4 : leurs montants sont faux. La cascade annule donc
F2, A3 et F4.

Questions à trancher :

**a) Comment annuler un avoir d'avancement (A3) ?**
On ne fait pas d'avoir d'un avoir.
**Proposition** : une **facture d'annulation** (même type que la facture d'avancement, nature ANNULATION) qui reprend A3
à l'identique en positif (+ 500).
**Décision** : Un avoir d'avoir, qui produira une écriture d'extourne (contre-passation).

**b) Documents créés et leur état.**
**Proposition** : en une seule transaction, après confirmation de la liste : avoir de F2 (− 2 000), facture
d'annulation de A3 (+ 500), avoir de F4 (− 3 500). F2, A3, F4 et ces trois documents passent à ANNULE et sont masqués de
l'avancement (affichables pour contrôle). Total de la cascade : − 5 000, l'avancement revient à 30 % (F1).
**Décision** : Oui.

**c) Annuler un document qui n'est pas le dernier sans cascade ?**
**Proposition** : impossible : annuler un document annule toujours tous ceux qui le suivent dans le marché. Annuler le
dernier ne déclenche pas de cascade.
**Décision** : Non : pas d'annulation sans cascade (annuler le dernier document seul reste possible).

**d) Situations liées (Q30 : révision alpha remise en cours).** S2, S3, S4 ont servi à F2, A3, F4.
- 1) seule la **dernière** (S4) est remise en cours (nouvel indice en brouillon, avancements conservés) ; S2 et S3 sont
  masquées comme leurs factures ;
- 2) toutes sont remises en cours.

**Proposition** : 1) : l'utilisateur repart de la dernière situation (80 %) pour refacturer ; garder trois brouillons
concurrents prêterait à confusion.
**Décision** : Oui : seule la dernière situation est remise en cours.

**e) Numéro de situation de la facture suivante.**
- 1) on reprend après la dernière non annulée : la prochaine est la n° 2 ;
- 2) on continue la suite : la prochaine est la n° 5.

**Proposition** : 1), le client voit une suite continue de situations valables ; les documents annulés gardent leur
numéro (visible en contrôle). Le numéro reste modifiable (Q29).
**Décision** : Reprendre au n° 2.

**f) Bloc de déduction (13.7).** La facture suivante ne déduit que F1 : les documents annulés et leurs annulations
s'équilibrent et sont exclus du sous-détail.
**Décision** : Oui.

**g) Règlements.** Une facture déjà réglée par le client peut-elle être annulée ? Les règlements ne sont pas gérés
aujourd'hui.
**Proposition** : permis ; avertissement à brancher avec le futur module Comptabilité (TACHES.md).
**Décision** : Oui ; le règlement ou l'avoir pourra être déduit d'une prochaine facture.

### 13.14 Derniers points ouverts par les décisions 13.4 bis et 13.12 bis

**a) Sections et tranches d'une facture sur plusieurs documents (13.4 bis b).**
« Une section par document (commande et BL), des tranches par commande pour regrouper les BL. » Une section est
toujours à la racine (`SECTION_RACINE`), une tranche est dans une section : une tranche ne peut donc pas regrouper des
sections. Deux lectures possibles, sur l'exemple RF-1, RF-2 (BL de CF-1) et CF-2 (commande facturée sans BL) :

```
Lecture 1 : une section par document source        Lecture 2 : une section par commande, une tranche par BL
SECTION BL RF-1 (tranche « CF-1 ») + pied           SECTION CF-1 + pied de CF-1
SECTION BL RF-2 (tranche « CF-1 ») + pied             ├─ tranche BL RF-1
SECTION Cde CF-2 + pied                               └─ tranche BL RF-2
Pied global                                          SECTION CF-2 + pied de CF-2
                                                     Pied global
```

**Proposition** : lecture 2 (la remise et le port de la commande s'appliquent une seule fois à toutes ses livraisons ;
le pied global ne regroupe que deux pieds).
**Décision** (31/10/2026) : lecture 2, réalisée (`RegroupementLivraisons`, module Document) : une section par commande
d'origine, une tranche par BL, pied du premier BL (copie de celui de la commande) ; un BL ajouté à une facture
brouillon rejoint la section de sa commande.

**b) Chantier par ligne (13.4 bis a et d).**
**Proposition** : colonne `lig_cha_id` (cœur, `ALTER TABLE document_ligne`), reprise de la ligne source (commande ou
BL), sinon du rattachement de son document ; colonne « Chantier » (code, combo) dans la grille ; sans chantier
d'entête, les listes de documents affichent « Plusieurs » et le filtre par chantier (`v_liste_documents`) trouve le
document par ses lignes. Faut-il aussi l'affaire et le marché par ligne, ou le chantier suffit-il (les parents se
déduisent du chantier) ?
**Décision** (31/10/2026), réalisée (`db/248`) : chantier par ligne sur les documents d'achat seulement, vide = celui
de l'entête (souligné dans la grille), modifiable ; repris du chantier de l'entête de chaque source quand la cible a
plusieurs sources ; plusieurs chantiers : entête vide et avertissement « Autre chantier » des contrôles de saisie ;
filtre par chantier : entête, sinon chantiers des lignes (achats) ou des documents sources (ventes), colonne
`chantiers` de `v_liste_documents`. Le chantier suffit (parents déduits).

**c) Avoir d'avoir (13.12 bis a).**
**Proposition** : transformation `V_AVOIR → V_AVOIR` (étape AVOIR, nature ANNULATION) qui reprend l'avoir à
l'identique, en sens inverse ; même chose côté achats (`A_AVOIR → A_AVOIR`) pour une erreur de saisie ? Les écritures
d'extourne seront produites par le futur module Comptabilité.
**Décision** :

**d) Imputation d'un règlement ou d'un avoir sur une facture suivante (13.12 bis g).**
**Proposition** : hors périmètre de cette analyse (règlements non gérés) ; à reporter dans TACHES.md avec le module
Comptabilité (lettrage, acomptes, déduction sur la facture suivante).
**Décision** :

## 14. Réalisation

### Lot 1 – achats (16/10/2026)

- Q1 : `db/168_transformations_achats.sql` (`A_DEVIS → A_FACTURE`, vaut commande et réception).
- Q2 : « tout le reliquat » reprend toutes les lignes de prix ; une ligne sans reste est reprise à 0 avec son lien
  (`TransformationService.Transformer`) ; affichée grisée (`ligne-soldee`).
- Q3, Q5 : reste par étape, brouillons compris (part des brouillons dans l'info-bulle du reste).
- Q4 : une cible est aussi liée, pour son étape, aux lignes d'origine de sa source (facture d'un BL → commande).
- Q6 : `lil_qte` et `lil_montant_ht` recalculées à chaque enregistrement de la cible (`DocumentService.RecalculerLiens`).
- Q7, Q8 : colonnes Qté parent, Reste, Soldé (`EditeurDocument.definirRestes`, `GET /documents/{id}/restes`) ; à la
  validation, ligne soldée ou sous le seuil → `document_ligne_solde` (`lso_cible_lig_id`), retiré par un avoir ; règle
  `etatSolde` ↔ `Soldes.Etat` (jeu `modules/document/tests/soldes/01_reste_solde.json`) ; seuils en % et en quantité
  par famille (`parametre_document`, page `/parametres/documents`, `modules/document/db/015_document_soldes.sql`).
- Q9 : avoir inchangé (reprend la facture, rouvre le reste) ; mêmes colonnes.
- Vérifié sur la base de démo : commande, BL partiel (reste 20, ligne soldée à la main : solde 4,26 écrit), second BL
  (reste seul repris, lignes soldées grisées), facture du BL liée au BL et à la commande.
- Reste du lot : facture sur plusieurs documents (Q10, 13.4 bis), après les pieds de section (lot 4). § 13.14 : les
  propositions sont retenues par défaut tant qu'aucune décision n'est saisie.

### Lot 2 – options et variantes à la transformation (16/10/2026)

- Q11 : fenêtre « Options et variantes » (`choisirOptions`, `client/src/app/documents/transformation.js`) après le choix
  de la cible ; chaque unité (`unitesOptionnelles` ↔ `Options.Unites`, jeu `modules/document/tests/options/01_unites.json`)
  est retenue ou non ; sans choix : refus `OPTION_NON_TRAITEE` ; choix tracés dans `document_lien.lie_choix`
  (`modules/document/db/016_document_options.sql`).
- Q12 : la ligne de base d'une variante est proposée aussi (gardée par défaut, écartable) : base et variante peuvent
  être gardées ensemble. Une option ou variante retenue passe en prix vendu (V), sans lien de variante.
- Q13 : lignes pour mémoire reprises (hors total) ; tranches F conservées. Q14 : prix du devis conservés.
- Q15, 13.1 : devis → facture passe par une commande créée et validée automatiquement (`tra_intermediaire_tyd_id`,
  `db/169_transformations_ventes.sql`), marquée `ent_intermediaire` (pas de marché obligatoire au lot 3) ; le devis passe
  au statut Accepté dès l'étape commande. Les achats (demande de prix → facture) restent directs.
- Correctif : la TVA d'un document écrit deux fois dans le même contexte (intermédiaire créé puis validé) est détachée
  avant réécriture (`PersistanceDocument.Ecrire`).
- Vérifié sur la base de démo : refus sans choix, option retenue reprise en vendu, non retenues absentes, devis
  Accepté, devis → facture (commande intermédiaire validée, facture en brouillon). Non vérifié en base : variante
  (aucune dans les données de démonstration ; règle couverte par le jeu partagé).

### Lot 3 – marché, commande de base et avenants (16/10/2026)

- Q16, 13.2 : valider une commande client exige un marché (`MARCHE_OBLIGATOIRE`, `SpecialisationBtp.ControlerValidationAsync`,
  nouveau point d'accroche du module Document), sauf la commande intermédiaire d'un devis facturé directement (13.1).
  Avant la validation, la page document ouvre la fenêtre du marché (`structure/marche-commande.js`) : chantier de la
  commande ou de son projet, ou nouveau chantier pré-rempli (code, libellé, ville du projet, affaire, client) que
  l'utilisateur complète ; puis nouveau marché (la commande en est la base) ou avenant d'un marché en cours du chantier.
  Plus de bouton « Plus tard » : Annuler abandonne la validation.
- Q17 : `marche_document` (`db/170_marches.sql`) tenu par `f_marche_commande` à la validation (`ApresValidationAsync`)
  et au rattachement d'une commande validée ; base au rang 0, avenants 1, 2… ; `mar_montant_ht` calculé
  (`f_marche_recalculer` : commandes validées, avenants en moins-value compris), en lecture seule dans la fiche ; la fiche
  marché liste la commande et les avenants ; liste des marchés : nombre d'avenants.
- Q19 : transformations `V_DEVIS → V_SITUATION | V_FACTURE_AVT` supprimées. Le refus des BL, situations et factures
  d'avancement directs d'une commande d'un marché viendra avec leur création depuis le marché (lots 5 et 6), pour ne pas
  les bloquer avant. Q18 (commandes prises en compte, ajout d'un avenant à une situation en cours) : lots 5 et 6.
- Vérifié sur la base de démo : validation refusée sans marché ; commande validée avec un nouveau chantier et un nouveau
  marché (base) ; seconde commande validée comme avenant (rang 1) ; montant du marché = somme des deux commandes ;
  fiche marché (commande, avenant, montant).

### Lot 4 – pieds de section et pied global (16/10/2026)

- Q20 a : une SECTION à la racine peut porter son pied (lignes de pied et sous-totaux de pied filles de la section,
  `PIED_RACINE` assoupli) ; chaque section calcule son pied sur ses propres lignes (`pieds_sections` du résultat) ; sans
  pied de section, le calcul est inchangé. Répliqué entre les deux `MoteurDocument` (`calculerPortee` / `CalculerPortee`,
  `consoliderPied` / `ConsoliderPied`), jeux `modules/document/tests/cas/08_pieds_sections.json` (deux sections,
  montants vérifiés à la main) et `09_pieds_sections_controles.json`.
- Q21 : pied global = total HT des sections, lignes des pieds de section consolidées par nature (type, mode, sens) et
  libellé (sans accents ni casse, table d'accents explicite identique JS / C#), montants et bases additionnés, taux
  affiché s'il est commun ; TVA additionnée par taux ; postes HT, TVA, postes TTC ; net global = somme des nets de
  section.
- Q22 (premier temps) : le pied global ne reçoit que des postes après TVA saisis à la racine (retenue de garantie,
  acompte…) ; un poste HT ou une ventilation TVA à la racine est refusé (`PIED_GLOBAL`). À affiner (compte prorata).
- 13.6 : un pied de section dans un document à moins de deux sections est une erreur (`PIED_SECTION_INTERDIT`) : un
  devis ou une commande saisis à la main n'en ont pas.
- Grille : tranche « Pied de la section » repliable en fin de chaque section, pied global avec ses lignes
  « Consolidé ». Vérifié dans le navigateur sur un devis d'essai (supprimé ensuite) : nets de section 1 117,20 et
  687,99, pied global 1 705,19 (moteur BTP du serveur identique).

### Lot 5 – plusieurs sources, BL du marché (16/10/2026)

- Q10, 13.4 bis : `TransformerPlusieurs` et `AjouterSources` (module Document) ; une section par document source (la
  sienne, ou une section créée à son nom), son bloc de pied y est déplacé, sa colonne Code porte le numéro de la source ;
  le contenu existant d'un brouillon devient lui aussi une section. Fenêtre « Documents en attente » (`EnAttente` :
  même tiers, lignes encore ouvertes pour toutes les étapes de la transformation) par le bouton « ＋ Documents » de la
  page document. Entête : rattachement gardé seulement s'il est commun aux sources (13.4 bis a).
- Une cible qui couvre plusieurs étapes (facture qui vaut réception) ne reprend que le plus petit reste : une facture
  directe d'une commande ne refacture pas ce qu'un BL a livré (13.4 bis a).
- Q18, Q23 : BL du marché depuis la fiche (« 🚚 Nouveau BL » : toutes les commandes validées, base puis avenants) ;
  « ＋ Documents » d'un document du marché charge les avenants validés pas encore repris ; composantes d'ouvrage non
  saisissables dans un BL (quantités unitaires × quantité de l'ouvrage, 13.8).
- Q19 : BL, situation et facture d'avancement directs d'une commande d'un marché refusés (`MARCHE_CREATION`).
- Suppression : un brouillon issu d'une transformation se supprime avec ses liens (sinon un BL brouillon créé par erreur
  bloquait le reste de ses sources, Q5) ; un document déjà transformé reste protégé.
- 13.14 a et b réalisés le 31/10/2026 (lot D) : regroupement des BL d'une même commande en tranches dans la section de
  la commande, chantier par ligne (`lig_cha_id`) des achats ; transformation ligne à ligne hors marché (case « Choisir
  les lignes » de la fenêtre de transformation : lignes décochées laissées en reliquat, quantité modifiable).
- Vérifié sur la base de démo : BL du marché (deux sections, numéros des commandes, pieds dans les sections, totaux des
  deux commandes), refus du BL direct, documents en attente du fournisseur, ajout d'un second BL à une facture
  brouillon (deux sections, deux sources), bouton et composantes dans la page.

### Lot 6a – avancement : saisie, précédents, création depuis le marché (16/10/2026)

- Q24 : règle d'avancement dans les deux `MoteurDocument` (jeux `10_avancement_periode.json`, `11_avancement_cumul.json`,
  valeurs vérifiées à la main) : saisie en % (P), quantité (Q) ou montant (M) cumulés, référence = montant (le % pour une
  ligne sans prix), les deux autres valeurs déduites ; situation : quantité et montant cumulés ; facture d'avancement :
  cumul − précédent (une période négative est possible : retour en arrière). Le % est enregistré (analyses).
- Q25, Q31 : situations et factures d'avancement créées depuis la fiche du marché (toutes ses commandes validées) ; une
  facture créée depuis une situation reprend son avancement ; précédent = dernier document d'avancement validé non
  annulé de la même ligne de commande (avenant tardif : précédent nul), relu à chaque enregistrement.
- Q27 : `LIGNE_DEPASSEE` (bloque la validation) sauf l'option « Dépassement autorisé » du marché, reportée sur le
  document.
- Grille : colonnes % préc., % cumul, Qté cumul, Montant cumul (saisissables, mode marqué ✎), Montant préc. ; un %
  saisi sur un titre ou une section s'applique à toutes ses lignes. Les colonnes du reste à solder ne s'affichent pas.
- Vérifié sur la base de démo : facture d'avancement du marché 4 (204 lignes suivies), 30 % sur la première commande
  → 38 131,85 € HT, validée ; facture suivante : précédent 30 %, période nulle.
- Reste au lot 6b : avoir automatique (Q26), facture à 0 et état comptable (13.9), révisions et numéro de situation
  (Q29), reprise d'un autre logiciel (13.11), bloc de déduction (13.7), lignes de pied en montant fixe (Q28, 13.10).

### Lot 6b – avoir d'avancement, révisions, reprise, déduction (16/10/2026)

- Q28, 13.10 : un poste de pied en montant de la commande (remise forfaitaire, port…) suit l'avancement : proposé au
  prorata de l'avancement global de sa portée (mode A), modifiable en % ou en montant cumulé, plafonné au montant de la
  commande (`LIGNE_DEPASSEE`) ; répliqué dans les deux moteurs (jeu `12_avancement_pied.json`). Corrige un défaut du lot
  6a (le poste était recopié en entier dans chaque facture).
- Q26 : une facture d'avancement dont la période est négative devient, à sa validation, un avoir d'avancement (type
  `V_AVOIR`, nature AVANCEMENT, numéro d'avoir) ; le facturé du marché le compte avec son signe ; il reste un précédent
  des factures suivantes.
- 13.9 : état comptable des pièces (à transférer, transférée, sans écriture si le total est nul), préparé pour le module
  Comptabilité. Proposer les marchés à facturer pour une période (13.9) : non fait (écran à concevoir).
- Q29 : numéro de situation par marché attribué à la validation (situations de référence d'un côté ; factures, avoirs
  d'avancement et reprises de l'autre), saisissable dans l'entête ; une situation validée se révise par un nouvel indice
  qui devient la référence, refusé si une facture non annulée en est issue (`SITUATION_FACTUREE`).
- 13.11 : reprise d'avancement (`V_REPRISE_AVT`, non comptable) créée depuis la fiche du marché : cumul déjà facturé dans
  un autre logiciel, compté comme précédent.
- 13.7 : bloc de déduction sous les totaux de l'entête (cumul HT, documents précédents déduits, période HT), figé à la
  validation d'une facture (`document_deduction`).
- Vérifié sur la base de démo : retour de 30 % à 20 % → période −12 710,63, avoir d'avancement AV2026-00002 à la
  validation, bloc de déduction affiché ; situation validée puis révisée (indice B de référence) ; reprise créée depuis
  le marché, refusée depuis une commande.

### Lot 7 – annulation en cascade (16/10/2026)

- Q30, 13.12 bis : « Annuler par avoir… » sur une facture ou un avoir d'avancement validé : la pièce et toutes les
  pièces d'avancement suivantes du marché (numéro de situation, puis ordre de création), non annulées, sont annulées en
  une transaction après confirmation (liste des pièces) ; chaque facture par un avoir d'annulation qui la reprend
  entièrement, chaque avoir d'avancement par un avoir d'avoir (extourne) ; toutes passent au statut Annulé, hors
  avancement (précédents, déductions, numéros de situation : la suivante reprend après la dernière valable) ; le
  facturé du marché revient au net ; la dernière situation qui avait servi est remise en cours (nouvel indice de
  référence, avancements conservés). Bloc de déduction : « Afficher les pièces annulées ». Hors marché : la pièce seule.
- Précision apportée au lot 6 : la saisie initiale d'une ligne d'avancement repart du montant précédent (référence),
  le % seulement pour une ligne sans prix — repartir du % arrondi pouvait décaler le montant d'un centime.
- Vérifié sur la base de démo : facture SI2026-00002 et avoir d'avancement AV2026-00002 annulés (AV2026-00003 et
  -00004), facturé du marché 0 ; facture issue d'une situation annulée → situation remise en cours (indice C).

**Analyse réalisée en entier (lots 1 à 7).** Points restants : voir TACHES.md.
