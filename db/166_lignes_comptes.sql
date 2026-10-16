-- =============================================================================
-- Cœur LogiBTP – compte comptable des lignes et mode bordereau des ouvrages.
-- Les colonnes lig_cpt_code (code du compte) et lig_commentaire viennent du module Document (010) ; ce script ajoute :
--  * compte_comptable : plan de comptes minimal (code + libellé) pour afficher le libellé du compte d'une ligne ou d'une
--    nature (nat_compte_vente / nat_compte_achat), en attendant le module Comptabilité (qui pourra la remplacer) ;
--    aucune clé étrangère : un compte inconnu reste affiché par son code ;
--  * le mode de calcul des ouvrages B (bordereau : PV fixe de l'ouvrage sans ventilation sur les composantes),
--    utilisé par l'import OptimBTP.
-- Rejouable (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- =============================================================================

CREATE TABLE IF NOT EXISTS compte_comptable (
    cpt_code     VARCHAR(20)  PRIMARY KEY,
    cpt_libelle  VARCHAR(150) NOT NULL,
    cpt_actif    BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Comptes du plan comptable général utilisés par les natures de démonstration (et usuels du BTP).
INSERT INTO compte_comptable (cpt_code, cpt_libelle) VALUES
 ('601000', 'Achats stockés – matières premières et fournitures'),
 ('602000', 'Achats stockés – autres approvisionnements'),
 ('604000', 'Achats d''études et prestations de services'),
 ('604100', 'Achats de sous-traitance (fabrication)'),
 ('606000', 'Achats non stockés de matières et fournitures'),
 ('611000', 'Sous-traitance générale'),
 ('613500', 'Locations mobilières'),
 ('641100', 'Salaires et appointements'),
 ('681120', 'Dotations aux amortissements des immobilisations corporelles'),
 ('701000', 'Ventes de produits finis'),
 ('704000', 'Travaux'),
 ('706000', 'Prestations de services'),
 ('708000', 'Produits des activités annexes')
ON CONFLICT (cpt_code) DO NOTHING;

-- Mode de calcul des ouvrages : déboursé (D), somme des PV (V), bordereau (B).
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_ent_mode_calcul_ouvrage_check;
ALTER TABLE document ADD CONSTRAINT document_ent_mode_calcul_ouvrage_check CHECK (ent_mode_calcul_ouvrage IN ('D','V','B'));
