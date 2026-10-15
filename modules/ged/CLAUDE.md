# Module GED – contexte

## Rôle
- Documents stockés sur le serveur (contenus rangés par empreinte SHA-256, dépôts identiques partagés), liés à un élément quelconque (`type_element`, `id_element`), versions, aperçu, mails (.eml / .msg avec pièces jointes), suppression par masquage, coffre-fort (journal chaîné immuable).
- Versions de deux genres : `etape` (VALIDATION, ENVOI, RECEPTION, SIGNATURE, REFUS, ARCHIVAGE) toutes conservées ; `edition` (dépôts, modifications) dont seules les N dernières sont gardées (`editions_conservees`, 5 par défaut).

## Dépendances
- Dépend de : socle (`@logibtp/socle`, `LogiBTP.Socle.Web` : `Utilisateur`, `ExceptionMetier`, `SocieteCourante`) ; `postal-mime`, `@kenjiuno/msgreader` (chargés au premier mail).
- Utilisé par le cœur : `SpecialisationGedBtp` (`src/LogiBTP.Api/Btp/SpecialisationsElements.cs`, config `Ged:Repertoire`, `Ged:TailleMaxDepotMo`), `Program.cs` (`AddModuleGed<SpecialisationGedBtp>`, `MapModuleGed`) ; client `client/src/app/ged/ged.js` (`creerFournisseurGed`, démo semée, catégorie `notice_technique` DOE), pages `ged.js`, `fiche.js` (onglet compact), `document.js` (onglet Pièces), fiche élément de bibliothèque (`image_ged`, notices), import (fichier source, catégorie `import`).

## Structure
- `db/050_ged_schema.sql` : tables, triggers du coffre, paramètres, vue `v_liste_ged`.
- `js/src/coffre.js` : `sha256`, `horodatage`, `texteEntree`, `empreinteEntree`, `verifierChaine`, `EMPREINTE_ORIGINE` (64 zéros).
- `js/src/versions.js` : `editionsAPurger`, `versionsVisibles`, `etapes`, `GENRES`, `ETAPES`.
- `js/src/fichiers.js` : `genreApercu` (image, pdf, texte, mail), `estMail`, `icone`, `formatTaille`, `titreDepuisNom`, `dateDepuisFichier`.
- `js/src/mails.js` : `lireMail` → `{ objet, de, a, cc, date, message, pieces }`, `texteDeHtml`.
- `js/src/fournisseurs.js` : `FournisseurGedApi`, `FournisseurGedMemoire`, `ErreurGed`, `PARAMETRES_DEFAUT` (interface commune documentée en tête).
- `js/ui/explorateur.js` : `ExplorateurGed` (classe mère), `htmlMail` ; `depot.js` : `DialogueDepot` ; `apercu.js` : `rendreApercu`, `libererApercu` ; `ged.css`.
- `dotnet/LogiBTP.Ged` : `ChaineCoffre`, `RegleVersions`, `StockageGed` (chemin `ab/cd/<empreinte>`).
- `dotnet/LogiBTP.Ged.Web` : `ServiceGed`, `SpecialisationGed`, `Donnees.cs` (entités, `GedDbContext`), `Extensions.cs` (DI + routes).

