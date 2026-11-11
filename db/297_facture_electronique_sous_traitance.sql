-- =============================================================================
-- Facturation électronique, réception de sous-traitance (plans/facturation-electronique.md, lot 15) : signal de
-- notification PAIEMENT_DIRECT (demande de paiement direct, statut 224, reçue d'un sous-traitant ; délai d'acceptation
-- de 15 jours : niveau ATTENTION). Codes SignauxFe de Domaine/Codes.cs ↔ SIGNAL_FE de client/src/app/codes.js.
-- Rejouable.
-- =============================================================================

ALTER TABLE facture_electronique_signal DROP CONSTRAINT IF EXISTS facture_electronique_signal_fsi_code_check;
ALTER TABLE facture_electronique_signal ADD CONSTRAINT facture_electronique_signal_fsi_code_check
    CHECK (fsi_code IN ('RECUE', 'REJET', 'REFUS', 'LITIGE', 'ERREUR_FILE', 'PAIEMENT_DIRECT'));

INSERT INTO facture_electronique_signal (fsi_code, fsi_libelle, fsi_niveau) VALUES
 ('PAIEMENT_DIRECT', 'Demande de paiement direct reçue d''un sous-traitant', 'ATTENTION')
ON CONFLICT (fsi_code) DO NOTHING;
