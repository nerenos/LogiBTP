-- =============================================================================
-- Module Annuaire – code du tiers de secours (rejouable). Le code d'un tiers vient du chrono des fiches (module Fiche :
-- fiche personne, ou IChronosFiches pour un tiers provisoire ou un compte particulier) ; une insertion sans code (script
-- SQL, reprise) reçoit encore T + identifiant, suffixé (-2, -3…) si ce code est déjà porté par un tiers du chrono.
-- =============================================================================

CREATE OR REPLACE FUNCTION f_personne_avant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    base TEXT;
    n    INT := 1;
BEGIN
    IF NEW.per_code IS NULL OR btrim(NEW.per_code) = '' THEN
        base := 'T' || lpad(NEW.per_id::text, 6, '0');
        NEW.per_code := base;
        WHILE EXISTS (SELECT 1 FROM personne WHERE per_code = NEW.per_code AND per_id <> NEW.per_id) LOOP
            n := n + 1;
            NEW.per_code := base || '-' || n;
        END LOOP;
    END IF;
    NEW.per_modifie_le := now();
    RETURN NEW;
END $$;
