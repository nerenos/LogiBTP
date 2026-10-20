# Module CRM – contexte

## Rôle
- Suivi de la relation et de l'information autour des affaires ([analyse](../../documentation/conception/ANALYSE-MODULE-CRM.md), décisions C1 à C30) : notes (actions, messages, tâches), rappels, demandes (pré-dossiers de veille), suivi des validations des plans, bordereaux de diffusion, fil d'actualité.
- Facultatif, activé par société (`module_societe`, code `crm`) : désactivé, menus et onglets masqués, routes refusées (409 `MODULE_INACTIF`), données conservées.
- Ne connaît pas l'application : un élément rattaché est un couple (`type_element`, `id_element`) comme dans la GED ; individus et services sont des identifiants décrits par la spécialisation.

## Dépendances
- Dépend de : `@logibtp/socle` (JS), `LogiBTP.Socle` / `LogiBTP.Socle.Web` (`Utilisateur`, `ExceptionMetier`), EF Core Npgsql, HtmlSanitizer (même liste blanche que `htmlSur` et le module Document, sans dépendre de lui). Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationCrmBtp` : éléments tiers, contacts, projets, affaires, chantiers, marchés, documents — groupe d'indices —, individu de l'utilisateur par `ind_utilisateur`, services de `db/193` ; `db/194` : élément GED `crm_note`, catégorie `crm` ; écrans `client/src/app/crm/*` et `pages/crm*.js`).

## Structure
- `js/src/notes.js` : `NATURES_NOTE`, `ETATS_NOTE`, `ETATS_CLOS`, `LONGUEUR_OBJET`, `controlerNote`, `MESSAGES_NOTE` ↔ `dotnet/LogiBTP.Crm/ReglesNote.cs` (`Controler`, `Messages`) ; jeu `tests/cas/01_note.json`.
- `dotnet/LogiBTP.Crm.Web` : `Donnees.cs` (entités `CrmTypeNote`, `CrmNote`, `CrmNoteLien`, `CrmNoteDestinataire`, `CrmNoteHistorique`, `CrmDroit`, `CrmConsultation`, `CrmDbContext`, `NettoyageHtmlCrm`), `SpecialisationCrm.cs` (`TypesElements`, `DecrireAsync`, `IndividuAsync`, `IndividusAsync`, `ServicesIndividuAsync`, `ServicesAsync`), `ServiceCrm.cs` (contexte, types de notes, listes par vue, détail, écriture, suppression, prise en charge, rendu, lecture, masquage), `Extensions.cs` (`AddModuleCrm<T>`, `MapModuleCrm` : renvoie le groupe `/crm`, sur lequel le cœur pose `ExigeModule("crm", …)`).
- `db/095_crm_schema.sql` (rejouable) : `crm_type_note`, `crm_note` (trigger d'historique `tr_crm_note_historique`), `crm_note_lien`, `crm_note_destinataire`, `crm_note_historique`, `crm_droit` (SUPERVISER, RGPD par profil ; ADMIN), `crm_consultation`.

## Règles
- Note : nature ACTION / MESSAGE / TACHE, état A_FAIRE / EN_COURS / TERMINE / MEMO / ANNULEE (clos : TERMINE, MEMO, ANNULEE). Tâche : responsable ou service, et échéance ; message : un destinataire sauf une réponse (`not_parent_id`) ; privée ou RGPD : jamais dans le fil (`not_dans_fil`, décoché par défaut).
- Responsable nul avec un service : note « à prendre », visible de tous les membres du service ; « Prendre » = devenir responsable (état EN_COURS si À faire) ; « Rendre au service » ; tout changement tracé (historique : CREATION, ETAT, RESPONSABLE, SERVICE, ECHEANCE).
- Lecture : tout le monde voit les notes ; note privée masquée sauf auteur, responsable, destinataires ; note RGPD masquée sauf l'auteur. Levée du masquage (`?reveler=true`) : droit SUPERVISER (privée) ou RGPD, consultation journalisée (`crm_consultation`), visible de l'auteur et de l'administrateur. La recherche ignore le contenu des notes protégées.
- Modification : administrateur, auteur, responsable, destinataire, membre du service d'une note à prendre ; contrôle des modifications concurrentes par `maj_le` (409 `NOTE_MODIFIEE`). Suppression : l'auteur tant que personne d'autre n'a lu, modifié ni répondu (sinon 409 `NOTE_UTILISEE` : l'annuler), l'administrateur toujours.
- Conservation : jusqu'à l'archivage (module Archivage à venir, `not_archivee_le`) ou la suppression du tiers.

## Routes HTTP (préfixe `/api/crm`)
- `GET /contexte` (utilisateur, individu, services, droits, types d'éléments, services, types de notes), `POST /elements` ([{ type, id }] → libellé, page, icône).
- `GET|PUT /types-notes` (PUT : administrateur ; un type retiré utilisé est désactivé).
- `GET /notes?vue=mes|a_prendre|recues|creees|toutes&type_element=&id_element=&nature=&etat=ouvertes|<code>&srv=&recherche=&page=&taille=` (notes racines, non archivées, triées par échéance puis création).
- `GET /notes/{id}?reveler=`, `POST /notes`, `PUT /notes/{id}`, `DELETE /notes/{id}`, `POST /notes/{id}/prendre|rendre|lue`.

## Tests
- `npm test --workspace modules/crm/js` ; `dotnet test modules/crm/dotnet/LogiBTP.Crm.Tests` (même jeu).
