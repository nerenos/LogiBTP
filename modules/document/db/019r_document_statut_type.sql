-- Module Document : statut d'un document pris dans les statuts de son propre type.
-- Une transformation (commande d'un devis, facture d'une commande…) ou un avoir créait la copie avec le brouillon du type
-- d'origine (DocumentService.Dupliquer lisait le statut avant de changer de type) : la page affichait un statut vide.
-- Rejouable : remet le statut de même code du bon type, sinon son brouillon.
UPDATE document d
SET ent_std_id = coalesce(
    (SELECT c.std_id FROM statut_document c WHERE c.std_tyd_id = d.ent_tyd_id AND c.std_code = s.std_code),
    (SELECT b.std_id FROM statut_document b WHERE b.std_tyd_id = d.ent_tyd_id AND b.std_code = 'BROUILLON'))
FROM statut_document s
WHERE s.std_id = d.ent_std_id AND s.std_tyd_id <> d.ent_tyd_id;
