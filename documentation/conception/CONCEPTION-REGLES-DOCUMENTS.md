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
| V_DEVIS | Devis client | V | DV | non | non | — | — | 30 j | — | BROUILLON, ENVOYE, VALIDE, ACCEPTE, SOLDE, ANNULE, FACTURE, FACTURATION |
| V_COMMANDE | Commande client | V | CC | non | non | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE, FACTURE, FACTURATION |
| V_RECEPTION | Bon de livraison | V | BL | non | oui | — | — | — | — | BROUILLON, ENVOYE, VALIDE, SOLDE, ANNULE, FACTURE, FACTURATION |
| V_RETOUR | Bon de retour client | V | RC | non | oui | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE |
| V_SITUATION | Situation de travaux | V | ST | non | non | — | S | — | — | BROUILLON, ENVOYE, VALIDE, FACTURE, ANNULE |
| V_FACTURE_AVT | Facture d'avancement | V | SI | **oui** | non | FactureAvancement | F | — | V_AVOIR | BROUILLON, ENVOYE, VALIDE, SOLDE, ANNULE |
| V_REPRISE_AVT | Reprise d'avancement | V | RA | non | non | — | R | — | — | BROUILLON, VALIDE, ANNULE |
| V_FACTURE | Facture | V | FA | **oui** | non | — | — | — | (V_AVOIR par transformation) | BROUILLON, ENVOYE, VALIDE, SOLDE, ANNULE |
| V_AVOIR | Avoir | V | AV | **oui** | non | — | — | — | — | BROUILLON, ENVOYE, VALIDE, SOLDE, ANNULE |
| V_DEMANDE_ACOMPTE | Demande d'acompte | V | DAC | non | non | — | — | — | — | BROUILLON, ENVOYE, VALIDE (terminal), ANNULE |
| V_FACTURE_ACOMPTE | Facture d'acompte | V | FAC | **oui** | non | — | — | — | V_AVOIR | BROUILLON, VALIDE (terminal), ANNULE |
| V_RECU_ACOMPTE | Reçu d'acompte | V | RAC | non | non | — | — | — | — | BROUILLON, VALIDE (terminal), ANNULE |
| A_DEVIS | Demande de prix | A | DF | non | non | — | — | 30 j | — | BROUILLON, ENVOYE, VALIDE, ACCEPTE, SOLDE, ANNULE |
| A_COMMANDE | Commande fournisseur | A | CF | non | non | — | — | — | — | BROUILLON, ENVOYE, VALIDE, SOLDE, ANNULE, FACTURE |
| A_RECEPTION | BL fournisseur | A | RF | non | oui | — | — | — | — | BROUILLON, VALIDE, SOLDE, ANNULE, FACTURE |
| A_RETOUR | Bon de retour fournisseur | A | RR | non | oui | — | — | — | — | BROUILLON, ENVOYE, VALIDE, SOLDE, ANNULE |
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
obligatoire, mode de règlement, lot technique de ligne). Un Module de gestion des droits complet est prévu plus tard.

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
| G9 | Historique : CREATION, MODIFICATION, VALIDATION, ANNULATION, DEVALIDATION avec instantané compressé de l'état précédent | MD `Historiser` | ✔ |
| G10 | Annulation d'une pièce validée par un avoir de nature ANNULATION (les deux au statut ANNULE, lien ANNULATION) | MD `AnnulerParAvoirDans` | ✔ |
| G11 | Droits par profil et par type (CONSULTER, CREER, MODIFIER, VALIDER, TRANSFORMER, SUPPRIMER, DEVALIDER) | MD `VerifierDroit` | ✔ |
| G12 | Date de fin de validité calculée mais **jamais exploitée** (pas d'alerte ni de statut « Expiré ») | — | ✚ (§ 6, R3) Ok traité |
| G13 | Statuts SOLDE et FACTURE paramétrés mais **jamais posés** automatiquement (seuls ACCEPTE et ANNULE le sont) | — | ⚠ (§ 5, I3) Ok traité|

### 2.2 Contenu et calcul

| N° | Règle | Où | État |
|---|---|---|---|
| G20 | Moteurs miroirs JS / C# (decimal, une seule fonction d'arrondi, demi vers l'infini), jeux de cas partagés | MD `MoteurDocument` ; Cœur `MoteurDevisBtp` | ✔ |
| G21 | Types de ligne : titres, ouvrages, éléments (numérotés) ; texte, sous-total, image, saut de page, pied, TVA, section (non numérotés) ; section à la racine seulement ; pied à la racine ou dans une section racine | MD `TL`, `SECTION_RACINE`, `PIED_RACINE` | ✔ |
| G22 | Type de prix hérité par la descendance (V vendu, O option, M pour mémoire, A variante, F frais annexes sur un titre) | MD `HandlerStandard`, `TYPE_PRIX_HERITE` | ✔ |
| G23 | TVA par catégorie (normale, autoliquidée, intracom, exonérée) ; ligne de prix sans TVA en erreur (`TVA_MANQUANTE`) | MD | Ok pour le moment mais sera complété avec le module comptabilité |
| G24 | Pied en tranches, bases (CUMUL, TOTAL_HT, HT_NET, TOTAL_TTC, LIGNE), pieds de section et pied global consolidé (pas de poste HT au pied global : `PIED_GLOBAL`) | MD | ✔ |
| G25 | Libellés figés dans un statut non modifiable (`libelles_figes`) | MD `entree` | Pourquoi seulement les libelle? |
| G26 | Nature obligatoire sur les lignes de prix pour valider (`NATURE_OBLIGATOIRE`) — **tous les types**, stock compris. Oui pour les analyse | Cœur `ControlerValidation` ↔ `controlesValidation` | ⚠ (§ 5, I6) |
| G27 | Écart d'arrondi : règles du moteur BTP, sans distinction de type. Frais annexes, coefficient de prorata : règles du moteur BTP, utilisation seulement en vente | Cœur | ✔ |

### 2.3 Transformation

| N° | Règle | Où | État |
|---|---|---|---|
| G30 | Seules les transformations paramétrées ; source validée (`SOURCE_NON_VALIDEE`), droit TRANSFORMER | MD `TransformationService` | ✔ |
| G31 | Tout le reliquat : toutes les lignes de prix reprises, à 0 quand plus rien ne reste ; une cible qui couvre plusieurs étapes ne reprend que le plus petit reste | MD `Preparer` | ✔ |
| G32 | Liens de lignes recalculés à chaque enregistrement de la cible ; solde à la validation (case ou seuils par famille) | MD `RecalculerLiens`, `EcrireSoldes` | ✔ |
| G33 | Options et variantes : choix obligatoire pour chaque unité (`OPTION_NON_TRAITEE`), tracé dans `lie_choix` | MD | ✔ |
| G34 | Type intermédiaire (devis → facture par une commande validée d'office) | MD `tra_intermediaire_tyd_id` | ✔ |
| G35 | Plusieurs sources : une section et un bloc de pied par source | MD `TransformerPlusieurs` | ✔ |
| G36 | Entête copié (rattachements, intervenants, coordonnées, condition de paiement) | MD `Dupliquer` ; Cœur `PreparerEntetePlusieurs` | Attention on peut modifier quelques éléments comme les coordonées, changé le tiers payeurs, mais le code du tiers reste figé |

### 2.4 Interface

| N° | Règle | Où | État |
|---|---|---|---|
| G40 | Vue de colonnes par défaut : par type et modèle, puis modèle, puis type, puis globale ; mémorisée dans le navigateur ; titres renommables | MD `vueParDefaut`, `GestionVuesDocument` | ✔ |
| G41 | Document transformé : ouvrages repliés, libellés sur une ligne, cellules modifiables teintées hors des cellules modifables uniquement pour les lignes de textes | MD `EditeurDocument.estTransforme` | ✔ |
| G42 | Coordonnées figées dans le document du client et du payeur : prises d'office, rechargées par ⟳ | Cœur `ContactsDocument`, `PanneauxBtp.rendreContact` | ✔ |

## 3. Règles par famille

| N° | Règle | Ventes (V) | Achats (A) | Stock (S) | Où | État |
|---|---|---|---|---|---|---|
| F1 | Tiers du document (première ligne de l'annuaire du document) | client | fournisseur | Société de la base | Cœur `fonctionTiers` | TIERS_OBLIGATOIRE bloque la validation (§ 5, I5) |
| F2 | Seuils de solde automatique | vente | achat | stock | MD `SeuilsSolde` | Ok traité |
| F3 | Condition de paiement par défaut | `conditions_paiement.vente` | `conditions_paiement.achat` | — | MD `EcheancierDocument` | ✔ |
| F4 | Compte comptable hérité de la nature | `nat_compte_vente` | `nat_compte_achat` | `nat_compte_stock` | Cœur `comptes.js` | ✔ |
| F5 | Coordonnées figées | client + payeur | fournisseur | Société de la base | Cœur | ✔ |
| F6 | Sens du document (`tyd_sens` 1, 2, 3) | — | — | — | Param. | ⚠ colonne non utilisée (§ 5, I7) |
| F7 | Mouvement de stock (`tyd_mouvemente_stock`) | BL, retour | BL, retour | entrées, sorties… | Param. | ⚠ non utilisé, pas de module Stock (§ 5, I7) |
| F8 | Pièce comptable : état comptable, échéancier | factures, avoirs (numérotation continue) | factures, avoirs (numérotation non continue) | Inventaire | MD `ValiderDans` | ⚠ (§ 5, I1) |
| F9 | Marché, avancement, retenue de garantie, acomptes | oui | situation fournisseur seulement | — | Cœur | ✔ ventes / ✚ achats (sous-traitance) |
| F10 | Facturé du marché / de la structure (`v_facturation_document`) | factures, factures d'avancement, d'acompte, avoirs | — | — | Cœur db/174 | ✔ |
| F11 | Règlements : sens E (encaissement) / D (décaissement) | E | D | — | Cœur `SpecialisationReglementBtp` | ✔ (échéances des achats absentes, I1) |

## 4. Règles par type

| Type | Règles propres programmées | Où | État |
|---|---|---|---|
| Devis (V_DEVIS, A_DEVIS) | Validité 30 jours par défaut modifiables dans les paramètres de la base ; transformation en commande → source au statut ACCEPTE ; V_DEVIS : propriété « chantier » obligatoire (texte) | Param., MD | ⚠ propriété chantier redondante avec le rattachement (§ 5, I8) |
| Commande client (V_COMMANDE) | Marché obligatoire à la validation (`MARCHE_OBLIGATOIRE`), sauf commande intermédiaire ; inscription au marché (base, avenants) ; modèle de pied du marché ; BL, situation, facture d'avancement d'une commande de marché créés depuis le marché (`MARCHE_CREATION`) | Cœur | ✔ |
| BL / retour (V_, A_RECEPTION, RETOUR) | Composantes d'ouvrage non saisissables (livraison des composantes) ; retour = quantités négatives au signe près | Cœur, MD | ✔ |
| Situation (V_SITUATION) | État cumulé non comptable (présentation C) ; liens à quantité 0 ; numéro de situation (création, validation) ; saisie reprise de la dernière situation ; révision par indice (`SITUATION_FACTUREE` si facturée) ; transformée en facture d'avancement du delta ; lignes du parent verrouillées, ajout de texte ou de pied | MD, Cœur | ✔ |
| Facture d'avancement (V_FACTURE_AVT) | Période = cumul − précédent ; dépassement selon le marché (`LIGNE_DEPASSEE`) ; période négative → avoir d'avancement ; déductions des précédents figées ; postes du marché et retenue ; déductions d'acompte | MD, Cœur | ✔ |
| Reprise d'avancement (V_REPRISE_AVT) | Non comptable, compte comme précédent des factures | MD | ✔ |
| Facture (V_FACTURE) | Numérotation continue ; état comptable ; échéancier ; postes du marché (retenue) si rattachée à un marché | MD, Cœur | ✔ |
| Avoir (V_AVOIR) | Numérotation continue ; nature ANNULATION ou AVANCEMENT ; reprend les lignes de la pièce | MD | ✔ |
| Acomptes (DAC, FAC, RAC) | Demande → facture (mode CA, TVA du marché) ou reçu (trésorerie, exonéré) ; une ligne PV fixe par taux de TVA, nature Prestation | Cœur `Acomptes` | ⚠ la facture d'acompte reçoit la retenue de garantie du marché (§ 5, I2) |
| Facture fournisseur (A_FACTURE) | Aucune règle propre | — | ⚠ (§ 5, I1, I4) |
| Situation fournisseur (A_FACTURE_AVT) | Handler d'avancement, avoir A_AVOIR | MD | ⚠ pas de marché ni de numéro de situation côté achats |
| Stock (S_*) | Aucune règle propre (pas de module Stock) | — | ✚ |

## 5. Incohérences relevées (vérification du comportement programmé)

- **I1 – Pièce comptable = numérotation continue.** L'état comptable (`ent_etat_compta`), l'échéancier et les postes
  du marché des pièces comptables reposent sur `tyd_numerotation_continue`. Les factures
  et avoirs fournisseurs ont une numérotation non continue comme les autres document. Le numéro du fournisseur sera saisie dans la référence externe : ils ont donc un échéancier, un état comptable et le module Règlements a deséchéances à payer.
- **I2 – Retenue de garantie sur une facture d'acompte.** `PostesMarche.Portee` pose les postes globaux du marché sur
  toute facture de vente du marché hors avoirs, donc aussi sur `V_FACTURE_ACOMPTE`. Proposition : postes du marché
  sur les factures d'avancement et les factures simples seulement (règle de type, R10). Ok
- **I3 – Statuts SOLDE et FACTURE jamais posés.** Une commande entièrement livrée et facturée reste VALIDE ; une
  situation facturée garde VALIDE (la fiche marché le déduit des liens). Proposition : statut calculé après chaque
  transformation et chaque solde (R4). Ok à faire
- **I4 – Référence externe des achats.** Le numéro du fournisseur n'est pas obligatoire sur une facture fournisseur, et
  rien n'empêche la double saisie d'une même facture (même fournisseur, même référence). Proposition : R12.
- **I5 – Tiers obligatoire pour le stock.** `TIERS_OBLIGATOIRE` s'applique à tout document, y compris aux mouvements de
  stock internes qui n'ont pas de tiers. On règle le problème en saisissant la société de la base pour le stock.
- **I6 – Nature obligatoire partout.** La nature des lignes de prix est exigée à la validation de tout type, y compris
  une demande d'acompte (contournée en posant la nature prestations) et le stock. Proposition : règle de type (R11).
- **I7 – Paramètres sans effet.** `tyd_sens` et `tyd_mouvemente_stock` sont paramétrés mais lus nulle part.
  Proposition : les garder pour le module Stock et le sens des mouvements, et le documenter. OK
- **I8 – Propriété « chantier » du devis.** Propriété d'entête obligatoire (texte) antérieure au rattachement à la
  structure (`ent_chantier_id`) : double saisie, et un devis rattaché à un chantier peut encore être refusé si le
  texte est vide. Proposition : retirer la propriété. OK 
- **I9 – Droits du profil SAISIE.** Pas de droit VALIDER : un utilisateur de saisie ne valide ni un BL ni une situation.
  À confirmer (Q4). Ok à pofiner dans le module de gestion des droits plus tard.
- **I10 – Validité sans effet.** La fin de validité d'un devis est calculée à la validation mais rien ne la surveille
  (G12). Alerte dans les listes, pas de refus de transformer un devis expiré mais un avertissement pour laisser l'utilisateur choisir

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
| R1 | `TIERS_OBLIGATOIRE` | Tiers exigé à la validation | famille | Tous : oui  |
| R2 | `NATURE_OBLIGATOIRE` | Nature des lignes de prix exigée à la validation | type | oui |
| R3 | `VALIDITE` | Durée de validité (jours) et alerte / statut « Expiré » à échéance | type | devis 30 j ; alerte dans les listes, pas de refus de transformer un devis expiré mais un avertissement pour laisser l'utilisateur choisir |
| R4 | `STATUT_AUTO` | Statut calculé : SOLDE quand tout est transformé ou soldé, FACTURATION dés le début de facturation et avant que tout soit facturé, FACTURE quand tout est facturé | type | commandes, BL, devis, situations (I3) |
| R5 | `PIECE_COMPTABLE` | Pièce comptable : état comptable, échéancier, numéro définitif, non supprimable | type | factures, avoirs, factures d'avancement et d'acompte, Inventaire, ventes, achats, stock (I1) |
| R6 | `NUMEROTATION` | Format du numéro (préfixe, exercice, longueur), continuité, attribution (création / validation) | type | actuel ; format paramétrable |
| R7 | `DATE_PIECE` | Date d'une pièce comptable : pas dans le futur, pas avant la dernière pièce du même type (chronologie de la numérotation continue) | famille | ventes : oui ; achats : oui (Mais on utilise 2 dates la date création du document et la date du fournisseur qui sera la date comptable) |
| R8 | `MONTANT_NUL` | Validation d'un document à total nul : avertissement ou permis | type | facture : avertissement ; situation : permis (13.9) |
| R9 | `MODIFICATION_APRES_VALIDATION` | Champs modifiables sur un document validé (rattachement, commentaire, coordonnées, échéancier) | global | rattachement, échéancier, commentaires | Il faudra dévérouiller le document avant
| R10 | `POSTES_MARCHE` | Types qui reçoivent les postes du marché (retenue, paiement direct) | type | V_FACTURE_AVT, V_FACTURE (I2) |
| R11 | `LIGNES_AUTORISEES` | Types de lignes permis à la saisie (ex. situation : texte et pied ; BL : tout est permit) | type | situation, facture d'avancement : texte, pied | Attention pas de suppression mais la fonction non éditable est permis
| R12 | `REFERENCE_EXTERNE` | Référence externe obligatoire et unique par tiers | type | A_FACTURE, A_AVOIR : pas obligatoire et avertissement si non unique (I4) ; V_COMMANDE : obligatoire si marché public Préférence au niveau du paramétrage de la base |
| R13 | `REMISE_MAX` | Remise de ligne ou de pied au-delà d'un seuil : avertissement, ou droit ADMIN | famille | ventes : 15 % OK Préférence au niveau du paramétrage de la base (si -1 alors pas de seuil) |
| R14 | `MARGE_MIN` | Marge nette sous un seuil à la validation d'un devis, facture : avertissement | type | V_DEVIS, V_FACTURE (en création sans origine) |
| R15 | `ENCOURS_CLIENT` | Encours du client (factures non réglées + commandes en cours) au-delà de `per_cli_encours_max` : avertissement à la validation d'une commande ou d'une facture | famille | ventes (module Règlements) | Ok un paramétrage à la base et une surcharge possible sur la fiche du tiers (si -1 alors pas de seuil)
| R16 | `PRIX_ACHAT_ECART` | Facture fournisseur : prix différent de la commande au-delà d'un % : avertissement (rapprochement) | type | A_FACTURE | Ok un paramétrage à la base par défaut aucune différence (si -1 alors pas de seuil)
| R17 | `QUANTITE_DEPASSEE` | Quantité transformée au-delà du reste du parent : refus, avertissement ou permis | type | BL, factures : avertissement ; avancement : `LIGNE_DEPASSEE` existant |
| R18 | `TRANSFORMATION_STATUT` | Statuts de la source qui permettent la transformation (ex. devis ACCEPTE seulement) | type | devis : VALIDE ou ACCEPTE |
| R19 | `INDICE` | Indices permis (devis : oui ; pièces comptables : non) | type | devis, commandes, situations |
| R20 | `SUPPRESSION_BROUILLON` | Brouillon supprimable par son auteur seul, ou par tout utilisateur ayant le droit | global | droit SUPPRIMER |

Chaque règle à effet « avertissement » s'affiche dans les contrôles de la page document (sans bloquer) et est tracée
dans l'historique de validation ; un « refus » est une erreur de validation (code stable, comme les autres).

## 7. Points à décider

1. **Q1** – Paramétrage des règles : table `regle_document` à trois niveaux (§ 6.1), ou propriétés supplémentaires de
   `type_document` (plus simple, sans niveau famille) ? à trois niveaux mêmes structure
2. **Q2** – `tyd_comptable` distinct de la numérotation continue (I1) : les factures et avoirs fournisseurs deviennent
   des pièces comptables (échéancier, état comptable, règlements à payer) ? Oui mais la référence est celle du fournisseur qui est différente du compteur interne.
3. **Q3** – Statuts automatiques (R4) : SOLDE / FACTURE calculés, ou les retirer du paramétrage ? Oui avec le cas de FACTURATION
4. **Q4** – Profil SAISIE : droit VALIDER sur les documents non comptables (BL, situations, commandes) ? OK et à approfondir avec le future module de gestion des droits.
5. **Q5** – Propriété « chantier » du devis (I8) : retirée ? Oui
6. **Q6** – Règles à effet bloquant ou d'avertissement : quelles règles du catalogue doivent pouvoir bloquer ? Voir si tout est clair avec les ajouts. On va quand Même créer une Exception pour un utilisateur type root (a définir dans le module gestion des droits) pour débloquer certaines situation avec une trace des modifications sans avoir à trifouiller la base.
7. **Q7** – Priorités de réalisation : proposition — R1, R2, R5, R10 (corrigent I1, I2, I5, I6), puis R4, R12, R3, R7,
   puis les contrôles de gestion (R13 à R17). Relire l'analyse avant et revalidation

## 8. Décisions intégrées et points restant à voir (17/10/2026)

Les décisions du § 7 et les annotations des tableaux sont reprises ci-dessous ; chaque point garde une **Proposition**
et attend sa **Décision**. Les points P1 à P5 changent le cycle de vie : à trancher avant tout développement.

### 8.1 Cycle de vie

**P1 – Statut ENVOYE.** Ajouté à la plupart des types, placé avant VALIDE dans le tableau du § 1. Une facture ne
s'envoie pourtant qu'une fois validée et numérotée.
- a) ENVOYE après VALIDE pour les pièces comptables et les situations (envoi au client), avant VALIDE pour un devis ou
  une demande de prix (proposition envoyée, encore modifiable ?) ;
- b) ENVOYE posé par le futur module Mail (pièce jointe envoyée) ou à la main (bouton « Marquer envoyé ») ;
- c) un document ENVOYE est-il modifiable (devis renvoyé après correction = nouvel indice ?).

