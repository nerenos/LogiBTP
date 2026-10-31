-- Marchés à facturer pour un mois (CONCEPTION-ACHATS-MARCHES.md 13.9, décision du 31/10/2026, lot E) : pour un mois
-- civil, on propose les marchés de vente en cours non soldés sans pièce d'avancement validée dans le mois ; l'utilisateur
-- peut indiquer qu'il n'y a pas eu d'avancement (aucune situation créée, aucun numéro de situation consommé), mémorisé ici
-- par marché et par mois. Rejouable.

CREATE TABLE IF NOT EXISTS marche_sans_avancement (
    msa_mar_id       INT           NOT NULL REFERENCES marche(mar_id) ON DELETE CASCADE,
    msa_mois         DATE          NOT NULL CHECK (msa_mois = date_trunc('month', msa_mois)::date),   -- premier jour du mois
    msa_commentaire  TEXT,
    msa_par          VARCHAR(100)  NOT NULL,
    msa_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (msa_mar_id, msa_mois)
);
COMMENT ON TABLE marche_sans_avancement IS 'Marché sans avancement pour un mois : écarté de la liste des marchés à facturer de ce mois';
