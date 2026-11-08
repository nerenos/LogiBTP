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
| 3 | Écrans du module : liste de travail, règle, suspensions | `modules/relance` | 2 | FAIT (08/11/2026) |
| 4 | Branchement du cœur : pièces en attente, rôle, droits, portée | cœur | 2, 3 | FAIT (08/11/2026) |
| 5 | Surcharge par tiers sur la fiche personne | cœur | 4 | FAIT (08/11/2026) |
| 6 | Envoi par courriel et note du CRM | cœur | 4 | FAIT (08/11/2026) |
| 7 | Lettres, recommandés et mise en demeure | cœur | 6 | FAIT (08/11/2026) |
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

## Lot 3 : écrans du module, liste de travail, règle, suspensions (FAIT (08/11/2026))

- **Module** : `modules/relance`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/relance/js/ui/liste-relances.js` (relances proposées regroupées par tiers et chargé, cochées
  par défaut, mode modifiable par `creerCombo`, commentaire, validation par `confirmer`, recommandés en attente de
  numéro), `js/ui/parametres-relances.js` (règle par nature : niveaux, délais, modes, modèles, répéter ; avertissement
  sans module Règlements, Q8), `js/ui/suspensions.js`, `js/personnalisation/fr.json` (textes, icônes), déclaration de la
  couche dans `client/personnalisation/couches.js`, tests vitest des écrans.
- **Règles répliquées** : aucune. Aucun texte, icône ni couleur en dur ; raccourcis par `declarerRaccourcis`.
- **Critère de fin** : `npm test` vert ; écrans affichés sur des données de test (page de démonstration du module ou
  test du rendu).
- **Réalisé** (08/11/2026) : `modules/relance/js/ui` : `liste-relances.js` (`ListeRelances` : dues par tiers puis chargé, lot
  préparé coché par défaut, mode par `creerCombo`, commentaire, validation par `confirmer`, échecs d'envoi signalés,
  annulation des non retenues, recommandés en attente de numéro, relance notée Q22 b, suspension depuis une pièce),
  `parametres-relances.js` (règle par nature, contrôle par `controlerRegle`, avertissement sans Règlements Q8),
  `suspensions.js`, `modeles.js` (état et calculs sans DOM), `relance.css` ; `js/personnalisation` (textes, icônes,
  thème), couche déclarée dans `client/personnalisation/couches.js`, exports `./ui` ; tests `modeles`, `ecrans` (clés,
  icônes, conventions), `import` (raccourcis). Pas de DOM dans vitest : rendu non testé, page de démonstration non faite.
  Correction du lot 2 : le mode préféré du tiers ne remplace plus un niveau en RECOMMANDE (Q13), test ajouté. Les
  recommandés en attente sont relus lot par lot (20 derniers) faute de route dédiée.

## Lot 4 : branchement du cœur, pièces en attente, rôle, droits, portée (FAIT (08/11/2026))

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
- **Réalisé** (08/11/2026) : `db/283_relances.sql` (rejouable, rejoué deux fois sur PostgreSQL 16 ; manifeste après
  `282`) : `module_societe` « relance », `type_document.tyd_role_relance` (DEVIS sur V_DEVIS ; FACTURE sur V_FACTURE,
  V_FACTURE_AVT, V_FACTURE_ACOMPTE ; posés à la création de la colonne seulement) ; codes `ROLE_RELANCE` ↔ `RolesRelance`
  et `MODULE_FACULTATIF.RELANCE` (parité `CodesTests`) ; `Btp/SpecialisationRelanceBtp.cs` : pièces valables non
  annulées (`PerimetreDocuments`), devis ENVOYE non rejetés, non expirés, non transformés (groupe d'indices compris),
  départ = envoi, montant TTC, groupe d'indices `ent_groupe_id` ; factures : échéances ouvertes de `ServiceReglement`
  si Règlements est actif (part cautionnée d'une retenue exigible à la date de la pièce, reste à la libération), sinon
  échéances du document (sans échéance : net à payer) tant que le statut n'est pas PAYE ; tiers = intervenant PAYEUR,
  sinon le tiers ; chargé = `aff_responsable_ind_id`, sinon `per_cli_charge_ind_id` ; portée SOI / EQUIPE (équipiers du
  jour) / SERVICE (membres des services dont on est responsable) / TOUT ; `RoutesRelancesBtp` : Créer exigé pour
  `POST /api/relances/lots` (même gabarit que la lecture), route du cœur `GET /api/relances/libelles` (libellés des
  pièces et des tiers d'un lot ou d'une suspension) ; nœud `relances` (CONSULTER, CREER, VALIDER, portée) ; routes :
  `/api/relances` en module, `/lots/{id}/annuler` Créer, `/lots/{id}/valider`, `/{id}/recommande`, `/notees` Valider ;
  page `client/src/app/pages/relances.js` (onglets liste de travail, suspensions, règle ; onglet retenu dans le
  navigateur), menu Ventes › Relances, `api.relances`. Tests `RelancesBtpTests` (5 sans base, 1 avec `LOGIBTP_TEST_PG` :
  devis expiré, remplacé, annulé, transformé, rejeté, brouillon ; facture payée sans et avec Règlements ; payeur ;
  chargé de l'affaire ou du client ; portée). `/relances` vérifiée avec Playwright sur une base locale (devis et facture
  dus listés, lot préparé avec ses libellés). Points ouverts : rôle non modifiable par écran ; pas de choix de pièce dans
  l'onglet Suspensions (suspension d'une pièce depuis la liste de travail) ; sans requête HTTP (préparation de nuit,
  lot 9), le module Règlements est pris comme inactif et la portée comme TOUT.

## Lot 5 : surcharge par tiers sur la fiche personne (FAIT (08/11/2026))

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/284_personne_relance.sql` (`ALTER TABLE personne` : règle propre, « ne pas relancer », contact de
  relance, mode préféré, commentaire ; Q6, Q21), `scripts.txt`, définition de la fiche personne
  (`client/src/app/fiches/definitions.js`, onglet Facturation et règlement, groupe Relances), suspension par tiers depuis
  la fiche, `SpecialisationRelanceBtp.RegleDuTiersAsync`, textes du cœur.
