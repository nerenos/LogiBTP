-- Module Document – lien de paiement direct entre deux pièces (facture d'un sous-traitant payée par le client, déduite
-- de notre facture au client ; module Sous-traitance). Rejouable.

ALTER TABLE document_lien DROP CONSTRAINT IF EXISTS document_lien_lie_type_check;
ALTER TABLE document_lien ADD CONSTRAINT document_lien_lie_type_check CHECK (lie_type IN ('TRANSFORMATION', 'COPIE', 'ANNULATION', 'PAIEMENT_DIRECT'));