**Proposition** : ENVOYE toujours après VALIDE (non modifiable) ; posé à la main ou par le module Mail ; un devis à
corriger après envoi passe par un indice.

**Décision** : ENVOYE = validé par l'entreprise (document émis), VALIDE = validé par le tiers : ordre ENVOYE puis VALIDE. Une validation interne de l'entreprise, facultative, peut s'ajouter avant l'envoi (voir P17).

**P2 – Dévalidation (droit DEVALIDER, historique DEVALIDATION).** Ajoutée au § 2 (G9, G11) et liée à R9 (« il faudra
déverrouiller le document avant »).
- a) types permis : documents non comptables seulement (devis, commande, BL, situation…) ; une pièce comptable ne se
  dévalide jamais (avoir) ;
- b) conditions : aucun document aval (transformation), ou seulement des brouillons ? Commande inscrite au marché :
  dévalidable tant qu'aucun BL ni situation n'est validé ?
- c) effets : retour BROUILLON, déverrouillage, retrait des soldes écrits (`document_ligne_solde`), de l'inscription au
  marché, des déductions et des échéances ; numéro conservé ;
- d) R9 : les champs permis (rattachement, commentaires, coordonnées, échéancier) se modifient-ils sans dévalidation, ou
  la dévalidation est-elle toujours nécessaire ?

