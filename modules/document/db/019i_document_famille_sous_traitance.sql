-- Module Document – famille T (sous-traitance) à côté de V, A, S, E : documents d'achat de sous-traitance (appel
-- d'offres, commande, facture d'avancement, avoir ; ANALYSE-MODULE-SOUS-TRAITANCE.md ST1), traités comme des achats
-- (famille d'achat : A ou T) ; types déclarés par l'application. Lot de consultation (ST3) : copies d'une même demande
-- de prix envoyées à plusieurs fournisseurs, désignées par un code commun (`ent_consultation`) sur les types qui le
-- proposent (`tyd_consultation`). Rejouable.

ALTER TABLE type_document DROP CONSTRAINT IF EXISTS type_document_tyd_famille_check;
ALTER TABLE type_document ADD CONSTRAINT type_document_tyd_famille_check CHECK (tyd_famille IN ('V', 'A', 'S', 'E', 'T'));

ALTER TABLE regle_document DROP CONSTRAINT IF EXISTS regle_document_rdo_famille_check;
ALTER TABLE regle_document ADD CONSTRAINT regle_document_rdo_famille_check CHECK (rdo_famille IN ('V', 'A', 'S', 'E', 'T'));

-- Famille d'achat : achats et sous-traitance (tiers fournisseur, décaissement, comptes d'achat).
CREATE OR REPLACE FUNCTION f_famille_achat(p_famille VARCHAR) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT p_famille IN ('A', 'T')
$$;

ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_consultation BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE type_document SET tyd_consultation = TRUE WHERE tyd_code = 'A_DEVIS' AND NOT tyd_consultation;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_consultation VARCHAR(30);
CREATE INDEX IF NOT EXISTS ix_ent_consultation ON document (ent_consultation) WHERE ent_consultation IS NOT NULL;
