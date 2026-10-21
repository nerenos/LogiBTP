# LogiBTP – analyse du module d'authentification (première étape)

> Analyse préalable (21/10/2026), demandée comme suite de l'analyse transverse
> ([ANALYSE-MODULES-TRANSVERSE.md](ANALYSE-MODULES-TRANSVERSE.md), § 2). **Point de départ** : une session utilisateur
> pour la saisie, liée à un **salarié** ou à un **intérimaire**. Le module complet des droits (groupes, droits par
> module et par action, comptes de service, fournisseur d'identité, double facteur) viendra ensuite (§ 9).
> Modules qui l'attendent : [Pointage MO](ANALYSE-MODULE-POINTAGE.md) (connexion du salarié, M8),
> [CRM](ANALYSE-MODULE-CRM.md) (« mes tâches », notes privées), [Planning](ANALYSE-MODULE-PLANNING.md) (vues
> personnelles, vue en consultation), [Exécution](ANALYSE-MODULE-EXECUTION.md) (« ma file »).

> **Réalisation** : lots 0 et 1 réalisés le 22/10/2026 ; contexte technique dans
> [modules/authentification/CLAUDE.md](../../modules/authentification/CLAUDE.md). Écarts : routes sous `/api/auth/*`
> (`connexion`, `deconnexion`, `session`, `mot-de-passe`, `politique`) ; empreintes PBKDF2-SHA256 propres au module
> (sans le paquet d'ASP.NET Identity, même principe) ; administrateur de l'installation = compte de personne sans
> personne liée ; script `005` (avant les modules métier).

## 1. Constat

| Sujet | Aujourd'hui | Conséquence |
|---|---|---|
| Utilisateur courant | En-têtes `X-Utilisateur`, `X-Profil`, `X-Groupe` (`Utilisateur.Depuis`, `socle/dotnet/LogiBTP.Socle.Web/Web.cs`) ; défaut `demo` / `ADMIN` | N'importe quel appel peut se faire passer pour n'importe qui ; aucun accès réel par salarié |
| Client | Constante `ENTETES` (`client/src/app/api.js` : `demo`, `ADMIN`) ; profil de démonstration choisi dans les paramètres hors ligne | Pas d'écran de connexion |
| Identifiant de connexion | `individu.ind_utilisateur` (unique, « pour le futur module des droits ») ; un individu qui en a un ne se supprime pas (`FICHE_PROTEGEE`) | Base prête à recevoir le lien compte ↔ individu |
| Profils et droits | Codes de profil libres (`ADMIN`, `SAISIE`) dans `droit_document`, `droit_fiche`, `crm_droit` ; `Utilisateur.EstAdmin` | Les droits existants restent valables : il suffit que la session fournisse le profil |
| Salariés | `demo_salarie` (statut CDI / CDD / INTERIM, `sal_actif`, `sal_ind_id` → individu de notre société) | Un compte se rattache à l'individu du salarié ou de l'intérimaire |
| Traces | Colonnes `…_cree_par`, `…_maj_par` (code utilisateur, 50 caractères) dans tous les modules | Le code utilisateur devient l'identifiant du compte : rien à changer dans les tables |
| Sociétés | Une base par société (sous-domaine) | Les comptes vivent dans la base de la société : on se connecte sur le sous-domaine |

## 2. Objet de la première étape

Permettre à un salarié ou à un intérimaire de **se connecter** (identifiant, mot de passe) sur le sous-domaine de sa
société et d'obtenir une **session** qui remplace les en-têtes : le serveur connaît alors de façon sûre son code, son
individu, son profil ; tous les écrans existants continuent de fonctionner (même `Utilisateur`), et les modules
s'appuient sur l'individu de la session (CRM, Pointage…).

Hors première étape (§ 9) : groupes et droits fins par module, comptes de service et bornes, appareils mobiles hors
ligne, fournisseur d'identité de l'entreprise (Microsoft 365, Google), double facteur, comptes de personnes extérieures
(portails).

## 3. Synthèse fonctionnelle

### 3.1 Compte

- **Aucun compte par défaut** : un administrateur crée un compte pour l'**individu** d'un **salarié** (CDI, CDD) ou d'un
  **intérimaire** qui doit se connecter (A3) ; identifiant = **pseudo** choisi pour le compte, unique dans la base, recopié
  dans `ind_utilisateur` (A1) ; mot de passe haché ; **profil** (codes existants :
  ADMIN, SAISIE, puis ceux du module complet) ; actif ou non ; fin de validité facultative (fin de mission d'un
  intérimaire, fin de CDD).
- Créé par un administrateur depuis la **fiche salarié** (ou la fiche individu) : onglet « Compte » avec identifiant,
  profil, validité, mot de passe provisoire à changer à la première connexion ; réinitialisation du mot de passe ;
  désactivation.
- Désactivé d'office quand le salarié n'est plus actif (`sal_actif`) ou que sa validité est passée ; jamais supprimé
  (les traces des tables gardent son code).

### 3.2 Connexion et session

- Page `/connexion` (identifiant, mot de passe), seule page accessible sans session avec la démo hors ligne.
- Session : jeton aléatoire dans un **cookie** `HttpOnly`, `Secure`, `SameSite=Strict`, propre au sous-domaine ;
  expiration glissante (par exemple 10 heures d'inactivité, 7 jours au plus), « Rester connecté » facultatif.
- Comptes de **service** (profil SERVICE, A12) : comptes nommés pour les tâches de fond (archivage de la GED, éditions
  produites en fond…), chacun avec ses droits, sans connexion interactive ; pseudos réservés refusés (A13).
- Tests : compte choisi **sans mot de passe** dans la démonstration hors ligne et, en ligne, seulement dans l'environnement
  de développement (A10, A11).
- Le serveur lit la session à chaque appel et construit `Utilisateur(Code, Profil, Groupe)` comme aujourd'hui ;
  `Utilisateur.Depuis` ne lit plus les en-têtes (sauf mode de développement explicite, § 4 A11).
- Déconnexion (bandeau : 👤 nom · profil → Se déconnecter) ; changement de mot de passe par l'utilisateur.
- Plusieurs fenêtres d'une même session (module Navigation) partagent le cookie : aucune connexion par fenêtre.

### 3.3 Sécurité de base

- Hachage par l'algorithme d'ASP.NET Core (`PasswordHasher`, PBKDF2 avec sel et itérations, réglage évolutif) sans
  tout ASP.NET Identity.
- Verrouillage temporaire après N échecs (par exemple 5 échecs → 15 minutes), message identique pour un identifiant
  inconnu ou un mot de passe faux.
- Politique de mot de passe minimale (longueur 12, refus des plus courants) ; mot de passe provisoire à usage unique.
- Journal des connexions (réussies, échouées, déconnexions, réinitialisations) : qui, quand, adresse, navigateur.
- Toutes les routes `/api` exigent une session, sauf `/api/sante`, `/api/societe`, `/api/connexion` ; la page de
  connexion et les fichiers du client restent publics.

## 4. Questions, propositions et décisions

| N° | Question | Proposition | Décision (21/10/2026) |
|---|---|---|---|
| A1 | Identifiant : code libre (`jp.martin`), courriel ou matricule ? | Code libre unique dans la base, proposé à la création (`p.nom`, sans accents), repris de `ind_utilisateur` ; le courriel et le matricule servent à le retrouver, pas à se connecter. | ✘ Autrement : l'identifiant est un **pseudo** choisi pour le compte (unique dans la base), pas forcément `prenom.nom`. |
| A2 | Un profil par compte ou plusieurs ? | Un seul profil en première étape (le serveur l'envoie comme aujourd'hui `X-Profil`) ; plusieurs profils ou groupes avec le module complet. | ✔ Retenue. |
| A3 | Qui peut avoir un compte en première étape ? | Les individus de notre société qui sont salariés (CDI, CDD) ou intérimaires ; un compte sans salarié (dirigeant, administrateur externe, borne) attend le module complet, sauf le compte administrateur de l'installation (A9). | ✔ Précisé : pour commencer, salariés et intérimaires, et **seulement ceux pour qui un compte est paramétré** : **par défaut, aucun compte**. |
| A4 | Intérimaire : validité du compte ? | Date de fin obligatoire pour un intérimaire (fin de mission), facultative pour un CDD ; prolongeable ; après la date, connexion refusée « compte expiré ». | ✔ Retenue. |
| A5 | Profil par défaut à la création ? | Profil `SAISIE` (saisie sans validation, comme aujourd'hui) ; un administrateur choisit un autre profil ; un intérimaire ne peut pas être ADMIN. | ✔ Retenue. |
| A6 | Durée de session et « Rester connecté » ? | 10 h d'inactivité, 7 jours au plus avec « Rester connecté » ; réglables par société dans les paramètres. | ✔ Retenue. |
| A7 | Mot de passe oublié sans module Mail ? | Réinitialisation par un administrateur (mot de passe provisoire affiché une fois) ; le lien de réinitialisation par courriel attendra le module Mail. | ✔ Retenue. |
| A8 | Une même personne dans deux sociétés (deux bases) ? | Deux comptes indépendants (un par base) ; la connexion unique entre sociétés relève du module complet. | ✔ Deux comptes, deux bases séparées. |
| A9 | Premier administrateur d'une base neuve ? | Créé par le module d'installation (déjà prévu) ou, en attendant, par une commande serveur (`dotnet LogiBTP.Api -- comptes creer-admin`) qui affiche un mot de passe provisoire ; aucun compte par défaut à mot de passe connu. | ✔ Retenue. |
| A10 | Démonstration hors ligne ? | Inchangée : sans API, pas de connexion, profil de démonstration choisi dans les paramètres. | ✔ Pour le moment ; on peut aussi **choisir un compte sans mot de passe pour les tests** (démonstration hors ligne, et en ligne seulement dans l'environnement de développement, comme A11). |
| A11 | Développement et tests (les en-têtes servent aux appels de test, curl, scripts de démonstration) ? | Mode `Authentification:Mode` = `Session` (défaut) ou `EnTetes` (développement uniquement, refusé hors environnement Development) ; les tests d'intégration et `generer-documents-demo.mjs` se connectent par `/api/connexion`. | ✔ Retenue. |
| A12 | Tâches de fond (archivage GED, éditions produites en fond) ? | Utilisateur système interne (`systeme`, profil ADMIN), jamais utilisable pour se connecter. | ✔ Précisé : un **profil SERVICE** avec **plusieurs comptes nommés** (archivage de la GED, éditions produites en fond, puis bornes…), chacun avec ses droits ; aucun ne se connecte de façon interactive. |
| A13 | Données existantes signées `demo` ? | Gardées telles quelles (code historique) ; un compte ne peut pas prendre le code `demo` ni `systeme`. | ✔ Précisé : **pseudos réservés** refusés (`demo`, `admin`, `administrateur`, `system`, `systeme`, `root`, `service`, `test`, `invite`, `guest`… liste paramétrable) ; données signées `demo` gardées. |
| A14 | Changement de profil d'un utilisateur connecté ? | Pris en compte à son prochain appel (la session relit le compte, cache court) ; désactiver un compte ferme ses sessions. | ✔ Retenue. |

Toutes les questions de la première étape sont tranchées (A1 à A14).

## 5. Liens avec les autres modules

| Module | Ce que la première étape apporte |
|---|---|
| Tous | `Utilisateur` sûr (code, profil) ; droits existants par profil (`droit_document`, `droit_fiche`, `crm_droit`) inchangés |
| Annuaire / Salariés | Onglet « Compte » de la fiche salarié ; `ind_utilisateur` = identifiant ; désactivation quand le salarié sort |
| CRM | L'individu de la session vient du compte (plus besoin de saisir `ind_utilisateur` à la main) : « Mes tâches », « À prendre », rappels, notes privées fonctionnent pour chaque salarié |
| Pointage | Connexion personnelle du salarié et de l'intérimaire (la borne et le hors-ligne viennent avec le module complet) |
| Planning, Exécution | Vues personnelles, « ma file », vue en consultation pour les chefs d'équipe |
| Navigation (client) | Page de connexion, utilisateur dans le bandeau, déconnexion ; redirection vers `/connexion` sur une réponse 401 |
| Édition, GED | Auteur réel des dépôts et des éditions ; tâches de fond sous l'utilisateur système |
| Installation (à venir) | Premier administrateur, clé de chiffrement |

## 6. Faisabilité

**Faisable rapidement** : le point d'entrée est unique (`Utilisateur.Depuis`, appelé par toutes les routes), le code
utilisateur est déjà la trace de toutes les tables, et les droits sont déjà exprimés par profil.

| Travail | Où |
|---|---|
| Module `modules/authentification` (générique) : comptes, sessions, journal, hachage, verrouillage, routes `/connexion`, `/deconnexion`, `/session`, `/mot-de-passe` ; point d'accroche « personne liée » (le cœur dit qui peut avoir un compte et sa validité) | Nouveau module (JS : règles de mot de passe répliquées ; .NET : `LogiBTP.Authentification(.Web)`) |
| Lecture de la session : intergiciel qui pose l'utilisateur dans `HttpContext.Items` ; `Utilisateur.Depuis` le lit (en-têtes seulement en mode développement) | Socle.Web |
| Spécialisation du cœur : compte réservé aux individus salariés ou intérimaires actifs, validité, synchronisation de `ind_utilisateur`, désactivation à la sortie | `src/LogiBTP.Api/Btp` |
| Client : page `/connexion`, suppression de `ENTETES['X-Utilisateur' / 'X-Profil']`, `app.utilisateur()` et `app.profil()` lus depuis `/api/session`, 401 → connexion, onglet « Compte » de la fiche salarié, bandeau | `client/src/app` |
| Tests et scripts : connexion avant les appels ; jeu de cas des règles de mot de passe | Tests, `client/scripts` |

**Risques** : oublier une route publique ou au contraire en exposer une (test qui vérifie que chaque route exige une
session) ; scripts et tests qui reposent sur les en-têtes (mode développement explicite) ; verrouillage d'un compte
administrateur unique (commande serveur de secours, A9).

## 7. Simplification d'utilisation

- Pseudo saisi à la création du compte depuis la fiche salarié (suggestion modifiable, unicité contrôlée à la frappe).
- Mot de passe provisoire affiché une fois, à recopier ; changement imposé à la première connexion.
- « Rester connecté » sur un poste personnel ; déconnexion automatique sur un poste partagé (réglage par société).
- Liste « Comptes utilisateurs » (actifs, expirés, verrouillés, dernière connexion) dans le menu Paramètres, avec
  déverrouillage et réinitialisation en un clic.

## 8. Esquisse du modèle de données (`modules/authentification/db`)

| Table | Colonnes principales |
|---|---|
| `compte` | `cpt_id`, `cpt_code` (pseudo, unique, recopié dans `ind_utilisateur`), `cpt_type` (PERSONNE / SERVICE), `cpt_type_element` / `cpt_id_element` (individu lié, point d'accroche), `cpt_hash`, `cpt_mdp_provisoire`, `cpt_profil`, `cpt_actif`, `cpt_valide_jusqu_au`, `cpt_echecs`, `cpt_verrouille_jusqu_au`, `cpt_derniere_connexion`, `cpt_cree_par`, `cpt_cree_le`, `cpt_maj_par`, `cpt_maj_le` |
| `session_utilisateur` | `ses_id`, `ses_jeton_hache`, `ses_cpt_id`, `ses_cree_le`, `ses_vu_le`, `ses_expire_le`, `ses_persistante`, `ses_adresse`, `ses_navigateur`, `ses_fermee_le` |
| `journal_connexion` | `jco_id`, `jco_code`, `jco_evenement` (CONNEXION, ECHEC, VERROUILLAGE, DECONNEXION, MDP_CHANGE, MDP_REINITIALISE, EXPIRE), `jco_le`, `jco_adresse`, `jco_navigateur`, `jco_par` |
| `parametre_authentification` | durée de session, « Rester connecté », seuil de verrouillage, politique de mot de passe, pseudos réservés |

## 9. Découpage en lots

| Lot | Contenu | Prérequis |
|---|---|---|
| 0 | Module, comptes liés aux salariés et intérimaires (aucun par défaut, pseudo, pseudos réservés), connexion, session par cookie, lecture par `Utilisateur.Depuis`, comptes de service nommés (profil SERVICE), mode développement et compte de test sans mot de passe, page de connexion, bandeau, journal | — |
| 1 | Gestion des comptes : onglet « Compte » de la fiche salarié, liste des comptes, réinitialisation, déverrouillage, validité des intérimaires, désactivation à la sortie | 0 |
| 2 (module complet) | Groupes et profils multiples, droits par module et par action (regroupement de `droit_document`, `droit_fiche`, `crm_droit`), écran des droits | 1 |
| 3 | Comptes de service et appareils enregistrés (borne du Pointage), jetons des appareils mobiles hors ligne | Lot 2 ; Pointage |
| 4 | Fournisseur d'identité de l'entreprise (OpenID Connect), double facteur, réinitialisation par courriel | Lot 2 ; module Mail |
