// Catalogue documenté du langage des éditions : fonctions (signature, description, exemple), contextes de
// résolution des chemins, formats des champs. Source de l'aide de l'éditeur de modèle (dictionnaire) et du guide
// (documentation/GUIDE-EDITIONS.md) ; un test vérifie que chaque fonction du moteur y figure.

/** Catégories des fonctions, dans l'ordre d'affichage. */
export const CATEGORIES_FONCTIONS = ['Conditions', 'Texte', 'Nombres et montants', 'Dates', 'Collections', 'Page et paramètres', 'Mise en forme', 'Codes'];

/** Fonctions : nom (casse d'affichage), catégorie, signature, description, exemple. */
export const CATALOGUE_FONCTIONS = [
  { nom: 'Si', categorie: 'Conditions', signature: 'Si(condition; alors; sinon)', description: 'Valeur selon une condition ; sans « sinon » : vide si faux. Seule la branche retenue est évaluée.', exemple: '=Si(document.verrouille; "Original"; "Provisoire")' },
  { nom: 'EstVide', categorie: 'Conditions', signature: 'EstVide(valeur)', description: 'Vrai si la valeur est absente, vide ou une liste vide.', exemple: '=Si(EstVide(client.contact); ""; "À l’attention de " & client.contact)' },
  { nom: 'PremierNonVide', categorie: 'Conditions', signature: 'PremierNonVide(v1; v2; …)', description: 'Première valeur non vide (jusqu’à 20).', exemple: '=PremierNonVide(payeur.nom; client.nom)' },
  { nom: 'Contient', categorie: 'Conditions', signature: 'Contient(texte; recherché)', description: 'Vrai si le texte contient le recherché (sans casse ni accents).', exemple: '=Contient(ligne.libelle; "option")' },
  { nom: 'CommencePar', categorie: 'Conditions', signature: 'CommencePar(texte; début)', description: 'Vrai si le texte commence par le début (sans casse ni accents).', exemple: '=CommencePar(document.type.code; "V_")' },
  { nom: 'Dans', categorie: 'Conditions', signature: 'Dans(valeur; v1; v2; …)', description: 'Vrai si la valeur est égale à l’une des suivantes.', exemple: '=Dans(ligne.type; "TITRE"; "SECTION")' },
  { nom: 'Choix', categorie: 'Conditions', signature: 'Choix(rang; v1; v2; …)', description: 'Valeur de rang donné (1 = première) ; vide hors limites.', exemple: '=Choix(document.avancement.rang; "1re"; "2e"; "3e")' },

  { nom: 'Concat', categorie: 'Texte', signature: 'Concat(v1; v2; …)', description: 'Textes mis bout à bout (garde la mise en forme Gras, Couleur…). L’opérateur & fait de même.', exemple: '=Concat(Gras("N° "); document.numero)' },
  { nom: 'Joindre', categorie: 'Texte', signature: 'Joindre(séparateur; v1; v2; …)', description: 'Valeurs non vides jointes par le séparateur ; les listes (lignes d’adresse) sont mises à plat. Séparateur Ligne() : une valeur par ligne.', exemple: '=Joindre(Ligne(); client.nom; client.adresse)' },
  { nom: 'Majuscule', categorie: 'Texte', signature: 'Majuscule(texte)', description: 'Texte en majuscules.', exemple: '=Majuscule(client.nom)' },
  { nom: 'Minuscule', categorie: 'Texte', signature: 'Minuscule(texte)', description: 'Texte en minuscules.', exemple: '=Minuscule(document.type.libelle)' },
  { nom: 'Gauche', categorie: 'Texte', signature: 'Gauche(texte; n)', description: 'n premiers caractères.', exemple: '=Gauche(client.nom; 20)' },
  { nom: 'Droite', categorie: 'Texte', signature: 'Droite(texte; n)', description: 'n derniers caractères.', exemple: '=Droite(document.numero; 5)' },
  { nom: 'Longueur', categorie: 'Texte', signature: 'Longueur(texte)', description: 'Nombre de caractères.', exemple: '=Longueur(document.objet) > 60' },
  { nom: 'Remplacer', categorie: 'Texte', signature: 'Remplacer(texte; ancien; nouveau)', description: 'Toutes les occurrences remplacées.', exemple: '=Remplacer(societe.siret; " "; "")' },
  { nom: 'Texte', categorie: 'Texte', signature: 'Texte(valeur)', description: 'Valeur convertie en texte brut.', exemple: '=Texte(document.indice)' },
  { nom: 'Ligne', categorie: 'Texte', signature: 'Ligne()', description: 'Saut de ligne (avec multiligne « auto » ou « sauts »).', exemple: '="Bon pour accord" & Ligne() & "Date et signature"' },

  { nom: 'Nombre', categorie: 'Nombres et montants', signature: 'Nombre(valeur; décimales; milliers)', description: 'Nombre au format français, décimales fixes (2 par défaut), séparateur de milliers (vrai par défaut).', exemple: '=Nombre(ligne.qte; 3)' },
  { nom: 'Montant', categorie: 'Nombres et montants', signature: 'Montant(valeur; décimales)', description: 'Montant sans symbole (2 décimales par défaut).', exemple: '=Montant(totaux.ht)' },
  { nom: 'Monnaie', categorie: 'Nombres et montants', signature: 'Monnaie(valeur; symbole)', description: 'Montant suivi du symbole (€ par défaut).', exemple: '=Monnaie(totaux.net)' },
  { nom: 'Pourcent', categorie: 'Nombres et montants', signature: 'Pourcent(valeur; décimales max)', description: 'Pourcentage sous sa forme la plus simple (2 décimales au plus) : 30 %, 85,26 %.', exemple: '=Pourcent(ligne.avt_pct)' },
  { nom: 'Simple', categorie: 'Nombres et montants', signature: 'Simple(valeur; décimales max)', description: 'Nombre sous sa forme la plus simple, zéros inutiles retirés : 30, 85,5.', exemple: '=Simple(ligne.qte)' },
  { nom: 'Arrondi', categorie: 'Nombres et montants', signature: 'Arrondi(valeur; décimales)', description: 'Arrondi commercial (0 décimale par défaut).', exemple: '=Arrondi(totaux.ttc; 0)' },
  { nom: 'ArrondiSup', categorie: 'Nombres et montants', signature: 'ArrondiSup(valeur; décimales)', description: 'Arrondi vers le haut.', exemple: '=ArrondiSup(ligne.qte)' },
  { nom: 'ArrondiInf', categorie: 'Nombres et montants', signature: 'ArrondiInf(valeur; décimales)', description: 'Arrondi vers le bas.', exemple: '=ArrondiInf(ligne.qte)' },
  { nom: 'Abs', categorie: 'Nombres et montants', signature: 'Abs(valeur)', description: 'Valeur absolue.', exemple: '=Abs(element.montant)' },
  { nom: 'Min', categorie: 'Nombres et montants', signature: 'Min(v1; v2; …)', description: 'Plus petite valeur (listes mises à plat).', exemple: '=Min(100; ligne.avt_pct)' },
  { nom: 'Max', categorie: 'Nombres et montants', signature: 'Max(v1; v2; …)', description: 'Plus grande valeur.', exemple: '=Max(0; totaux.net)' },
  { nom: 'EnLettres', categorie: 'Nombres et montants', signature: 'EnLettres(montant; unité; sous-unité)', description: 'Montant en toutes lettres (euro / centime par défaut).', exemple: '="Arrêté à la somme de " & EnLettres(totaux.net)' },
  { nom: 'EntierEnLettres', categorie: 'Nombres et montants', signature: 'EntierEnLettres(nombre)', description: 'Partie entière en lettres, sans unité.', exemple: '=EntierEnLettres(document.validite_jours) & " jours"' },

  { nom: 'Date', categorie: 'Dates', signature: 'Date(date; format)', description: 'Date mise en forme : court (17/10/2026, par défaut), long (17 octobre 2026), mois (octobre 2026), heure.', exemple: '=Date(document.date; "long")' },
  { nom: 'AjouterJours', categorie: 'Dates', signature: 'AjouterJours(date; n)', description: 'Date décalée de n jours.', exemple: '=Date(AjouterJours(document.date; 30))' },
  { nom: 'Aujourdhui', categorie: 'Dates', signature: 'Aujourdhui()', description: 'Date du jour de l’édition (fournie par le serveur).', exemple: '="Édité le " & Date(Aujourdhui())' },

  { nom: 'Somme', categorie: 'Collections', signature: 'Somme(collection; champ)', description: 'Somme d’un champ (ou d’une expression sur element) des éléments d’une collection.', exemple: '=Somme(lignes; "montant")' },
  { nom: 'Compte', categorie: 'Collections', signature: 'Compte(collection; champ)', description: 'Nombre d’éléments (ou de valeurs non vides du champ).', exemple: '=Compte(echeances) > 1' },
  { nom: 'Moyenne', categorie: 'Collections', signature: 'Moyenne(collection; champ)', description: 'Moyenne des valeurs non vides du champ.', exemple: '=Moyenne(lignes; "avt_pct")' },

  { nom: 'Page', categorie: 'Page et paramètres', signature: 'Page()', description: 'Numéro de la page (bandes de page).', exemple: 'Page {{Page()}} / {{NbPages()}}' },
  { nom: 'NbPages', categorie: 'Page et paramètres', signature: 'NbPages()', description: 'Nombre total de pages.', exemple: 'Page {{Page()}} / {{NbPages()}}' },
  { nom: 'Parametre', categorie: 'Page et paramètres', signature: 'Parametre(nom)', description: 'Valeur d’un paramètre du modèle, de la présentation ou de la demande ; Parametre("presentation") = code de la présentation.', exemple: '=Parametre("prix") ET NON Parametre("avancement")' },

  { nom: 'Gras', categorie: 'Mise en forme', signature: 'Gras(texte)', description: 'Texte en gras dans le champ.', exemple: '=Gras(client.nom) & " – " & client.contact' },
  { nom: 'Italique', categorie: 'Mise en forme', signature: 'Italique(texte)', description: 'Texte en italique.', exemple: '=Italique("(option)")' },
  { nom: 'Souligne', categorie: 'Mise en forme', signature: 'Souligne(texte)', description: 'Texte souligné.', exemple: '=Souligne(document.objet)' },
  { nom: 'Barre', categorie: 'Mise en forme', signature: 'Barre(texte)', description: 'Texte barré.', exemple: '=Si(ligne.option; Barre(ligne.libelle); ligne.libelle)' },
  { nom: 'Taille', categorie: 'Mise en forme', signature: 'Taille(points; texte)', description: 'Taille de police en points.', exemple: '=Taille(14; document.numero)' },
  { nom: 'Couleur', categorie: 'Mise en forme', signature: 'Couleur(couleur; texte)', description: 'Couleur de la charte (primaire, alerte…) ou #rrggbb.', exemple: '=Couleur("alerte"; "Facture échue")' },
  { nom: 'Style', categorie: 'Mise en forme', signature: 'Style(nom; texte)', description: 'Style nommé de la charte appliqué à une partie du champ.', exemple: '=Style("titre"; document.type.libelle)' },
  { nom: 'Retrait', categorie: 'Mise en forme', signature: 'Retrait(libellé; texte)', description: 'Retrait suspendu : libellé à gauche, texte aligné après lui sur toutes ses lignes.', exemple: '=Retrait("Objet : "; document.objet)' },

  { nom: 'CodeBarre39', categorie: 'Codes', signature: 'CodeBarre39(valeur)', description: 'Valeur encodée pour la police Code 39 (dans un champ ; le composant code39 le fait seul).', exemple: '=CodeBarre39(document.numero)' },
];