**Proposition** : a) oui ; b) aucun document aval validé (les brouillons aval sont signalés) ; c) oui, tracé dans
l'historique avec un motif ; d) les champs de R9 restent modifiables sans dévalider (comme le rattachement aujourd'hui),
tout le reste demande la dévalidation.

**Décision** : dévalidation possible sur tous les documents, pièces comptables comprises (ex. un client veut corriger le nom de facturation : avec l'accord du comptable, la pièce est déverrouillée) ; droit distinct de très haut niveau, réservé à peu de personnes, toujours tracé (voir P18).

**P3 – Exception « root » (Q6).** En attendant le module de gestion des droits : un droit FORCER réservé au profil
ADMIN (passer outre une règle bloquante, dévalider une pièce à titre exceptionnel), motif obligatoire, trace dans
l'historique (type FORCAGE). Une pièce transférée à la comptabilité (`ent_etat_compta` = T) reste-t-elle intouchable
même ainsi ?

**Proposition** : oui pour FORCER (ADMIN, motif obligatoire) ; une pièce transférée reste intouchable.

**Décision** : retenue (droit FORCER, ADMIN, motif obligatoire, trace ; pièce transférée intouchable).

**P4 – Statuts automatiques (R4, Q3, FACTURATION).** Une règle par type et un ordre de priorité sont nécessaires :

| Type | FACTURATION | FACTURE | SOLDE |
|---|---|---|---|
| Devis | une partie facturée (directement ou par commande) | tout facturé | tout transformé (commandé) ou soldé |
| Commande | début de facturation | tout facturé | tout livré ou soldé, facturation non commencée |
| BL | début de facturation | tout facturé | — |
| Situation | — | facturée (déjà déduit des liens) | — |

Questions : FACTURE l'emporte sur SOLDE ; ACCEPTE (devis) reste jusqu'au premier statut automatique ; un avoir ou une
annulation fait revenir le statut (recalcul) ; quels statuts sont terminaux ?

**Proposition** : statut recalculé après chaque validation d'un document aval, solde, avoir ou annulation ; ordre
VALIDE / ACCEPTE < SOLDE < FACTURATION < FACTURE ; statuts non modifiables ; seuls FACTURE et ANNULE sont terminaux.

**Décision** : FACTURATION prime sur SOLDE. Les devis gardent VALIDE, sauf la facturation directe (FACTURATION / FACTURE) ; commandes et BL prennent les statuts automatiques. Factures : statuts PAYE_PARTIEL et PAYE liés au module Règlements (voir P19).

**P5 – Résultat figé (G25 : « pourquoi seulement les libellés ? »).** Un document validé est recalculé à l'ouverture
par le moteur du navigateur (le serveur ne réécrit rien) ; seuls les libellés à variables sont figés, pour que le texte
ne change pas. Les montants affichés restent ceux enregistrés tant que le moteur ne change pas ; une nouvelle version du
moteur pourrait afficher d'autres montants que ceux validés.

**Proposition** : document validé = résultat enregistré affiché tel quel (pas de recalcul ; comparaison en mode débogage
seulement, écart signalé) : libellés, montants, totaux et TVA tous figés.

**Décision** : oui : on affiche ce qui a été validé, sans recalcul.

### 8.2 Règles nouvelles issues des annotations

**P6 – Tiers du stock (F1, F5, I5, R1).** Tiers obligatoire pour tous ; un document de stock a pour tiers notre société
(`per_societe_base`). **Proposition** : posé d'office à la création des documents de la famille S (non modifiable),
avec les coordonnées figées de notre société.

**Décision** : sans réponse : proposition retenue par défaut.

**P7 – Seuils de solde du stock (F2).** **Proposition** : `parametre_document.seuils_solde.stock` (même forme que vente
et achat), lu pour la famille S ; page `/parametres/documents` complétée.

**Décision** : sans réponse : proposition retenue par défaut.

**P8 – Compte de stock (F4).** **Proposition** : colonne `nat_compte_stock` de la nature (bibliothèque), compte hérité
par les lignes des documents de stock (`comptes.js`, futur module Comptabilité).

**Décision** : non : le module Stock définira l'article stocké dans la bibliothèque, dont la nature est déjà obligatoire ; pas d'exception à la nature obligatoire pour le stock (R2), pas de `nat_compte_stock`.

**P9 – Pièce comptable (R5, Q2, F8) et dates des achats (R7).** `tyd_comptable` : factures et avoirs (ventes, achats),
factures d'avancement et d'acompte, inventaire. À confirmer :
- échéancier et règlements : ventes et achats seulement (pas l'inventaire) ;
- état comptable (A / T / S) et non-suppression : toutes les pièces comptables ;
- numérotation continue réservée aux ventes ; achats : compteur interne non continu, référence externe = numéro du
  fournisseur ;
- deux dates pour les achats : date du document (saisie, chronologie interne) et date de la pièce du fournisseur = date
  comptable (`ent_date_externe`, nouvelle colonne) ; l'échéancier d'un achat part de la date du fournisseur.

**Proposition** : comme ci-dessus ; pour les achats, R7 contrôle seulement que la date du fournisseur n'est pas dans le
futur (la chronologie des pièces reçues n'est pas garantie).

**Décision** : sans réponse : proposition retenue par défaut.

**P10 – Acompte par taux de TVA.** « Une ligne PV fixe par taux de TVA, nature Prestation » : en mode chiffre
d'affaires, la demande d'acompte reçoit une ligne par taux de TVA du marché, au prorata du HT de chaque taux des
commandes. La nature « Prestation » n'existe pas encore (natures actuelles : MO, MAT, LOC, OUV, ISO, FABAT, AMO, ST).

**Proposition** : nature `PRE` « Prestations » (compte de vente 706000) créée par script ; répartition au prorata, la
dernière ligne prenant l'arrondi ; en trésorerie, une seule ligne exonérée.

**Décision** : retenue. De plus, une ligne d'ouvrage sans composante passe automatiquement en nature Prestation à la validation (voir P20).

**P11 – Frais annexes et prorata réservés aux ventes (G27).** **Proposition** : dans un document d'achat ou de stock,
colonnes et actions des frais annexes et du coefficient de prorata masquées, type de prix F refusé, coefficient de
prorata forcé à 1 (règle de famille transmise par l'entrée de calcul aux deux moteurs, avec un jeu de cas).

**Décision** : sans réponse : proposition retenue par défaut.

**P12 – Tiers figé à la transformation (G36).** Le client (ou le fournisseur) d'un document issu d'une transformation ne
change plus ; payeur, contacts et coordonnées restent modifiables. **Proposition** : première ligne de l'annuaire du
document (tiers) non modifiable dès qu'une ligne est liée à un parent ; refus serveur `TIERS_FIGE` si `ent_tiers_id`
change.

**Décision** : sans réponse : proposition retenue par défaut.

**P13 – Teinte des cellules (G41).** « Cellules modifiables teintées hors des cellules modifiables uniquement pour les
lignes de textes » : à préciser. Lecture proposée : teinter les cellules modifiables, **sauf** sur les lignes de texte
(dont tout le contenu est libre).

**Décision** : toutes les colonnes modifiables des lignes sont teintées (quantité, %, montant…) ; la colonne Libellé, modifiable seulement sur les lignes de texte, n'est jamais teintée.

**P14 – Paramètres de la base (R3, R12, R13, R15, R16).** Durée de validité des devis, référence externe obligatoire
des commandes de marché public, remise maximale (15 %), encours client (surchargé par `per_cli_encours_max` de la fiche
du tiers), écart de prix d'achat (0 %) ; -1 = pas de seuil. **Proposition** : ce sont des valeurs de règles au niveau
global ou famille du catalogue (§ 6.1), éditées dans une page « Règles des documents » ; la durée de validité reste
aussi modifiable par type.

**Décision** : sans réponse : proposition retenue par défaut.

**P15 – Marge minimale (R14).** Devis et factures créées sans origine (factures directes) : seuil de marge nette en %,
paramètre de la base, avertissement à la validation. **Proposition** : marge nette de l'onglet Analyse (PV remisé sans
frais annexes ni prorata − revient) / PV ; seuil -1 = pas de contrôle.

**Décision** : sans réponse : proposition retenue par défaut.

**P16 – Référence externe en double (R12).** **Proposition** : avertissement (non bloquant) à l'enregistrement et à la
validation si un autre document du même type et du même tiers porte la même référence externe, avec son numéro.

**Décision** : sans réponse : proposition retenue par défaut.

### 8.3 Ordre de réalisation (Q7, après relecture)

1. Socle des règles : table `regle_document` à trois niveaux, catalogue, lecture serveur et client, page de paramétrage
   (Q1, P14).
2. Cycle de vie : P1 ENVOYE, P2 dévalidation, P3 forçage, P4 statuts automatiques, P5 résultat figé.
3. Corrections : R10 / I2 (postes du marché), P9 pièce comptable et dates des achats, P6 tiers du stock, I8 propriété
   chantier retirée, P12 tiers figé.
4. Règles de saisie : P11 frais annexes en vente seulement, R11 lignes autorisées (déjà en partie), P10 acompte par taux.
5. Contrôles de gestion (avertissements) : R3 validité, R7 dates, R8 montant nul, R12 / P16 référence, R13 remise,
   R14 / P15 marge, R15 encours, R16 écart de prix, R17 quantité dépassée.

### 8.4 Points restant à voir après les réponses

**P17 – Validation entreprise, envoi, validation du tiers (suite de P1).** La nouvelle chaîne est BROUILLON →
(APPROUVE, validation interne facultative) → ENVOYE → VALIDE (tiers). Aujourd'hui, « Valider » verrouille le document,
attribue le numéro continu, écrit les soldes, l'échéancier, l'inscription au marché… et pose le statut VALIDE.
- a) Ce traitement (verrouillage, numéro, échéancier, soldes, marché) se fait à ENVOYE (validation de l'entreprise),
  ou à l'approbation interne quand elle est activée ? VALIDE (tiers) ne change plus le contenu ?
- b) Types qui attendent une validation du tiers : devis (acceptation), situation (visa du maître d'œuvre : fonction
  VALIDATION_SITUATION), commande fournisseur (accusé de réception) ; une facture ou un BL n'a pas de validation du
  tiers (reste ENVOYE) ?
- c) Le statut ACCEPTE du devis devient VALIDE (même sens) : ACCEPTE est retiré ?
- d) Transformation : depuis un document ENVOYE (ex. BL d'une commande envoyée) ou seulement VALIDE (ex. commande d'un
  devis accepté) ? Règle de type (R18) ?
