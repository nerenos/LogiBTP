-- Journal technique de l'application (ANALYSE-MODULE-DROITS.md § 3.7, lot 4) : erreurs (niveau LOGIBTP_JOURNAL_NIVEAU du
-- .env, Error par défaut), messages masqués avant écriture ; écrit dans la base principale, purgé après 30 jours (D24).
-- Rejouable.
CREATE TABLE IF NOT EXISTS journal_technique (
    jte_id         BIGSERIAL     PRIMARY KEY,
    jte_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    jte_niveau     VARCHAR(12)   NOT NULL,
    jte_categorie  VARCHAR(200)  NOT NULL,
    jte_message    TEXT          NOT NULL,
    jte_exception  TEXT
);
CREATE INDEX IF NOT EXISTS ix_jte_le ON journal_technique (jte_le DESC);
