-- =============================================================================
-- Cœur – module Relances, lot 6 (plans/relances.md, Q11, Q20). Rejouable.
--
-- Modèles de courriel des relances (module Mail, usage RELANCE), un par nature et par niveau de la règle par défaut :
-- mmo_type = « <NATURE>_<niveau> » (DEVIS_1…3, FACTURE_1…3). Choix à l'envoi (Btp/SpecialisationRelanceBtp) : modèle du
-- niveau de la règle (modele_courriel), sinon celui de la nature et du niveau, sinon le plus haut niveau inférieur de la
-- nature (niveaux 4 et 5). Modifiables dans /parametres/mail ; jamais remplacés une fois créés.
-- Variables : tiers, contact, pieces (liste des pièces), nombre, montant (total relancé TTC), jours_retard (le plus
-- grand), echeances (échéances échues des factures), tableau (pièces en tableau HTML), niveau, charge, commentaire,
-- utilisateur, date.
-- =============================================================================

INSERT INTO mail_modele (mmo_code, mmo_libelle, mmo_usage, mmo_type, mmo_objet, mmo_corps_html, mmo_defaut) VALUES
 ('RELANCE_DEVIS_1', 'Relance d''un devis : niveau 1', 'RELANCE', 'DEVIS_1', 'Notre proposition – {{pieces}}',
  '<p>Bonjour {{contact}},</p><p>Nous revenons vers vous au sujet de notre proposition ({{pieces}}), d''un montant de {{montant}} TTC, que vous trouverez de nouveau en pièce jointe.</p><p>Avez-vous pu en prendre connaissance ? Nous restons à votre disposition pour toute question ou adaptation.</p>{{tableau}}<p>Cordialement,<br>{{charge}}</p>', TRUE),
 ('RELANCE_DEVIS_2', 'Relance d''un devis : niveau 2', 'RELANCE', 'DEVIS_2', 'Relance – notre proposition {{pieces}}',
  '<p>Bonjour {{contact}},</p><p>Sauf erreur de notre part, nous n''avons pas encore reçu votre réponse à notre proposition ({{pieces}}, {{montant}} TTC), jointe à nouveau.</p><p>Pouvez-vous nous indiquer où en est votre réflexion ? Nous serions heureux d''en parler avec vous.</p>{{tableau}}<p>Cordialement,<br>{{charge}}</p>', FALSE),
 ('RELANCE_DEVIS_3', 'Relance d''un devis : niveau 3', 'RELANCE', 'DEVIS_3', 'Dernière relance – notre proposition {{pieces}}',
  '<p>Bonjour {{contact}},</p><p>Nous nous permettons une dernière relance au sujet de notre proposition ({{pieces}}, {{montant}} TTC), jointe à ce courriel.</p><p>Sans nouvelle de votre part, nous considérerons que le projet n''est plus d''actualité. N''hésitez pas à nous contacter si nous pouvons encore vous aider.</p>{{tableau}}<p>Cordialement,<br>{{charge}}</p>', FALSE),
 ('RELANCE_FACTURE_1', 'Relance d''une facture : niveau 1', 'RELANCE', 'FACTURE_1', 'Rappel d''échéance – {{pieces}}',
  '<p>Bonjour {{contact}},</p><p>Sauf erreur de notre part, le règlement des pièces ci-dessous ne nous est pas encore parvenu : il reste dû {{montant}} TTC, échu depuis {{jours_retard}} jours.</p>{{tableau}}<p>Échéances concernées : {{echeances}}.</p><p>Nous vous remercions de bien vouloir procéder à ce règlement. Si celui-ci a été effectué entre-temps, merci de ne pas tenir compte de ce message.</p><p>Cordialement,<br>{{charge}}</p>', TRUE),
 ('RELANCE_FACTURE_2', 'Relance d''une facture : niveau 2', 'RELANCE', 'FACTURE_2', 'Deuxième relance – {{pieces}}',
  '<p>Bonjour {{contact}},</p><p>Malgré notre précédent rappel, nous restons dans l''attente du règlement de {{montant}} TTC, échu depuis {{jours_retard}} jours.</p>{{tableau}}<p>Échéances concernées : {{echeances}}.</p><p>Merci de régulariser cette situation dans les meilleurs délais ou de nous faire part de toute difficulté.</p><p>Cordialement,<br>{{charge}}</p>', FALSE),
 ('RELANCE_FACTURE_3', 'Relance d''une facture : niveau 3', 'RELANCE', 'FACTURE_3', 'Dernier rappel avant mise en demeure – {{pieces}}',
  '<p>Bonjour {{contact}},</p><p>En dépit de nos relances, la somme de {{montant}} TTC, échue depuis {{jours_retard}} jours, reste impayée.</p>{{tableau}}<p>Échéances concernées : {{echeances}}.</p><p>Sans règlement de votre part sous huit jours, nous serons contraints de vous adresser une mise en demeure.</p><p>Cordialement,<br>{{charge}}</p>', FALSE)
ON CONFLICT (mmo_code) DO NOTHING;