- e) Validation interne : nom du statut (APPROUVE ?), activée par type (règle du catalogue), droit distinct (APPROUVER) ?
- f) Reprise des données existantes : les documents VALIDE actuels deviennent ENVOYE (ils ont été émis), les devis
  ACCEPTE deviennent VALIDE.

**Proposition** : a) tout le traitement actuel de validation se fait à ENVOYE (ou à APPROUVE si l'approbation est
activée pour le type) ; VALIDE ne touche plus au contenu ; b) comme listé, règle de type « validation du tiers » ; c) oui ;
d) R18 : commande depuis un devis VALIDE (ou ENVOYE avec avertissement), les autres depuis ENVOYE ; e) APPROUVE,
règle de type, droit APPROUVER ; f) oui, par script.

**Décision** : retenue, avec ces précisions : une facture aussi peut être rejetée (par la plateforme de réception ou par le tiers) ; ENVOYE signale qu'il reste une étape : la facture est ensuite validée (VALIDE) ou annulée par un avoir. Pas de script de reprise (base de développement) : seules les données de démonstration sont corrigées. Pas de blocage de la transformation selon le statut : transformer un document ENVOYE le passe d'office à VALIDE, statut que la règle des statuts automatiques peut ensuite recalculer (R18 sans objet).

**P18 – Dévalidation d'une pièce comptable (suite de P2).** La facture émise est en principe intangible (une erreur se
corrige par un avoir), et la facturation électronique (2026) transmet la facture par une plateforme : une fois transmise,
elle ne peut plus être modifiée.
- a) Champs modifiables après dévalidation d'une pièce comptable : entête non financier seulement (nom et adresse de
  facturation, références, commentaires), jamais les lignes ni les montants ?
