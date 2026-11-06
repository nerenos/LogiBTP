# Module Bibliothèque – référence détaillée

Référence lue à la demande (hors contexte par défaut). Les règles que le code doit respecter sont dans [CLAUDE.md](../../modules/bibliotheque/CLAUDE.md) ; une règle modifiée l'est là, l'inventaire ici.

## Dépendances
- Dépend de : socle (`D`, `S`, `arr6`, `evaluerExpression`, `ErreurCalcul`, `texteBrut` ; `LogiBTP.Socle.Web`). Aucune dépendance au module Document ni au Métré : la composition est un JSON opaque pour le module.
- Utilisé par le cœur : `ElementsBibliotheque.cs` (prix des composés par `MoteurDevisBtp`, `AvantEcriture` de la fiche `element`), `SpecialisationBibliothequeBtp`, `Program.cs` ; client `app/bibliotheque/` (`bibliotheque.js`, `appel.js`, `envoi.js`, `donnees.js`), `fiches/fiche-element.js` (`FicheElement`), `pages/parametres-bibliotheque.js`, `pages/liste.js` (glisser vers un document). Image et notices : GED (`ele_image_ged`, `type_element: 'element'`).

## Structure
- `db/060_bibliotheque_schema.sql` : tables, triggers d'historique, paramètres, `v_famille_element` ; `061` : données techniques ; `062` : coefficients par période ; `063` : postes de pied ; `064` (rejouable) : `ele_mots_cles`, `ele_code_barre` (unique par bibliothèque), `ele_description_html`, `ele_delai_livraison`, type `TEXTE` (libellé seul, sans prix) ; `066` (rejouable) : genre des postes de pied.
- `js/src/calcul.js` : `calculerElement`, `prixAchat`, `ratio`, `convertir`, `codeAppel`, `analyserCodeAppel`, `coefficientsEffectifs`, `SCENARIOS_PA`, `GESTIONS`, `TYPES_NATURE`.
- `js/src/fournisseurs.js` : `FournisseurBibliothequeApi`, `FournisseurBibliothequeMemoire`, `ErreurBibliotheque`, `entreeDepuisLigne`, `SCENARIOS_TOUS`, `DONNEES_TECHNIQUES` (interface commune documentée en tête).
- `js/ui/referentiels.js` : `GestionReferentiels` (comptes des natures tenus par l'application) ; `onglets.js` : `OngletPrix`, `OngletUnites`, `OngletTarifs` ; `arbres.js` : `PanneauArbres` (filtres familles / natures de la liste) ; `bibliotheque.css`.
- `dotnet/LogiBTP.Bibliotheque` : `CalculElement`, `CoefficientsElement` (sans dépendance web).
- `dotnet/LogiBTP.Bibliotheque.Web` : `ServiceBibliotheque`, `SpecialisationBibliotheque`, `Donnees.cs` (entités, `BibliothequeDbContext`), `Extensions.cs`.

## Modèle de données
- `bibliotheque` (`bib_code` ≤ 10, un seul `bib_defaut`), `famille_element` (arbre par bibliothèque, code unique par bib), `regroupement_nature`, `nature_element` (+ `nat_isolant`, `nat_types` JSONB), `element` (`ele_*` ; unique `(ele_bib_id, ele_code)` ; `ele_unt_stock` obligatoire, `ele_unites` JSONB `[{ unite, formule }]` ; `ele_scenario_pa`, `ele_pa_fixe`, `ele_dernier_pa`, `ele_pmp`, `ele_pa`, `ele_coef_fg`, `ele_pr`, `ele_coef_benef`, `ele_pv`, `ele_pv_fixe`, `ele_coef_remise`, `ele_pv_net` ; `ele_composition` JSONB `{ mode, lignes, metres, variables }` (métrés en script) ; `ele_image_ged` sans FK ; `ele_proprietes` ; données techniques `ele_poids`… `ele_isolant_u` (dont `ele_longueur`, mm) ; `ele_coef_fg_impose`, `ele_coef_benef_impose`).
- `tarif_fournisseur` (`tfo_*`, un seul `tfo_principal` par élément, `tfo_tiers_id` = annuaire ; lot 8, `db/065` : `tfo_prix_public`, `tfo_remise1`, `tfo_remise2`, `tfo_delai`, `tfo_code_barre`, `tfo_prix` = prix net), `tarif_import` (journal des imports), `historique_prix_element` (`hpe_avant` / `hpe_apres` JSONB), `coefficient_periode` (`cop_nat_id` null = global, unique `(portée, cop_debut)`), `parametre_bibliotheque` (`scenario_defaut`, `scenarios_autorises`, `coef_fg_defaut`, `coef_benef_defaut`).
- Triggers : `tr_historique_prix_creation` (AFTER INSERT) et `tr_historique_prix_maj` (BEFORE UPDATE, compare `fn_prix_element`) ; auteur = `ele_maj_par`, commentaire = `ele_commentaire_prix` (consommé, remis à NULL).
- Cœur : `db/115_bibliotheque.sql` (`v_liste_elements`, unités pal / pl / rl, `document.ent_bib_id`), `db/116_bibliotheque_demo.sql` (généré).

## Points de spécialisation
- `SpecialisationBibliotheque` : `PeutParametrer` (admin), `PeutModifierTarifs` (tous), `RecalculerOuvrage(Element)` (cœur : `ElementsBibliotheque.RecalculerOuvrage`).
- `ServiceBibliotheque` : méthodes `virtual` ; la fiche de l'élément passe par le module Fiche (type `element`, verrou, empreinte), pas par ce service.
- `FournisseurBibliothequeMemoire({ bibliotheques, familles, regroupements, natures, unites, elements, tarifs, parametres, periodes, profil, utilisateur, horloge })` : `apresEcriture(ligne)` joue le recalcul serveur et le trigger d'historique (cœur : `apresEcritureElement`).
- Onglets de fiche : contexte `{ valeur, definir, valeurs, modifiable, id, fournisseur, message, unites, parametres, periodes, donnees }`.

## Routes HTTP (sous `/api/bibliotheque`)
- `GET|PUT /parametres` ; `GET|PUT /bibliotheques`, `/familles?bib`, `/regroupements`, `/natures`, `/periodes` + `DELETE …/{id|code}` ; `POST /recalcul`.
- `GET /elements?recherche&bib&type` (chaque mot dans le code, le libellé, les mots-clés ou le code-barres), `/elements/{id}`, `/appel?code&bib` (code d'élément, sinon code-barres, bibliothèque du document d'abord ; mêmes règles dans `FournisseurBibliothequeMemoire`) ; `GET|POST /elements/{id}/tarifs`, `DELETE /elements/{id}/tarifs/{tarif}` ; `GET /tarifs?tiers` ; `POST /tarifs/import` { tiers_id, fournisseur, fichier, lignes, simulation } (lot 8 : élément par code d'appel, référence fournisseur ou code-barres, rapport par ligne, `ImporterTarifs` ; mêmes règles dans `FournisseurBibliothequeMemoire.importerTarifs`) ; `GET /elements/{id}/historique`.

## Textes et icônes (module Personnalisation, lot P3h)
- Textes `bibliotheque.*` de `js/personnalisation/fr.json` (zones `scenarios`, `gestions`, `types_nature`, `donnees_techniques`, `fournisseur`, `arbres`, `prix`, `unites`, `tarifs`, `referentiels`) ; icônes `bibliotheque_*` de `images/icones.json` et communes du socle ; aucune couleur propre (variables du socle).
- `SCENARIOS_PA`, `GESTIONS`, `TYPES_NATURE`, `DONNEES_TECHNIQUES` : `pairesParCode` (même forme) ; état d'une période de coefficients par code (`a_venir`, `en_vigueur`, `passee`).
- Gardés : messages d'erreur de `calcul.js` (moteur répliqué avec `CalculElement.cs`) ; commentaires de l'historique des prix écrits par le fournisseur mémoire.
- Tests : `js/test/preparation.js` compose socle + module (clé manquante = échec) ; clés du code vérifiées par `client/test/personnalisation.test.js`.
