import { texte, textesParCode } from '@logibtp/socle/dictionnaire';

// Catalogue documenté du langage des éditions : fonctions (signature, description, exemple), contextes de
// résolution des chemins, formats des champs. Source de l'aide de l'éditeur de modèle (dictionnaire) et du guide
// (documentation/GUIDE-EDITIONS.md) ; un test vérifie que chaque fonction du moteur y figure.

/** Catégories des fonctions, dans l'ordre d'affichage. */
const CODES_CATEGORIES = ['CONDITIONS', 'TEXTE', 'NOMBRES', 'DATES', 'COLLECTIONS', 'PAGE', 'MISE_EN_FORME', 'CODES'];
const CATEGORIES = textesParCode('edition.catalogue.categories', CODES_CATEGORIES);
export const CATEGORIES_FONCTIONS = Object.freeze(CODES_CATEGORIES.map((c) => CATEGORIES[c]));

/** Fonctions : nom (casse d'affichage), catégorie, signature, description, exemple. */
export const CATALOGUE_FONCTIONS = [
  { nom: 'Si', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'Si(condition; alors; sinon)', get description() { return texte('edition.catalogue.fonctions.si'); }, exemple: '=Si(document.verrouille; "Original"; "Provisoire")' },
  { nom: 'EstVide', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'EstVide(valeur)', get description() { return texte('edition.catalogue.fonctions.estvide'); }, exemple: '=Si(EstVide(client.contact); ""; "À l’attention de " & client.contact)' },
  { nom: 'PremierNonVide', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'PremierNonVide(v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.premiernonvide'); }, exemple: '=PremierNonVide(payeur.nom; client.nom)' },
  { nom: 'Contient', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'Contient(texte; recherché)', get description() { return texte('edition.catalogue.fonctions.contient'); }, exemple: '=Contient(ligne.libelle; "option")' },
  { nom: 'CommencePar', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'CommencePar(texte; début)', get description() { return texte('edition.catalogue.fonctions.commencepar'); }, exemple: '=CommencePar(document.type.code; "V_")' },
  { nom: 'Dans', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'Dans(valeur; v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.dans'); }, exemple: '=Dans(ligne.type; "TITRE"; "SECTION")' },
  { nom: 'Choix', get categorie() { return CATEGORIES.CONDITIONS; }, signature: 'Choix(rang; v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.choix'); }, exemple: '=Choix(document.avancement.rang; "1re"; "2e"; "3e")' },

  { nom: 'Concat', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Concat(v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.concat'); }, exemple: '=Concat(Gras("N° "); document.numero)' },
  { nom: 'Joindre', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Joindre(séparateur; v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.joindre'); }, exemple: '=Joindre(Ligne(); client.nom; client.adresse)' },
  { nom: 'Majuscule', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Majuscule(texte)', get description() { return texte('edition.catalogue.fonctions.majuscule'); }, exemple: '=Majuscule(client.nom)' },
  { nom: 'Minuscule', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Minuscule(texte)', get description() { return texte('edition.catalogue.fonctions.minuscule'); }, exemple: '=Minuscule(document.type.libelle)' },
  { nom: 'Gauche', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Gauche(texte; n)', get description() { return texte('edition.catalogue.fonctions.gauche'); }, exemple: '=Gauche(client.nom; 20)' },
  { nom: 'Droite', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Droite(texte; n)', get description() { return texte('edition.catalogue.fonctions.droite'); }, exemple: '=Droite(document.numero; 5)' },
  { nom: 'Longueur', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Longueur(texte)', get description() { return texte('edition.catalogue.fonctions.longueur'); }, exemple: '=Longueur(document.objet) > 60' },
  { nom: 'Remplacer', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Remplacer(texte; ancien; nouveau)', get description() { return texte('edition.catalogue.fonctions.remplacer'); }, exemple: '=Remplacer(societe.siret; " "; "")' },
  { nom: 'Texte', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Texte(valeur)', get description() { return texte('edition.catalogue.fonctions.texte'); }, exemple: '=Texte(document.indice)' },
  { nom: 'Ligne', get categorie() { return CATEGORIES.TEXTE; }, signature: 'Ligne()', get description() { return texte('edition.catalogue.fonctions.ligne'); }, exemple: '="Bon pour accord" & Ligne() & "Date et signature"' },

  { nom: 'Nombre', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Nombre(valeur; décimales; milliers)', get description() { return texte('edition.catalogue.fonctions.nombre'); }, exemple: '=Nombre(ligne.qte; 3)' },
  { nom: 'Montant', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Montant(valeur; décimales)', get description() { return texte('edition.catalogue.fonctions.montant'); }, exemple: '=Montant(totaux.ht)' },
  { nom: 'Monnaie', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Monnaie(valeur; symbole)', get description() { return texte('edition.catalogue.fonctions.monnaie'); }, exemple: '=Monnaie(totaux.net)' },
  { nom: 'Pourcent', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Pourcent(valeur; décimales max)', get description() { return texte('edition.catalogue.fonctions.pourcent'); }, exemple: '=Pourcent(ligne.avt_pct)' },
  { nom: 'Simple', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Simple(valeur; décimales max)', get description() { return texte('edition.catalogue.fonctions.simple'); }, exemple: '=Simple(ligne.qte)' },
  { nom: 'Arrondi', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Arrondi(valeur; décimales)', get description() { return texte('edition.catalogue.fonctions.arrondi'); }, exemple: '=Arrondi(totaux.ttc; 0)' },
  { nom: 'ArrondiSup', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'ArrondiSup(valeur; décimales)', get description() { return texte('edition.catalogue.fonctions.arrondisup'); }, exemple: '=ArrondiSup(ligne.qte)' },
  { nom: 'ArrondiInf', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'ArrondiInf(valeur; décimales)', get description() { return texte('edition.catalogue.fonctions.arrondiinf'); }, exemple: '=ArrondiInf(ligne.qte)' },
  { nom: 'Abs', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Abs(valeur)', get description() { return texte('edition.catalogue.fonctions.abs'); }, exemple: '=Abs(element.montant)' },
  { nom: 'Min', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Min(v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.min'); }, exemple: '=Min(100; ligne.avt_pct)' },
  { nom: 'Max', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'Max(v1; v2; …)', get description() { return texte('edition.catalogue.fonctions.max'); }, exemple: '=Max(0; totaux.net)' },
  { nom: 'EnLettres', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'EnLettres(montant; unité; sous-unité)', get description() { return texte('edition.catalogue.fonctions.enlettres'); }, exemple: '="Arrêté à la somme de " & EnLettres(totaux.net)' },
  { nom: 'EntierEnLettres', get categorie() { return CATEGORIES.NOMBRES; }, signature: 'EntierEnLettres(nombre)', get description() { return texte('edition.catalogue.fonctions.entierenlettres'); }, exemple: '=EntierEnLettres(document.validite_jours) & " jours"' },

  { nom: 'Date', get categorie() { return CATEGORIES.DATES; }, signature: 'Date(date; format)', get description() { return texte('edition.catalogue.fonctions.date'); }, exemple: '=Date(document.date; "long")' },
  { nom: 'AjouterJours', get categorie() { return CATEGORIES.DATES; }, signature: 'AjouterJours(date; n)', get description() { return texte('edition.catalogue.fonctions.ajouterjours'); }, exemple: '=Date(AjouterJours(document.date; 30))' },
  { nom: 'Aujourdhui', get categorie() { return CATEGORIES.DATES; }, signature: 'Aujourdhui()', get description() { return texte('edition.catalogue.fonctions.aujourdhui'); }, exemple: '="Édité le " & Date(Aujourdhui())' },

  { nom: 'Somme', get categorie() { return CATEGORIES.COLLECTIONS; }, signature: 'Somme(collection; champ)', get description() { return texte('edition.catalogue.fonctions.somme'); }, exemple: '=Somme(lignes; "montant")' },
  { nom: 'Compte', get categorie() { return CATEGORIES.COLLECTIONS; }, signature: 'Compte(collection; champ)', get description() { return texte('edition.catalogue.fonctions.compte'); }, exemple: '=Compte(echeances) > 1' },
  { nom: 'Moyenne', get categorie() { return CATEGORIES.COLLECTIONS; }, signature: 'Moyenne(collection; champ)', get description() { return texte('edition.catalogue.fonctions.moyenne'); }, exemple: '=Moyenne(lignes; "avt_pct")' },

  { nom: 'Page', get categorie() { return CATEGORIES.PAGE; }, signature: 'Page()', get description() { return texte('edition.catalogue.fonctions.page'); }, exemple: 'Page {{Page()}} / {{NbPages()}}' },
  { nom: 'NbPages', get categorie() { return CATEGORIES.PAGE; }, signature: 'NbPages()', get description() { return texte('edition.catalogue.fonctions.nbpages'); }, exemple: 'Page {{Page()}} / {{NbPages()}}' },
  { nom: 'Parametre', get categorie() { return CATEGORIES.PAGE; }, signature: 'Parametre(nom)', get description() { return texte('edition.catalogue.fonctions.parametre'); }, exemple: '=Parametre("prix") ET NON Parametre("avancement")' },

  { nom: 'Gras', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Gras(texte)', get description() { return texte('edition.catalogue.fonctions.gras'); }, exemple: '=Gras(client.nom) & " – " & client.contact' },
  { nom: 'Italique', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Italique(texte)', get description() { return texte('edition.catalogue.fonctions.italique'); }, exemple: '=Italique("(option)")' },
  { nom: 'Souligne', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Souligne(texte)', get description() { return texte('edition.catalogue.fonctions.souligne'); }, exemple: '=Souligne(document.objet)' },
  { nom: 'Barre', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Barre(texte)', get description() { return texte('edition.catalogue.fonctions.barre'); }, exemple: '=Si(ligne.option; Barre(ligne.libelle); ligne.libelle)' },
  { nom: 'Taille', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Taille(points; texte)', get description() { return texte('edition.catalogue.fonctions.taille'); }, exemple: '=Taille(14; document.numero)' },
  { nom: 'Couleur', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Couleur(couleur; texte)', get description() { return texte('edition.catalogue.fonctions.couleur'); }, exemple: '=Couleur("alerte"; "Facture échue")' },
  { nom: 'Style', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Style(nom; texte)', get description() { return texte('edition.catalogue.fonctions.style'); }, exemple: '=Style("titre"; document.type.libelle)' },
  { nom: 'Retrait', get categorie() { return CATEGORIES.MISE_EN_FORME; }, signature: 'Retrait(libellé; texte)', get description() { return texte('edition.catalogue.fonctions.retrait'); }, exemple: '=Retrait("Objet : "; document.objet)' },

  { nom: 'CodeBarre39', get categorie() { return CATEGORIES.CODES; }, signature: 'CodeBarre39(valeur)', get description() { return texte('edition.catalogue.fonctions.codebarre39'); }, exemple: '=CodeBarre39(document.numero)' },
];

/** Opérateurs des expressions. */
export const OPERATEURS = [
  { symbole: '+ - * /', get description() { return texte('edition.catalogue.operateurs.calcul'); } },
  { symbole: '&', get description() { return texte('edition.catalogue.operateurs.concatenation'); } },
  { symbole: '= <> < > <= >=', get description() { return texte('edition.catalogue.operateurs.comparaisons'); } },
  { symbole: 'ET OU NON', get description() { return texte('edition.catalogue.operateurs.logique'); } },
  { symbole: '( )', get description() { return texte('edition.catalogue.operateurs.priorite'); } },
  { symbole: '"texte"  « texte »', get description() { return texte('edition.catalogue.operateurs.chaine'); } },
  { symbole: 'Vrai Faux Nul', get description() { return texte('edition.catalogue.operateurs.litteraux'); } },
];

/**
 * Contextes de résolution d'un chemin : le premier mot du chemin désigne le contexte ; un autre premier mot est cherché
 * dans l'élément courant, puis dans les paramètres du bloc, puis à la racine des données de la source.
 */
export const CONTEXTES = [
  { nom: 'ligne', get description() { return texte('edition.catalogue.contextes.ligne'); }, exemple: '{{ligne.libelle_html}}' },
  { nom: 'element', get description() { return texte('edition.catalogue.contextes.element'); }, exemple: '{{element.montant}}' },
  { nom: 'groupe', get description() { return texte('edition.catalogue.contextes.groupe'); }, exemple: '{{groupe.valeur}}' },
  { nom: 'page', get description() { return texte('edition.catalogue.contextes.page'); }, exemple: '=Si(page.derniere; "Fin"; "Suite page suivante")' },
  { nom: 'bloc', get description() { return texte('edition.catalogue.contextes.bloc'); }, exemple: '=Si(bloc.lettres; EnLettres(totaux.net); Nul)' },
  { nom: 'donnees', get description() { return texte('edition.catalogue.contextes.donnees'); }, exemple: '{{donnees.document.numero}}' },
  { nom: 'parametres', get description() { return texte('edition.catalogue.contextes.parametres'); }, exemple: '{{parametres.presentation}}' },
  { nom: 'sources', get description() { return texte('edition.catalogue.contextes.sources'); }, exemple: 'sources.marche_documents' },
  { nom: 'hote', get description() { return texte('edition.catalogue.contextes.hote'); }, exemple: '{{hote.document.numero}}' },
  { nom: 'elements', get description() { return texte('edition.catalogue.contextes.elements'); }, exemple: 'Compte(elements)' },
];

/** Formats d'un champ (propriété format) ; « nom:argument » pour les décimales. */
export const FORMATS_CHAMP = [
  { format: 'montant', get description() { return texte('edition.catalogue.formats.montant'); } },
  { format: 'monnaie', get description() { return texte('edition.catalogue.formats.monnaie'); } },
  { format: 'nombre:N', get description() { return texte('edition.catalogue.formats.nombre'); } },
  { format: 'simple:N', get description() { return texte('edition.catalogue.formats.simple'); } },
  { format: 'pourcent', get description() { return texte('edition.catalogue.formats.pourcent'); } },
  { format: 'date', get description() { return texte('edition.catalogue.formats.date'); } },
  { format: 'zero_vide', get description() { return texte('edition.catalogue.formats.zero_vide'); } },
];