- b) Accord du comptable : simple droit (le comptable dévalide lui-même), ou demande d'un utilisateur approuvée par un
  autre (deux personnes) ?
- c) Pièce transmise à une plateforme de facturation électronique ou transférée en comptabilité (état T) : dévalidation
  refusée ?
- d) Documents non comptables : effets de la dévalidation (retour BROUILLON, retrait des soldes, de l'inscription au
  marché…) et documents aval validés (refus, ou avertissement) ?
- e) Numéro conservé ; historique DEVALIDATION avec motif et instantané ; nouvelle validation obligatoire ensuite.

**Proposition** : a) oui, entête non financier seulement pour une pièce comptable ; b) droit DEVALIDER propre au
comptable, motif obligatoire (le circuit à deux personnes viendra avec le module de gestion des droits) ; c) refus ;
d) retour BROUILLON avec retrait des effets de la validation, refus si un document aval est validé ; e) oui.

**Décision** : en théorie oui, mais les factures aux particuliers ne passent pas par une plateforme. La dévalidation crée toujours l'indice suivant (B, C…), qui devient la référence sans retour possible à l'indice précédent ; tout devient modifiable, lignes comprises (une facture modifiée repasse par la validation interne du comptable). Déverrouiller une facture, ou un document dont un document aval est validé, est réservé au mode root (FORCER) pour débloquer une situation particulière, avec une trace dans l'historique : mieux vaut une solution prévue qu'une intervention directe dans la base (voir P22 et P23).

