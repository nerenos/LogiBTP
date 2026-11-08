# Restes du TODO : accusés de réception de commande reçus par courriel (module Mail)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1 (Documents, lot 9
> réalisé). Sujet sans analyse détaillée : questions ouvertes à trancher **au démarrage du plan** ; les lots suivent la
> recommandation.
>
> Contexte utile :
> - Module Mail : reconnaissance miroir `modules/mail/js/src/reconnaissance.js` ↔
>   `modules/mail/dotnet/LogiBTP.Mail/ReconnaissanceMail.cs`, jeu `modules/mail/tests/cas/01_reconnaissance.json`
>   (tests `modules/mail/js/test/reconnaissance.test.js`, `LogiBTP.Mail.Tests/ReconnaissanceMailTests.cs`) ; réception
>   `modules/mail/dotnet/LogiBTP.Mail.Web/ServiceReceptionMail.cs` (`TraiterAsync :113`, `ReconnaitreAsync :156`,
>   `RattacherAsync :352`) ; spécialisation `SpecialisationMail.cs` ; codes `modules/mail/js/src/codes.js` ↔
>   `LogiBTP.Mail/Codes.cs`.
> - ARC de l'entête d'une commande : `ent_arc_numero`, `ent_arc_date`, `ent_arc_livraison` (`db/238_documents_arc.sql:10-12`),
>   modifiables hors verrou par `ArcDocument` (`src/LogiBTP.Api/Btp/Structure.cs:25`). Boîte de réception du cœur :
>   `client/src/app/pages/mail.js`.
> - Le module Mail ne connaît pas les commandes : le cœur spécialise.
>
> Décisions (08/11/2026) : périmètre retenu (Q1 : tout) ; aucun choix de détail pris, voir ci-dessous.

## Questions ouvertes (à trancher au démarrage)

| N° | Question | Recommandation | Statut |
|---|---|---|---|
| AO1 | Où chercher le numéro de commande et la date de livraison ? | Objet et corps du message (texte), pas d'analyse des pièces jointes PDF dans ce plan ; motifs d'AR (« accusé de réception », « confirmation de commande », « AR », « ARC ») et numéro au format de la numérotation des commandes. | ✔ Tranché (08/11/2026) : recommandation retenue |
| AO2 | Que fait-on d'un AR reconnu ? | Rattachement automatique du message à la commande trouvée ; numéro et date de livraison **proposés** dans la boîte de réception, appliqués à l'ARC de la commande seulement après validation par l'utilisateur. | ✔ Tranché (08/11/2026) : recommandation retenue |
| AO3 | Commande introuvable ou plusieurs candidates ? | Pas de rattachement ; message marqué « AR à rapprocher » avec les candidates proposées. | ✔ Tranché (08/11/2026) : recommandation retenue |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Reconnaissance d'un AR (motifs, numéro, date) | `modules/mail` | AO1 | FAIT (08/11/2026) |
| 2 | Point d'accroche « AR reconnu » à la réception | `modules/mail` | 1, AO2 | FAIT (08/11/2026) |
| 3 | Rapprochement de la commande et rattachement | cœur | 2, AO3 | FAIT (08/11/2026) |
| 4 | Proposition de la livraison confirmée dans la boîte de réception | cœur | 3 | A FAIRE |

---

## Lot 1 : reconnaissance d'un AR (FAIT le 08/11/2026)

- **Module** : `modules/mail`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `reconnaissance.js` ↔ `ReconnaissanceMail.cs` (nouvelle reconnaissance : est-ce un AR, numéro de
  commande candidat, date de livraison), `codes.js` ↔ `Codes.cs` (type de reconnaissance), `01_reconnaissance.json`
  (ou nouveau `02_accuses_reception.json`), `reconnaissance.test.js`, `ReconnaissanceMailTests.cs`, `CodesTests.cs`.
- **Dépendances** : AO1 tranchée.
- **Règles répliquées JS / C#** : détection d'un AR, extraction du numéro et de la date (formats jj/mm/aaaa, « semaine
  n »…, selon AO1).
