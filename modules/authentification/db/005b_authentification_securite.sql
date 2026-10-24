-- Module Authentification : sécurité de la connexion demandée par le module Droits (ANALYSE-MODULE-DROITS.md) ; rejouable.

-- Usurpation (D14, D27 : administrateur seulement, jamais un autre administrateur) : la session de l'administrateur
-- agit pour le compte usurpé jusqu'à la fin indiquée ; motif obligatoire ; chaque écriture est journalisée.
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_usurpe_cpt_id BIGINT REFERENCES compte(cpt_id) ON DELETE SET NULL;
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_usurpation_fin TIMESTAMPTZ;
ALTER TABLE session_utilisateur ADD COLUMN IF NOT EXISTS ses_usurpation_motif VARCHAR(200);

INSERT INTO parametre_authentification (pau_cle, pau_valeur) VALUES
 -- Usurpation : durée maximale (minutes), notification au compte usurpé.
 ('usurpation', '{"minutes": 60, "notifier": true}')
ON CONFLICT (pau_cle) DO NOTHING;

ALTER TABLE journal_connexion DROP CONSTRAINT IF EXISTS journal_connexion_jco_evenement_check;
ALTER TABLE journal_connexion ADD CONSTRAINT journal_connexion_jco_evenement_check CHECK (jco_evenement IN ('CONNEXION', 'ECHEC', 'VERROUILLAGE',
    'DECONNEXION', 'MDP_CHANGE', 'MDP_REINITIALISE', 'EXPIRE', 'REFUS', 'DEVERROUILLAGE', 'COMPTE', 'MDP_OUBLI',
    'USURPATION', 'USURPATION_FIN', 'USURPATION_ACTION'));