**P19 – Statuts de paiement des factures (suite de P4).** PAYE_PARTIEL et PAYE sont posés par le module Règlements
(facultatif) d'après le reste à payer des échéances (pointages, cautions sur les retenues) : sans le module, ces
statuts ne sont jamais posés. Questions : une retenue de garantie non libérée laisse-t-elle la facture PAYE_PARTIEL
(proposition : PAYE quand tout est réglé hors retenues, retenue suivie à part) ; la suppression d'un règlement fait
revenir le statut ; ANNULE l'emporte toujours.

**Proposition** : comme ci-dessus ; statut recalculé à chaque enregistrement ou suppression de règlement ou de caution
(point d'accroche du module Règlements).

**Décision** : retenue.

**P20 – Ouvrage sans composante en prestation (suite de P10).** À la validation, un ouvrage sans composante prend la
nature Prestation : seulement s'il n'a pas de nature (évite NATURE_OBLIGATOIRE), ou toujours (la nature saisie est
remplacée) ? Tous types, ou ventes seulement ?

**Proposition** : seulement s'il n'a pas de nature, toutes familles ; nature PRE créée par script (P10).

**Décision** : à la validation, un ouvrage sans composante devient un élément (type de ligne ELEMENT) de nature Prestation, même si une autre nature était saisie ; aucune ligne de prix sans nature (analyses). Voir P24.

**P21 – Statuts cumulés.** Un document porte un seul statut ; avec les nouvelles chaînes (ENVOYE / VALIDE,
FACTURATION / FACTURE, PAYE_PARTIEL / PAYE), une facture peut être à la fois validée par le client et partiellement
payée, une commande à la fois validée par le client et en facturation.

**Proposition** : le statut affiché est le plus avancé de la chaîne (ex. VALIDE < FACTURATION < FACTURE ;
ENVOYE < PAYE_PARTIEL < PAYE) ; les étapes franchies restent lisibles dans l'historique et dans des indicateurs
(`ent_valide_tiers_le`, état de facturation, état de paiement) pour les filtres des listes.

**Décision** : retenue.

### 8.5 Points restant à voir après les dernières réponses

**P22 – Indice créé par une dévalidation (suite de P18).**
- a) L'indice précédent (A) : statut REMPLACE (terminal, consultation seule), hors du facturé, des échéances et des
  restes ; il garde son numéro (le même numéro de pièce pour A et B, l'indice les distinguant) ?
- b) Documents et données qui pointaient sur A (documents aval, liens de lignes, soldes, échéances pointées par des
  règlements, déductions d'acompte, inscription au marché) : reportés sur B, ligne par ligne (correspondance A → B
  écrite à la création de l'indice) ?
- c) Pièce comptable : la nouvelle version repart en BROUILLON, puis APPROUVE (validation interne du comptable,
  obligatoire pour une pièce dévalidée même si l'approbation n'est pas activée pour le type), puis ENVOYE ?
