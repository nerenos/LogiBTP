-- =============================================================================
-- Cœur – clé du métré vers sa ligne (fk_mtr_ligne, db/100) différable, contrôlée immédiatement par défaut (rien ne
-- change pour l'application). La reprise de données la diffère dans sa transaction (SET CONSTRAINTS … DEFERRED) :
-- chaque métré écrit verrouillait sa ligne (contrôle de la clé), puis la ligne recevait lig_mtr_id ; verrou puis
-- mise à jour de la même ligne dans une transaction de centaines de milliers de lignes : écriture de plus en plus lente.
-- Différée, la clé est contrôlée une fois pour toutes à la fin de la transaction.
-- =============================================================================

ALTER TABLE metre ALTER CONSTRAINT fk_mtr_ligne DEFERRABLE INITIALLY IMMEDIATE;
