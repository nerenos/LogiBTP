-- =============================================================================
-- Module Document – avancement, suite (CONCEPTION-ACHATS-MARCHES.md, Q26, Q28, Q29, 13.9, 13.10) :
-- - lig_avt_mode A : poste de pied en montant au prorata de l'avancement global (proposé, modifiable en P ou M) ;
-- - tyd_avoir_tyd_id : type de l'avoir qu'une facture d'avancement devient quand sa période est négative ;
-- - ent_nature_avoir (AVANCEMENT : période négative ; ANNULATION : annulation d'une facture) ;
-- - ent_etat_compta : A à transférer, T transféré, S sans écriture (total nul) — préparé pour le module Comptabilité ;
-- - ent_rang_avancement : numéro de situation (par marché, modifiable : reprise d'un autre logiciel).
-- Rejouable.
-- =============================================================================

ALTER TABLE document_ligne DROP CONSTRAINT IF EXISTS document_ligne_lig_avt_mode_check;
ALTER TABLE document_ligne ADD CONSTRAINT document_ligne_lig_avt_mode_check CHECK (lig_avt_mode IN ('P','Q','M','A'));

ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_avoir_tyd_id INT REFERENCES type_document(tyd_id);

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_nature_avoir VARCHAR(12) CHECK (ent_nature_avoir IN ('ANNULATION','AVANCEMENT'));
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_etat_compta CHAR(1) CHECK (ent_etat_compta IN ('A','T','S'));
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_rang_avancement INT;
