# Module Mail – contexte

## But
Messagerie de l'application par des comptes système (SMTP / IMAP, mot de passe ou OAuth 2.0) : envoi depuis les éléments de l'application par une file soumise aux limitations du compte, journal, réception rangée en GED, avis de non-remise, reconnaissance et rattachement des courriels reçus.

## Contraintes absolues
- Toujours présent (hors `module_societe`) ; sans compte d'envoi : 409 `MAIL_NON_CONFIGURE`.
- Sans métier : ne connaît ni GED, ni documents, ni CRM, ni notifications, ni module OAuth. Tout passe par `SpecialisationMail` (cœur : `Btp/MailBtp.cs`) et par `IFournisseurJeton` du socle. JS `@logibtp/mail` sans dépendance ; .NET → Socle(.Web), EF Core Npgsql, MailKit 4.18.2, HtmlSanitizer.
- Identité et connexion d'un compte chiffrées, jamais renvoyées ; l'application montre l'alias ; adresse lue par un administrateur seulement, journalisée. Mot de passe vide en modification = inchangé.
- **Tout envoi passe par la file** ; limites comptées en destinataires ; envoi groupé au-delà du seuil confirmé (409 `MAIL_CONFIRMATION`).
- SSL ou STARTTLS obligatoire. HTML toujours nettoyé côté serveur (corps, signatures, modèles, reçus).
- Réception : **jamais de suppression** sur le serveur IMAP ; **jamais de changement de statut automatique** depuis un courriel reçu.
- Reconnaissance répliquée JS ↔ C# : `js/src/reconnaissance.js` ↔ `LogiBTP.Mail/ReconnaissanceMail.cs` (jeu `tests/cas/01_reconnaissance.json`), normalisation par la table d'accents du socle (`sansAccent` ↔ `SansAccent.Retirer`) et l'apostrophe typographique ramenée à la droite.
- Envois automatiques uniquement depuis le cœur, par `EnvoyerAutomatiqueAsync` (usage → expéditeur).
- Scripts SQL rejouables, pas de migrations EF.

## État actuel
- **Base** : `db/007` (`mail_compte`, `mail_alias`, `mail_usage`, `mail_modele`, `mail_lot`, `mail_message` sens E / R, `mail_destinataire`, `mail_piece` `ged:<id>`, `mail_lien`, `mail_journal`, `mail_parametre`), `007b` (relève : `mail_dossier`, reçu unique par compte et empreinte, paramètres de conservation 90 j, première relève 30 j, taille 25 Mo), `007c` (`mme_nature`, `mail_regle`, `mail_proposition`, seuils haut 80 / bas 40). Cœur : `db/206`, `db/207`.
- **Règles** (`LogiBTP.Mail`) : `ReglesEnvoi` (limites par hébergeur, créneau, simulation d'un lot, prochain essai 1 / 5 / 15 / 60 min, classement Temporaire / Definitive / Authentification / Blocage, découpage), `Adresses` (validité, domaine, gabarits `{{…}}` échappés), `ReconnaissanceMail`.
- **Web** : `Donnees`, `Modeles`, `SpecialisationMail` (usages connus, `DecrireAsync`, pièces, `ApresEnvoiAsync`, `RecevoirAsync`, `CandidatsAsync`, `AlerterAsync`, `ServicesAsync`, `SignalerAsync`…), `TransportMail` (`TransportMailKit` : XOAUTH2, MIME, Message-ID `…logibtp@<domaine>`, `ReleverAsync`, `ApresRattachementAsync`), `LectureMail` (MimeKit, avis RFC 3464), `NettoyageHtmlMail`, `ServiceComptesMail`, `ServiceEnvoiMail`, `ServiceReceptionMail`, `EnvoiMail` (file, 15 s), `ReleveMail` (relèves dues chaque minute, purge quotidienne), `Extensions` (`AddModuleMail<T>`, `MapModuleMail`).
- **Usages du cœur** : NOTIFICATION (`CanalCourrielBtp`), AUTHENTIFICATION (mot de passe oublié, priorité haute), CRM (bordereaux), envoi d'un document (📧 Envoyer). Pages `/mail`, `/mail/nouveau`, `/parametres/mail`.
- **Signaux** (notifications du cœur, module `mail`) : ERREUR, PARTI, LOT, BLOCAGE, QUOTA, COMPTE, VOLUME, NON_REMIS.

## Routes (`/api/mail`)
- Paramétrage (administrateur) : `GET|POST /comptes`, `PUT|DELETE /comptes/{id}` (409 `MAIL_COMPTE_UTILISE`), `POST /comptes/{id}/tester|reprendre`, `GET /comptes/{id}/adresse`, `PUT /comptes/{id}/alias`, `GET /alias`, `GET /disponible`, `GET|PUT /usages`, `GET|POST /modeles`, `DELETE /modeles/{id}`, `GET|PUT /parametres`, `GET|PUT /regles`.
- Envoi : `GET /preparer?type=&id=&usage=`, `POST /estimer`, `POST /envoyer`.
- Réception : `GET /boites`, `POST /comptes/{id}/relever`, `GET /recus?vue=a-rapprocher|tous|rapproches|ignores&compte=`, `GET /rattachement/types`, `POST /messages/{id}/rattacher|detacher|ignorer|marquer-adresse`.
- Consultation : `GET /messages?vue=envoyes|attente|erreurs|tous`, `GET /messages/{id}`, `POST /messages/{id}/annuler|relancer`, `GET /lots`, `GET /journal`, `GET /compteurs`, `POST /traiter` (administrateur).

## Textes et icônes (module Personnalisation, lot P3j)
- Le module n'affiche aucun texte (erreurs par code au lot P2). Écrans du Mail dans le cœur (`client/src/app/pages/mail.js`, `parametres-mail.js`) : textes `mail_btp.*`, icônes `mail_btp_*`, couleurs du corps des courriels `--mail-corps-*` de `client/personnalisation`.

## Tests
`dotnet test modules/mail/dotnet/LogiBTP.Mail.Tests` (règles, adresses, gabarits, reconnaissance ; parcours complet avec un faux transport si `LOGIBTP_TEST_PG` désigne une base où `007` est chargé) ; `npm test --workspace modules/mail/js`. Essai réel : `LOGIBTP_TEST_MAIL_*` du `.env`.
