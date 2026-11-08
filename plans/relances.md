# Relances des devis et des factures : plan par lots

> Analyse : [ANALYSE-RELANCES.md](../documentation/conception/ANALYSE-RELANCES.md) (05/11/2026) ; questions :
> [relances-questions.md](relances-questions.md). Décisions du 08/11/2026 : (a) pour les huit questions bloquantes
> (Q1, Q2, Q3, Q7, Q9, Q10, Q14, Q23) ; **recommandation retenue faute de réponse pour les autres questions, à relire**.
> Périmètre (Q24) : tout. Ordre : socle (rien ici), module `modules/relance`, puis cœur.
>
> Principe : le module Relances (facultatif, `MODULE_FACULTATIF.RELANCE`) porte la règle des niveaux, le calcul des
> relances dues (répliqué JS ↔ C#), le journal, les suspensions et la préparation validée ; il ne dépend ni du module
> Document, ni du module Règlements, ni du Mail, de l'Édition ou du CRM. Le cœur le spécialise
> (`SpecialisationRelanceBtp`, méthode patron, comme `SpecialisationReglementBtp`) : pièces en attente, contacts,
> portée, envoi, lettres, notes.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Règle des niveaux et calcul des relances dues | `modules/relance` (nouveau) | — | FAIT (08/11/2026) |
| 2 | Schéma, journal, suspensions et service du module | `modules/relance` | 1 | FAIT (08/11/2026) |
| 3 | Écrans du module : liste de travail, règle, suspensions | `modules/relance` | 2 | A FAIRE |
| 4 | Branchement du cœur : pièces en attente, rôle, droits, portée | cœur | 2, 3 | A FAIRE |
| 5 | Surcharge par tiers sur la fiche personne | cœur | 4 | A FAIRE |
| 6 | Envoi par courriel et note du CRM | cœur | 4 | A FAIRE |
| 7 | Lettres, recommandés et mise en demeure | cœur | 6 | A FAIRE |
| 8 | Suivi : onglets, colonne « Dernière relance », relance notée | cœur | 6 | A FAIRE |
| 9 | Préparation de nuit, notification, tâche d'appel, pastille | cœur | 6 | A FAIRE |

---

## Lot 1 : règle des niveaux et calcul des relances dues (FAIT (08/11/2026))

- **Module** : `modules/relance` (nouveau, dépend du socle seul). **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/relance/js/package.json` (`@logibtp/relance`), `js/src/index.js`, `js/src/codes.js` ↔
  `dotnet/LogiBTP.Relances/Codes.cs` (`NATURE_RELANCE` : DEVIS, FACTURE ; `MODE_RELANCE` : COURRIEL, COURRIER,
  RECOMMANDE, TACHE ; `ETAT_RELANCE` : PROPOSEE, ENVOYEE, ATTENTE_NUMERO, ANNULEE ; codes d'erreur), `js/src/regles.js` ↔
  `dotnet/LogiBTP.Relances/ReglesRelance.cs`, `modules/relance/tests/cas/01_niveaux.json`,
  `dotnet/LogiBTP.Relances.Tests/` (`CodesTests.cs`, `ReglesRelanceTests.cs`), `LogiBTP.slnx`, `package.json` racine.
- **Règles répliquées JS ↔ C#** :
  - Règle : 1 à 5 niveaux { rang, délai en jours depuis le départ, mode proposé, modèle de courriel, modèle d'édition },
    dernier niveau répétable avec son intervalle (Q4, Q5 : délais en jours, défaut 15, 30, 60).
  - Niveau dû d'une pièce à une date : départ = date d'envoi (devis) ou échéance échue la plus ancienne non soldée
    (facture, Q3) ; seul le niveau atteint est proposé, et seulement s'il dépasse le dernier niveau fait (pas de
    rattrapage double, Q5) ; pièce arrêtée ou suspendue à la date : rien (Q7) ; montant relancé = reste échu à la date,
    échéances futures listées pour information ; retenue de garantie seulement après sa date de libération.
  - Regroupement (Q9, Q10) : par tiers, chargé et mode ; modèle du niveau le plus élevé du groupe ; chaque pièce garde
    son propre niveau ; jours de retard par pièce et du groupe.
- **Jeux** : `01_niveaux.json` (départ, niveaux atteints, répétition, relance faite en retard, suspension, retenue,
  échéances futures, regroupement à niveaux mêlés) ; parité des codes.
- **Critère de fin** : `npm test --workspace @logibtp/relance` et `dotnet test LogiBTP.slnx` verts, le jeu passe en JS
  et en C#.
- **Réalisé** (08/11/2026) : `modules/relance` (`@logibtp/relance`, `LogiBTP.Relances`, `LogiBTP.Relances.Tests`,
  `CLAUDE.md`) ; `regles.js` ↔ `ReglesRelance.cs` (`regleParDefaut`, `controlerRegle` avec `ERREUR_RELANCE`,
  `niveauAtteint`, `relanceDue`, `relancesDues`, `regrouper`) ; jeu `01_niveaux.json` (39 cas JS, mêmes cas en C#) ;
  regroupement aussi par **nature** (devis et factures d'un même tiers jamais dans la même relance : modèles par niveau
  et nature, Q11) ; une retenue de garantie porte sa date de libération comme date d'échéance ; règle propre d'une pièce
  (surcharge du tiers, lot 5) prise avant celle de sa nature.

## Lot 2 : schéma, journal, suspensions et service du module (FAIT (08/11/2026))

- **Module** : `modules/relance`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/relance/db/099t_relance.sql` (numéro à confirmer à l'écriture ; rejouable) : `relance_regle`
  (par nature, niveaux en JSONB ou table fille), `relance` (pièce `ent_id` et groupe d'indices **par identifiant, sans
  clé étrangère vers le module Document**, tiers, chargé, niveau, mode, état, date, auteur, montant relancé, message du
  courriel, document GED, numéro de recommandé, lot, commentaire), `relance_lot` (date, auteur, nombre, état : PREPARE,
  ENVOYE, PARTIEL), `relance_suspension` (pièce **ou** tiers, jusqu'au, motif), règle par défaut (Q4) ;
  `db/installation/scripts.txt` ; `dotnet/LogiBTP.Relances.Web/` : `SpecialisationRelance.cs` (classe mère, points
  d'accroche : `PiecesEnAttenteAsync`, `RegleDuTiersAsync`, `EnvoyerAsync` par mode, `ApresEnvoiAsync`, portée),
  `ServiceRelance.cs` (calcul des dues avec `ReglesRelance`, préparation, validation d'un lot, journal, suspensions,
  saisie du numéro de recommandé), `Donnees.cs`, `Extensions.cs` (routes `/api/relances…`).
- **Règles répliquées** : aucune nouvelle (le service appelle `ReglesRelance`).
- **Jeux** : tests du service sur une spécialisation de test (préparation, validation partielle, suspension, journal
  qui fait avancer le niveau).
- **Critère de fin** : script rejoué deux fois sans erreur ; `dotnet test LogiBTP.slnx` vert.
- **Réalisé** (08/11/2026) : `modules/relance/db/099t_relance.sql` (rejouable, rejoué deux fois sur PostgreSQL 16 ;
  manifeste après `099r`) : `relance_regle` (clé : nature, niveaux en JSONB, règle par défaut), `relance_lot`,
  `relance` (pièce `rel_ent_id` et groupe d'indices `rel_ent_groupe_id`, groupe d'envoi `rel_groupe` dans le lot,
  courriel `rel_courriel_id` au lieu du texte du message), `relance_suspension` (motif LITIGE, PROMESSE, ECHELONNEMENT,
  AUTRE) ; codes `ETAT_LOT_RELANCE`, `MOTIF_SUSPENSION` et erreurs du service (parité) ; `LogiBTP.Relances.Web`
  (`SpecialisationRelance` : `PiecesEnAttenteAsync`, `RegleDuTiersAsync` en lot de tiers avec « ne pas relancer » et
  mode préféré, `PorteeAsync`, `EnvoyerAsync` → `EnvoyerCourrielAsync` / `EnvoyerCourrierAsync` /
  `EnvoyerRecommandeAsync` / `CreerTacheAsync`, `ApresEnvoiAsync`, `Seuil` ; `ServiceRelance` ; `Extensions` :
  `AddModuleRelance<T>`, `MapModuleRelance`) ; en plus du plan : relance notée (`POST /relances/notees`, Q22 b, service
  pour le bouton du lot 8). Validation : un envoi en échec laisse son groupe proposé ; relances non retenues proposées
  (lot PARTIEL) ; lot clos (ENVOYE) quand plus rien n'est proposé. Tests `ServiceRelanceTests` (7, avec `LOGIBTP_TEST_PG`).

## Lot 3 : écrans du module, liste de travail, règle, suspensions (A FAIRE)

- **Module** : `modules/relance`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/relance/js/ui/liste-relances.js` (relances proposées regroupées par tiers et chargé, cochées
  par défaut, mode modifiable par `creerCombo`, commentaire, validation par `confirmer`, recommandés en attente de
  numéro), `js/ui/parametres-relances.js` (règle par nature : niveaux, délais, modes, modèles, répéter ; avertissement
  sans module Règlements, Q8), `js/ui/suspensions.js`, `js/personnalisation/fr.json` (textes, icônes), déclaration de la
  couche dans `client/personnalisation/couches.js`, tests vitest des écrans.
- **Règles répliquées** : aucune. Aucun texte, icône ni couleur en dur ; raccourcis par `declarerRaccourcis`.
- **Critère de fin** : `npm test` vert ; écrans affichés sur des données de test (page de démonstration du module ou
  test du rendu).

## Lot 4 : branchement du cœur, pièces en attente, rôle, droits, portée (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `db/283_relances.sql` (numéro à confirmer ; `ALTER TABLE type_document` : rôle `ROLE_RELANCE` DEVIS /
  FACTURE / NULL posé sur V_DEVIS et les factures de vente, Q2), `client/src/app/codes.js` ↔
  `src/LogiBTP.Domaine/Codes.cs` (`ROLE_RELANCE`, `MODULE_FACULTATIF.RELANCE`), `tests/LogiBTP.Calcul.Tests/CodesTests.cs`,
  `src/LogiBTP.Api/Btp/SpecialisationRelanceBtp.cs` (pièces en attente : devis ENVOYE non expirés, non transformés ;
  factures à reste échu — reste par `ResteAPayer` si le module Règlements est actif, sinon net à payer tant que le statut
  n'est pas PAYE, Q8 — ; toujours par `PerimetreDocuments` / `v_document_valable`, jamais `ent_verrouille` seul ; tiers
  payeur, Q6 ; chargé `aff_responsable_ind_id`, sinon celui du client ; portée SOI / EQUIPE / SERVICE / TOUT, Q9),
  `SpecialisationDroitsBtp.cs` (nœud `relances` : CONSULTER, CREER, VALIDER ; routes `/api/relances…`),
  `src/LogiBTP.Api/Program.cs`, route et menu client `/relances` (`client/src/app/pages/relances.js`, menus),
  `db/installation/scripts.txt`.
- **Règles répliquées** : aucune (calcul du module).
- **Jeux** : tests serveur de `SpecialisationRelanceBtp` (devis expiré, remplacé, annulé, facture soldée, sans
  Règlements, payeur distinct, portée).
- **Critère de fin** : `dotnet test LogiBTP.slnx` et `npm test` verts ; `/relances` liste les pièces dues d'une base de
  démonstration.

## Lot 5 : surcharge par tiers sur la fiche personne (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/284_personne_relance.sql` (`ALTER TABLE personne` : règle propre, « ne pas relancer », contact de
  relance, mode préféré, commentaire ; Q6, Q21), `scripts.txt`, définition de la fiche personne
  (`client/src/app/fiches/definitions.js`, onglet Facturation et règlement, groupe Relances), suspension par tiers depuis
  la fiche, `SpecialisationRelanceBtp.RegleDuTiersAsync`, textes du cœur.
- **Règles répliquées** : aucune.
- **Critère de fin** : un tiers « ne pas relancer » sort de la liste ; une règle propre change le niveau dû (test serveur).

## Lot 6 : envoi par courriel et note du CRM (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/MailBtp.cs` (usage RELANCE existant, modèles par niveau et nature créés par
  `db/285_relances_mail.sql`, variables : tiers, pièces, montants, échéances, jours de retard), `SpecialisationRelanceBtp`
  (`EnvoyerAsync` COURRIEL : destinataire = contact de relance, sinon contact figé `ent_contact_client` / payeur, sinon
  intervenant ; lot de priorité basse ; pièces jointes : dernière édition en GED, sinon édition produite à l'envoi ;
  devis joint ; tiers sans courriel : mode basculé en COURRIER, Q11, Q21), `SpecialisationCrmBtp.cs` (note RELANCE sur
  chaque pièce si le CRM est actif, liée au courriel, Q14), `TODO.md` (lot 5 du module Mail absorbé, Q20).
- **Règles répliquées** : aucune.
- **Critère de fin** : validation d'un lot de relances : un courriel par groupe dans la file du Mail, journal
  `relance` ENVOYEE, note RELANCE posée, indicateur « Devis à relancer » remis à zéro (`db/267`) ; tests serveur verts.

## Lot 7 : lettres, recommandés et mise en demeure (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/EditionsBtp.cs` (source de données « relance » : tiers, pièces, montants,
  mentions de la société), modèles « Relance 1 », « Relance 2 », « Mise en demeure » (`client/src/app/editions/modeles.js`
  ou script de semis), `SpecialisationRelanceBtp.EnvoyerAsync` COURRIER / RECOMMANDE (une lettre par groupe, PDF rangé en
  GED de chaque pièce, catégorie `relance` ; recommandé à l'état ATTENTE_NUMERO jusqu'à la saisie, Q12) ; dernier niveau
  des factures : mise en demeure, recommandé par défaut, mentions pénalités et indemnité citées **sans calcul** (Q13 b).
- **Règles répliquées** : aucune.
- **Critère de fin** : validation en mode COURRIER produit le PDF rangé en GED ; un recommandé passe à ENVOYEE après la
  saisie du numéro.

## Lot 8 : suivi, onglets, colonne « Dernière relance », relance notée (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/286_liste_derniere_relance.sql` (reprise de `v_liste_documents` **à partir de `db/267`** : colonne
  `derniere_relance`), colonnes des vues de devis et de factures (`client/src/app/vues-liste.js`), onglet Suivi de la page
  document (`client/src/app/documents/tracabilite.js`) et de la fiche tiers (relances du journal), bouton « Noter une
  relance faite » dans la liste de travail (inscrit au journal, Q22 b).
- **Règles répliquées** : aucune.
- **Critère de fin** : la colonne et les onglets montrent la dernière relance ; une relance notée fait avancer le niveau.

## Lot 9 : préparation de nuit, notification, tâche d'appel, pastille (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/NotificationsBtp.cs` (source « relances à préparer » : calcul chaque nuit par base,
  notification « N relances à préparer » aux personnes qui ont le droit, jamais d'envoi, Q15), `SpecialisationRelanceBtp`
  (mode TACHE pour les devis : tâche du CRM à échéance du jour rattachée au devis, proposé seulement si le CRM est actif,
  Q16), pastille « relancé N » sur la fiche tiers seulement (Q17 b), textes.
- **Règles répliquées** : aucune.
- **Critère de fin** : le planificateur d'une base de démonstration émet la notification ; un devis en mode TACHE crée
  la tâche sans courriel ; suite complète `npm test` et `dotnet test LogiBTP.slnx` verte.

---

## Points ouverts

- `CLAUDE.md` du nouveau module `modules/relance` : demandé par l'utilisateur, créé au lot 1.
- Reportés au TODO à la fin du plan : calcul des pénalités de retard pour information (Q13 a, taux à tenir à jour) ;
  pastille « relancé N » dans l'entête des nouvelles pièces (Q17) ; blocage du client (Q17 c).
- Décisions par défaut à relire : Q4 à Q6, Q8, Q11 à Q13, Q15 à Q22, Q24.
