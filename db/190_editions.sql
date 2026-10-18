-- =============================================================================
-- Cœur LogiBTP – éditions (module Édition, modules/edition/db/090) : dernier modèle imprimé d'un document (Q13) et
-- mentions de la société imprimées sur les pièces (§ 15.4 : assurance décennale, pénalités, indemnité forfaitaire,
-- escompte ; particuliers : médiateur, rétractation). Rejouable.
-- =============================================================================

-- Dernier modèle et présentation utilisés pour imprimer le document : { "modele": code, "presentation": code }.
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_modele_edition JSONB;

-- Paramètres des éditions de la société (une ligne par clé, valeur JSON).
CREATE TABLE IF NOT EXISTS parametre_edition (
    pae_cle          VARCHAR(50)  PRIMARY KEY,
    pae_valeur       JSONB        NOT NULL,
    pae_modifie_le   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    pae_modifie_par  VARCHAR(50)  NOT NULL DEFAULT ''
);

INSERT INTO parametre_edition (pae_cle, pae_valeur) VALUES ('mentions', '{
  "decennale": { "assureur": "", "adresse": "", "police": "", "couverture": "France métropolitaine" },
  "penalites": "Pénalités de retard : trois fois le taux d''intérêt légal, exigibles sans rappel.",
  "indemnite": "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.",
  "escompte": "Pas d''escompte pour paiement anticipé.",
  "mediateur": { "nom": "", "site": "" },
  "retractation": "En cas de contrat conclu hors établissement, vous disposez d''un délai de rétractation de quatorze jours (articles L221-18 et suivants du Code de la consommation).",
  "accord": "Bon pour accord, date et signature précédées de la mention « lu et approuvé » :",
  "tva_debits": false,
  "libre": ""
}'::jsonb)
ON CONFLICT (pae_cle) DO NOTHING;
