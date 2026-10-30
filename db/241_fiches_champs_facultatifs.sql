-- =============================================================================
-- Cœur LogiBTP – champs des fiches salarié et matériel rendus facultatifs (client/src/app/fiches/definitions.js) :
-- poste, contrat, date d'entrée, salaire brut ; révision, contrôle réglementaire, valeur et date d'achat.
-- Colonnes sans valeur par défaut : une saisie vide écrit NULL (ConstructeurFiche). Rejouable.
-- =============================================================================

ALTER TABLE salarie
    ALTER COLUMN sal_poste DROP NOT NULL,
    ALTER COLUMN sal_statut DROP NOT NULL,
    ALTER COLUMN sal_date_entree DROP NOT NULL,
    ALTER COLUMN sal_salaire DROP NOT NULL;

ALTER TABLE materiel
    ALTER COLUMN mat_heures_revision DROP NOT NULL,
    ALTER COLUMN mat_controle_ok DROP NOT NULL,
    ALTER COLUMN mat_valeur_achat DROP NOT NULL,
    ALTER COLUMN mat_date_achat DROP NOT NULL;