- **Règles répliquées** : aucune.
- **Critère de fin** : un tiers « ne pas relancer » sort de la liste ; une règle propre change le niveau dû (test serveur).
- **Réalisé** (08/11/2026) : `db/284_personne_relance.sql` (rejouable, rejoué deux fois sur PostgreSQL 16 ; manifeste après
  `283`) : `personne.per_rel_regle` (JSONB), `per_rel_ne_pas_relancer`, `per_rel_contact_ind_id`, `per_rel_mode` (CHECK
  sur `MODE_RELANCE`), `per_rel_commentaire` ; fiche personne (`definitions.js`, onglet Facturation et règlement, groupe
  Relances ; `db/131` régénéré) ; `SpecialisationRelanceBtp.RegleDuTiersAsync` (règle propre invalide ignorée, contrôlée
  comme une facture : pas de mode TACHE) ; action « Suspendre les relances » de la fiche (ouvre `/relances?suspendre=<tiers>` :
  onglet Suspensions, saisie ouverte sur le tiers) ; rôle de relance d'un type de pièce (`tyd_role_relance`) modifiable avec
  les rôles Rentabilité (`creerCombo`, `PUT /rentabilite/parametres/roles`). Tests `RelancesBtpTests` (règle illisible ou
  invalide ignorée ; avec `LOGIBTP_TEST_PG` : tiers « ne pas relancer » absent de la liste, règle propre à 30 jours ramène
  le niveau dû de 2 à 1, règle invalide sans effet). Points ouverts : la règle propre se saisit en JSON (pas d'éditeur de
  niveaux) ; le contact de relance et le commentaire ne sont lus qu'à l'envoi (lot 6) ; le rôle de relance se règle sur la
  page des paramètres Rentabilité (module Rentabilité requis).

