# Règles des documents : globales, par famille, par type

Analyse du module Document et de sa spécialisation BTP (17/10/2026). Objectifs :

1. **Recenser** les règles déjà programmées, à trois niveaux : **global** (tout document), **famille** (ventes V,
   achats A, stock S) et **type** (devis, commande, BL, facture, avoir, situation…), avec l'endroit où elles vivent ;
2. **vérifier** ce comportement (incohérences relevées au § 5) ;
3. **proposer** les règles qui manquent et une façon de les paramétrer (§ 6), puis les points à décider (§ 7).

Légende de l'état : **✔** programmé · **⚠** programmé mais à vérifier ou incohérent · **✚** proposé (non programmé).
Sigles des emplacements : *MD* module Document (`modules/document`), *Cœur* spécialisation BTP (`src/`, `client/`),
*Param.* paramétrage en base (`type_document`, `statut_document`, `transformation_autorisee`, `droit_document`,
`parametre_document`).

## 0. Demande (reprise fidèle)

> Complète l'analyse du module document pour ajouter les règles globales au document, à la famille (vente, achat) et au
> type de document (devis, factures, ...) afin de vérifier le comportement déjà programmé et d'ajouter des règles.

## 1. Paramétrage actuel des types (base de démonstration)

| Type | Libellé | Fam. | Préfixe | Num. continue | Stock | Handler | Avanc. | Validité | Avoir | Statuts |
|---|---|---|---|---|---|---|---|---|---|---|
| V_DEVIS | Devis client | V | DV | non | non | — | — | 30 j | — | BROUILLON, VALIDE, ACCEPTE, SOLDE, ANNULE, FACTURE |
| V_COMMANDE | Commande client | V | CC | non | non | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE, FACTURE |
| V_RECEPTION | Bon de livraison | V | BL | non | oui | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE, FACTURE |
| V_RETOUR | Bon de retour client | V | RC | non | oui | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |
| V_SITUATION | Situation de travaux | V | ST | non | non | — | S | — | — | BROUILLON, VALIDE, FACTURE, ANNULE |
| V_FACTURE_AVT | Facture d'avancement | V | SI | **oui** | non | FactureAvancement | F | — | V_AVOIR | BROUILLON, VALIDE, SOLDE, ANNULE |
| V_REPRISE_AVT | Reprise d'avancement | V | RA | non | non | — | R | — | — | BROUILLON, VALIDE, ANNULE |
| V_FACTURE | Facture | V | FA | **oui** | non | — | — | — | (V_AVOIR par transformation) | BROUILLON, VALIDE, SOLDE, ANNULE |
| V_AVOIR | Avoir | V | AV | **oui** | non | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |
| V_DEMANDE_ACOMPTE | Demande d'acompte | V | DAC | non | non | — | — | — | — | BROUILLON, VALIDE (terminal), ANNULE |
| V_FACTURE_ACOMPTE | Facture d'acompte | V | FAC | **oui** | non | — | — | — | V_AVOIR | BROUILLON, VALIDE (terminal), ANNULE |
| V_RECU_ACOMPTE | Reçu d'acompte | V | RAC | non | non | — | — | — | — | BROUILLON, VALIDE (terminal), ANNULE |
| A_DEVIS | Demande de prix | A | DF | non | non | — | — | 30 j | — | BROUILLON, VALIDE, ACCEPTE, SOLDE, ANNULE |
| A_COMMANDE | Commande fournisseur | A | CF | non | non | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE, FACTURE |
| A_RECEPTION | BL fournisseur | A | RF | non | oui | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE, FACTURE |
| A_RETOUR | Bon de retour fournisseur | A | RR | non | oui | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |
| A_FACTURE | Facture fournisseur | A | FF | non | non | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |
| A_FACTURE_AVT | Situation fournisseur | A | SF | non | non | FactureAvancement | F | — | A_AVOIR | BROUILLON, VALIDE, SOLDE, ANNULE |
| A_AVOIR | Avoir fournisseur | A | AF | non | non | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |
| S_DEMANDE … S_INVENTAIRE | Stock (6 types) | S | DA, RS, ES, SS, TS, BI | non | ES, SS, TS, BI | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |

Transformations autorisées (`transformation_autorisee`, étape et étapes couvertes) :

