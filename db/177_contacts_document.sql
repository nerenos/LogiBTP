-- =============================================================================
-- Cœur LogiBTP – coordonnées figées du client (ou du fournisseur) et du payeur dans l'entête des documents :
-- instantané pris dans l'annuaire (raison sociale, contact, adresse, courriel, téléphone, SIRET, TVA) pour les éditions,
-- conservé à la transformation et rechargé à la demande (bouton de l'entête). L'annuaire du document (ent_intervenants)
-- reste la référence vers les fiches.
-- Rejouable.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_contact_client JSONB;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_contact_payeur JSONB;