## Modèle de données
- `contenu_ged` (`cge_empreinte` PK CHAR(64), taille, chemin) ; `document_ged` (`dge_*` : titre, categorie, nature `fichier|mail`, `dge_type_element` / `dge_id_element`, `dge_parent_id` = pièce jointe d'un mail, `dge_mail` JSONB, resume, notes, `dge_etat`, `dge_coffre`, `dge_a_envoyer`, `dge_supprime*`) ; `version_ged` (`vge_*`, unique `(vge_document, vge_numero)`, genre, etape, empreinte → contenu) ; `coffre_ged` (`cof_*` : empreinte du document, horodatage, utilisateur, motif, `cof_empreinte_precedente`, `cof_empreinte_entree` unique) ; `parametre_ged` (`editions_conservees`, `taille_apercu_max`, `adresse_copie_cachee`, `categories` avec drapeau `coffre`).
- Triggers : `tr_coffre_immuable` (ni UPDATE ni DELETE sur `coffre_ged`), `tr_document_coffre` (pas de DELETE ni de sortie du coffre), `tr_version_coffre` (versions d'un document du coffre conservées), `tr_*_vidage` (TRUNCATE interdit sur les trois tables).
- Vue `v_liste_ged` (documents non supprimés + dernière version) pour le module Liste.

## Points de spécialisation
- `SpecialisationGed` (C#) : `RepertoireStockage` (racine ; un sous-répertoire par société nommé comme sa base : `logibtp`, `logibtp_demo`… via `SocieteCourante.Base`, `Extensions.RepertoireSociete`, ancien dossier au nom du code renommé au premier accès), `TailleMaxDepot` (200 Mo), `Visibles(query, u)`, `PeutDeposer`, `PeutModifier`, `PeutPurger` (admin), `PeutSupprimerCoffre` (admin), `ControlerDepot(meta, nom, taille, u)`.
- `ServiceGed` : méthodes `virtual` (Lister, Deposer, NouvelleVersion, Etape, Modifier, MettreAuCoffre, Verifier, VerifierCoffre, Supprimer, Restaurer, Purger, Contenu).
- `ExplorateurGed(conteneur, { fournisseur, contexte: { type_element, id_element, libelle } | null, compact, modifiable, admin, utilisateur, message, documentInitial, coffre, envoi })` : `contexte` null = recherche globale ; `envoi` = case « 📧 À envoyer » (`dge_a_envoyer`, module Mail à venir) ; `compact` = vue des fiches.
- Fournisseurs : `FournisseurGedApi({ base: '/api/ged', entetes })` ou `FournisseurGedMemoire({ utilisateur, profil, parametres, horloge })` (démo hors ligne, tests ; mêmes règles que `ServiceGed`).
- Rattachement des documents du cœur : `type_element` = `tyd_code` du type de document, `id_element` = `ent_groupe_id ?? ent_id` (groupe des indices) ; `salarie`, `materiel`, `element` (bibliothèque).

## Routes HTTP (sous `/api/ged`)
- `GET /parametres` ; `GET /documents?type_element&id_element&recherche&supprimes&coffre` ; `POST /documents` (multipart : `fichier` + `donnees` JSON) ; `GET|PUT|DELETE /documents/{id}` (DELETE = masquage).
- `POST /documents/{id}/versions` (multipart), `/etapes`, `/coffre`, `/restaurer` ; `GET /documents/{id}/verification` ; `DELETE /documents/{id}/definitif` (purge) ; `GET /versions/{id}/contenu?telecharger` ; `GET /coffre/verification`.

## Règles répliquées JS / C# et jeux de cas
- Chaîne du coffre : `coffre.js` ↔ `ChaineCoffre.cs` ; texte d'entrée `precedente|empreinte_document|horodatage|document|version|utilisateur|motif`, horodatage ISO UTC à la milliseconde (`ChaineCoffre.Tronquer`) ; jeu `tests/cas/01_coffre.json`.
- Conservation des versions : `versions.js` ↔ `RegleVersions.cs` (courante jamais purgée, rien au coffre) ; jeu `tests/cas/02_versions.json`.
- `FournisseurGedMemoire` reproduit `ServiceGed` (codes `ErreurGed` : INTROUVABLE, COFFRE, SUPPRIME, ACCES_REFUSE…).

## Conventions et pièges
- Ne jamais contourner les triggers de `db/050` (pas de DELETE / TRUNCATE / désactivation de trigger, pas de « sortie » du coffre, même en script de démo ou de test).
- Document au coffre : aucune nouvelle version ni étape, seuls `resume` et `notes` modifiables ; mise au coffre refusée si le contenu recalculé diffère (`INTEGRITE`).
- Purge : document déjà masqué (`NON_SUPPRIME` sinon), jamais au coffre ; masquer un mail masque ses pièces jointes.
- Dépôt multipart lu par le service (pas de liaison `IFormFile`, `DisableAntiforgery`) ; ne jamais poser le Content-Type d'un FormData.
- Toute modification d'une règle répliquée : les deux côtés + le jeu de cas.

## Tests
- `npm test --workspace modules/ged/js` (vitest : jeux partagés, fournisseur mémoire, mails).
- `dotnet test modules/ged/dotnet/LogiBTP.Ged.Tests` (ou `dotnet test LogiBTP.slnx`).
