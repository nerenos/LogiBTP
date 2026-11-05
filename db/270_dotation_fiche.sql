-- Fiches de dotation signées (module Stock, S26 ; rejouable) : la fiche de dotation d'un salarié (EPI, outillage) est
-- éditée par le module Édition (modèle FICHE_DOTATION, source fiche salarié, source annexe dotations_salarie) ; signée
-- à la borne d'atelier, elle couvre les mouvements de dotation enregistrés depuis la fiche signée précédente (instants
-- dfi_debut exclu à dfi_fin inclus, sur mvt_cree_le : un mouvement ne figure que sur une fiche), garde la signature
-- (table signature) et son PDF rangé dans la GED du salarié (catégorie « dotation », empreinte SHA-256).
-- Routes : Btp/DotationFicheBtp.cs.

CREATE TABLE IF NOT EXISTS dotation_fiche (
    dfi_id         BIGSERIAL    PRIMARY KEY,
    dfi_sal_id     INT          NOT NULL REFERENCES salarie(sal_id) ON DELETE CASCADE,
    dfi_du         DATE         NOT NULL,
    dfi_au         DATE         NOT NULL,
    dfi_debut      TIMESTAMPTZ,
    dfi_fin        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    dfi_sig_id     BIGINT       REFERENCES signature(sig_id) ON DELETE SET NULL,
    dfi_dge_id     BIGINT,
    dfi_lieu       VARCHAR(10)  NOT NULL DEFAULT 'BORNE' CHECK (dfi_lieu IN ('BORNE', 'BUREAU')),
    dfi_cree_par   VARCHAR(50)  NOT NULL,
    dfi_cree_le    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_dfi_periode CHECK (dfi_au >= dfi_du)
);
CREATE INDEX IF NOT EXISTS ix_dfi_salarie ON dotation_fiche (dfi_sal_id, dfi_au DESC);

COMMENT ON TABLE dotation_fiche IS 'Fiche de dotation signée d''un salarié : période couverte, signature, PDF rangé en GED';

UPDATE parametre_ged SET pge_valeur = pge_valeur || '[{"code":"dotation","libelle":"Fiche de dotation"}]'::jsonb
WHERE pge_cle = 'categories' AND NOT pge_valeur @> '[{"code":"dotation"}]'::jsonb;
