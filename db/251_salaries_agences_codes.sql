-- =============================================================================
-- Cœur – salariés (analyse d'ergonomie du 31/10/2026, FS2 et FS3). Rejouable.
--
-- Agence d'un salarié = personne de l'annuaire : notre société ou l'un de ses niveaux inférieurs (agence,
-- établissement, service ; pas les dépôts) : sal_agence_per_id. sal_agence garde le nom court de l'agence (nom
-- commercial, sinon raison sociale), tenu par trigger : clé des zones de déplacement et de la règle de paie REPAS du
-- module Pointage. Le rattachement de l'individu du salarié suit (SalariesAnnuaire.cs).
--
-- Code et matricule : le code du salarié (sal_code, 10 caractères, unique) est son identifiant ; sal_matricule n'est
-- plus saisi, il recopie le code (lu encore par des vues et des écrans, retiré à un lot suivant) ; le matricule de paie
-- reprend l'ancien matricule là où il était vide (l'export de paie ne change pas).
-- =============================================================================

ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_agence_per_id INT REFERENCES personne (per_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_sal_agence_per ON salarie (sal_agence_per_id);

-- Agences proposées : notre société (per_societe_base) et ses niveaux inférieurs, hors dépôts.
CREATE OR REPLACE VIEW v_agences_societe AS
WITH RECURSIVE arbre AS (
    SELECT p.per_id, 0 AS profondeur FROM personne p WHERE p.per_societe_base
    UNION ALL
    SELECT e.per_id, a.profondeur + 1 FROM personne e JOIN arbre a ON e.per_parent_id = a.per_id WHERE a.profondeur < 5
)
SELECT p.per_id,
       left(coalesce(nullif(trim(p.per_nom_commercial), ''), p.per_raison_sociale), 30) AS nom,
       p.per_raison_sociale AS raison_sociale, p.per_niv_code AS niveau, a.profondeur, p.per_actif AS actif
FROM arbre a JOIN personne p ON p.per_id = a.per_id
WHERE p.per_niv_code <> 'DEPOT';

-- Reprise : agence texte → personne (nom court, raison sociale, ou raison sociale finissant par le nom : « … Agence de
-- Grenoble ») ; sans correspondance, notre société. Le nom commercial vide d'une agence reconnue par la fin de sa
-- raison sociale reçoit l'ancien texte : les clés du Pointage (zones, REPAS) restent les mêmes.
WITH correspondance AS (
    SELECT DISTINCT ON (s.sal_agence) s.sal_agence AS texte, a.per_id, (a.nom <> s.sal_agence AND a.raison_sociale ILIKE '%' || s.sal_agence) AS par_fin
    FROM (SELECT DISTINCT sal_agence FROM salarie WHERE sal_agence_per_id IS NULL AND sal_agence IS NOT NULL) s
    JOIN v_agences_societe a ON a.nom = s.sal_agence OR a.raison_sociale = s.sal_agence OR a.raison_sociale ILIKE '%' || s.sal_agence
    ORDER BY s.sal_agence, (a.nom = s.sal_agence) DESC, (a.raison_sociale = s.sal_agence) DESC, a.profondeur DESC
)
UPDATE personne p SET per_nom_commercial = c.texte, per_modifie_le = now()
FROM correspondance c
WHERE p.per_id = c.per_id AND c.par_fin AND nullif(trim(p.per_nom_commercial), '') IS NULL;

UPDATE salarie s SET sal_agence_per_id = coalesce(
        (SELECT a.per_id FROM v_agences_societe a WHERE a.nom = s.sal_agence ORDER BY a.profondeur DESC LIMIT 1),
        (SELECT a.per_id FROM v_agences_societe a WHERE a.profondeur = 0))
WHERE s.sal_agence_per_id IS NULL AND s.sal_agence IS NOT NULL;

-- Clés du Pointage (zones de déplacement, valeurs de la règle REPAS) : ancien texte → nom court de l'agence, puis
-- le salarié prend ce nom.
DROP TABLE IF EXISTS agence_renommee;
CREATE TEMP TABLE agence_renommee AS
SELECT DISTINCT s.sal_agence AS ancien, a.nom AS nouveau
FROM salarie s JOIN v_agences_societe a ON a.per_id = s.sal_agence_per_id
WHERE s.sal_agence IS DISTINCT FROM a.nom AND s.sal_agence IS NOT NULL;
UPDATE poi_zone_chantier z SET pzc_agence = r.nouveau FROM agence_renommee r
 WHERE z.pzc_agence = r.ancien AND NOT EXISTS (SELECT 1 FROM poi_zone_chantier x WHERE x.pzc_cha_id = z.pzc_cha_id AND x.pzc_agence = r.nouveau);
UPDATE poi_regle g SET prg_parametres = jsonb_set(g.prg_parametres, '{valeurs}', (g.prg_parametres->'valeurs') - r.ancien
           || jsonb_build_object(r.nouveau, g.prg_parametres->'valeurs'->r.ancien))
  FROM agence_renommee r
 WHERE g.prg_type = 'REPAS' AND g.prg_parametres->'valeurs' ? r.ancien;
UPDATE salarie s SET sal_agence = a.nom FROM v_agences_societe a WHERE a.per_id = s.sal_agence_per_id AND s.sal_agence IS DISTINCT FROM a.nom;
DROP TABLE agence_renommee;

-- Code : reprise du matricule là où il manque, matricule de paie = ancien matricule là où il est vide ; puis le
-- matricule recopie le code (en deux temps : l'unicité du matricule est contrôlée ligne à ligne).
UPDATE salarie SET sal_code = sal_matricule WHERE sal_code IS NULL;
UPDATE salarie SET sal_matricule_paie = sal_matricule WHERE sal_matricule_paie IS NULL AND sal_matricule <> left(sal_code, 10);
UPDATE salarie SET sal_matricule = '~' || sal_id WHERE sal_matricule IS DISTINCT FROM left(sal_code, 10);
UPDATE salarie SET sal_matricule = left(sal_code, 10) WHERE sal_matricule LIKE '~%';
CREATE UNIQUE INDEX IF NOT EXISTS ux_sal_code ON salarie (sal_code);

-- Nom court de l'agence et matricule recopiés à chaque écriture.
CREATE OR REPLACE FUNCTION f_salarie_agence_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sal_agence_per_id IS NULL THEN
        NEW.sal_agence := NULL;
    ELSE
        NEW.sal_agence := (SELECT left(coalesce(nullif(trim(per_nom_commercial), ''), per_raison_sociale), 30)
                           FROM personne WHERE per_id = NEW.sal_agence_per_id);
    END IF;
    NEW.sal_matricule := coalesce(left(NEW.sal_code, 10), NEW.sal_matricule, '~' || NEW.sal_id);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_salarie_agence_code ON salarie;
CREATE TRIGGER tr_salarie_agence_code BEFORE INSERT OR UPDATE OF sal_agence_per_id, sal_code, sal_agence, sal_matricule ON salarie
    FOR EACH ROW EXECUTE FUNCTION f_salarie_agence_code();

-- Nom commercial ou raison sociale d'une agence modifiés : le nom court des salariés suit, ainsi que les clés du
-- Pointage (zones de déplacement, valeurs de la règle REPAS).
CREATE OR REPLACE FUNCTION f_personne_agence_salaries() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    ancien TEXT := left(coalesce(nullif(trim(OLD.per_nom_commercial), ''), OLD.per_raison_sociale), 30);
    nouveau TEXT := left(coalesce(nullif(trim(NEW.per_nom_commercial), ''), NEW.per_raison_sociale), 30);
BEGIN
    IF ancien IS DISTINCT FROM nouveau AND EXISTS (SELECT 1 FROM salarie WHERE sal_agence_per_id = NEW.per_id) THEN
        UPDATE salarie SET sal_agence = nouveau WHERE sal_agence_per_id = NEW.per_id;
        UPDATE poi_zone_chantier z SET pzc_agence = nouveau WHERE z.pzc_agence = ancien
           AND NOT EXISTS (SELECT 1 FROM poi_zone_chantier x WHERE x.pzc_cha_id = z.pzc_cha_id AND x.pzc_agence = nouveau);
        UPDATE poi_regle SET prg_parametres = jsonb_set(prg_parametres, '{valeurs}', (prg_parametres->'valeurs') - ancien
                   || jsonb_build_object(nouveau, prg_parametres->'valeurs'->ancien))
         WHERE prg_type = 'REPAS' AND prg_parametres->'valeurs' ? ancien;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_personne_agence_salaries ON personne;
CREATE TRIGGER tr_personne_agence_salaries AFTER UPDATE OF per_nom_commercial, per_raison_sociale ON personne
    FOR EACH ROW EXECUTE FUNCTION f_personne_agence_salaries();

-- Vues de liste par défaut des salariés (2 et 4) : la colonne Matricule (doublon du code) est retirée.
UPDATE vue_liste v
   SET vli_definition = jsonb_set(v.vli_definition, '{colonnes}',
       (SELECT coalesce(jsonb_agg(c ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(v.vli_definition->'colonnes') WITH ORDINALITY AS t(c, o) WHERE c->>'code' <> 'matricule'))
 WHERE v.vli_id IN (2, 4)
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.vli_definition->'colonnes') c WHERE c->>'code' = 'matricule');
