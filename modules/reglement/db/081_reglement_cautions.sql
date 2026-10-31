-- Module Règlements : cautions de retenue de garantie (décision du 31/10/2026, lot F).
-- Une caution ne pointe plus les retenues : elle remplace la retenue (part cautionnée exigible avec la pièce) et sa
-- consommation sur les retenues du tiers est calculée (ResteAPayer.ConsommerCautions). Les anciens pointages de caution
-- (qui soldaient à tort la retenue) sont retirés. Rejouable.
DELETE FROM pointage WHERE poi_cau_id IS NOT NULL;

COMMENT ON TABLE caution IS 'Caution d''un tiers remplaçant la retenue de garantie (objet marche, sinon toutes les retenues du tiers) ; consommation calculée, aucun pointage.';
