-- =============================================================================
-- Cœur LogiBTP – valeurs initiales des règles des documents (CONCEPTION-REGLES-DOCUMENTS.md, § 6 et § 8) : par famille
-- et par type ; le reste prend la valeur globale ou celle du catalogue. Rejouable (une valeur déjà paramétrée est gardée).
-- =============================================================================

-- Par type de document.
INSERT INTO regle_document (rdo_code, rdo_tyd_id, rdo_valeur)
SELECT v.code, t.tyd_id, v.valeur::jsonb
FROM (VALUES
  -- Pièces comptables (P9) : factures et avoirs des ventes et des achats, factures d'avancement et d'acompte, inventaire.
  ('PIECE_COMPTABLE', 'V_FACTURE', 'true'), ('PIECE_COMPTABLE', 'V_AVOIR', 'true'), ('PIECE_COMPTABLE', 'V_FACTURE_AVT', 'true'),
  ('PIECE_COMPTABLE', 'V_FACTURE_ACOMPTE', 'true'), ('PIECE_COMPTABLE', 'A_FACTURE', 'true'), ('PIECE_COMPTABLE', 'A_AVOIR', 'true'),
  ('PIECE_COMPTABLE', 'A_FACTURE_AVT', 'true'), ('PIECE_COMPTABLE', 'S_INVENTAIRE', 'true'),
  -- Statuts automatiques (P4) : commandes et BL ; devis : facturation directe seulement.
  ('STATUTS_AUTO', 'V_DEVIS', 'true'), ('STATUTS_AUTO', 'V_COMMANDE', 'true'), ('STATUTS_AUTO', 'V_RECEPTION', 'true'),
  ('STATUTS_AUTO', 'A_DEVIS', 'true'), ('STATUTS_AUTO', 'A_COMMANDE', 'true'), ('STATUTS_AUTO', 'A_RECEPTION', 'true'),
  -- Documents sans validation du tiers : reprise d'avancement, reçu d'acompte.
  ('VALIDATION_TIERS', 'V_REPRISE_AVT', 'false'), ('VALIDATION_TIERS', 'V_RECU_ACOMPTE', 'false'),
  -- Indices : pas sur les pièces comptables (la dévalidation en crée un).
  ('INDICE', 'V_FACTURE', 'false'), ('INDICE', 'V_AVOIR', 'false'), ('INDICE', 'V_FACTURE_AVT', 'false'), ('INDICE', 'V_FACTURE_ACOMPTE', 'false'),
  ('INDICE', 'A_FACTURE', 'false'), ('INDICE', 'A_AVOIR', 'false'),
  -- Documents d'avancement : texte et pied seulement (R11).
  ('LIGNES_AUTORISEES', 'V_SITUATION', '"TEXTE_PIED"'), ('LIGNES_AUTORISEES', 'V_FACTURE_AVT', '"TEXTE_PIED"'), ('LIGNES_AUTORISEES', 'A_FACTURE_AVT', '"TEXTE_PIED"'),
  -- Fin de validité des devis (R3).
  ('VALIDITE_ALERTE', 'V_DEVIS', 'true'), ('VALIDITE_ALERTE', 'A_DEVIS', 'true'),
  -- Total nul : avertissement sur une facture (R8).
  ('MONTANT_NUL', 'V_FACTURE', '"AVERTISSEMENT"'), ('MONTANT_NUL', 'A_FACTURE', '"AVERTISSEMENT"'),
  -- Référence du fournisseur en double (R12).
  ('REFERENCE_EXTERNE_UNIQUE', 'A_FACTURE', 'true'), ('REFERENCE_EXTERNE_UNIQUE', 'A_AVOIR', 'true'),
  -- Postes du marché (R10, I2) : factures d'avancement et factures simples.
  ('POSTES_MARCHE', 'V_FACTURE', 'true'), ('POSTES_MARCHE', 'V_FACTURE_AVT', 'true'),
  -- Marge minimale (R14) : devis et factures directes.
  ('MARGE_MIN', 'V_DEVIS', '-1'), ('MARGE_MIN', 'V_FACTURE', '-1'),
  -- Écart de prix d'achat (R16).
  ('PRIX_ACHAT_ECART', 'A_FACTURE', '0')
) AS v(code, type, valeur)
JOIN type_document t ON t.tyd_code = v.type
ON CONFLICT DO NOTHING;

-- Par famille.
INSERT INTO regle_document (rdo_code, rdo_famille, rdo_valeur)
SELECT v.code, v.famille, v.valeur::jsonb
FROM (VALUES
  ('FRAIS_ANNEXES', 'V', 'true'),       -- frais annexes et coefficient de prorata : ventes seulement (P11)
  ('DATE_PIECE', 'V', 'true'),          -- chronologie des pièces comptables des ventes (R7)
  ('REMISE_MAX', 'V', '15'),            -- remise au-delà de 15 % : avertissement (R13)
  ('ENCOURS_CLIENT', 'V', '-1')         -- encours client : pas de seuil par défaut, fiche du tiers prioritaire (R15)
) AS v(code, famille, valeur)
ON CONFLICT DO NOTHING;
