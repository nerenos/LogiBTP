-- =============================================================================
-- Module Document – situation de production (analyse du module Rentabilité, § 4.12, lot 4) : nouvel avancement D
-- d'un type de document, double de la situation de travaux (S) qui dit l'avancement réel du chantier ; même saisie
-- (lignes du marché, %, quantité ou montant cumulés), présentation en cumul, saisie partant de la dernière situation de
-- production validée ; ni facture, ni écriture comptable, ni numéro de situation commun avec les situations de travaux.
-- Codes : TYPE_AVANCEMENT (js/src/codes.js) ↔ TypesAvancement (Domaine/Codes.cs). Rejouable.
-- =============================================================================

ALTER TABLE type_document DROP CONSTRAINT IF EXISTS type_document_tyd_avancement_check;
ALTER TABLE type_document ADD CONSTRAINT type_document_tyd_avancement_check CHECK (tyd_avancement IN ('S', 'F', 'R', 'D'));
COMMENT ON COLUMN type_document.tyd_avancement IS 'Avancement : S situation de travaux, F facture d''avancement, R reprise d''avancement, D situation de production (avancement réel)';
