-- =============================================================================
-- Module Facturation électronique : réception hors plateforme (plans/facturation-electronique.md, lot 14).
-- ffl_hors_plateforme : facture reçue en dehors de toute plateforme (Factur-X ou XML glissé sur la liste des factures
-- à traiter ou sur une pièce, pièce jointe d'un courriel), traitée comme un flux reçu (sens In, connecteur MANUEL) ;
-- ses statuts posés restent au journal, aucun CDAR n'est déposé. Rejouable.
-- =============================================================================

ALTER TABLE fe_flux ADD COLUMN IF NOT EXISTS ffl_hors_plateforme BOOLEAN NOT NULL DEFAULT FALSE;
