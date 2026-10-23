# Conception – Module Mail

Analyse : [ANALYSE-MODULE-MAIL.md](ANALYSE-MODULE-MAIL.md).

## Décisions techniques — session du 23/10/2026

### Principe
- **Module toujours présent** (hors `module_societe`). Sans compte d'envoi : 409 `MAIL_NON_CONFIGURE`, et les fonctions qui en dépendent sont refusées.
- **Sans métier** : le module ne connaît ni la GED, ni les documents, ni le CRM, ni les notifications, ni OAuth. Le cœur fournit tout par `SpecialisationMail` (`Btp/MailBtp.cs`) ; le jeton OAuth passe par `IFournisseurJeton` du socle.
- **Comptes système seulement** (adresses de service), désignés à l'écran par un alias (`mail_alias`). L'identité et la connexion sont chiffrées, l'adresse est comparée par empreinte HMAC et affichée à un administrateur sur demande, journalisée. Authentification par mot de passe (Exchange OVH) ou OAuth 2.0 (Gmail).
- MailKit 4.18.2 pour SMTP, IMAP et MIME ; HtmlSanitizer pour nettoyer côté serveur les corps, signatures et modèles.

### Envoi (lots 1 et 2)
- **Tout courriel passe par une file** (`mail_message`), traitée par un service de fond par base (15 s). Raison : respecter les limitations des hébergeurs et ne jamais bloquer l'utilisateur.
- **Créneau calculé** (`ReglesEnvoi.Calculer`) à la mise en file et à chaque passage, à partir du journal : débit par minute, quotas horaire et journalier **comptés en destinataires** (une réserve du quota est gardée pour les priorités haute et normale), messages par heure et par domaine, nouveaux destinataires par jour. Limites par défaut selon l'hébergeur, modifiables par compte.
- Priorités : envoi d'un utilisateur = HAUTE ; envoi groupé (découpage au-delà du nombre de destinataires par message : A et CC sur le premier, CCI répartis) = BASSE, en lot avec lissage. Au-delà d'un seuil, l'utilisateur confirme l'envoi groupé (409 `MAIL_CONFIRMATION` avec l'estimation). L'utilisateur voit la position, le départ estimé et la cause d'une attente.
- **Erreurs classées** : temporaire → nouvel essai (1, 5, 15, 60 min) ; définitive → ERREUR et auteur prévenu ; authentification → compte en ERREUR, administrateurs prévenus ; blocage (quota, spam) → compte SUSPENDU, reprise manuelle. Un jeton OAuth à reconnecter fait attendre le courriel 15 minutes.
- Journal `mail_journal` : une ligne par tentative (destinataires, nouveaux, domaines, code et réponse SMTP).
- Envoi d'un document : pièces « à envoyer » de la GED, courriel rangé en GED, statut ENVOYE, note du CRM.
- **Envois automatiques** (`EnvoyerAutomatiqueAsync`, usage → expéditeur, sans confirmation), toujours depuis le cœur : canal courriel des notifications (`CanalCourrielBtp` implémente `ICanalNotification`, ajouté au module Notifications, avec la préférence « par courriel »), mot de passe oublié par lien à usage unique (module Authentification : `reinitialisation_mdp`, `/auth/oubli`, `/auth/reinitialiser`, priorité haute), bordereaux de diffusion du CRM.

### Réception (lot 3)
- **Relève IMAP par UID** des dossiers choisis (UIDVALIDITY changé : reprise sur N jours ; 200 au plus par dossier ; en-têtes seuls au-delà de la taille maximale). **Jamais de suppression sur le serveur** : seulement marquer lus, déplacer vers un dossier des traités ou retirer le drapeau, selon les options du compte. Relève horaire par défaut.
- Courriel reçu lu par MimeKit, HTML nettoyé (images distantes et scripts retirés), rangé dans la GED de sa boîte. Visible par un administrateur ou un membre d'un des services du compte.
- **Avis de non-remise** (RFC 3464) rapprochés de l'envoi par le Message-ID d'origine : destinataires marqués, alerte à l'auteur (aux administrateurs pour un envoi automatique), adresse signalable dans l'annuaire (`coo_non_remis_le`).
- Liste « À rapprocher », rattachement manuel, détacher, ignorer ; purge des courriels non rapprochés après 90 jours.

### Reconnaissance (lot 4)
- Règle répliquée entre `reconnaissance.js` (`@logibtp/mail`, pour l'essai des règles à l'écran) et `ReconnaissanceMail.cs` (jeu `01_reconnaissance`). Normalisation par une table d'accents explicite, le C# tournant sans globalisation, et comparaison par mots entiers.
- Nature = première règle (`mail_regle`, livrées ARC, DEVIS, FACTURE, BL, RELANCE) dont l'expéditeur et un mot s'appliquent. Scores des candidats fournis par le cœur (`CandidatsAsync`) : fil (In-Reply-To, References) 100, numéro dans l'objet 70, dans le texte ou le nom d'une pièce 60, dans le texte des pièces 50, référence 40, tiers de l'expéditeur 50 / 20.
- Décision : IGNORE, RATTACHE (fil, ou un seul candidat au-dessus du seuil haut 80), PROPOSE (au-dessus du seuil bas 40), sinon A_RAPPROCHER. Un rattachement automatique alerte le service (tâche du CRM ou notification).
- **Jamais de changement de statut automatique** d'un document à partir d'un courriel reçu.
