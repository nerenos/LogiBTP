# Module Droits – contexte

## Rôle
- Droits par profil ([analyse](../../documentation/conception/ANALYSE-MODULE-DROITS.md), décisions D1 à D33) : un compte = un profil ; arbre des droits par nœud « module/élément » (documents/V/V_DEVIS, fiches/salarie, administration/profils…), actions en cascade à la saisie et indépendantes en base, portée (SOI, SERVICE, TOUT), héritage du plus proche ancêtre qui a une ligne ; profil total (ADMIN) : tout.
- Le serveur décide : chaque route `/api` est rattachée à un nœud par la table de la spécialisation ; une route absente de la table est refusée (403 `DROIT_NON_DECLARE`) et signalée au démarrage (exception en développement).
- Fournit le contrat `IDroits` du socle aux autres modules (Document, Fiche, CRM, Authentification) ; sans module Droits, ces modules gardent leurs tables historiques (`droit_document`, `droit_fiche`, `crm_droit`).

## Dépendances
- JS `@logibtp/droits` : aucune dépendance (règles seules). .NET : `LogiBTP.Droits` (règles), `LogiBTP.Droits.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationDroitsBtp` : catalogue et table des routes ; `Program.cs` : `AddModuleDroits`, `UseDroits` après `UseAuthentificationSession`, `MapModuleDroits`, `VerifierRoutesDroits`) ; client (`app.acces(noeud)`, `app.peut(noeud, action)`, propriété `droit` des menus, page `/parametres/droits`).

## Structure
- `js/src/regles.js` ↔ `dotnet/LogiBTP.Droits/ReglesDroits.cs` : `ACTIONS` (cascade), `PORTEES`, `ALIAS_ACTIONS` (VOIR, TRANSFORMER = consulter ; APPROUVER = valider ; DEVALIDER, DEBLOQUER = déverrouiller ; CONFIDENTIEL = RGPD), `actionsEffectives` / `Effectives` (source = nœud de la ligne retenue), `porteeAccordee`, `autorise(droits, nœud, action, portéeMin)`, `accesSousArbre(droits, nœud, ecriture)` (une action sur le nœud ou un descendant ; écriture : autre que consulter), `cocher` (précédentes au moins à la même portée), `decocher` (une seule), `reappliquer` (lignes des descendants retirées), `controlerProfil`, `controlerLignes` (catalogue : nœud connu, action permise, portée) ; jeu `tests/cas/01_droits.json`.
- `dotnet/LogiBTP.Droits.Web` : `Donnees.cs` (`Profil` à UUID v7, `DroitProfil`, `JournalDroits`, `DroitsDbContext`), `SpecialisationDroits.cs` (`NoeudCatalogue`, `ModeRoute` Module / Action / Session / Publique, `RouteDroits(préfixe, mode, nœud, action)`, `CatalogueAsync`, `Routes`, `ComptesParProfilAsync`), `ServiceDroits.cs` (`IDroits` : droits par profil en cache 60 s par base, vidé à chaque écriture ; profils, lignes, journal), `Extensions.cs` (`RoutesDroits` : gabarit normalisé, préfixe le plus long, nœud avec les valeurs de la route `{type}` ; `AddModuleDroits`, `UseDroits`, `VerifierRoutesDroits`, `MapModuleDroits`).
- `db/009_droits.sql` (rejouable) : `profil`, `droit_profil` (`dpr_actions` JSONB), `journal_droits` ; profils système ADMIN (total), SAISIE, MOBILE (pointage SOI, profil par défaut d'un compte), SERVICE ; lot 2 : `limite_validation` (`lva_piece`, `lva_cumul`, `lva_jours` ; −1 = sans limite, 0 = sur demande).
- Lot 2 : `ReglesDroits.LimiteEffective` (nœud ou plus proche ancêtre), `Depassement` (PIECE, CUMUL ; même règle que `LimiteValidation.Depassement` du socle), `ControlerLimite` ; `IDroits.LimiteAsync` (profil total : aucune) ; limites lues et remplacées avec les lignes (`DroitsSaisis.Limites`, journal `LIMITE`).

## Règles
- Contrôle d'une route (`UseDroits`) : Module = `accesSousArbre` (GET : lecture ; sinon écriture), Action = `autorise` sur le nœud, Session = connecté, Publique = rien ; utilisateur par `Utilisateur.Depuis`.
- Contrôle fin dans les modules par `IDroits.PorteeAsync` / `AutoriseAsync` / `ExigerAsync` (nœuds : `documents/{famille}/{code}` du module Document, `fiches/{type}`, `crm`, `pointage` par le cœur).
- Montants de validation (lot 2) : contrôlés par le module Document avant la validation (`ControlerMontantAsync` : HT de la pièce, cumul des pièces du même type validées par le même utilisateur pour le même tiers sur la période, droit FORCER = sans limite) ; dépassement : `SpecialisationDocument.MontantDepasseAsync` (cœur : tâche du CRM au service du document, sinon du type, sinon premier service administratif) puis 422 `MONTANT_VALIDATION`.
- Listes (lot 2) : `SpecialisationListe.RestrictionAsync` du cœur : types de documents et de fiches non consultables écartés (`TypesRefuses`), champs confidentiels de la fiche de la source masqués sans le droit RGPD (`ColonnesMasquees` : ni lus, ni cherchés, ni triés ; filtre ou segment refusé `COLONNE_CONFIDENTIELLE`).
- Profils : code `^[A-Z][A-Z0-9_]{1,29}$` jamais modifié (porté par les comptes) ; profil système non supprimable (409 `PROFIL_SYSTEME`), profil porté par des comptes non supprimable (409 `PROFIL_UTILISE`) ; profil total : pas de lignes (409 `PROFIL_TOTAL`) ; lignes remplacées en bloc, contrôlées (422 `NOEUD_INVALIDE`, `ACTION_INCONNUE`, `PORTEE_INCONNUE`), journal par nœud modifié (avant / après).

## Routes HTTP (préfixe `/api/droits`)
- `GET /moi` (session : code, profil, total, lignes) ; gestion (nœud `administration/profils`) : `GET /catalogue`, `GET|POST /profils`, `PUT|DELETE /profils/{id}`, `GET|PUT /profils/{id}/droits` { lignes }, `GET /journal?profil=`.

## Tests
- `npm test --workspace modules/droits/js` ; `dotnet test modules/droits/dotnet/LogiBTP.Droits.Tests` (jeu partagé, rattachement des routes).
