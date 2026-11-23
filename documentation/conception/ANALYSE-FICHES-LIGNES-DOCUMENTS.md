# Analyse : fiches et lignes de documents (demande du 20/11/2026)

> Analyse brute. Questions ouvertes : [plans/fiches-lignes-documents-questions.md](plans/fiches-lignes-documents-questions.md).
> Plan par lots : à rédiger après les réponses (`plans/fiches-lignes-documents.md`).

## 1. Demande (texte de l'utilisateur)

Dans le module fiche :
- Ajouter un titre court pour les onglets en cas de manque de place.
- Dans les fiches de ressource, un lien vers la liste des derniers pointages de la ressource.

Dans les documents :
- Couleur et style (gras, souligné, italique…) par type de ligne (tranche 1..n, élément, ouvrage, composantes,
  sous-ouvrage, texte), sur toute la ligne. Valeur par défaut au départ ; sans surcharge dans le texte on prend la
  mise en forme du type, sinon la surcharge. On peut réimposer la mise en forme au global ou par ligne.
- Indication visuelle quand le prix d'achat d'une ligne diffère (plus ou moins) du prix en bibliothèque, avec la mise à
  jour de la bibliothèque directement (bouton sur l'icône d'indication).
- Zones supplémentaires sur les entêtes de document (global, par famille, par type).

## 2. Existant (constaté dans le code au 20/11/2026)

### 2.1 Onglets des fiches
- `modules/fiche/js/ui/fiche.js` : `sections` (onglets du programme, onglets spécifiques `ongletsSpecifiques()`,
  onglet des champs supplémentaires « x_ », Pièces jointes) rendus dans `nav.fiche-onglets` avec une pastille de
  compteur (synthèse). `fiche.css` : `.fiche-onglets { flex-wrap: wrap }` : sans place, les onglets passent à la ligne.
- Précédent dans le bandeau : libellé court `court` des menus quand la place manque (`navigation/menus.js`).

### 2.2 Ressources et pointages
- Fiches `salarie` (salariés et intérimaires) et `materiel` (cœur, `db/195`, `client/src/app/ressources/`).
- Liste des pointages : thème `pointages`, vue `v_liste_pointages` (`db/199`, `db/200`), colonnes `salarie_id`,
  `date_pointage`, `couche` (saisie / validée)… ; vues de liste `vuePointages` (`client/src/app/vues-liste.js`, 1010+).
- Pointage du matériel à la borne (`db/292`) : pas de colonne matériel dans `v_liste_pointages` (à vérifier au plan).

### 2.3 Types de lignes et mise en forme
- `type_ligne` (`modules/document/db/011`) : TITRE, OUVRAGE, ELEMENT, TEXTE, SOUS_TOTAL, IMAGE, SAUT_PAGE, PIED_HT,
  PIED_TTC, TVA, SECTION. « Tranche n » = titre de profondeur n ; « composante » = élément sous un ouvrage ;
  « sous-ouvrage » = ouvrage sous un ouvrage : ce sont des types **dérivés de la position**, pas des types en base.
- Libellé riche : `lig_libelle_html` (éditeur `editerLibelle` du socle, `formatLibre`, `htmlSur`) : la « surcharge
  dans le texte » existe déjà sous forme de balises dans le libellé.
- Mise en forme existante : étiquettes de lignes (`etiquette_ligne`, `ent_etiquettes`), couleur du type de prix
  (`couleur_type_prix`), italique des tranches F, teinte des cellules modifiables (`modules/document/db/013`).
- Règles des documents à trois niveaux (`regle_document`, `019c`/`019d`) : global, famille (V, A, S, E, T) ou type,
  le plus précis l'emporte : modèle réutilisable pour le paramétrage par niveau.

### 2.4 Prix d'achat et bibliothèque
- Ligne BTP : `lig_pa`, lien à l'élément par `lig_art_id` / `lig_proprietes.element.id`.
- Bibliothèque : scénarios de PA par élément (FIXE, FOURNISSEUR_PRINCIPAL, DERNIER_PA, MEILLEUR_MIN, MEILLEUR_MAX,
  PMP), tarifs fournisseurs (`modules/bibliotheque/db/065`).
- Envoi document → bibliothèque existant (`client/src/app/bibliotheque/envoi.js`, écritures par la fiche `element` :
  verrou, empreinte).
- Facture fournisseur : déjà un marqueur de couleur et le prix de référence en info-bulle quand le prix est modifié
  (DOCUMENT.md, Transformation et achats).

### 2.5 Zones supplémentaires
- Fiches : vraies colonnes nullables « x_ » créées depuis l'interface (`modules/fiche/db/1.1_champs_supplementaires`,
  registre `fiche_champ_supplementaire`, décision du 14/11/2026), limitées aux tables des fiches.
- Documents : `propriete_definition` (par type de document, niveau E entête / L ligne, types texte, entier, décimal,
  date, booléen, liste) et `ent_proprietes` JSONB, lus par `DocumentService` et le `HandlerStandard`, sans écran de
  paramétrage ni rendu générique dans l'entête ; portée par type seulement (ni global ni famille).

## 3. Points à trancher
Voir les questions ouvertes.