- d) Une pièce déjà transférée en comptabilité (état T) : la nouvelle version repasse à « à transférer » (A), le transfert
  suivant portera l'extourne de l'ancienne version (futur module Comptabilité) ?

**Proposition** : a) oui ; b) oui, avec la correspondance des lignes enregistrée ; c) oui ; d) oui.

**Décision** : a), b), c) retenus ; d) non : une pièce déjà transférée en comptabilité reste « transférée » (T), le comptable passe lui-même les écritures de correction.

**P23 – Niveaux de droits (suite de P2, P3, P18).**
| Droit | Portée |
|---|---|
| APPROUVER | validation interne (APPROUVE) quand elle est activée pour le type ; obligatoire pour une pièce comptable dévalidée |
| DEVALIDER | document non comptable sans document aval validé (nouvel indice) |
| FORCER (root) | pièce comptable, document avec un document aval validé, passage outre une règle bloquante ; motif obligatoire, trace |

**Proposition** : ces trois droits, dans `droit_document` en attendant le module de gestion des droits (ADMIN seul
pour FORCER).

**Décision** : retenue.

**P24 – Ouvrage sans composante transformé en élément (suite de P20).**
- a) Montants : un ouvrage sans composante et un élément ne se calculent pas pareil (le prix d'un ouvrage vient de ses
  composantes, celui d'un élément de son PA et de ses coefficients) ; la conversion garde le PV de la ligne (PV fixe)
  pour que le total validé ne change pas ?
- b) Moment : à la validation de l'entreprise (ENVOYE, ou APPROUVE) de tous les types ; le lien vers la bibliothèque
  (ouvrage) est gardé ?
- c) Signalé dans les contrôles avant validation (« 3 ouvrages sans composante passeront en prestation ») ?

**Proposition** : a) oui, PV gardé en PV fixe, contrôle que le total ne change pas ; b) oui ; c) oui, avertissement.

**Décision** : retenue.

**P25 – Validation du tiers (VALIDE).** Posée à la main (bouton « Validé par le client / le fournisseur »), par la
transformation (P17), et plus tard par le retour de la plateforme de facturation électronique ; un rejet se traite par
un avoir d'annulation (statut ANNULE). Faut-il un statut REJETE intermédiaire (rejet reçu, avoir à faire), visible dans
les listes ?

**Proposition** : pas de statut REJETE : le rejet est noté dans l'historique avec son motif, et la pièce reste ENVOYE
jusqu'à l'avoir (alerte dans les listes « rejetée, à annuler »).

**Décision** : retenue (pas de statut REJETE).

### 8.6 Bilan

Toutes les questions (Q1 à Q7, P1 à P25) ont une décision ; les propositions sans réponse sont retenues par défaut. Le
développement suit l'ordre du § 8.3, complété par le cycle de vie décidé en P17 à P25 (APPROUVE facultatif, ENVOYE,
VALIDE du tiers, REMPLACE, statuts automatiques et de paiement, dévalidation par indice, droits APPROUVER, DEVALIDER,
FORCER). Données de démonstration à corriger (documents VALIDE → ENVOYE, devis ACCEPTE → VALIDE), sans script de reprise.

## 9. Réalisation

Développement lancé le 17/10/2026 (un commit par lot).

### Lot 1 – socle des règles

- `modules/document/db/019c` : `regle_document` (code, famille ou type, valeur JSON, active) ; catalogue dans le code
  (`CatalogueRegles.Module`, étendu par `SpecialisationBtp.Regles` : nature obligatoire, postes du marché, frais annexes,
  remise maximale, marge minimale, encours, écart de prix d'achat, référence des marchés publics).
- `ReglesDocuments` : valeur du type, sinon de la famille, sinon globale, sinon défaut ; valeurs résolues transmises
  dans la définition du type (`regles`), lues côté client par `regle(definition, code)`.
- `db/178` : valeurs initiales (§ 8) ; `TIERS_OBLIGATOIRE` lu par la validation.
- `/parametres/documents`, section « Règles des documents » : défaut et valeurs par niveau (combo Global / famille /
  type), ajout, retrait, enregistrement (administrateur).

### Lot 2 – cycle de vie et statuts automatiques

- `modules/document/db/019d` : étapes datées (`ent_approuve_le`, `ent_envoye_le`, `ent_valide_tiers_le`), état de paiement
  (`ent_etat_paiement` P / T), rejet (`ent_rejete_le`, `ent_rejet_motif`), actions d'historique (APPROBATION, ENVOI,
  VALIDATION_TIERS, DEVALIDATION, FORCAGE, REJET), droits CONSULTER, APPROUVER, DEVALIDER, FORCER ; `f_regle_document`
  (règle à trois niveaux en SQL) ; `f_document_statut` : statut le plus avancé parmi PAYE, PAYE_PARTIEL, FACTURE,
  FACTURATION, SOLDE, VALIDE, ENVOYE, APPROUVE (ANNULE, REMPLACE explicites) — facturation et livraison (SOLDE, documents
  à étape RECEPTION) d'après les liens signés des lignes de prix vendues vers les documents validés non annulés, plus
  les soldes (règle STATUTS_AUTO).
- `db/179` : statuts APPROUVE, ENVOYE, REMPLACE (tous les types), FACTURATION (devis, commandes, BL), PAYE_PARTIEL et
  PAYE (pièces à régler) ; terminaux FACTURE, PAYE, ANNULE, REMPLACE ; ACCEPTE retiré ; droits du cycle (ADMIN).
- Validation : approbation (règle APPROBATION) ou envoi ; sans validation du tiers attendue (règle VALIDATION_TIERS),
  validé aussitôt ; statut du document et de ses documents d'origine recalculé (validation, annulation par avoir).
  Routes `POST /documents/{id}/envoyer`, `/valider-tiers`, `/rejeter` ; une source envoyée transformée est validée par
  le tiers d'office.
