# Module Facturation électronique – contexte

- Plan par lots : [facturation-electronique.md](../../documentation/conception/plans/facturation-electronique.md) ; analyse : [ANALYSE-FACTURATION-ELECTRONIQUE.md](../../documentation/conception/ANALYSE-FACTURATION-ELECTRONIQUE.md) ; décisions : [facturation-electronique-questions.md](../../documentation/conception/plans/facturation-electronique-questions.md).

## Rôle
- Réforme RFE : codes des normes, modèle sémantique EN16931, cycle de vie des factures (lot 1) ; lecture CII / Factur-X / UBL, schematrons, CDAR, connecteur de plateforme, file et journal (lots 2 à 9) ; écriture et e-reporting (partie B).
- Sans métier : ne connaît ni les pièces, ni les tiers ; le cœur les fournira par spécialisation (lot 11). Ne dépend ni de Document, ni d'Édition, ni d'OAuth.

## Dépendances
- JS `@logibtp/facture-electronique` → `@logibtp/socle` (decimal). .NET : `LogiBTP.FactureElectronique` → `LogiBTP.Socle`. Jamais du cœur ni d'un autre module.

## Repères (lot 1)
- Codes `js/src/codes.js` ↔ `dotnet/LogiBTP.FactureElectronique/Codes.cs` (parité par `CodesTests`) : valeurs des normes, clés en français. `TYPE_FACTURE` (BT-3, BR-FR-04), `CADRE_FACTURATION` (BT-23, BR-FR-08, B1 à M9), `CATEGORIE_TVA`, `TRAITEMENT` (note BAR), `CODE_NOTE`, `SOUS_TYPE_LIGNE`, `STATUT_CDV` (+ listes `STATUTS_TERMINAUX`, `STATUTS_MOTIF_OBLIGATOIRE`, `STATUTS_OBLIGATOIRES_PPF` ↔ `StatutCdv.Terminaux`…), `EMETTEUR_STATUT`, `SENS_FACTURE` (E / R), `MOTIF_STATUT` (51 codes BR-FR-CDV-CL-09), `ACTION_CDV` ; API XP Z12-013 : `SYNTAXE`, `PROFIL_FACTURE` (pas `PROFIL`, pris par le socle), `TYPE_FLUX`, `SENS_FLUX` (In / Out), `REGLE_TRAITEMENT`, `ETAT_ACCUSE`, `NIVEAU_ACCUSE`, `MOTIF_ACCUSE` ; file et journal : `ETAT_FLUX`, `EVENEMENT_FE` ; `ERREUR_FE`.
- `js/src/cycle-vie.js` ↔ `ReglesCycleVie.cs` (jeu `tests/cas/01_cycle_vie.json`, motifs générés depuis l'onglet « Tableau des motifs de STATUTS » de l'annexe A XP Z12-012 V1.4) : `emetteurDuSens` (E → VENDEUR, R → ACHETEUR), `emetteursStatut` (onglet « Acteurs CDV »), `motifsAutorises` (Rejetée selon PA_E / PA_R, Refusée B2B ou B2G), `statutTerminal`, `motifObligatoire`, `obligatoirePpf`, `controlerStatut` / `Controler` (liste d'`ERREUR_FE`), `statutsPosables`, `statutAffiche`.
- Enchaînement contrôlé seulement pour un statut posé par la société (émetteur = rôle du sens) : rien après Rejetée / Refusée, facture émise : rien avant Déposée, Déposée une fois, Complétée en réponse à Suspendue. Un statut reçu n'est contrôlé que sur code, émetteur, motif et action.
- Statut affiché : premier terminal, sinon le plus avancé (rang interne, à égalité le plus récent).
- `ModeleFacture.cs` (C# seul) : `Facture` (BG-0) et ses groupes (parties, payeur EXT-FR-FE-BG-02, agents, livraison, période, totaux, TVA, pièces jointes, lignes avec ligne parente, sous-type et facture antérieure EXT-FR-FE-BG-06). Montants en `decimal`.

## Tests
- `npm test --workspace @logibtp/facture-electronique` ; `dotnet test modules/facture-electronique/dotnet/LogiBTP.FactureElectronique.Tests` (même jeu, parité des codes).