| Source | Cibles |
|---|---|
| V_DEVIS | V_COMMANDE (COMMANDE), V_FACTURE (FACTURATION, vaut COMMANDE + RECEPTION, **par une commande intermédiaire**), A_COMMANDE (COMMANDE) |
| V_COMMANDE | V_RECEPTION, V_FACTURE (vaut RECEPTION), V_SITUATION, V_FACTURE_AVT, V_REPRISE_AVT, A_COMMANDE |
| V_RECEPTION | V_FACTURE, V_RETOUR |
| V_SITUATION | V_FACTURE_AVT |
| V_FACTURE | V_AVOIR |
| V_DEMANDE_ACOMPTE | V_FACTURE_ACOMPTE, V_RECU_ACOMPTE |
| A_DEVIS | A_COMMANDE, A_FACTURE (vaut COMMANDE + RECEPTION) |
| A_COMMANDE | A_RECEPTION, A_FACTURE (vaut RECEPTION), A_FACTURE_AVT |
| A_RECEPTION | A_FACTURE, A_RETOUR |
| A_FACTURE | A_AVOIR |
| S_DEMANDE | S_RESERVATION, A_COMMANDE ; S_RESERVATION → S_SORTIE |

Droits (`droit_document`) : ADMIN a tout (CREER, MODIFIER, VALIDER, TRANSFORMER, SUPPRIMER) ; SAISIE n'a que CREER,
MODIFIER, TRANSFORMER (ni VALIDER ni SUPPRIMER). Propriétés (`propriete_definition`) : V_DEVIS seul (chantier
obligatoire, mode de règlement, lot technique de ligne).

## 2. Règles globales (tout document)

### 2.1 Cycle de vie

