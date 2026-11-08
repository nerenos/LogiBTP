# Corrections de novembre : interface (P1, P2, P3, choix en liste I1)

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1 (choix en liste), § 6.
>
> Contexte utile :
> - P3 : fenêtre de notification du socle `socle/js/src/ui/notification.js` : décompte de 8 s figé au premier clic ou au
>   focus ; `d.show()` (`:100`) donne le focus au premier bouton et le `focusin` (`:87`) fige le décompte dès
>   l'ouverture. Test : `socle/js/test/notification.test.js`.
> - P2 : mots-clés de la bibliothèque = texte séparé par des virgules (`ele_mots_cles`, db/131 ;
>   `EleMotsCles`, `modules/bibliotheque/dotnet/LogiBTP.Bibliotheque.Web/Donnees.cs:114`) ; GED : `dge_mots_cles TEXT[]`.
>   Aucun composant jeton dans le socle (`socle/js/src/ui/`).
> - P1 : teintes des pastilles à nom de sens (`neutre`, `info`, `envoye`, `succes`, `attention`, `erreur`, `termine`,
>   `barre`) : `TEINTES_PASTILLE`, `modules/liste/js/src/modele.js:21`, employées par `client/src/app/codes.js:185-211`.
> - I1 : composant de choix en liste du module Liste `choisirDansListe` (`modules/liste/js/ui/choix.js:21`, option
>   `multiple` déjà présente), vues de choix par contexte (`vue_liste.vli_contexte` : `choix:conducteur`,
>   `choix:charge_affaires`…), fonction de choix injectée par le cœur (`client/src/app/annuaire/choix.js`). Combos
>   actuelles d'individus : par exemple `comboConducteur` (`client/src/app/structure/marche-commande.js:78`).
>   Analyse d'origine : `documentation/conception/ANALYSE-ERGONOMIE.md` § I1.
> - Règles d'interface : aucun texte, icône ni couleur en dur (`texte()`, `icone()`, variables du thème) ; combos par
>   `creerCombo` ; préférences dans le `localStorage`.
>
> Décisions (08/11/2026) :
> - **P3 (Q19 : a)** : le décompte ne se fige que sur un clic ou une frappe de l'utilisateur dans la fenêtre, pas sur le
>   focus donné à l'ouverture ; l'ouverture laisse le focus sur la saisie en cours. Tous niveaux, erreurs comprises.
> - **P2 (Q18 : a)** : composant `creerJetons` dans le socle (ajout par Entrée ou virgule, retrait par la croix), utilisé
>   par la fiche élément et la GED ; stockage inchangé.
> - **P1 (Q17 : b)** : codes des teintes gardés ; le paramétrage affiche le nom et l'aperçu de la couleur. Pas de reprise
>   des vues enregistrées.
> - **I1 (Q6 : b, puis c)** : individus de notre société filtrés par poste (conducteur, chargé d'affaires, rédacteur),
>   puis contact d'un intervenant pris dans les contacts du tiers ; la sélection multiple (destinataires) en dernier lot.
>
> Ordre : socle (lots 1, 2), modules (lots 3 à 5), cœur (lots 6 à 8).

## Points ouverts

| Point | Recommandation | Statut |
|---|---|---|
| Destinataires visés par la sélection multiple (lot 8) : envoi de courriel d'une pièce, diffusion GED, autres ? | Commencer par les destinataires de l'envoi de courriel d'une pièce ; les autres écrans suivent le même appel. | OUVERT |
| Noms de couleur des teintes (P1) : quelle correspondance code → couleur ? | Dérivée des variables du thème courant (`--pastille-<code>-*`) : nom de couleur lu dans le dictionnaire de textes, aperçu par la variable ; pas de couleur en dur. | OUVERT |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | P3 : décompte des notifications non figé à l'ouverture | `socle` | — | FAIT (08/11/2026) |
| 2 | P2 : composant `creerJetons` | `socle` | — | FAIT (08/11/2026) |
| 3 | P2 : mots-clés en jetons dans la fiche élément | `modules/bibliotheque` | 2 | A FAIRE |
| 4 | P2 : mots-clés en jetons dans la GED | `modules/ged` | 2 | A FAIRE |
| 5 | P1 : nom et aperçu de la couleur dans le choix de teinte | `modules/liste` | — | A FAIRE |
| 6 | I1 : individus de notre société par poste en choix en liste | cœur | — | A FAIRE |
| 7 | I1 : contact d'un intervenant dans les contacts du tiers | cœur | 6 | A FAIRE |
| 8 | I1 : sélection multiple des destinataires | cœur | 6 | A FAIRE |

---

## Lot 1 : P3, décompte des notifications non figé à l'ouverture (FAIT 08/11/2026)

> Écart : pas d'environnement DOM dans les tests du socle, le test emploie un faux `document`. `d.show()` est gardé, le focus est rendu à l'élément actif d'avant.

- **Module** : `socle`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `socle/js/src/ui/notification.js` (`:87` : figer sur `pointerdown` / `keydown` dans la fenêtre au lieu de
  `focusin` ; `:100` : ouverture sans prise de focus, l'élément actif d'avant reste actif), `socle/js/test/notification.test.js`.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : ouverture → décompte actif et focus inchangé ; clic dans la fenêtre → figé ; frappe → figé ;
  niveau erreur → même comportement ; fin du décompte → fermeture.
- **Critère de fin** : `npm test` vert ; une notification ouverte sans interaction se ferme après le délai.

## Lot 2 : P2, composant `creerJetons` (FAIT 08/11/2026)

> Écart : Entrée et Retour arrière passent par le groupe de raccourcis `jetons` (actions `ajouter`, `retirerDernier`, `actionDe`) ; la virgule est un séparateur de saisie traité sur `input`, pas un raccourci ; logique pure testée (`decouperJetons`, `ajouterJetons`, `retirerJeton`), le DOM n est pas testé. Textes `socle.jetons.*` dans `socle/js/personnalisation/fr.json`. `socle/CLAUDE.md` non modifié (à mentionner).

- **Module** : `socle`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `socle/js/src/ui/jetons.js` (nouveau : valeur en tableau de textes, ajout par Entrée ou virgule,
  retrait par la croix ou Retour arrière sur saisie vide, doublons ignorés, événement de changement), `socle/js/src/ui/index.js`
  (export), `socle/js/src/ui/socle.css` (variables du thème seulement), raccourcis par `declarerRaccourcis` si besoin
  (`raccourcis.json`), textes et icône par `texte()` / `icone()`, `socle/js/test/jetons.test.js` (nouveau), mention
  dans `socle/CLAUDE.md` **non** faite (aucun CLAUDE.md modifié par ce plan : la signaler dans le compte rendu).
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : ajout par Entrée, par virgule, collage « a, b » → deux jetons ; retrait ; doublon ignoré ; valeur
  initiale.
- **Critère de fin** : `npm test` vert ; composant exporté par le socle.

## Lot 3 : P2, mots-clés en jetons dans la fiche élément (FAIT 08/11/2026)

> Écart : la saisie est dans le module Fiche (`fiche.js`, champ texte de format `jetons`, valeur réécrite « a, b ») et la définition du cœur (`client/src/app/fiches/definitions.js`), pas dans `onglets.js` ; aucun changement C# (format inconnu accepté par la validation) ; tests dans `modules/fiche/js/test/fiche.test.js` et `client/test/mots-cles-jetons.test.js`.

- **Module** : `modules/bibliotheque`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : saisie des mots-clés de la fiche élément (`modules/bibliotheque/js/ui/onglets.js`, à localiser par
  graphify « mots-clés élément »), conversion texte à virgules ↔ tableau à la lecture et à l'écriture (stockage
  inchangé), `modules/bibliotheque/js/test/bibliotheque.test.js`.