## Lot 6 : envoi par courriel et note du CRM (FAIT (08/11/2026))

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
- **Réalisé** (08/11/2026) : `db/285_relances_mail.sql` (rejouable, rejoué deux fois sur PostgreSQL 16 ; manifeste après
  `284`) : six modèles `RELANCE_DEVIS_1…3`, `RELANCE_FACTURE_1…3` (usage RELANCE, `mmo_type` « NATURE_n » ; variables
  tiers, contact, pieces, nombre, montant, jours_retard, echeances, tableau, niveau, charge, commentaire, utilisateur,
  date) ; `SpecialisationRelanceBtp` : `EnvoyerCourrielAsync` → `CourrielAsync` / `PreparerCourrielAsync` (destinataire :
  contact de relance `per_rel_contact_ind_id`, sinon contact figé client ou payeur, sinon intervenant, sinon tiers ;
  modèle du niveau de la règle, sinon nature et niveau, sinon plus haut niveau inférieur ; PDF de chaque pièce, devis
  compris : dernière édition en GED, sinon produite par le modèle par défaut et rangée en GED, une édition impossible
  laisse le groupe proposé ; `EnvoyerAutomatiqueAsync` dans un lot du Mail par lot de relances, priorité basse ; élément
  du courriel = le tiers, `mail_lien` vers chaque pièce), sans adresse : `BasculerEnCourrierAsync` (journal en COURRIER) ;
  `ApresEnvoiAsync` → `NoterAsync` (CRM actif : une note RELANCE par groupe, action close, liée à chaque pièce par son
  groupe d'indices et au tiers, commentaire de la validation et du tiers `per_rel_commentaire`, `mail_lien` `crm_note`
  vers le courriel ; aussi pour une relance notée) ; `SpecialisationCrmBtp.TypeNoteAsync` / `TypeNoteRelance`. Test
  `RelancesBtpTests.Validation_d_un_lot_met_les_courriels_en_file_et_pose_la_note` (avec `LOGIBTP_TEST_PG` : un courriel
  par groupe en file BASSE dans un seul lot du Mail, modèle DEVIS_2, pièces jointes et liens, bascule COURRIER, journal
  ENVOYEE, notes RELANCE liées, `jours_envoye` à 0). Lot 5 du module Mail fermé au TODO (Q20). Points ouverts : la lettre
  de la bascule en courrier vient au lot 7 (journal seul d'ici là) ; le Mail range le `.eml` et sa note « Courriel
  envoyé » sur le tiers (élément du courriel), en plus de la note RELANCE des pièces ; les niveaux de la règle par défaut
  ne désignent pas de modèle (choix par nature et niveau) ; un lot du Mail repris d'une validation à l'autre est compté
  courriel par courriel (fin signalée trop tôt si la file part entre deux groupes).

## Lot 7 : lettres, recommandés et mise en demeure (FAIT (08/11/2026))

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/EditionsBtp.cs` (source de données « relance » : tiers, pièces, montants,
  mentions de la société), modèles « Relance 1 », « Relance 2 », « Mise en demeure » (`client/src/app/editions/modeles.js`
  ou script de semis), `SpecialisationRelanceBtp.EnvoyerAsync` COURRIER / RECOMMANDE (une lettre par groupe, PDF rangé en
  GED de chaque pièce, catégorie `relance` ; recommandé à l'état ATTENTE_NUMERO jusqu'à la saisie, Q12) ; dernier niveau
  des factures : mise en demeure, recommandé par défaut, mentions pénalités et indemnité citées **sans calcul** (Q13 b).
- **Règles répliquées** : aucune.
- **Critère de fin** : validation en mode COURRIER produit le PDF rangé en GED ; un recommandé passe à ENVOYEE après la
  saisie du numéro.
- **Réalisé** (08/11/2026) : source d'édition « relance » (`SourceRelanceEdition` dans `Btp/EditionsBtp.cs` : identifiant =
  relances du journal de la lettre ; société avec ses mentions, tiers au contact de relance, relance, pièces avec échéances
  échues et à échoir ; paramètres mode, date, commentaire de l'envoi ; droits du nœud `relances` et portée par chargé) ;
  modèles RELANCE_1, RELANCE_2, MISE_EN_DEMEURE dans `client/src/app/editions/modeles.js` (→ `db/191` régénéré ; codes
  `MODELE_EDITION` ↔ `ModelesEdition`) ; `db/286_relances_lettres.sql` (catégorie GED `relance`, rejouable, manifeste) ;
  `SpecialisationRelanceBtp` : `EnvoyerCourrierAsync` / `EnvoyerRecommandeAsync` (et donc la bascule du lot 6) →
  `LettreAsync` : modèle du niveau de la règle (`med_id`), sinon `ModeleParDefaut` (dernier niveau de la règle d'une
  facture → MISE_EN_DEMEURE, niveau 1 → RELANCE_1, sinon RELANCE_2), un PDF par groupe produit par le moteur du serveur,
  rangé en GED de chaque pièce (type, groupe d'indices) ; ENVOYEE, ou ATTENTE_NUMERO jusqu'à la saisie (route du module).
  Tests : `RelancesBtpTests` (modèle par défaut, identifiant, test PostgreSQL : PDF réel produit par Jint sans alerte,
  dépôt GED simulé par un INSERT dans la transaction du test car `ServiceGed` ouvre la sienne, recommandé ENVOYEE après
  le numéro), `client/test/modeles-relance.test.js`. Points ouverts : listes de modèles non fournies à l'écran de la règle
  (`med_id` non exposé par l'Édition), un seul document GED au journal par lettre, `db/191` à rejouer sur les bases
  existantes ; le script du lot 8 devient `db/287`.

## Lot 8 : suivi, onglets, colonne « Dernière relance », relance notée (FAIT (08/11/2026))

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/287_liste_derniere_relance.sql` (286 pris par le lot 7) (reprise de `v_liste_documents` **à partir de `db/267`** : colonne
  `derniere_relance`), colonnes des vues de devis et de factures (`client/src/app/vues-liste.js`), onglet Suivi de la page
  document (`client/src/app/documents/tracabilite.js`) et de la fiche tiers (relances du journal), bouton « Noter une
  relance faite » dans la liste de travail (inscrit au journal, Q22 b).
- **Règles répliquées** : aucune.
- **Critère de fin** : la colonne et les onglets montrent la dernière relance ; une relance notée fait avancer le niveau.
- **Réalisé** (08/11/2026) : `db/287_liste_derniere_relance.sql` (rejouable, rejoué deux fois sur PostgreSQL 16 ; manifeste après
  `286` ; reprise de `v_liste_documents` de `db/267`, aucun script intermédiaire ne l'avait reprise) : colonne `derniere_relance`
  (date de la dernière relance ENVOYEE ou ATTENTE_NUMERO du journal, pièce ou groupe d'indices) ; `client/src/app/vues-liste.js`
  (source Documents, colonne « Dernière relance » des vues Devis et Factures, `db/121` régénéré) ; `relances/journal-relances.js`
  (relances faites, dernière relance et table) affiché dans la traçabilité de l'onglet Suivi de la page document
  (`documents/tracabilite.js`) et dans l'onglet Suivi de la fiche tiers (`pages/fiche.js`, avec ou sans CRM, droit de lecture du nœud
  `relances`) ; ajout du cœur : `GET /api/relances/modeles` (`RoutesRelancesBtp` : modèles de courriel d'usage RELANCE avec leur
  nature, modèles d'édition de la source « relance » avec `med_id`), lu par `/relances` à l'ouverture de l'onglet Règle et fourni à
  `ParametresRelances` (mise en demeure réservée aux factures) ; le bouton « Noter une relance faite » (liste de travail, lot 3)
  était déjà branché sur `POST /api/relances/notees` (Q22 b). Tests : `RelancesBtpTests.Relance_notee_renseigne_la_colonne_et_fait_avancer_le_niveau`
  (avec `LOGIBTP_TEST_PG` : niveau 2 dû, relance notée, colonne renseignée, plus rien de dû, niveau 3 vingt jours plus tard),
  `client/test/journal-relances.test.js`. Vérifié avec Playwright sur l'API et Vite locaux : colonne dans la liste des devis, journal dans
  l'onglet Suivi du document et de la fiche tiers, six modèles de courriel et trois lettres dans les combos de la règle. Points ouverts :
  les vues déjà enregistrées gardent leurs colonnes (`db/121` ne remplace que les vues jamais modifiées), pas de réimpression d'une lettre
  ni d'action « Noter » depuis l'onglet Suivi.

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