| N° | Règle | Où | État |
|---|---|---|---|
| G1 | Création en BROUILLON ; numéro attribué à la création, sauf numérotation continue (à la validation) ; compteur par type et exercice | MD `DocumentService.Creer`, `AttribuerNumero`, `compteur_numero` | ✔ |
| G2 | Enregistrement en un appel : recalcul serveur, écarts client / serveur détectés puis arbitrés (`calcul_cas_test`) | MD `Enregistrer`, `ComparateurCalcul` | ✔ |
| G3 | Verrouillage optimiste (`ent_version`, 409 VERSION) et verrou d'édition par fenêtre sans expiration (forcé par un administrateur) | MD `VerrouDocumentService` | ✔ |
| G4 | Statut modifiable (`std_modifiable`) ou verrouillé (`ent_verrouille`) : document modifiable ou non (`DOCUMENT_BLOQUE`, `DOCUMENT_VALIDE`) ; à l'écran, document figé = consultation seule (grille, détail, mise en forme du libellé) | MD `VerifierModifiable` ; `EditeurDocument.fige` | ✔ |
| G5 | Validation : contrôles (handler, spécialisation, base), calcul, statut VALIDE, verrouillage, fin de validité = aujourd'hui + jours, historique de l'état précédent | MD `ValiderDans` | ✔ |
| G6 | Tiers obligatoire à la validation (`TIERS_OBLIGATOIRE`), facultatif en brouillon | MD `ValiderDans` | ✔ |
| G7 | Indices A, B… d'un même groupe, un seul de référence (`DesignerReference`) ; copie = nouveau document indice A, lien COPIE | MD `CreerIndice`, `Copier` | ✔ |
| G8 | Suppression : droit SUPPRIMER, document modifiable, jamais une source de TRANSFORMATION (`DOCUMENT_LIE`) ; un brouillon issu d'une transformation part avec ses liens | MD `Supprimer` | ✔ |
| G9 | Historique : CREATION, MODIFICATION, VALIDATION, ANNULATION avec instantané compressé de l'état précédent | MD `Historiser` | ✔ |
| G10 | Annulation d'une pièce validée par un avoir de nature ANNULATION (les deux au statut ANNULE, lien ANNULATION) | MD `AnnulerParAvoirDans` | ✔ |
| G11 | Droits par profil et par type (CREER, MODIFIER, VALIDER, TRANSFORMER, SUPPRIMER) | MD `VerifierDroit` | ✔ |
| G12 | Date de fin de validité calculée mais **jamais exploitée** (pas d'alerte ni de statut « Expiré ») | — | ✚ (§ 6, R3) |
| G13 | Statuts SOLDE et FACTURE paramétrés mais **jamais posés** automatiquement (seuls ACCEPTE et ANNULE le sont) | — | ⚠ (§ 5, I3) |

### 2.2 Contenu et calcul

| N° | Règle | Où | État |
|---|---|---|---|
| G20 | Moteurs miroirs JS / C# (decimal, une seule fonction d'arrondi, demi vers l'infini), jeux de cas partagés | MD `MoteurDocument` ; Cœur `MoteurDevisBtp` | ✔ |
| G21 | Types de ligne : titres, ouvrages, éléments numérotés ; texte, sous-total, image, saut de page, pied, TVA, section non numérotés ; section à la racine seulement ; pied à la racine ou dans une section racine | MD `TL`, `SECTION_RACINE`, `PIED_RACINE` | ✔ |
| G22 | Type de prix hérité par la descendance (V, O option, M pour mémoire, A variante, F frais annexes sur un titre) | MD `HandlerStandard`, `TYPE_PRIX_HERITE` | ✔ |
| G23 | TVA par catégorie (normale, autoliquidée, intracom, exonérée) ; ligne de prix sans TVA en erreur (`TVA_MANQUANTE`) | MD | ✔ |
| G24 | Pied en tranches, bases (CUMUL, TOTAL_HT, HT_NET, TOTAL_TTC, LIGNE), pieds de section et pied global consolidé (pas de poste HT au pied global : `PIED_GLOBAL`) | MD | ✔ |
| G25 | Libellés figés dans un statut non modifiable (`libelles_figes`) | MD `entree` | ✔ |
| G26 | Nature obligatoire sur les lignes de prix pour valider (`NATURE_OBLIGATOIRE`) — **tous les types**, stock compris | Cœur `ControlerValidation` ↔ `controlesValidation` | ⚠ (§ 5, I6) |
| G27 | Écart d'arrondi, frais annexes, coefficient de prorata : règles du moteur BTP, sans distinction de type | Cœur | ✔ |

### 2.3 Transformation

| N° | Règle | Où | État |
|---|---|---|---|
| G30 | Seules les transformations paramétrées ; source validée (`SOURCE_NON_VALIDEE`), droit TRANSFORMER | MD `TransformationService` | ✔ |
| G31 | Tout le reliquat : toutes les lignes de prix reprises, à 0 quand plus rien ne reste ; une cible qui couvre plusieurs étapes ne reprend que le plus petit reste | MD `Preparer` | ✔ |
| G32 | Liens de lignes recalculés à chaque enregistrement de la cible ; solde à la validation (case ou seuils par famille) | MD `RecalculerLiens`, `EcrireSoldes` | ✔ |
| G33 | Options et variantes : choix obligatoire pour chaque unité (`OPTION_NON_TRAITEE`), tracé dans `lie_choix` | MD | ✔ |
| G34 | Type intermédiaire (devis → facture par une commande validée d'office) | MD `tra_intermediaire_tyd_id` | ✔ |
| G35 | Plusieurs sources : une section et un bloc de pied par source | MD `TransformerPlusieurs` | ✔ |
| G36 | Entête copié (rattachements, intervenants, coordonnées figées, condition de paiement) | MD `Dupliquer` ; Cœur `PreparerEntetePlusieurs` | ✔ |

### 2.4 Interface

| N° | Règle | Où | État |
|---|---|---|---|
| G40 | Vue de colonnes par défaut : par type et modèle, puis modèle, puis type, puis globale ; mémorisée dans le navigateur ; titres renommables | MD `vueParDefaut`, `GestionVuesDocument` | ✔ |
| G41 | Document transformé : ouvrages repliés, libellés sur une ligne, cellules modifiables teintées | MD `EditeurDocument.estTransforme` | ✔ |
| G42 | Coordonnées figées du client et du payeur : prises d'office, rechargées par ⟳ | Cœur `ContactsDocument`, `PanneauxBtp.rendreContact` | ✔ |

## 3. Règles par famille

| N° | Règle | Ventes (V) | Achats (A) | Stock (S) | Où | État |
|---|---|---|---|---|---|---|
| F1 | Tiers du document (première ligne de l'annuaire du document) | client | fournisseur | — (aucun) | Cœur `fonctionTiers` | ⚠ stock : TIERS_OBLIGATOIRE bloque la validation (§ 5, I5) |
| F2 | Seuils de solde automatique | vente | achat | vente (par défaut) | MD `SeuilsSolde` | ⚠ stock non distingué |
| F3 | Condition de paiement par défaut | `conditions_paiement.vente` | `.achat` | — | MD `EcheancierDocument` | ✔ |
| F4 | Compte comptable hérité de la nature | `nat_compte_vente` | `nat_compte_achat` | — | Cœur `comptes.js` | ✔ |
| F5 | Coordonnées figées | client + payeur | fournisseur | — | Cœur | ✔ |
| F6 | Sens du document (`tyd_sens` 1, 2, 3) | — | — | — | Param. | ⚠ colonne non utilisée (§ 5, I7) |
| F7 | Mouvement de stock (`tyd_mouvemente_stock`) | BL, retour | BL, retour | entrées, sorties… | Param. | ⚠ non utilisé, pas de module Stock (§ 5, I7) |
| F8 | Pièce comptable : état comptable, échéancier | factures, avoirs (numérotation continue) | **aucune** (numérotation non continue) | — | MD `ValiderDans` | ⚠ (§ 5, I1) |
| F9 | Marché, avancement, retenue de garantie, acomptes | oui | situation fournisseur seulement | — | Cœur | ✔ ventes / ✚ achats (sous-traitance) |
| F10 | Facturé du marché / de la structure (`v_facturation_document`) | factures, factures d'avancement, d'acompte, avoirs | — | — | Cœur db/174 | ✔ |
| F11 | Règlements : sens E (encaissement) / D (décaissement) | E | D | — | Cœur `SpecialisationReglementBtp` | ✔ (échéances des achats absentes, I1) |

## 4. Règles par type

| Type | Règles propres programmées | Où | État |
|---|---|---|---|
| Devis (V_DEVIS, A_DEVIS) | Validité 30 jours par défaut ; transformation en commande → source au statut ACCEPTE ; V_DEVIS : propriété « chantier » obligatoire (texte) | Param., MD | ⚠ propriété chantier redondante avec le rattachement (§ 5, I8) |
| Commande client (V_COMMANDE) | Marché obligatoire à la validation (`MARCHE_OBLIGATOIRE`), sauf commande intermédiaire ; inscription au marché (base, avenants) ; modèle de pied du marché ; BL, situation, facture d'avancement d'une commande de marché créés depuis le marché (`MARCHE_CREATION`) | Cœur | ✔ |
| BL / retour (V_, A_RECEPTION, RETOUR) | Composantes d'ouvrage non saisissables (livraison des composantes) ; retour = quantités négatives au signe près | Cœur, MD | ✔ |
| Situation (V_SITUATION) | État cumulé non comptable (présentation C) ; liens à quantité 0 ; numéro de situation (création, validation) ; saisie reprise de la dernière situation ; révision par indice (`SITUATION_FACTUREE` si facturée) ; transformée en facture d'avancement du delta ; lignes du parent verrouillées, ajout de texte ou de pied | MD, Cœur | ✔ |
| Facture d'avancement (V_FACTURE_AVT) | Période = cumul − précédent ; dépassement selon le marché (`LIGNE_DEPASSEE`) ; période négative → avoir d'avancement ; déductions des précédents figées ; postes du marché et retenue ; déductions d'acompte | MD, Cœur | ✔ |
| Reprise d'avancement (V_REPRISE_AVT) | Non comptable, compte comme précédent des factures | MD | ✔ |
| Facture (V_FACTURE) | Numérotation continue ; état comptable ; échéancier ; postes du marché (retenue) si rattachée à un marché | MD, Cœur | ✔ |
| Avoir (V_AVOIR) | Numérotation continue ; nature ANNULATION ou AVANCEMENT ; reprend les lignes de la pièce | MD | ✔ |
| Acomptes (DAC, FAC, RAC) | Demande → facture (mode CA, TVA du marché) ou reçu (trésorerie, exonéré) ; une ligne PV fixe, nature OUV | Cœur `Acomptes` | ⚠ la facture d'acompte reçoit la retenue de garantie du marché (§ 5, I2) |
| Facture fournisseur (A_FACTURE) | Aucune règle propre | — | ⚠ (§ 5, I1, I4) |
| Situation fournisseur (A_FACTURE_AVT) | Handler d'avancement, avoir A_AVOIR | MD | ⚠ pas de marché ni de numéro de situation côté achats |
| Stock (S_*) | Aucune règle propre (pas de module Stock) | — | ✚ |

## 5. Incohérences relevées (vérification du comportement programmé)

- **I1 – Pièce comptable = numérotation continue.** L'état comptable (`ent_etat_compta`), l'échéancier et les postes
  du marché des pièces comptables reposent sur `tyd_numerotation_continue`. Les factures
  et avoirs fournisseurs ne sont pas en numérotation continue (le numéro est celui du fournisseur) : ils n'ont donc
  **ni échéancier, ni état comptable**, et le module Règlements n'a pas d'échéances à payer. Proposition : une
  propriété distincte `tyd_comptable` (pièce comptable) ; la numérotation continue reste une règle de numérotation.
- **I2 – Retenue de garantie sur une facture d'acompte.** `PostesMarche.Portee` pose les postes globaux du marché sur
  toute facture de vente du marché hors avoirs, donc aussi sur `V_FACTURE_ACOMPTE`. Proposition : postes du marché
  sur les factures d'avancement et les factures simples seulement (règle de type, R10).
- **I3 – Statuts SOLDE et FACTURE jamais posés.** Une commande entièrement livrée et facturée reste VALIDE ; une
  situation facturée garde VALIDE (la fiche marché le déduit des liens). Proposition : statut calculé après chaque
  transformation et chaque solde (R4).
- **I4 – Référence externe des achats.** Le numéro du fournisseur n'est pas obligatoire sur une facture fournisseur, et
  rien n'empêche la double saisie d'une même facture (même fournisseur, même référence). Proposition : R12.
- **I5 – Tiers obligatoire pour le stock.** `TIERS_OBLIGATOIRE` s'applique à tout document, y compris aux mouvements de
  stock internes qui n'ont pas de tiers. Proposition : règle de famille « tiers obligatoire » (V, A oui ; S non).
- **I6 – Nature obligatoire partout.** La nature des lignes de prix est exigée à la validation de tout type, y compris
  une demande d'acompte (contournée en posant la nature OUV) et le stock. Proposition : règle de type (R11).
- **I7 – Paramètres sans effet.** `tyd_sens` et `tyd_mouvemente_stock` sont paramétrés mais lus nulle part.
  Proposition : les garder pour le module Stock et le sens des mouvements, et le documenter ; ou les retirer.
- **I8 – Propriété « chantier » du devis.** Propriété d'entête obligatoire (texte) antérieure au rattachement à la
  structure (`ent_chantier_id`) : double saisie, et un devis rattaché à un chantier peut encore être refusé si le
  texte est vide. Proposition : retirer la propriété (ou la rendre facultative).
- **I9 – Droits du profil SAISIE.** Pas de droit VALIDER : un utilisateur de saisie ne valide ni un BL ni une situation.
  À confirmer (Q4).
- **I10 – Validité sans effet.** La fin de validité d'un devis est calculée à la validation mais rien ne la surveille
  (G12).

## 6. Règles proposées et paramétrage

### 6.1 Principe

Chaque règle est **déclarée dans le code** (catalogue : code, libellé, niveau d'application, valeur par défaut) et
**paramétrée en base** à trois niveaux, le plus précis l'emportant : **global** → **famille** → **type**. Table
proposée `regle_document` (module Document) : `rdo_code`, `rdo_famille` (null = global), `rdo_tyd_id` (null = famille
ou global), `rdo_valeur` JSONB, `rdo_actif`. Lecture : `ReglesDocument.Valeur(code, type)` côté serveur, la définition
du type (`GET /types-document/{code}/definition`) transmettant les valeurs résolues au client. Les règles du cœur
(marché, BTP) s'ajoutent au même catalogue par la spécialisation. Une page « Règles des documents »
(`/parametres/documents`) les présente par niveau (héritée / redéfinie).

### 6.2 Catalogue proposé

| N° | Code | Règle | Niveau par défaut | Valeur proposée |
|---|---|---|---|---|
| R1 | `TIERS_OBLIGATOIRE` | Tiers exigé à la validation | famille | V, A : oui ; S : non (I5) |
| R2 | `NATURE_OBLIGATOIRE` | Nature des lignes de prix exigée à la validation | type | oui sauf acomptes et stock (I6) |
| R3 | `VALIDITE` | Durée de validité (jours) et alerte / statut « Expiré » à échéance | type | devis 30 j ; alerte dans les listes, refus de transformer un devis expiré (avertissement) |
| R4 | `STATUT_AUTO` | Statut calculé : SOLDE quand tout est transformé ou soldé, FACTURE quand tout est facturé | type | commandes, BL, devis, situations (I3) |
| R5 | `PIECE_COMPTABLE` | Pièce comptable : état comptable, échéancier, numéro définitif, non supprimable | type | factures, avoirs, factures d'avancement et d'acompte, ventes **et achats** (I1) |
| R6 | `NUMEROTATION` | Format du numéro (préfixe, exercice, longueur), continuité, attribution (création / validation) | type | actuel ; format paramétrable |
| R7 | `DATE_PIECE` | Date d'une pièce comptable : pas dans le futur, pas avant la dernière pièce du même type (chronologie de la numérotation continue) | famille | ventes : oui ; achats : non |
| R8 | `MONTANT_NUL` | Validation d'un document à total nul : refus, avertissement ou permis | type | facture : avertissement ; situation : permis (13.9) |
| R9 | `MODIFICATION_APRES_VALIDATION` | Champs modifiables sur un document validé (rattachement, commentaire, coordonnées, échéancier) | global | rattachement, échéancier, commentaires |
| R10 | `POSTES_MARCHE` | Types qui reçoivent les postes du marché (retenue, paiement direct) | type | V_FACTURE_AVT, V_FACTURE (I2) |
| R11 | `LIGNES_AUTORISEES` | Types de lignes permis à la saisie (ex. situation : texte et pied ; BL : pas de nouvelle ligne de prix hors commande ?) | type | situation, facture d'avancement : texte, pied |
| R12 | `REFERENCE_EXTERNE` | Référence externe obligatoire et unique par tiers | type | A_FACTURE, A_AVOIR : obligatoire et unique (I4) ; V_COMMANDE : obligatoire si marché public ? |
| R13 | `REMISE_MAX` | Remise de ligne ou de pied au-delà d'un seuil : avertissement, ou droit ADMIN | famille | ventes : 15 % ? |
| R14 | `MARGE_MIN` | Marge nette sous un seuil à la validation d'un devis : avertissement | type | V_DEVIS |
| R15 | `ENCOURS_CLIENT` | Encours du client (factures non réglées + commandes en cours) au-delà de `per_cli_encours_max` : avertissement à la validation d'une commande ou d'une facture | famille | ventes (module Règlements) |
| R16 | `PRIX_ACHAT_ECART` | Facture fournisseur : prix différent de la commande au-delà d'un % : avertissement (rapprochement) | type | A_FACTURE |
| R17 | `QUANTITE_DEPASSEE` | Quantité transformée au-delà du reste du parent : refus, avertissement ou permis | type | BL, factures : avertissement ; avancement : `LIGNE_DEPASSEE` existant |
| R18 | `TRANSFORMATION_STATUT` | Statuts de la source qui permettent la transformation (ex. devis ACCEPTE seulement) | type | devis : VALIDE ou ACCEPTE |
| R19 | `INDICE` | Indices permis (devis : oui ; pièces comptables : non) | type | devis, commandes, situations |
| R20 | `SUPPRESSION_BROUILLON` | Brouillon supprimable par son auteur seul, ou par tout utilisateur ayant le droit | global | droit SUPPRIMER |

Chaque règle à effet « avertissement » s'affiche dans les contrôles de la page document (sans bloquer) et est tracée
dans l'historique de validation ; un « refus » est une erreur de validation (code stable, comme les autres).

## 7. Points à décider

1. **Q1** – Paramétrage des règles : table `regle_document` à trois niveaux (§ 6.1), ou propriétés supplémentaires de
   `type_document` (plus simple, sans niveau famille) ?
2. **Q2** – `tyd_comptable` distinct de la numérotation continue (I1) : les factures et avoirs fournisseurs deviennent
   des pièces comptables (échéancier, état comptable, règlements à payer) ?
3. **Q3** – Statuts automatiques (R4) : SOLDE / FACTURE calculés, ou les retirer du paramétrage ?
4. **Q4** – Profil SAISIE : droit VALIDER sur les documents non comptables (BL, situations, commandes) ?
5. **Q5** – Propriété « chantier » du devis (I8) : retirée ?
6. **Q6** – Règles à effet bloquant ou d'avertissement : quelles règles du catalogue doivent pouvoir bloquer ?
7. **Q7** – Priorités de réalisation : proposition — R1, R2, R5, R10 (corrigent I1, I2, I5, I6), puis R4, R12, R3, R7,
   puis les contrôles de gestion (R13 à R17).
