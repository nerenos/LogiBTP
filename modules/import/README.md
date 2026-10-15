# Module Import

Lecture, dans le navigateur, de documents produits par d'autres logiciels et conversion en un devis neutre que
l'application traduit dans son modèle (`modules/import/js`, sans dépendance).

- `lireZip` : archive zip (fichiers stockés ou deflate, `DecompressionStream`).
- `analyserXml` : arbre XML simple (éléments, attributs, texte, CDATA, entités), utilisable sous Node.
- `rtfEnHtml` / `rtfEnTexte` : libellés RTF (RichEdit) en HTML simple (paragraphes, gras, italique, souligné, accents).
- `lireFichierOptim` / `convertirOptim` : devis OptimBTP (`.optim` = zip contenant `Devis.xml`). Chaque champ du
  fichier a un sort documenté (`CHAMPS_ENTETE`, `CHAMPS_LIGNE`, `CHAMPS_INTERVENANT`) : repris, recalculé ou non
  repris ; `non_repris` liste les champs renseignés sans équivalent (affichés en mode débogage).
- `associerUnite`, `associerNature`, `associerTaux`, `associerOption` : rapprochement avec les référentiels.

L'application (cœur) ouvre le devis importé dans une fenêtre de vérification, puis à la création conserve le fichier
source dans la GED et enregistre l'origine du document (traçabilité, réutilisation de l'import).