- **Dépendances** : lot 2. Même fichier que le plan `corrections-bibliotheque.md` (lots 1, 3, 5) : ne pas mener en
  parallèle.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : « béton, coffrage » → deux jetons ; enregistrement → `ele_mots_cles` = « béton, coffrage ».
- **Critère de fin** : `npm test` vert ; aucune reprise de données.

## Lot 4 : P2, mots-clés en jetons dans la GED (A FAIRE)

- **Module** : `modules/ged`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : saisie des mots-clés d'un document (`modules/ged/js/ui/depot.js`, `apercu.js` ou `explorateur.js`, à
  localiser par graphify « mots-clés document GED »), `modules/ged/js/test/ged.test.js`.
- **Dépendances** : lot 2.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : dépôt avec deux jetons → `dge_mots_cles` à deux valeurs ; modification ; retrait.
- **Critère de fin** : `npm test` vert.

## Lot 5 : P1, nom et aperçu de la couleur dans le choix de teinte (A FAIRE)

- **Module** : `modules/liste`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/liste/js/src/modele.js` (`:21`, `TEINTES_PASTILLE` inchangé), choix de teinte du concepteur
  (`modules/liste/js/ui/concepteur.js`, `creerCombo` avec aperçu par la variable du thème), textes des noms de couleur
  (dictionnaire du module), `modules/liste/js/test/liste.test.js`.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : chaque teinte a un nom de couleur au dictionnaire ; le choix montre un aperçu ; code enregistré
  inchangé.
- **Critère de fin** : `npm test` vert (y compris les tests de textes de la Personnalisation).

## Lot 6 : I1, individus de notre société par poste en choix en liste (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `client/src/app/annuaire/choix.js` (contextes `choix:conducteur`, `choix:charge_affaires`,
  `choix:redacteur` avec filtre par défaut sur le poste, retirable), combos actuelles remplacées : `marche-commande.js:78`
  et les autres appelants (graphify « combo conducteur chargé d'affaires rédacteur »), vues de choix par contexte (script
  `db/` si de nouvelles vues sont livrées, ajouté à `db/installation/scripts.txt`), test client.
- **Dépendances** : aucune.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : test client : le contexte conducteur n'affiche que les individus de notre société à ce poste ;
  filtre retirable ; saisie directe conservée.
- **Critère de fin** : `npm test` vert ; plus de combo d'individus par poste dans les écrans visés.

## Lot 7 : I1, contact d'un intervenant dans les contacts du tiers (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/structure/intervenants.js` (choix du contact par `choisirDansListe` filtré sur les
  contacts du tiers de l'intervenant), `client/src/app/annuaire/choix.js` (contexte `choix:contact_tiers`), test client.
- **Dépendances** : lot 6.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : intervenant avec tiers → seuls ses contacts ; sans tiers → choix refusé avec message (`texte()`).
- **Critère de fin** : `npm test` vert.

## Lot 8 : I1, sélection multiple des destinataires (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : écran des destinataires retenu au point ouvert (graphify « destinataires envoi courriel »), appel de
  `choisirDansListe` avec `multiple` (`modules/liste/js/ui/choix.js:21`, rien à changer dans le module), test client.
- **Dépendances** : lot 6 ; point ouvert « destinataires visés » tranché.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : sélection de trois contacts → trois destinataires ; Échap → aucun changement.
- **Critère de fin** : `npm test` vert.