/** Opérateurs des expressions. */
export const OPERATEURS = [
  { symbole: '+ - * /', description: 'Calcul en décimal exact (× ÷ − acceptés).' },
  { symbole: '&', description: 'Concaténation de textes.' },
  { symbole: '= <> < > <= >=', description: 'Comparaisons (nombres, dates, textes).' },
  { symbole: 'ET OU NON', description: 'Logique.' },
  { symbole: '( )', description: 'Priorité.' },
  { symbole: '"texte"  « texte »', description: 'Chaîne littérale ("" pour un guillemet dans "…").' },
  { symbole: 'Vrai Faux Nul', description: 'Littéraux.' },
];

/**
 * Contextes de résolution d'un chemin : le premier mot du chemin désigne le contexte ; un autre premier mot est cherché
 * dans l'élément courant, puis dans les paramètres du bloc, puis à la racine des données de la source.
 */
export const CONTEXTES = [
  { nom: 'ligne', description: 'Élément courant d’un tableau (une ligne de la collection).', exemple: '{{ligne.libelle_html}}' },
  { nom: 'element', description: 'Élément courant d’une bande REPETE / GROUPE, d’un composant repete, d’un pied ou d’une collection de sous-rapport.', exemple: '{{element.montant}}' },
  { nom: 'groupe', description: 'Groupe courant d’une bande GROUPE : valeur (de la rupture), elements, rang, premier (premier élément), suite (vrai sur les pages suivantes).', exemple: '{{groupe.valeur}}' },
  { nom: 'page', description: 'Page courante (bandes de page) : numero, total, premiere, derniere.', exemple: '=Si(page.derniere; "Fin"; "Suite page suivante")' },
  { nom: 'bloc', description: 'Paramètres passés à un bloc lié.', exemple: '=Si(bloc.lettres; EnLettres(totaux.net); Nul)' },
  { nom: 'donnees', description: 'Racine des données de la source (utile quand un champ de l’élément courant porte le même nom).', exemple: '{{donnees.document.numero}}' },
  { nom: 'parametres', description: 'Paramètres du rapport, de la présentation et de la demande (aussi par Parametre("nom")).', exemple: '{{parametres.presentation}}' },
  { nom: 'sources', description: 'Sources annexes déclarées par sources_annexes, lues par le serveur.', exemple: 'sources.marche_documents' },
  { nom: 'hote', description: 'Dans un sous-rapport : données du rapport qui l’inclut.', exemple: '{{hote.document.numero}}' },
  { nom: 'elements', description: 'Dans un sous-rapport sur une liste : les éléments transmis.', exemple: 'Compte(elements)' },
];

/** Formats d'un champ (propriété format) ; « nom:argument » pour les décimales. */
export const FORMATS_CHAMP = [
  { format: 'montant', description: 'Montant, 2 décimales, séparateur de milliers (montant:3 : 3 décimales).' },
  { format: 'monnaie', description: 'Montant suivi de « € » (monnaie:$ : autre symbole).' },
  { format: 'nombre:N', description: 'Nombre à N décimales fixes.' },
  { format: 'simple:N', description: 'Nombre sous sa forme la plus simple (N décimales au plus).' },
  { format: 'pourcent', description: 'Pourcentage le plus simple (2 décimales au plus) suivi de « % ».' },
  { format: 'date', description: 'Date courte (date:long, date:mois, date:heure).' },
  { format: 'zero_vide', description: 'Valeur nulle non imprimée (aussi propriété zero_vide: true).' },
];
