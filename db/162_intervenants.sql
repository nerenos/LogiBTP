-- Intervenants (petit annuaire) des projets, affaires, chantiers, marchés et documents : tiers de l'annuaire (personne)
-- et/ou contact (individu) avec une fonction (client, architecte, bureau de contrôle, sous-traitant, payeur, validation
-- des situations…). Ils servent à joindre les bonnes personnes et, plus tard, au module de courriels.
--  - Structure : table intervenant (une ligne par intervenant, rattachée à un seul objet).
--  - Documents : instantané ent_intervenants (JSONB) dans l'entête : enregistré, figé à la validation et copié à la
--    transformation avec le document ; repris du marché ou du chantier à la saisie.
-- Les fonctions sont répliquées dans client/src/app/structure/donnees.js (FONCTIONS_INTERVENANT, test structure).

CREATE TABLE fonction_intervenant (
    fin_code            VARCHAR(30)   PRIMARY KEY,
    fin_libelle         VARCHAR(80)   NOT NULL,
    fin_portee          CHAR(1)       NOT NULL DEFAULT 'T' CHECK (fin_portee IN ('S', 'D', 'T')), -- structure, document, tous
    fin_unique          BOOLEAN       NOT NULL DEFAULT FALSE,   -- un seul intervenant de cette fonction par objet
    fin_paiement_direct BOOLEAN       NOT NULL DEFAULT FALSE,   -- paiement direct possible (sous-traitant)
    fin_ordre           INT           NOT NULL DEFAULT 0,
    fin_actif           BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO fonction_intervenant (fin_code, fin_libelle, fin_portee, fin_unique, fin_paiement_direct, fin_ordre) VALUES
('CLIENT', 'Client / maître d''ouvrage', 'T', TRUE, FALSE, 10),
('MOA_DELEGUE', 'Maître d''ouvrage délégué', 'S', FALSE, FALSE, 20),
('ARCHITECTE', 'Architecte', 'S', FALSE, FALSE, 30),
('MOE', 'Maître d''œuvre', 'S', FALSE, FALSE, 40),
('BE', 'Bureau d''études', 'S', FALSE, FALSE, 50),
('BC', 'Bureau de contrôle', 'S', FALSE, FALSE, 60),
('CSPS', 'Coordonnateur SPS', 'S', FALSE, FALSE, 70),
('ECONOMISTE', 'Économiste', 'S', FALSE, FALSE, 80),
('MANDATAIRE', 'Mandataire du groupement', 'S', TRUE, FALSE, 90),
('COTRAITANT', 'Cotraitant', 'S', FALSE, FALSE, 100),
('SOUS_TRAITANT', 'Sous-traitant', 'T', FALSE, TRUE, 110),
('PAYEUR', 'Payeur', 'T', TRUE, FALSE, 120),
('DESTINATAIRE', 'Destinataire des documents', 'T', FALSE, FALSE, 130),
('VALIDATION_SITUATION', 'Validation des situations', 'T', FALSE, FALSE, 140),
('FOURNISSEUR', 'Fournisseur', 'D', TRUE, FALSE, 150),
('LIVRAISON', 'Contact de livraison', 'D', FALSE, FALSE, 160),
('AUTRE', 'Autre', 'T', FALSE, FALSE, 990);

CREATE TABLE intervenant (
    itv_id              SERIAL        PRIMARY KEY,
    itv_prj_id          INT           REFERENCES projet(prj_id) ON DELETE CASCADE,
    itv_aff_id          INT           REFERENCES affaire(aff_id) ON DELETE CASCADE,
    itv_cha_id          INT           REFERENCES chantier(cha_id) ON DELETE CASCADE,
    itv_mar_id          INT           REFERENCES marche(mar_id) ON DELETE CASCADE,
    itv_fin_code        VARCHAR(30)   NOT NULL REFERENCES fonction_intervenant(fin_code),
    itv_per_id          BIGINT        REFERENCES personne(per_id) ON DELETE CASCADE,  -- tiers
    itv_ind_id          BIGINT        REFERENCES individu(ind_id) ON DELETE SET NULL, -- contact
    itv_principal       BOOLEAN       NOT NULL DEFAULT FALSE,
    itv_paiement_direct BOOLEAN       NOT NULL DEFAULT FALSE,   -- information (montants : gestion de la sous-traitance)
    itv_commentaire     TEXT,
    itv_ordre           INT           NOT NULL DEFAULT 0,
    CONSTRAINT itv_un_objet CHECK (num_nonnulls(itv_prj_id, itv_aff_id, itv_cha_id, itv_mar_id) = 1),
    CONSTRAINT itv_tiers_ou_contact CHECK (itv_per_id IS NOT NULL OR itv_ind_id IS NOT NULL)
);
CREATE INDEX ix_intervenant_prj ON intervenant (itv_prj_id) WHERE itv_prj_id IS NOT NULL;
CREATE INDEX ix_intervenant_aff ON intervenant (itv_aff_id) WHERE itv_aff_id IS NOT NULL;
CREATE INDEX ix_intervenant_cha ON intervenant (itv_cha_id) WHERE itv_cha_id IS NOT NULL;
CREATE INDEX ix_intervenant_mar ON intervenant (itv_mar_id) WHERE itv_mar_id IS NOT NULL;
CREATE INDEX ix_intervenant_per ON intervenant (itv_per_id);
CREATE INDEX ix_intervenant_ind ON intervenant (itv_ind_id);

-- Documents : [{ fonction, per_id, tiers, ind_id, contact, principal, paiement_direct, commentaire }]
-- (tiers et contact : noms au moment de la saisie, pour l'affichage et l'impression).
ALTER TABLE document ADD COLUMN ent_intervenants JSONB;

-- Intervenants de tous les objets (structure et documents) avec leurs noms : où intervient un tiers ou un contact,
-- destinataires d'un courriel.
CREATE VIEW v_intervenants AS
SELECT CASE WHEN i.itv_prj_id IS NOT NULL THEN 'projet' WHEN i.itv_aff_id IS NOT NULL THEN 'affaire'
            WHEN i.itv_cha_id IS NOT NULL THEN 'chantier' ELSE 'marche' END AS objet,
       coalesce(i.itv_prj_id, i.itv_aff_id, i.itv_cha_id, i.itv_mar_id)::BIGINT AS objet_id,
       i.itv_fin_code AS fonction, f.fin_libelle AS fonction_libelle, i.itv_per_id AS per_id, p.per_raison_sociale AS tiers,
       i.itv_ind_id AS ind_id, nullif(trim(concat_ws(' ', d.ind_prenom, d.ind_nom)), '') AS contact, i.itv_principal AS principal,
       i.itv_paiement_direct AS paiement_direct
FROM intervenant i
JOIN fonction_intervenant f ON f.fin_code = i.itv_fin_code
LEFT JOIN personne p ON p.per_id = i.itv_per_id
LEFT JOIN individu d ON d.ind_id = i.itv_ind_id
UNION ALL
SELECT 'document', e.ent_id, x->>'fonction', f.fin_libelle, (x->>'per_id')::BIGINT, coalesce(p.per_raison_sociale, x->>'tiers'),
       (x->>'ind_id')::BIGINT, coalesce(nullif(trim(concat_ws(' ', d.ind_prenom, d.ind_nom)), ''), x->>'contact'),
       coalesce((x->>'principal')::BOOLEAN, FALSE), coalesce((x->>'paiement_direct')::BOOLEAN, FALSE)
FROM document e
CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.ent_intervenants, '[]'::JSONB)) x
LEFT JOIN fonction_intervenant f ON f.fin_code = x->>'fonction'
LEFT JOIN personne p ON p.per_id = (x->>'per_id')::BIGINT
LEFT JOIN individu d ON d.ind_id = (x->>'ind_id')::BIGINT;
