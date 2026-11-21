-- =============================================================================
-- Module Document – styles des lignes par classe de ligne (plan fiches-lignes-documents, lot 5).
--   style_ligne : style d'une classe de ligne (TRANCHE_1 à TRANCHE_5, SECTION, OUVRAGE, SOUS_OUVRAGE, ELEMENT,
--   COMPOSANTE, TEXTE, SOUS_TOTAL) à un niveau : global (famille et type nuls), famille ou type de document ; le plus
--   précis l'emporte, comme les règles des documents (regle_document). Propriétés (JSONB) : couleur, fond (#rrggbb ou
--   variable du thème), gras, italique, souligne, barre, taille (PETITE, NORMALE, GRANDE).
--   document.ent_styles_lignes : { CLASSE: { propriétés } }, style de la classe propre au document (au-dessus du type).
--   document_ligne.lig_style : { propriétés }, style propre d'une ligne entière (au-dessus de tout).
--   Un changement du paramétrage s'applique aux documents existants (style calculé à l'affichage).
-- =============================================================================

CREATE TABLE IF NOT EXISTS style_ligne (
    sli_id       SERIAL       PRIMARY KEY,
    sli_classe   VARCHAR(20)  NOT NULL CHECK (sli_classe IN ('TRANCHE_1','TRANCHE_2','TRANCHE_3','TRANCHE_4','TRANCHE_5',
                                                              'SECTION','OUVRAGE','SOUS_OUVRAGE','ELEMENT','COMPOSANTE','TEXTE','SOUS_TOTAL')),
    sli_famille  CHAR(1)      CHECK (sli_famille IN ('V','A','S','E','T')),
    sli_tyd_id   INT          REFERENCES type_document (tyd_id) ON DELETE CASCADE,
    sli_valeur   JSONB        NOT NULL,
    CONSTRAINT style_ligne_niveau CHECK (sli_tyd_id IS NULL OR sli_famille IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_style_ligne ON style_ligne (sli_classe, coalesce(sli_famille, ''), coalesce(sli_tyd_id, 0));

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_styles_lignes JSONB;
ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_style JSONB;
