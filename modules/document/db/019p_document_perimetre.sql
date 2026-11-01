-- =============================================================================
-- Module Document – périmètre unique des pièces valables (analyse du module Rentabilité, A5).
--
-- Une pièce valable est validée par l'entreprise (verrouillée), indice de référence de son groupe, et pas remplacée
-- par un indice suivant (REMPLACE : version d'origine d'une pièce dévalidée, restée verrouillée). Une pièce annulée
-- (ANNULE) reste dans le périmètre, marquée `annule` : avec son avoir d'annulation (lui aussi ANNULE), elle se compense.
-- Pour lire un état (commande en cours, montant d'un marché, précédents d'un avancement), écarter aussi les pièces
-- annulées : `NOT annule`, ou `f_document_valable(id, FALSE)`.
--
-- Même règle en C# : `PerimetreDocuments` (LogiBTP.Documents.Web). Toute requête qui somme des pièces passe par l'un ou
-- l'autre, jamais par `ent_verrouille` seul. Rejouable.
-- =============================================================================

CREATE OR REPLACE VIEW v_document_valable AS
SELECT d.ent_id, s.std_code = 'ANNULE' AS annule
FROM document d
JOIN statut_document s ON s.std_id = d.ent_std_id
WHERE d.ent_verrouille AND d.ent_is_reference AND s.std_code <> 'REMPLACE';

COMMENT ON VIEW v_document_valable IS 'Pièces valables : verrouillées, indice de référence, non remplacées ; annule = pièce annulée (compensée par son avoir)';

CREATE OR REPLACE FUNCTION f_document_valable(p_ent BIGINT, p_annulees BOOLEAN DEFAULT TRUE) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM v_document_valable v WHERE v.ent_id = p_ent AND (p_annulees OR NOT v.annule));
$$;

COMMENT ON FUNCTION f_document_valable(BIGINT, BOOLEAN) IS 'Pièce valable (v_document_valable) ; p_annulees = FALSE écarte aussi les pièces annulées';