- Module Règlements : `SpecialisationReglement.ApresPointageAsync` (échéances touchées) ; cœur : état de paiement hors
  retenue de garantie, statut recalculé.
- Correction : un document d'avancement n'écrit plus de soldes sur les lignes de la commande (soldes erronés retirés de
  la démo). Données de démonstration : documents validés envoyés, sources transformées validées par le tiers.
- Page document : bouton « Approuver » ou « Valider » selon la règle, « Envoyer », « Validé par le tiers », « Rejeté… ».

### Lot 3 – dévalidation par indice, droits, forçage, résultat figé

- `DocumentService.Devalider` (`POST /documents/{id}/devalider`, motif) : l'indice suivant (même numéro) devient la
  référence en brouillon, avec tout le contenu et les mêmes parents ; l'ancienne version passe à REMPLACE ; liens des
  lignes (aval et parents), liens de documents, soldes et échéances (pointages compris) reportés (`ReporterVersion`),
  données du cœur par `SpecialisationDocument.ReporterVersionAsync` (marché, déductions, acomptes) ; droit DEVALIDER,
  ou FORCER pour une pièce comptable ou un document dont un document aval est validé ; historique DEVALIDATION ou
  FORCAGE avec motif (`his_motif`). Une pièce déjà transférée reste transférée.
- Échéancier réécrit en place à la validation (une échéance pointée garde son identifiant).
- Règle INDICE : création d'indice refusée (`INDICE_INTERDIT`) sur les pièces comptables.
- Résultat figé (P5) : un document validé affiche ses valeurs enregistrées (`EditeurDocument.figerResultat`).
- Page document : bouton « Dévalider… » (droit DEVALIDER ou FORCER), ouverture de la nouvelle version.
- Vérifié : FA2026-00003 dévalidée (indice B, échéance pointable conservée), revalidée (ENVOYE).

### Lot 4 – corrections

- Pièce comptable par la règle PIECE_COMPTABLE (P9) : état comptable et, pour les ventes et les achats, échéancier
  (factures et avoirs fournisseurs compris) ; la numérotation continue reste une règle de numérotation.
- Date de la pièce du fournisseur (`ent_date_externe`, `modules/document/db/019e`, champ « Date fournisseur » de l'entête
  des achats) : départ de l'échéancier.
- Postes du marché par la règle POSTES_MARCHE (I2 : plus de retenue sur les factures d'acompte).
- Stock : tiers = notre société, posé à la validation (P6) ; contrôle du tiers après les compléments.
- Propriété « chantier » du devis retirée (I8, `db/180`, `db/110`).
- Tiers figé d'un document issu d'une transformation (P12) : refus serveur `TIERS_FIGE`, champ verrouillé dans
  l'annuaire du document.
- Vérifié : FF2026-00003 validée (état comptable A, échéance au 31/10 depuis la date du fournisseur), changement de tiers
  refusé sur FF2026-00002.

### Lot 5 – règles de saisie

- R11 : lignes ajoutables par la règle LIGNES_AUTORISEES (`EditeurDocument.lignesLimitees` : texte et pied seulement).
- P11 : frais annexes et coefficient de prorata réservés aux ventes (règle FRAIS_ANNEXES) : colonnes Prorata, Coef. FA,
  FA reçus et section des frais masquées, type de prix F non proposé ; refus à la validation
  `FRAIS_ANNEXES_INTERDITS` (`SpecialisationBtp.ControlerValidationAsync` ↔ `controlesValidation(lignes, regles)`).
  Contrôle à la validation plutôt que dans les moteurs : un document d'achat garde un calcul identique.
- P10 : acompte en mode chiffre d'affaires réparti par taux de TVA du marché (au prorata du HT des lignes vendues des
  commandes, arrondi sur la dernière), nature Prestation (`db/181`, code PRE).
- P20 / P24 : à la validation, un ouvrage sans composante devient un élément de nature Prestation ; si le total HT
  changeait, refus `OUVRAGE_PRESTATION_ECART`.
- Vérifié : acompte de 10 000 € en mode CA sur le marché de démo (5 630,32 à 10 %, 4 369,68 à 20 %, essai retiré) ;
  commande fournisseur avec un coefficient de prorata refusée (FRAIS_ANNEXES_INTERDITS).

### Lot 6 – contrôles de gestion

- Avertissements (non bloquants) : `GET /documents/{id}/avertissements?action=VALIDER|TRANSFORMER`
  (`DocumentService.Avertissements`, point d'accroche `SpecialisationDocument.AvertissementsAsync` avec les règles
  résolues du type) ; le client les affiche avant la validation et avant la transformation (page document et bouton des
  listes) et l'utilisateur choisit de poursuivre (`client/src/app/documents/avertissements.js`).
  - Module : R8 total nul (MONTANT_NUL), R12 / P16 référence externe en double pour le même type et le même tiers
    (REFERENCE_EXTERNE_UNIQUE), R17 quantité au-delà du reste du parent (QUANTITE_DEPASSEE = AVERTISSEMENT,
    `DocumentService.Depassements`), à la transformation R3 validité dépassée (VALIDITE_ALERTE) et P25 document rejeté.
  - Cœur : R13 remise de ligne ou de pied au-delà de REMISE_MAX, R14 / P15 marge nette (PV sans frais annexes ni
    prorata − revient) sous MARGE_MIN pour un document qui n'est pas issu d'une transformation, R15 encours du client
    (échéances non pointées des pièces validées + commandes en cours non facturées + ce document) au-delà du plafond de
    la fiche du tiers ou d'ENCOURS_CLIENT, R16 prix facturé différent de la commande au-delà de PRIX_ACHAT_ECART.
- Refus à la validation : R7 DATE_PIECE (`DATE_FUTURE` : date du document ou du fournisseur dans le futur ;
  `DATE_ANTERIEURE` : pièce à numérotation continue antérieure à la dernière pièce numérotée du type), R12
  REFERENCE_EXTERNE_OBLIGATOIRE, REFERENCE_MARCHE_PUBLIC (commande d'un marché public, `SpecialisationBtp`), R17
  QUANTITE_DEPASSEE = REFUS.
- Listes : colonne « Alerte » de `v_liste_documents` (`db/182` : « Rejeté, à annuler : motif », « Validité dépassée »
  pour un document approuvé ou envoyé si VALIDITE_ALERTE) ajoutée aux vues des documents ; DATE_PIECE activée pour les
  achats (date du fournisseur).
- Vérifié sur la démo : validité dépassée (liste et transformation de DV2026-00003), encours et marge avec des seuils
  d'essai (remis à -1), référence en double (FF2026-00003), quantité dépassée (essai remis), date future et antérieure,
  référence d'une commande de marché public refusées.

