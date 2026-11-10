-- =============================================================================
-- Module Facturation électronique : étapes de la réception au journal fe_evenement (plans/facturation-electronique.md,
-- lot 12) : LECTURE (facture lue), PIECE_CREEE (pièce créée par l'application), DOUBLON (création refusée pour une
-- facture déjà enregistrée). Seule la contrainte des types change ; le journal reste en ajout seul. Rejouable.
-- =============================================================================

ALTER TABLE fe_evenement DROP CONSTRAINT IF EXISTS fe_evenement_type_check;
ALTER TABLE fe_evenement ADD CONSTRAINT fe_evenement_type_check CHECK (fev_type IN ('PRODUCTION','CONTROLE','DEPOT','ACCUSE',
    'RECEPTION','STATUT_RECU','STATUT_POSE','ERREUR','REPRISE','ACTION_UTILISATEUR','AVOIR_INTERNE','RATTACHEMENT','IMPORT_MANUEL',
    'LECTURE','PIECE_CREEE','DOUBLON'));
