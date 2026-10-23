# Analyse du module Mail

Statut : **analyse à valider** (23/10/2026). Les décisions proposées sont marquées ◐ dans le tableau des questions
(§ 9) ; elles passeront à ✔ ou ✘ après relecture.

## 1. But

Communiquer avec l'extérieur **depuis** l'application (clients, fournisseurs, sous-traitants, maîtres d'œuvre) tout en
**centralisant** l'information : chaque courriel envoyé ou reçu qui concerne un élément de LogiBTP (document, tiers,
chantier, marché, note du CRM…) y est rattaché, archivé dans la GED et, s'il appelle une action, signalé au service
concerné.

Premier temps : **comptes de messagerie système** (adresses de service : `noreply@`, `commercial@`, `achats@`,
`compta@`, `sav@`…) en **SMTP** (envoi) et **IMAP** (réception), plusieurs comptes par société. Second temps : comptes
des utilisateurs (boîte personnelle).

## 2. Points déjà marqués « à traiter avec le module Mail »

Relevés dans les analyses, la conception et le code ; le module doit y répondre (lot indiqué au § 10).

| Origine | Point | Ce qui existe déjà |
|---|---|---|
| GED | Pièces marquées « à envoyer » avec l'élément lié | `document_ged.dge_a_envoyer`, case 📧 de l'`ExplorateurGed` (option `envoi`), index `ix_dge_a_envoyer` |
| GED | Courriels archivés (.eml / .msg, pièces jointes en documents enfants) | `dge_mail` JSONB `{ objet, de, a, cc, date, message, sens }`, `dge_parent_id`, aperçu `htmlMail`, `lireMail`, extraction du texte des .eml, plein texte sur `dge_mail` |
| GED | Adresse de copie cachée | paramètre `adresse_copie_cachee` de `parametre_ged` (vide) |
| GED | Versions d'étape ENVOI et RECEPTION | genre `etape` de `version_ged` (toutes conservées) |
| Documents (cycle) | Statut ENVOYE posé par le module Mail ou à la main | `ent_envoye_le` (`modules/document/db/019d`) |
| Documents | Destinataires depuis les intervenants | `v_intervenants` (structure et documents), coordonnées figées `ent_contact_client` / `ent_contact_payeur` (courriel) |
| Édition | Envoi par courriel de la pièce produite | bouton Envoyer de l'aperçu prévu ; pièce en GED marquée `dge_a_envoyer` |
| Notifications | Canal courriel des préférences | `notification_preference.npr_courriel` (faux par défaut, sans effet) |
| CRM (C7) | Envoi des notes et des bordereaux de diffusion, réception avec rapprochement automatique | courriel glissé → note + GED (`noteDepuisCourriel`), bordereaux `crm_diffusion` imprimés |
| CRM (C6, C27) | Rappels et relances (devis sans réponse, factures impayées) par courriel | rappels à l'écran seulement ; relances non réalisées |
| Authentification (A7, lot 2) | Mot de passe oublié par lien envoyé par courriel ; double facteur | réinitialisation par un administrateur |
| Exécution (E22) | Courriel de confirmation du SAV avec le bon signé | aucune solution d'attente : attend le module Mail |
| Pointage (M21) | Envoi du relevé hebdomadaire signé (option) | relevé rangé dans la GED du salarié |

## 3. Périmètre

### Inclus (premier temps)

1. **Comptes système** : plusieurs par société, chacun en envoi (SMTP), en réception (IMAP) ou les deux ; paramètres
   de connexion, identifiants et adresse **chiffrés en base**, nom d'application par alias ; authentification par
   mot de passe ou OAuth 2.0 (module OAuth séparé, rappels avant la fin de validité des jetons) ; test de connexion ;
   usage par défaut (quel alias pour quel envoi).
