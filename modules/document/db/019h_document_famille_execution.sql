-- Module Document – famille E (exécution) à côté de V (ventes), A (achats) et S (stock) : documents de travail transmis
-- de service en service (ANALYSE-MODULE-EXECUTION.md § 2, E1), non comptables ; les types sont déclarés par
-- l'application. Rejouable.

ALTER TABLE type_document DROP CONSTRAINT IF EXISTS type_document_tyd_famille_check;
ALTER TABLE type_document ADD CONSTRAINT type_document_tyd_famille_check CHECK (tyd_famille IN ('V', 'A', 'S', 'E'));

ALTER TABLE regle_document DROP CONSTRAINT IF EXISTS regle_document_rdo_famille_check;
ALTER TABLE regle_document ADD CONSTRAINT regle_document_rdo_famille_check CHECK (rdo_famille IN ('V', 'A', 'S', 'E'));
