# Module Document – évolutions d'octobre 2026

> Demandes du 18/10/2026 et décisions prises avec l'utilisateur. Découpage en lots, chaque lot commité sur `main`
> avant le suivant. Les points marqués *(interprétation)* sont à confirmer à la réalisation du lot.

## Lot A – corrections de saisie et d'affichage (réalisé le 18/10/2026)

Au passage : la grille ne réagissait plus aux flèches, à Entrée, F2, Origine / Fin ni à la frappe directe en mode
ligne (`executer` supprimé par erreur avec les raccourcis personnalisables) ; rétabli.

1. **Entrée dans une cellule** : valide la saisie et passe en édition sur la ligne du dessous, dans la même colonne
   si elle y est modifiable ; ne crée jamais de ligne (création : Ctrl+Entrée, déjà existant).
2. **Valeurs « Préc. » perdues à la réouverture** des situations et factures d'avancement : les précédents n'étaient
   relus qu'à l'enregistrement ; un brouillon rouvert après la validation (ou l'annulation) d'un autre document
   d'avancement gardait les anciens, et la validation ne les relisait pas. Ils sont maintenant relus aussi à la
   lecture d'un document non verrouillé et à la validation.
3. **Boutons du plan du document écrasés** : la barre des boutons garde sa largeur minimale (le panneau ne la
   réduit pas en dessous de la taille des boutons).
4. **Bouton de mise en forme du libellé** : à la sélection d'une cellule de libellé, un bouton à gauche de la cellule
   ouvre la mise en forme (la même que le double-clic ou F2 ; en consultation sur un libellé non modifiable).

## Lot B – numérotation (réalisé le 18/10/2026)

Réalisation : `AVANCEMENT_NON_NUMEROTE` (`SpecialisationBtp.ControlerValidationAsync` : « antérieure » = créée avant,
identifiant plus petit) ; `DocumentService.ChangerNumero`, `PUT /documents/{id}/numero`, bouton « N°… » de la page
document (administrateur ; FORCER en numérotation continue) ; unicité vérifiée sur tous les types.

### Règle : facture d'avancement précédente numérotée

- Refus strict de la validation d'une facture d'avancement (et de son avoir d'avancement) si une facture d'avancement
  antérieure **du même marché** n'a pas son numéro comptable (`ent_numero`), quel que soit son statut ; but : pas de
  trou ni d'inversion dans la chronologie comptable.
- Les factures d'avancement à 0 sont exclues du contrôle.
- Pas de forçage : l'utilisateur numérote d'abord l'autre facture (changement de numéro ci-dessous).
- Données existantes non reprises (une base de démonstration propre sera recréée).

### Changement du numéro d'un document

- En brouillon : changement direct ; dans les autres états : par dévalidation (nouvel indice).
- Numérotation continue : droit FORCER avec motif ; interdit si la pièce est transférée en comptabilité (état T).
- Le numéro saisi suit le format du type (préfixe, exercice, rang) : on en extrait le rang.
- Unicité : un numéro déjà pris n'est jamais attribué ; on prend le prochain rang libre et on avertit l'utilisateur.
- Compteur : il pointe sur le **prochain rang libre** (les trous sont comblés, il peut donc redescendre) ; la règle du
  prochain libre vaut aussi pour la numérotation automatique.
- Les indices partagent le numéro : tous sont renommés ; l'historique garde l'ancien numéro (motif compris).

## Lot C – postes de pied HT et TTC (réalisé le 18/10/2026)

Réalisation : groupes vides affichés par l'éditeur (pas par les moteurs : calcul et parité inchangés) ; un poste TTC
dans une portée sans ventilation TVA ajoute d'abord la ligne TVA (sans elle, le moteur le calcule avant la TVA) ;
retenue de démonstration RG5 en % du cumul (TTC net) : la base TOTAL_TTC est le TTC du corps avant les postes HT.

- Les groupes « Postes HT » et « Postes TTC » sont toujours présents dans le pied du document, même vides (lignes
  virtuelles d'accueil), pour pouvoir y ajouter un poste ; un groupe vide n'est pas imprimé.
- Les règles en vigueur ne changent pas (`PIED_GLOBAL`, postes HT repris de la commande, documents d'avancement…).
- Nouveau type d'élément de bibliothèque **POSTE_PIED** : libellé, mode (% / montant / coefficient), base, sens,
  valeur, compte, retenue, TVA ; insertion dans le pied depuis la bibliothèque.

## Lot D – recharger les prix de la bibliothèque (Analyse › Éléments) (réalisé le 18/10/2026)

Réalisation : `rechargementPrix` (`analyse-calcul.js`, tests) et bouton « ⟳ Prix de la bibliothèque » de la partie
Éléments ; articles seulement (un ouvrage de la bibliothèque n'est pas rechargé : alerte) ; prix convertis dans
l'unité de la ligne (sans correspondance d'unité : alerte) ; lignes sans lien dont le code est inconnu : comptées.
Le tableau des prix fixes ci-dessous est appliqué tel quel.

- Bouton sur les éléments filtrés (filtres de l'analyse : nature, tranche…) ; seules les lignes du devis concernées
  par le filtre sont mises à jour.
- Prix du jour (c'est une mise à jour des prix) ; les coefficients ne changent pas.
- Ligne sans lien vers la bibliothèque : rapprochement proposé par le code ; si l'utilisateur refuse, la ligne n'est
  pas mise à jour ; s'il accepte, le lien est refait.
- Aperçu des changements à confirmer avant application.
- *(interprétation)* Cas des prix fixes :

  | Ligne du document | Élément de la bibliothèque | Effet |
  |---|---|---|
  | prix calculé | PV calculé | PA rechargé, coefficients conservés |
  | prix calculé | PV fixe | PA et PV rechargés, coefficient de bénéfice recalculé |
  | PV fixe | PV calculé | PA rechargé, PV conservé, coefficient de bénéfice recalculé |
  | PV fixe | PV fixe | PA rechargé, PV de la ligne conservé, alerte (prix fixe en bibliothèque) |

## Lot E – textes d'introduction et de conclusion (réalisé le 18/10/2026)

Réalisation : colonnes `ent_texte_intro_html` / `ent_texte_intro`, `ent_texte_fin_html` / `ent_texte_fin` et modèles
`tyd_texte_*_html` (module Document, `019g`) ; texte affiché calculé par les deux moteurs (mêmes références que les
libellés, au niveau du document) et figé avec les libellés ; à la transformation, texte de la source, sinon modèle du
type cible. Saisie dans l'entête (section « Textes de l'édition »), modèles dans `/parametres/documents`.

- Deux textes multilignes avec mise en forme et variables (comme les libellés des lignes) : avant le bloc des lignes,
  et après le pied et les tableaux récapitulatifs (marché, factures ou situations) ; placement détaillé avec le
  module d'impression.
- Modèle par défaut (par type de document) recopié dans le document à la création, puis modifiable.
- Variables figées à la validation ; une dévalidation force leur recalcul.
- Repris par défaut à la transformation.

## Lot F – adresse des travaux / de livraison

- Trois blocs de coordonnées figées : client, payeur, adresse des travaux (ventes) ou de livraison (achats), dans
  `ent_adresse_livraison` (colonne existante du module, même forme que `ent_contact_client`).
- Contenu : adresse, contact sur place, téléphone, instructions de livraison.
- Payeur et adresse des travaux restent **vides** s'ils sont identiques au client (comparaison à l'enregistrement) ;
  le payeur n'est plus pris d'office égal au client.
- Valeurs par défaut : document parent, puis chantier. Changement de chantier : le bloc n'est remplacé que s'il est
  vide ; avertissement si l'adresse diffère de celle du chantier.
- Chantier : ajout d'un contact sur place (le client ou un salarié, pour les livraisons).
- Achats, choix de l'adresse de livraison : chantier, dépôt de l'entreprise (agences de notre société dans
  l'annuaire), retrait au comptoir (adresse du fournisseur ou d'une de ses agences, mention « Retrait au comptoir »),
  saisie libre.
- Obligatoire à la validation des commandes d'achat seulement ; information ailleurs.