- **Jeux de tests** : AR avec numéro et date ; AR sans date ; message ordinaire non reconnu ; deux numéros candidats.
- **Critère de fin** : le jeu passe en JS et en C# ; `npm test`, `dotnet test LogiBTP.slnx` verts.
- **Réalisé** : `reconnaitreAccuse` ↔ `ReconnaitreAccuse` (préfixes de numérotation et année de référence fournis par l'appelant ; livraison reconnue seulement après un mot « livraison ») ; jeu séparé `02_accuses_reception.json`, `AccuseReceptionTests.cs` ; codes `TYPE_RECONNAISSANCE`, `PRECISION_LIVRAISON`. Correction de parité : années reconnues de 2000 à 2099 seulement (sinon pas de date, sans exception), `setUTCFullYear` côté JS ; `Normaliser` aligne U+0085 et U+FEFF.

## Lot 2 : point d'accroche « AR reconnu » à la réception (FAIT le 08/11/2026)

- **Module** : `modules/mail`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `ServiceReceptionMail.cs` (`TraiterAsync :113`, `ReconnaitreAsync :156` : méthode virtuelle appelée
  pour un AR reconnu, sans effet par défaut ; état « proposition » conservé sur le message), `Donnees.cs` / script
  `modules/mail/db` si l'état doit être stocké (manifeste), tests `ServiceMailTests.cs`.
- **Dépendances** : lot 1 ; AO2 tranchée.
- **Règles répliquées JS / C#** : aucune nouvelle.
- **Jeux de tests** : C# : AR reconnu → accroche appelée une fois avec numéro et date ; message ordinaire → non appelée.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert.
- **Réalisé** : `SpecialisationMail.ParametresAccuseAsync` (préfixes, année de référence, motifs fournis par le cœur) et `AccuseReconnuAsync` (sans effet par défaut) ; `ServiceReceptionMail.ReconnaitreAccuseAsync` appelée après la reconnaissance, sauf courrier ignoré ou dossier « à traiter » ; proposition conservée sur le message (script `007d_mail_accuse.sql`, colonnes `mme_ar_*`, essayé le 08/11/2026 sur la base de dev 5433 dans une transaction annulée : six colonnes créées, aucune erreur, rien conservé) ; un échec de l'accroche est journalisé sans bloquer la réception ; test `Accuse_de_reception_reconnu_a_la_reception` (exécuté seulement avec `LOGIBTP_TEST_PG`).

## Lot 3 : rapprochement de la commande et rattachement (FAIT le 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : spécialisation du module Mail dans le cœur (`src/LogiBTP.Api/Btp/`, graphify « spécialisation mail
  cœur ») : recherche de la commande par numéro (pièces valables seulement, `v_document_valable`), rattachement par
  `RattacherAsync` (`:352`), marque « AR à rapprocher » sinon ; tests C#.
- **Dépendances** : lot 2 ; AO3 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : numéro trouvé → rattaché ; introuvable → marqué ; deux candidates → marqué avec les candidates ;
  commande annulée ou remplacée ignorée.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert.
- **Réalisé** : `AccuseCommandeBtp` (SQL des commandes `A_COMMANDE` / `T_COMMANDE` par `v_document_valable` hors annulées, numéros comparés sans séparateurs ni casse ; `Resoudre`) et surcharges `SpecialisationMailBtp.ParametresAccuseAsync` (préfixes des types ARC) / `AccuseReconnuAsync`. Écart au plan : l'accroche du module renvoie maintenant une `ResolutionAccuse` (élément unique ou candidates) et c'est `ServiceReceptionMail` qui rattache (`RattacherAsync`, origine `REGLE`, règle `ACCUSE_RECEPTION`, sans changer la contrainte `mli_origine`) ou, pour plusieurs candidates, les garde en propositions (indice `ACCUSE_RECEPTION`, état PROPOSE) ; numéro introuvable : le message reste « à rapprocher » avec sa proposition d'AR. Tests : `AccuseCommandeTests` (décisions, comparaison, SQL en base de dev dans une transaction annulée avec `LOGIBTP_TEST_PG`), cas de deux candidates dans `ServiceMailTests`.

## Lot 4 : proposition de la livraison confirmée (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/mail.js` (bandeau de proposition sur le message : numéro d'AR et date de
  livraison, bouton « Appliquer à la commande »), application par la route de l'ARC (`Structure.cs:25`), textes, test
  client.
- **Dépendances** : lot 3 ; après le lot 7 du plan `corrections-marche-document.md` s'il est en cours (même route de
  l'ARC).
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : appliquer → `ent_arc_numero`, `ent_arc_date`, `ent_arc_livraison` posés et tracés ; ignorer → rien.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts.