2. **Envoi** : rédaction depuis un élément (document, fiche, note, bordereau…) avec destinataires proposés, modèle
   d'objet et de corps à variables, pièces jointes de la GED ; **file d'attente** à priorités traitée en tâche de fond
   avec reprises, **limitations** par compte, **journal des envois**, **avertissements d'envoi massif**, utilisateur
   prévenu d'un envoi en attente ; courriel envoyé archivé dans la GED de l'élément ; conséquences (statut ENVOYE,
   version d'étape ENVOI, note du CRM).
3. **Réception** : relève IMAP périodique des dossiers choisis ; chaque courriel relevé est conservé (GED) et passe par
   la **reconnaissance** ; un courriel reconnu est rattaché à son élément et peut créer une **alerte à traiter** pour
   le service concerné ; les autres vont dans la liste **« À rapprocher »**.
4. **Marquage « à traiter »** côté messagerie : un courriel placé dans un dossier convenu (ou marqué d'un drapeau)
   depuis Outlook / Thunderbird / webmail entre dans la liste à rapprocher de l'application.
5. **Écrans** : paramétrage des comptes, des usages, des modèles et des règles ; boîte de l'application (reçus,
   envoyés, à rapprocher, en erreur) ; fenêtre de rédaction.

### Exclu ou reporté

- Comptes personnels des utilisateurs, boîtes partagées par utilisateur, agenda (second temps, § 8).
- Client de messagerie complet (dossiers, réponse à tout depuis la boîte, brouillons partagés) : LogiBTP n'est pas un
  remplaçant d'Outlook ; il envoie depuis ses éléments et centralise ce qui les concerne.
- Publipostage et campagnes (lettres d'information) : hors sujet, contraintes propres (désabonnement, réputation).
- Signature électronique des courriels (S/MIME) et chiffrement de bout en bout.
- Envoi recommandé électronique, plateforme de facturation électronique (sujet de la facture électronique, à part).

## 4. Principes

- **Le module est sans métier** (couches du projet) : il connaît des comptes, des messages, des destinataires, des
  pièces, des éléments génériques (`type_element`, `id_element`) et des règles ; le cœur le spécialise
  (`SpecialisationMail`, méthode patron) : description des éléments, candidats de rapprochement (numéros de documents,
  tiers par adresse), stockage des contenus (GED), conséquences d'un envoi ou d'un rapprochement (statut, note,
  alerte). Le module ne dépend ni de la GED, ni du CRM, ni des Notifications : les liens passent par le cœur.
- **La messagerie reste la source** : LogiBTP ne supprime ni ne déplace jamais un courriel sur le serveur, sauf règle
  explicite du compte (déplacement vers un dossier « traité » après rattachement, § 9 ML8).
- **Rien n'est perdu** : un envoi en échec reste dans la file (erreur visible, nouvel essai) ; un courriel reçu non
  reconnu reste à rapprocher ; les rapprochements automatiques sont annulables.
- **Aucune décision métier automatique** : un courriel reconnu comme acceptation de devis ou ARC rattache et alerte ;
  il ne change jamais le statut du document (proposé dans l'alerte, appliqué par une personne).
- **L'adresse d'un compte n'apparaît pas dans l'application** : elle est chiffrée comme les identifiants ; on y désigne
  les comptes par un **alias** (table de correspondance `mail_alias`). Les connexions OAuth 2.0 sont tenues par le
  module séparé OAuth ([analyse](ANALYSE-MODULE-OAUTH.md)), le mot de passe reste possible.
- **Tout envoi passe par une file d'attente** soumise aux limites du compte et journalisée ; l'utilisateur sait
  toujours si son courriel est parti ou en attente (§ 6.3).
- **Une base par société** : comptes, messages et tâches de fond par base (`OptionsSocietes.Societes()`,
  `CreerPorteeSociete`), comme `PlanificateurNotifications` et `ArchivageGed`.

## 5. Modèle de données (proposition, `modules/mail/db/007_mail.sql`)

Préfixes de colonnes selon la convention du projet. Numéro 007 : module transverse sans dépendance (comme 005, 006,
008) ; les liaisons au cœur (clés étrangères, élément GED `mail`) dans un script du cœur (`db/206_mail.sql`).

### Comptes

`mail_compte` (`mco_*`)

| Colonne | Rôle |
|---|---|
| `mco_id`, `mco_code` (unique) | identification technique ; le nom montré dans l'application est l'alias (`mail_alias`) |
| `mco_identite` | **chiffré** : `{ adresse, nom_affiche }` de l'expéditeur ; déchiffré seulement au moment de l'envoi et, pour un administrateur, à la demande (« Afficher l'adresse », journalisé) |
| `mco_adresse_empreinte` | HMAC de l'adresse normalisée (clé dérivée de la chaîne de l'installation) : reconnaître nos propres boîtes parmi les destinataires d'un courriel reçu, refuser un doublon, sans déchiffrer |
| `mco_genre` | `SYSTEME` (lot 1) ; `UTILISATEUR` (second temps, avec `mco_compte_utilisateur`) |
| `mco_envoi`, `mco_reception` | usages activés |
| `mco_authentification` | `MOT_DE_PASSE` (comptes non encore migrés) ou `OAUTH2` |
| `mco_connexion` | **bloc chiffré** (`chiffre:v1:…` du socle) : JSON `{ smtp: { hote, port, securite, identifiant, secret? }, imap: { … } }` ; `secret` seulement en mode mot de passe, effacé au passage en OAuth 2.0 |
| `mco_oco_id` | connexion du module OAuth en mode `OAUTH2` ([analyse OAuth](ANALYSE-MODULE-OAUTH.md)) : jetons chiffrés, renouvellement et rappels d'échéance tenus par ce module ; le Mail ne lit que le contrat `IFournisseurJeton` du socle (pas de clé étrangère entre modules : contrôle par le cœur) |
| `mco_repondre_a_mco_id` | compte dont l'adresse sert de réponse (indispensable pour `noreply@` : les réponses vont vers une boîte relevée) ; désigné par son alias, jamais par une adresse en clair |
| `mco_limites` | JSONB : limitations d'envoi du compte (§ 6.3), valeurs par défaut du fournisseur |
| `mco_signature_html` | signature ajoutée aux envois |
| `mco_dossiers` | JSONB : dossiers IMAP relevés et rôle (`RECEPTION`, `A_TRAITER`, `ENVOYES`, `TRAITES`), drapeau à suivre pris en compte |
| `mco_services` | services autorisés à consulter la boîte (vide : administrateurs) |
| `mco_actif`, `mco_etat` (`OK`, `ERREUR`), `mco_derniere_erreur`, `mco_verifie_le` | santé du compte (affichée dans le paramétrage) |
| `mco_maj_par`, `mco_maj_le` | traçabilité ; toute modification de `mco_identite` ou de `mco_connexion` est journalisée sans la valeur |

`mail_alias` (`mal_*`) : **table de correspondance** nom d'application → compte : `mal_nom` (« Service commercial »,
« Achats », « Ne pas répondre »), `mal_mco_id`, `mal_principal` (un alias principal par compte, celui des listes),
`mal_actif`. Tous les écrans, journaux, choix de compte et traces montrent l'alias, jamais l'adresse. Plusieurs alias
peuvent désigner le même compte (« Devis » et « Commercial » → `commercial@`) ; changer de boîte derrière un alias ne
change rien aux usages ni aux modèles qui le désignent.

`mail_usage` (`mus_*`) : usage logique → alias : `NOTIFICATION`, `AUTHENTIFICATION`, `DOCUMENT_VENTE`,
`DOCUMENT_ACHAT`, `RELANCE`, `SAV`, `PAIE`, `CRM`… (liste ouverte, usages déclarés par le cœur), surchargeable par type
de document ou par service.

`mail_dossier` (`mdo_*`) : état de synchronisation IMAP par compte et dossier : `UIDVALIDITY`, dernier UID relevé,
dernier passage, nombre d'erreurs consécutives.

### Messages

`mail_message` (`mme_*`)

| Colonne | Rôle |
|---|---|
| `mme_id`, `mme_mco_id`, `mme_mal_id` (alias choisi), `mme_sens` (`E` envoyé, `R` reçu) | |
| `mme_etat` | envoi : `BROUILLON`, `A_ENVOYER` (en file d'attente), `EN_COURS`, `ENVOYE`, `ERREUR`, `ANNULE`, `SUSPENDU` (connexion à reconnecter ou compte suspendu) ; réception : `RECU`, `RAPPROCHE`, `A_RAPPROCHER`, `PROPOSE`, `IGNORE` |
| `mme_priorite` | `HAUTE` (authentification, envoi unitaire d'un utilisateur), `NORMALE` (envois automatiques unitaires), `BASSE` (envois groupés, relances, notifications en nombre) |
| `mme_lot_id` | envoi groupé d'origine (`mail_lot`) |
| `mme_message_id`, `mme_in_reply_to`, `mme_references` | en-têtes du fil (clé de la reconnaissance des réponses) ; `Message-ID` généré à l'envoi (`<uuid@domaine du compte>`) |
| `mme_objet`, `mme_de`, `mme_repondre_a`, `mme_date`, `mme_extrait` | consultation et listes (le corps complet est dans le .eml) |
| `mme_empreinte` | empreinte SHA-256 du .eml (contenu rangé par le cœur dans la GED : dédoublonnage naturel) |
| `mme_dge_id` | document GED du courriel (posé par le cœur) |
| `mme_uid`, `mme_dossier` | position sur le serveur (réception) |
| `mme_tentatives`, `mme_prochain_essai`, `mme_erreur` | file d'envoi (reprises espacées : 1, 5, 15, 60 min, puis erreur) |
| `mme_auto` | courriel automatique (`Auto-Submitted`, réponse d'absence, avis de non-remise) : jamais d'alerte, jamais de réponse |
| `mme_cree_par`, `mme_cree_le`, `mme_envoye_le` | |

`mail_destinataire` (`mde_*`) : `A`, `CC`, `CCI` ; adresse, nom, élément d'origine facultatif (`per_id`, `ind_id`
résolus par le cœur) ; état de non-remise (avis de non-remise rapproché de l'envoi d'origine).

`mail_piece` (`mpi_*`) : pièces jointes d'un envoi : référence d'une **version figée** de la GED (empreinte), nom,
type, taille ; à la réception, les pièces sont les documents enfants du .eml dans la GED (pas de copie ici).

`mail_lien` (`mli_*`) : rattachements d'un message à des éléments (`type_element`, `id_element`) : origine
(`ENVOI`, `FIL`, `REGLE`, `MANUEL`), règle et score, auteur, date ; plusieurs liens possibles (un courriel qui cite
deux commandes) ; un lien automatique s'annule (retrait tracé).

`mail_modele` (`mmo_*`) : modèles d'objet et de corps HTML à variables par usage et type d'élément (comme les textes
de l'édition), un par défaut ; variables fournies par la spécialisation (numéro, montant, tiers, contact, rédacteur,
date de validité…).

`mail_regle` (`mrg_*`) : règles de reconnaissance paramétrables (§ 7.3) : compte(s), conditions (expéditeur, domaine,
objet, corps, nom des pièces), nature déduite (`ARC`, `REPONSE_DEVIS`, `FACTURE_FOURNISSEUR`, `BL`, `RELANCE`…),
action (rattacher, alerter, ignorer), service à alerter, ordre, actif.

`mail_lot` (`mlo_*`) : envoi groupé (relances de la semaine, diffusion d'un bordereau à 40 destinataires,
notifications en nombre) : origine, auteur, nombre de messages et de destinataires, envoyés, en erreur, fin estimée,
avertissement accepté (qui, quand, texte affiché).

`mail_journal` (`mjo_*`) : **journal des envois**, une ligne par tentative : message, lot, compte et alias, date,
utilisateur ou compte de service, origine (usage, module, élément), nombre de destinataires et domaines destinataires,
taille, résultat (code et réponse du serveur SMTP), durée ; puis non-remises rapprochées. Sert aux compteurs des
limitations (§ 6.3), aux avertissements et à l'écran de suivi des envois. Conservation paramétrée (13 mois par
défaut) ; les adresses des destinataires y sont gardées pour la preuve d'envoi, les nôtres jamais (alias).

`mail_parametre` : intervalle de relève, taille maximale des pièces envoyées, seuils de reconnaissance, durée de
conservation des courriels non rapprochés et du journal, seuils d'avertissement d'envoi massif.

## 6. Envoi

### 6.1 Parcours

1. Depuis un élément (bouton « 📧 Envoyer » de la page document, de l'aperçu de l'édition, d'une fiche, d'une note,
   d'un bordereau) : `app.naviguer('/mail/nouveau?type=&id=&usage=', { nouvelleFenetre })`.
2. La fenêtre de rédaction est pré-remplie par la spécialisation :
   - **expéditeur** : alias de l'usage (surcharge par type de document ou service), modifiable parmi les alias des
     comptes d'envoi ;
   - **destinataires** proposés : contact du document (`ent_contact_client`, payeur), intervenants (`v_intervenants`,
     contacts du tiers), destinataires du bordereau ; combo du socle (`creerCombo`), saisie libre contrôlée ;
   - **objet et corps** : modèle de l'usage et du type, variables calculées, signature du compte (puis, au second
     temps, de l'utilisateur) ;
   - **pièces** : pièces de la GED de l'élément marquées « à envoyer » (`dge_a_envoyer`), cochables ; ajout depuis la
     GED de l'élément ou du poste ; édition produite à la volée (PDF de l'édition par défaut du type) ;
   - option « copie à moi » (courriel de l'individu de l'utilisateur).
3. « Envoyer » : le message passe `A_ENVOYER` ; les pièces sont figées (version d'étape ENVOI dans la GED) ; la file
   l'envoie (tâche de fond, compte de service `mail_fond`) ; l'utilisateur voit l'état dans l'onglet Suivi / Pièces
   et dans la boîte de l'application. **S'il ne peut pas partir tout de suite** (limite du compte atteinte, file
   chargée, connexion à reconnecter), la fenêtre le dit avant de se fermer : « Votre courriel est en attente d'envoi
   (position 37, départ estimé vers 14 h 20) » ; une pastille « ⏳ en attente » reste sur l'élément jusqu'au départ,
   et l'auteur est notifié du départ différé puis de l'envoi ou de l'erreur (§ 6.3).
4. Après envoi réussi (spécialisation `ApresEnvoiAsync`) :
   - .eml complet archivé dans la GED de l'élément (nature `mail`, `sens: E`, pièces jointes en enfants : la GED sait
     déjà le faire pour un .eml déposé) ;
   - `dge_a_envoyer` retiré des pièces envoyées ;
   - document : `ent_envoye_le` posé (statut ENVOYE si le type le prévoit) ;
   - CRM actif : note « courriel envoyé » dans le Suivi de l'élément (contenu = le courriel de la GED) ;
   - copie dans le dossier « Envoyés » du compte si IMAP est configuré (`APPEND`, ML5).
5. Échec définitif (adresse refusée, authentification, taille) : état `ERREUR`, notification à l'auteur ; avis de
   non-remise reçu plus tard : rapproché de l'envoi par ses en-têtes, destinataire marqué, notification à l'auteur.

### 6.2 Envois automatiques (sans fenêtre)

Envois produits par l'application : notifications (canal courriel, `npr_courriel`), mot de passe oublié et double
facteur (Authentification), confirmation du SAV (Exécution), relevé hebdomadaire (Pointage), relances (CRM, à venir),
retours de visas (CRM). Chaque module l'écrit **par le cœur**, qui appelle le service du module Mail
(`ServiceMail.PreparerAsync(usage, element, destinataires, modele, variables, pieces)`) : mêmes file, archivage et
traces. Le module Notification n'appelle pas le module Mail : le cœur fournit un canal (`ICanalCourriel`) que le
planificateur utilise quand la préférence courriel est cochée. Plusieurs messages produits par une même action
(relances, diffusion, notifications d'un passage du planificateur) forment un **lot** (`mail_lot`) de priorité basse.

### 6.3 File d'attente, limitations et avertissements d'envoi massif

But : absorber les envois en nombre sans faire bloquer les comptes par l'hébergeur ni classer nos courriels en
indésirables, et toujours dire à l'utilisateur où en est son envoi.

**File d'attente.** Tout envoi passe par la file (`mail_message` à `A_ENVOYER`), même unitaire. L'expéditeur de fond
(`EnvoiMail`, par base) prend les messages par priorité (HAUTE, NORMALE, BASSE) puis par ancienneté, compte par compte,
dans la limite de chaque compte ; une part du quota (20 % par défaut) est **réservée aux priorités haute et normale**
pour qu'une relance groupée ne retarde jamais un mot de passe oublié ou l'envoi d'un devis. Messages d'un lot espacés
(lissage, petit écart aléatoire) plutôt qu'envoyés en rafale.

**Limitations par compte** (`mco_limites`, valeurs par défaut selon l'hébergeur déclaré, à ajuster ; les quotas réels
des hébergeurs sont à vérifier à la mise en place, ils changent) :

| Limite | Rôle | Exemple de défaut |
|---|---|---|
| messages par minute | débit (au-delà, l'hébergeur ralentit ou refuse) | 30 (Microsoft 365) |
| destinataires par message | au-delà, découpage en plusieurs messages identiques (CCI) ou refus | 100 |
| destinataires par heure et par jour | quota de l'hébergeur | 10 000 / jour (Microsoft 365), 2 000 / jour (Google Workspace) |
| messages par heure vers un même domaine | éviter le blocage par le serveur du destinataire | 60 |
| nouveaux destinataires par jour | adresses jamais écrites par ce compte : premier signal de spam | 200 |

Les compteurs se lisent dans le journal (`mail_journal`, fenêtres glissantes). Une limite atteinte **n'échoue pas** :
le message attend la fenêtre suivante (`mme_prochain_essai`), son auteur est prévenu (« en attente d'envoi »).

**Avertissements** (seuils dans `mail_parametre`) :

- **avant** un envoi groupé au-delà de N destinataires (50 par défaut) : confirmation obligatoire qui affiche le
  nombre de messages et de destinataires, le compte utilisé, la durée estimée de l'envoi et l'heure de fin ; le
  consentement est noté dans le lot ;
- **pendant** : compte à 80 % de son quota journalier : avertissement aux administrateurs et aux auteurs des lots en
  cours ; à 100 % : envois groupés repoussés au lendemain, priorités haute et normale servies par la réserve ;
- **signaux de mauvaise réputation** : taux de non-remise ou de refus du compte au-delà de 5 % sur une heure, refus
  « spam » ou « limite » renvoyés par le serveur (codes SMTP 421 / 450 / 452 / 550 5.7.x) : **envois groupés du compte
  suspendus** (`SUSPENDU`), alerte immédiate aux administrateurs, reprise manuelle après examen ;
- **envois inhabituels** d'un utilisateur (plus de N courriels en une heure depuis l'application) : avertissement aux
  administrateurs.

**Information de l'utilisateur** : la boîte de l'application a une vue « En attente » (position, départ estimé,
cause : limite, file, connexion) ; un lot affiche sa progression (envoyés / total, erreurs) ; l'auteur peut annuler ce
qui n'est pas parti. Notification au départ différé, à la fin du lot et à chaque erreur définitive.

**Écran de suivi des envois** (`/mail?vue=envois`, administrateurs) : journal filtrable (compte par son alias, période,
origine, résultat), compteurs de chaque compte face à ses limites, lots en cours, comptes suspendus (« Reprendre »).

## 7. Réception

### 7.1 Relève

- Tâche de fond `ReleveMail` par base et par compte de réception (intervalle par défaut 2 min, ML6) : connexion IMAP
  (MailKit), pour chaque dossier relevé : contrôle de `UIDVALIDITY`, lecture des UID supérieurs au dernier relevé,
  téléchargement du message complet (taille maximale paramétrée ; au-delà, en-têtes seuls et alerte).
- Rien n'est modifié sur le serveur par défaut (ni lu, ni déplacé) : la boîte reste utilisable par les personnes qui la
  lisent dans leur messagerie. Le suivi de ce qui a été relevé est fait par les UID (`mail_dossier`), pas par le
  drapeau « lu ».
- Chaque message : `mail_message` (`R`), .eml remis au cœur qui le dépose dans la GED sous l'élément boîte
  (`type_element = 'mail_compte'`, catégorie `mail`, confidentialité INTERNE, accès aux services du compte), puis
  reconnaissance.
- Dédoublonnage par `Message-ID` et empreinte (le même courriel reçu sur `commercial@` et `achats@` n'est rapproché
  qu'une fois ; ses deux réceptions restent visibles).

### 7.2 Marquage « à traiter » depuis la messagerie

Pour que les personnes qui lisent la boîte dans Outlook ou un webmail puissent envoyer un courriel vers l'application
sans la quitter :

- **Dossier convenu** (rôle `A_TRAITER`, par exemple `LogiBTP/À traiter`) : tout courriel déposé dedans est relevé et
  va dans « À rapprocher » même s'il a été reconnu automatiquement ailleurs. Fonctionne avec toutes les messageries
  (Exchange, Gmail, OVH…). **Recommandé.**
- **Drapeau « à suivre »** (`\Flagged`) sur un dossier relevé : option du compte ; le drapeau est visible en IMAP chez
  la plupart des hébergeurs, mais il sert aussi aux personnes pour leur propre suivi (bruit).
- Les **catégories Outlook** (couleurs) ne sont pas exposées par Exchange en IMAP : non retenues.
- Après rattachement dans l'application, option du compte : déplacer le courriel vers un dossier `TRAITES`
  (`LogiBTP/Traités`) ou retirer le drapeau, pour que la messagerie reflète l'état (ML8).

### 7.3 Reconnaissance automatique

Fonction pure, sans accès à la base, répliquée entre `modules/mail/js/src/reconnaissance.js` et
`ReconnaissanceMail.cs` (jeu `modules/mail/tests/cas/01_reconnaissance.json`) ; les **candidats** (éléments dont le
numéro, la référence externe ou l'adresse correspondent) sont fournis par la spécialisation du cœur.

Indices, du plus sûr au moins sûr :

| Rang | Indice | Exemple | Effet |
|---|---|---|---|
| 1 | **Fil** : `In-Reply-To` / `References` = `Message-ID` d'un envoi de l'application | réponse du client au courriel du devis DV2026-00012 | rattaché à l'élément de l'envoi, sûr |
| 2 | **Numéro de nos documents** dans l'objet, le corps ou le nom des pièces (motifs de numérotation des types) | « ARC commande CF2026-00045 » | candidat fort ; confirmé si l'expéditeur est le tiers du document ou un de ses contacts |
| 3 | **Référence externe** de nos documents (`ent_reference_externe`), numéro de marché, code de chantier | référence du client citée dans sa réponse | candidat moyen |
| 4 | **Expéditeur** connu de l'annuaire (coordonnée courriel d'un tiers ou d'un contact, domaine du tiers) | fournisseur qui envoie un PDF sans numéro | rattaché au tiers ; documents en cours du tiers proposés |
| 5 | **Texte des pièces jointes** (PDF extraits par la GED) | numéro de commande dans le PDF de l'ARC | complète les rangs 2 et 3 (passage différé, après l'extraction) |

**Nature** du courriel (règles `mail_regle` et mots-clés par défaut, comme la classification de la GED) : `ARC`,
`REPONSE_DEVIS` (acceptation, refus, question), `FACTURE_FOURNISSEUR`, `BL`, `RELANCE`, `AUTRE`.

**Décision** selon le score (seuils paramétrés) :

- au-dessus du seuil haut, un seul candidat : **rattachement automatique** (état `RAPPROCHE`) ;
- entre les seuils ou plusieurs candidats : **proposé** (`PROPOSE`) : la liste « À rapprocher » montre le ou les
  candidats, validation en un clic ;
- en dessous : `A_RAPPROCHER` sans proposition ;
- courriel automatique (`mme_auto`) : jamais d'alerte ; avis de non-remise rapproché de l'envoi d'origine.

### 7.4 Conséquences d'un rattachement (spécialisation du cœur, `ApresRapprochementAsync`)

- Le courriel de la GED est **lié à l'élément** (un dépôt classé dans le répertoire d'un élément lui est lié ; les
  pièces jointes suivent) ; les pièces reçoivent une version d'étape RECEPTION.
- **Alerte à traiter** pour le service concerné (service de la règle, sinon du document, sinon du rédacteur ou de
  l'acheteur) : tâche du CRM à prendre par le service (CRM actif), sinon notification aux membres du service
  (module Notification) ; l'alerte porte la nature et la proposition (« Devis DV2026-00012 : acceptation probable →
  passer à ACCEPTE ? »), jamais appliquée seule.
- CRM actif : note « courriel reçu » dans le Suivi de l'élément (comme un courriel glissé aujourd'hui).
- Exemples :
  - **ARC fournisseur** sur une commande : rattaché à la commande, tâche au service Achats (ou à l'acheteur) :
    contrôler les prix et délais de l'ARC ;
  - **réponse à un devis** : rattachée au devis (fil), tâche au rédacteur / service commercial ;
  - **facture fournisseur** : rattachée au tiers et à la commande ou au BL cité, tâche au service administratif
    (saisie de la facture, en attendant le module Comptabilité / la facture électronique).

### 7.5 Liste « À rapprocher » (`/mail?vue=a-rapprocher`)

Courriels `A_RAPPROCHER` et `PROPOSE` des boîtes visibles par l'utilisateur, avec aperçu (`htmlMail` de la GED), candidats
proposés, recherche d'un élément (combo des documents, tiers, chantiers…), actions : rattacher (un ou plusieurs
éléments), créer une note ou une tâche, créer un tiers provisoire depuis l'expéditeur (`creerTiersProvisoire`),
ignorer (avec motif), transférer à un service. Raccourcis déclarés dans un groupe `mail` (`declarerRaccourcis`).

## 8. Second temps : comptes des utilisateurs

À cadrer plus tard ; contraintes notées pour ne pas les bloquer maintenant :

- même table `mail_compte` (`mco_genre = UTILISATEUR`, compte de l'application propriétaire) ; envoi « au nom de »
  l'utilisateur par son propre compte ou par un compte système avec `Reply-To` de l'utilisateur ;
- authentification déléguée (OAuth2 de Microsoft 365 / Google, jeton de rafraîchissement chiffré) plutôt que le mot de
  passe de l'utilisateur ;
- confidentialité : la boîte personnelle n'est visible que de son propriétaire ; seuls les courriels rattachés à un
  élément deviennent visibles des autres (selon la confidentialité GED choisie) ;
- relève de la boîte de l'utilisateur limitée aux dossiers et drapeaux choisis (pas de copie intégrale de sa
  messagerie) ;
- complément envisageable : complément Outlook « Envoyer vers LogiBTP » (glisser sans quitter Outlook).

## 9. Questions et décisions proposées

| # | Question | Proposition | Décision |
|---|---|---|---|
| ML1 | Module facultatif ? | Oui (`module_societe`, code `mail`) ; sans lui, tout fonctionne comme aujourd'hui (pièces « à envoyer », courriels glissés, statut ENVOYE à la main). | ◐ À valider |
| ML2 | Bibliothèque SMTP / IMAP côté serveur | **MailKit / MimeKit** (MIT, référence en .NET : SMTP, IMAP, IDLE, OAuth2, DSN, MIME) ; `System.Net.Mail` n'a ni IMAP ni OAuth2. À ajouter à `DEPENDANCES.md`. | ◐ À valider |
| ML3 | Que chiffrer ? | Le bloc de connexion (hôtes, ports, sécurité, identifiant, mot de passe) **et l'identité du compte (adresse, nom affiché)** en valeurs `chiffre:v1:` du `Chiffrement` du socle ; jetons OAuth chiffrés par le module OAuth. En clair : code, usages, état, limites ; l'application montre l'**alias** (`mail_alias`), les comparaisons d'adresses passent par une empreinte HMAC. Jamais renvoyé au navigateur : l'écran affiche « configuré » et réécrit le bloc entier (comme `POST /{id}/secret` des fiches), l'adresse s'affiche à la demande pour un administrateur (journalisé). La perte de la clé de l'installation rend les comptes à ressaisir : module d'installation (rotation). Limite : les courriels archivés (.eml de la GED) contiennent les adresses en clair, comme tout courriel. | ✔ Demandé (alias et chiffrement de l'adresse) ; détail ◐ |
| ML4 | Authentification aux serveurs | Au choix par compte : **mot de passe** (comptes non encore migrés ; SSL/TLS ou STARTTLS obligatoires) ou **OAuth 2.0** par le module séparé [OAuth](ANALYSE-MODULE-OAUTH.md) (Microsoft 365 en client credentials au lot 1 ; Google, flux délégué au lot 2 du module OAuth) ; bascule « Passer en OAuth 2.0 » sans recréer le compte. Rappels avant la fin de validité du secret ou du jeton aux personnes autorisées à reconnecter : tenus par le module OAuth. | ✔ Demandé ; hébergeurs des premiers clients à connaître |
| ML5 | Copie des envois dans « Envoyés » du compte | Oui si IMAP est configuré sur le compte (option), pour que la messagerie montre ce que l'application a envoyé. | ◐ À valider |
| ML6 | Fréquence de relève | Interrogation toutes les 2 min (paramètre) au lot 2 ; IDLE (temps réel) plus tard si le besoin apparaît. | ◐ À valider |
| ML7 | Marquer les courriels relevés sur le serveur ? | Non : suivi par UID ; le drapeau « lu » appartient aux personnes. | ◐ À valider |
| ML8 | Que faire sur le serveur après un rattachement ? | Option du compte : rien (défaut), déplacer vers `TRAITES` ou retirer le drapeau à suivre. Jamais de suppression. | ◐ À valider |
| ML9 | Conserver tous les courriels reçus dans la GED ? | Oui dès la relève (aperçu, plein texte, pièces et dédoublonnage existants) sous l'élément boîte, confidentialité INTERNE et accès des services du compte ; non rapprochés et ignorés purgés après N jours (paramètre, 90 par défaut) par la rétention de la GED ; rapprochés : conservation de l'élément. | ◐ À valider |
| ML10 | Marqueur ajouté aux envois pour reconnaître les réponses | Pas de jeton visible : `Message-ID` maîtrisé + numéro du document dans l'objet par le modèle (« Devis DV2026-00012 – … ») suffisent ; adresse « plus » (`commercial+DV2026-00012@`) non retenue (support inégal des hébergeurs). | ◐ À valider |
| ML11 | Changement de statut automatique (devis accepté, commande confirmée) ? | Jamais : proposé dans l'alerte, appliqué par une personne. | ◐ À valider |
| ML12 | Où va l'alerte « à traiter » ? | Tâche du CRM à prendre par le service si le CRM est actif, sinon notification aux membres du service ; service = règle, sinon service du document, sinon rédacteur / acheteur. | ◐ À valider |
| ML13 | Marquage « à traiter » depuis la messagerie | Dossier convenu (recommandé, universel) ; drapeau à suivre en option par compte ; catégories Outlook non exposées en IMAP. | ◐ À valider |
| ML14 | Envoi depuis `noreply@` | Autorisé seulement pour les envois automatiques ; `Reply-To` obligatoire vers une adresse relevée pour tout envoi qui attend une réponse (document, relance, visa). | ◐ À valider |
| ML15 | Taille des pièces jointes | Limite par compte (20 Mo par défaut, total encodé) ; au-delà, refus avec message ; lien de téléchargement sécurisé : plus tard. | ◐ À valider |
| ML16 | Affichage des courriels reçus | HTML nettoyé (HtmlSanitizer, déjà utilisé par le CRM), images distantes bloquées par défaut (bouton « afficher »), pièces exécutables jamais ouvertes. | ◐ À valider |
| ML17 | Droits | Paramétrage des comptes : administrateur. Envoyer depuis un élément : droit de consulter l'élément (règles d'accès du type). Boîte d'un compte et « À rapprocher » : membres des services du compte et administrateurs. | ◐ À valider |
| ML18 | Avis de non-remise et réponses automatiques | Analyse des DSN (MimeKit) : envoi d'origine retrouvé, destinataire marqué, auteur notifié ; réponses d'absence : rattachées au fil, sans alerte. | ◐ À valider |
| ML19 | Règles de reconnaissance : où ? | Algorithme et score répliqués JS ↔ C# (jeu partagé, essai des règles à l'écran sans serveur) ; règles paramétrables en base ; candidats et motifs de numérotation fournis par le cœur. | ◐ À valider |
| ML20 | Environnement de développement | Serveur de messagerie de test dans le `docker-compose` (Mailpit pour l'envoi, GreenMail pour SMTP + IMAP) ; fournisseur mémoire `FournisseurMailMemoire` pour les tests et la démo hors ligne (même règles que le service). | ◐ À valider |
| ML21 | Comptes des utilisateurs | Second temps (§ 8) ; le modèle de données les prévoit dès le lot 1. | ✔ Demandé |
| ML22 | Journal des envois | Table `mail_journal` (une ligne par tentative, résultat SMTP, origine, alias) : compteurs des limites, avertissements, preuve d'envoi ; conservation 13 mois (paramètre). | ✔ Demandé ; durée ◐ |
| ML23 | File d'attente | Tout envoi passe par la file, priorités HAUTE / NORMALE / BASSE, réserve de 20 % du quota pour les deux premières, lots lissés ; l'utilisateur est prévenu que son courriel est en attente (position, départ estimé), pastille sur l'élément, notification au départ et en cas d'erreur, annulation possible. | ✔ Demandé ; réserve ◐ |
| ML24 | Limitations d'envoi | Par compte : messages par minute, destinataires par message, par heure et par jour, messages par domaine destinataire, nouveaux destinataires par jour ; défauts par hébergeur, modifiables ; une limite atteinte met en attente, n'échoue jamais. | ✔ Demandé ; valeurs ◐ |
| ML25 | Avertissements d'envoi massif | Confirmation avant un envoi groupé de plus de 50 destinataires (durée et fin estimées) ; alerte à 80 % du quota journalier ; suspension des envois groupés du compte sur signaux de spam (non-remises > 5 % sur une heure, refus 4xx / 5.7.x) ; alerte sur un volume inhabituel par utilisateur. | ✔ Demandé ; seuils ◐ |

## 10. Découpage en lots (proposition)

| Lot | Contenu | Débloque |
|---|---|---|
| 0 | **Module OAuth**, lot 1 ([analyse](ANALYSE-MODULE-OAUTH.md)) : contrat `IFournisseurJeton` du socle, connexions Microsoft 365 en client credentials, jetons chiffrés, renouvellement, rappels d'échéance, `/parametres/connexions` | comptes Microsoft 365 du lot 1 |
| 1 | Module `modules/mail` (JS règles + `LogiBTP.Mail(.Web)` + `007`), comptes système (identité et connexion chiffrées, alias, mot de passe ou OAuth 2.0), test de connexion, usages, modèles, **envoi** : fenêtre de rédaction depuis la page document et l'aperçu de l'édition, pièces « à envoyer », **file d'attente à priorités, limitations, journal des envois, avertissements d'envoi massif, information « en attente d'envoi »**, archivage .eml en GED, statut ENVOYE, version ENVOI, note du CRM, copie dans « Envoyés » ; boîte de l'application : envoyés, en attente, erreurs, suivi des envois | TODO « envoi des pièces à envoyer », Édition, cycle ENVOYE |
| 2 | **Envois automatiques** : canal courriel des notifications, mot de passe oublié (Authentification A7), confirmation du SAV (Exécution E22), relevé hebdomadaire (Pointage M21), bordereaux de diffusion et retours de visas (CRM C7) | modules en attente |
| 3 | **Réception** : relève IMAP, dossiers et marquage « à traiter », GED de la boîte, liste « À rapprocher » avec rattachement manuel, avis de non-remise, purge des non rapprochés | centralisation des courriels reçus |
| 4 | **Reconnaissance automatique** : fil, numéros, références, expéditeur, texte des pièces ; natures et règles paramétrables, seuils, alertes au service, propositions de statut | ARC, réponses aux devis, factures fournisseurs |
| 5 | Relances par courriel (CRM C27, avec le module Règlements) | relances |
| Second temps | Comptes des utilisateurs, OAuth délégué, IDLE, complément Outlook | |

Chaque lot : règles répliquées avec leur jeu de cas, `npm test`, `dotnet test LogiBTP.slnx`, `CLAUDE.md` du module,
`MODULES.md` (lignes du tableau des modules, de la spécialisation et des liens transverses), `DEPENDANCES.md`.

## 11. Risques et points d'attention

- **Délivrabilité** : SPF, DKIM et DMARC du domaine relèvent de l'hébergeur du client ; l'écran du compte affiche un
  avertissement si l'expéditeur n'est pas du domaine du serveur d'envoi. Envoyer par le serveur du client (pas par un
  relais LogiBTP) évite d'avoir à gérer la réputation d'envoi.
- **Retrait de l'authentification par mot de passe** chez Microsoft (et Google) : module OAuth livré avant le lot 1
  pour ne pas livrer un module inutilisable chez les clients Microsoft 365 ; le mot de passe reste pour les autres
  (ML4). Un secret client expiré coupe tous les envois du compte : d'où les rappels d'échéance du module OAuth et la
  file qui garde les messages (`SUSPENDU`) jusqu'à la reconnexion.
- **Blocage ou classement en indésirables** : limitations, lissage et suspension automatique des envois groupés
  (§ 6.3) ; les quotas des hébergeurs évoluent : valeurs par défaut à revoir à chaque mise en place.
- **Clé de chiffrement** : sans module d'installation, la perte de `LOGIBTP_CLE_CHIFFREMENT` rend tous les comptes
  illisibles (comme les mots de passe des fiches) ; procédure de ressaisie à documenter.
- **Volume** : boîtes partagées très chargées : relève incrémentale par UID, limite de taille, dossiers choisis ;
  première relève limitée aux N derniers jours (paramètre) pour ne pas importer des années d'historique.
- **RGPD** : courriels reçus non rapprochés purgés (ML9) ; contenu des boîtes visible des seuls services autorisés ;
  courriels privés reçus par erreur sur une boîte système : action « ignorer » qui purge le courriel de la GED.
- **Boucles** : jamais de réponse automatique à un courriel `Auto-Submitted` ou à une réponse d'absence ; un envoi de
  l'application relevé dans sa propre boîte (copie à soi) est reconnu par son `Message-ID` et ignoré.
