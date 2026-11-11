-- =============================================================================
-- Module Facturation électronique : statuts posés par la société (plans/facturation-electronique.md, lot 13).
-- fpa_statuts_non_envoyes : codes des statuts posés gardés au journal sans CDAR déposé (paramètre « statut envoyé ou
-- non » par code ; ReglesParametresFe.StatutsParametrables : statuts du vendeur ou de l'acheteur hors ceux qu'exige le
-- PPF, Refusée et Encaissée partant toujours). Vide : tout statut posé part en CDAR par la file. Rejouable.
-- =============================================================================

ALTER TABLE fe_parametre ADD COLUMN IF NOT EXISTS fpa_statuts_non_envoyes VARCHAR(3)[] NOT NULL DEFAULT '{}';
