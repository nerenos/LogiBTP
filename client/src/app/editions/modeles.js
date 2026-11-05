// Modèles d'édition fournis par le cœur (§ 15.6) : charte, blocs réutilisables (liés par les rapports) et rapports
// par type de pièce, au format du moteur d'édition (@logibtp/edition, modele.js). Source unique : le SQL
// db/191_editions_modeles.sql est généré depuis ce fichier (npm run generer-vues-liste --workspace client) ; un modèle
// fourni modifié localement n'est plus réécrit.
// Données lues : source « document » du serveur (SourceDocumentEdition : societe, document, client, payeur,
// adresse_travaux, redacteur, rattachement, lignes, pied, tva, totaux, echeances, textes).
import { CHARTE_DEFAUT } from '@logibtp/edition';

export const CHARTES_EDITION = [
  { code: 'DEFAUT', libelle: 'Charte LogiBTP', defaut: true, contenu: { ...CHARTE_DEFAUT, code: undefined, libelle: undefined } },
];

const champ = (valeur, o = {}) => ({ type: 'champ', valeur, ...o });
const retrait = (libelle, valeur, condition) => champ(`=Retrait(Gras("${libelle} : "); ${valeur})`, condition ? { condition } : {});
const adresse = (chemin) => ({ type: 'repete', collection: chemin, contenu: champ('{{element}}') });

// ---------------------------------------------------------------------------------------------------------------
// Blocs (Q5 : posés liés par les rapports ; paramètres et visibilité seulement)

const BLOCS = [
  {
    code: 'ENTETE_SOCIETE', libelle: 'Entête : logo et coordonnées de la société',
    contenu: {
      type: 'pile', enfants: [
        { type: 'image', ressource: 'LOGO', hauteur: 18, largeur: '45mm' },
        champ('{{societe.raison_sociale}}', { style: 'titre' }),
        adresse('societe.adresse'),
        champ('=Joindre(" – "; Si(societe.telephone; "Tél. " & societe.telephone; Nul); societe.courriel)', { style: 'discret' }),
      ],
    },
  },
  {
    code: 'COORDONNEES_DOCUMENT', libelle: 'Informations du document et destinataire',
    parametres: [{ nom: 'titre', defaut: '' }, { nom: 'libelle_adresse', defaut: 'Adresse des travaux' }],
    contenu: {
      type: 'rangee', espacement: 6, enfants: [
        {
          type: 'pile', largeur: '52%', fond: 'fond_titre', marges: 2.5, enfants: [
            champ('=Si(bloc.titre; bloc.titre; document.type.libelle) & " n° " & Si(document.numero; document.numero; "(brouillon)")', { style: 'sous_titre' }),
            champ('=Si(document.indice <> "A"; "Indice " & document.indice; Nul)', { style: 'discret' }),
            retrait('Date', 'Date(document.date; "long")'),
            retrait('Situation n°', 'document.avancement.rang', 'document.avancement.rang'),
            retrait('Validité', 'document.validite_jours & " jours, jusqu’au " & Date(AjouterJours(document.date; document.validite_jours))', 'document.validite_jours ET document.type.code = "V_DEVIS"'),
            retrait('Objet', 'document.objet', 'document.objet'),
            retrait('Chantier', 'Joindre(" – "; rattachement.chantier.code; rattachement.chantier.libelle)', 'rattachement.chantier'),
            retrait('Marché', 'Joindre(" – "; rattachement.marche.code; rattachement.marche.libelle)', 'rattachement.marche'),
            retrait('Votre référence', 'document.reference_externe', 'document.reference_externe'),
            retrait('Notre référence', 'document.notre_reference', 'document.notre_reference'),
            retrait('Rédacteur', 'redacteur.nom', 'redacteur.nom'),
          ],
        },
        {
          type: 'pile', largeur: '*', espacement: 3, enfants: [
            {
              type: 'pile', cadre: 'fin', marges: 3, enfants: [
                champ('{{client.nom}}', { style: 'nom_adresse' }),
                champ('{{client.contact}}'),
                adresse('client.adresse'),
                champ('{{client.courriel}}', { style: 'discret' }),
                champ('=Si(client.tva; "TVA : " & client.tva; Nul)', { style: 'discret' }),
              ],
            },
            {
              type: 'pile', condition: 'payeur.nom', marges: { gauche: 3 }, enfants: [
                champ('Facturer à', { style: 'petit' }), champ('{{payeur.nom}}', { style: 'gras' }), adresse('payeur.adresse'),
              ],
            },
            {
              type: 'pile', condition: 'adresse_travaux', marges: { gauche: 3 }, enfants: [
                champ('{{bloc.libelle_adresse}}', { style: 'petit' }),
                champ('{{adresse_travaux.libelle}}', { style: 'gras' }),
                adresse('adresse_travaux.adresse'),
                champ('=Joindre(" – "; adresse_travaux.contact; adresse_travaux.telephone)', { style: 'discret' }),
                champ('{{adresse_travaux.instructions}}', { style: 'discret' }),
              ],
            },
          ],
        },
      ],
    },
  },
  {
    code: 'LIGNES_DOCUMENT', libelle: 'Lignes du document (présentations : détaillée, sans composantes, sans prix, avancement)',
    contenu: {
      type: 'tableau', nom: 'lignes', collection: 'lignes', remplir: true,
      report: { libelle: 'Report', libelle_a_reporter: 'À reporter' },
      colonnes: [
        { cle: 'num', titre: 'N°', largeur: '13mm', valeur: '{{ligne.numero}}', style: 'petit' },
        { cle: 'lib', titre: 'Désignation', largeur: '*', valeur: '{{ligne.libelle_html}}', html: true },
        { cle: 'qte', titre: 'Qté', largeur: '15mm', valeur: '{{ligne.qte}}', alignement: 'droite', format: 'nombre:2', style: 'montant', zero_vide: true, condition: 'NON Parametre("avancement")' },
        { cle: 'u', titre: 'U', largeur: '8mm', valeur: '{{ligne.unite}}', alignement: 'centre', condition: 'NON Parametre("avancement")' },
        { cle: 'pu', titre: 'PU HT', largeur: '19mm', valeur: '{{ligne.pu}}', alignement: 'droite', format: 'montant', style: 'montant', zero_vide: true, condition: 'Parametre("prix") ET NON Parametre("avancement")' },
        { cle: 'mt', titre: 'Montant HT', largeur: '23mm', valeur: '{{ligne.montant}}', alignement: 'droite', format: 'montant', style: 'montant', zero_vide: true, condition: 'Parametre("prix") ET NON Parametre("avancement")', cumul: '=Si(ligne.compte_total; ligne.montant; Nul)' },
        { cle: 'amarche', titre: 'Marché HT', largeur: '22mm', valeur: '{{ligne.avt_montant_marche}}', alignement: 'droite', format: 'montant', style: 'montant', zero_vide: true, condition: 'Parametre("avancement")' },
        { cle: 'apct', titre: '% cumulé', largeur: '15mm', valeur: '{{ligne.avt_pct}}', alignement: 'droite', format: 'simple:2', style: 'montant', zero_vide: true, condition: 'Parametre("avancement")' },
        { cle: 'acumul', titre: 'Cumul HT', largeur: '22mm', valeur: '{{ligne.avt_montant_cumul}}', alignement: 'droite', format: 'montant', style: 'montant', zero_vide: true, condition: 'Parametre("avancement")', cumul: '=Si(ligne.compte_total; ligne.avt_montant_cumul; Nul)' },
        { cle: 'aprec', titre: 'Précédent HT', largeur: '22mm', valeur: '{{ligne.avt_montant_precedent}}', alignement: 'droite', format: 'montant', style: 'montant', zero_vide: true, condition: 'Parametre("avancement")', cumul: '=Si(ligne.compte_total; ligne.avt_montant_precedent; Nul)' },
        { cle: 'aperiode', titre: 'Période HT', largeur: '22mm', valeur: '{{ligne.montant}}', alignement: 'droite', format: 'montant', style: 'montant', zero_vide: true, condition: 'Parametre("avancement")', cumul: '=Si(ligne.compte_total; ligne.montant; Nul)' },
      ],
      gabarits: [
        { condition: 'ligne.composante ET NON Parametre("composantes")', masquer: true },
        { condition: 'ligne.type = "SAUT_PAGE"', saut_page: true },
        { condition: 'ligne.type = "IMAGE"', masquer: true },
        {
          condition: 'ligne.type = "SECTION"', fond: 'fond_section', style: 'section', garder_avec_suivant: true, bordures: { haut: 'fin', bas: 'fin' },
          cellules: [{ de: 'num', a: 'lib', valeur: '{{ligne.libelle_html}}', html: true }, { de: 'qte', a: 'aperiode', valeur: '=Si(Parametre("prix"); ligne.montant; Nul)', alignement: 'droite', format: 'montant', zero_vide: true }],
        },
        {
          condition: 'ligne.type = "TITRE"', fond: 'fond_titre', style: 'titre_ligne', garder_avec_suivant: true,
          cellules: [{ colonne: 'num', valeur: '{{ligne.numero}}' }, { de: 'lib', a: 'pu', valeur: '{{ligne.libelle_html}}', html: true, retrait: '=ligne.niveau * 2' },
            { de: 'mt', a: 'aperiode', valeur: '=Si(Parametre("prix"); ligne.montant; Nul)', alignement: 'droite', format: 'montant', zero_vide: true }],
        },
        { condition: 'ligne.type = "TEXTE"', cellules: [{ de: 'lib', a: 'aperiode', valeur: '{{ligne.libelle_html}}', html: true, style: 'discret', retrait: '=ligne.niveau * 2' }] },
        {
          condition: 'ligne.type = "SOUS_TOTAL" OU ligne.type = "PIED"', style: 'sous_total',
          cellules: [{ de: 'num', a: 'pu', valeur: '{{ligne.libelle_html}}', html: true, alignement: 'droite' },
            { de: 'mt', a: 'aperiode', valeur: '=Si(Parametre("prix"); ligne.montant; Nul)', alignement: 'droite', format: 'montant', zero_vide: true }],
        },
        { condition: 'ligne.composante', style: 'composante', lie_au_precedent: true, surcharges: { lib: { retrait: '=ligne.niveau * 2' } } },
        {
          condition: 'ligne.option OU ligne.pour_memoire', style: { base: 'normal', italique: true },
          surcharges: {
            lib: { retrait: '=ligne.niveau * 2', valeur: '=Concat(ligne.libelle_html; Si(ligne.option; " <i>(option)</i>"; ""))', html: true },
            mt: { valeur: '=Si(ligne.pour_memoire; "PM"; ligne.montant)', alignement: 'droite' },
          },
        },
        { surcharges: { lib: { retrait: '=ligne.niveau * 2' } } },
      ],
    },
  },
  {
    code: 'TOTAUX_DOCUMENT', libelle: 'Totaux, TVA, échéances et accord',
    parametres: [{ nom: 'accord', defaut: false }, { nom: 'lettres', defaut: false }],
    contenu: {
      type: 'rangee', espacement: 6, marges: { haut: 3 }, enfants: [
        {
          type: 'pile', largeur: '*', espacement: 2, enfants: [
            champ('{{textes.fin}}', { html: true }),
            champ('=Si(document.condition; "Conditions de paiement : " & document.condition.libelle; Nul)', { style: 'petit' }),
            {
              type: 'pile', condition: 'Compte(echeances) > 0', enfants: [
                champ('Échéancier', { style: 'gras' }),
                { type: 'repete', collection: 'echeances', contenu: champ('=Si(element.nature = "RETENUE"; "Retenue de garantie"; Si(element.date; "Échéance du " & Date(element.date); "À la réception")) & " : " & Monnaie(element.montant)', { style: 'petit' }) },
              ],
            },
            champ('="Arrêté à la somme de " & EnLettres(totaux.net) & "."', { style: 'petit', condition: 'bloc.lettres' }),
          ],
        },
        {
          type: 'pile', largeur: '75mm', espacement: 0, enfants: [
            {
              type: 'pile', cadre: 'normal', marges: 2, enfants: [
                {
                  type: 'repete', collection: 'pied', contenu: {
                    type: 'rangee', fond: '=Si(element.cle = "NET"; "fond_total"; Nul)', enfants: [
                      champ('=Si(element.genre = "total"; Gras(element.libelle); element.libelle & Si(element.taux ET element.genre <> "tva" ET NON Contient(element.libelle; Simple(element.taux)); " " & Pourcent(element.taux); "") & Si(element.base; " sur " & Montant(element.base); ""))', { largeur: '*', style: '=Si(element.genre = "total"; "gras"; "petit")' }),
                      champ('{{element.montant}}', { largeur: '28mm', format: 'montant', alignement: 'droite', style: 'montant' }),
                    ],
                  },
                },
                { type: 'trait', trait: 'fin' },
                {
                  type: 'rangee', fond: 'fond_total', marges: { haut: 0.5, bas: 0.5 }, enfants: [
                    champ('Net à payer', { style: 'gras', largeur: '*' }),
                    champ('{{totaux.net}}', { format: 'monnaie', style: 'total', alignement: 'droite', largeur: '35mm' }),
                  ],
                },
                {
                  // Avoirs imputés (module Règlements) et reste après imputation.
                  type: 'pile', condition: 'Compte(imputations) > 0', enfants: [
                    {
                      type: 'repete', collection: 'imputations', contenu: {
                        type: 'rangee', enfants: [
                          champ('="Imputation : " & element.type & " " & element.piece', { largeur: '*', style: 'petit' }),
                          champ('=Montant(-element.montant)', { largeur: '28mm', alignement: 'droite', style: 'montant' }),
                        ],
                      },
                    },
                    {
                      type: 'rangee', enfants: [
                        champ('Reste après imputation', { style: 'gras', largeur: '*' }),
                        champ('{{totaux.reste_imputation}}', { format: 'monnaie', style: 'gras', alignement: 'droite', largeur: '35mm' }),
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'pile', condition: 'bloc.accord', marges: { haut: 2 }, enfants: [
                champ('{{societe.mentions.accord}}', { style: 'petit' }),
                { type: 'espace', hauteur: 16 },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    code: 'TOTAUX_AVANCEMENT', libelle: "Pied d'avancement (cumul, précédent, période ; facturé du marché)",
    contenu: {
      type: 'pile', condition: 'document.avancement.pied', marges: { haut: 3 }, espacement: 1, enfants: [
        champ('="Avancement du marché" & Si(document.avancement.pied.marche_ht; " : " & Monnaie(document.avancement.pied.marche_ht) & " HT"; "") & Si(document.avancement.pied.pct_facture; Si(document.avancement.presentation = "P"; " – facturé "; " – réalisé ") & Pourcent(document.avancement.pied.pct_facture) & " (cumul HT)"; "")', { style: 'sous_titre' }),
        {
          type: 'tableau', collection: 'document.avancement.pied.lignes', remplir: false, report: false,
          colonnes: [
            { cle: 'lib', titre: '', largeur: '*', valeur: '{{ligne.libelle}}' },
            { cle: 'cumul', titre: 'Cumul', largeur: '30mm', valeur: '{{ligne.cumul}}', format: 'montant', alignement: 'droite', style: 'montant' },
            { cle: 'prec', titre: 'Cumul précédent', largeur: '30mm', valeur: '{{ligne.precedent}}', format: 'montant', alignement: 'droite', style: 'montant' },
            { cle: 'periode', titre: 'Période', largeur: '30mm', valeur: '{{ligne.periode}}', format: 'montant', alignement: 'droite', style: 'montant' },
          ],
          gabarits: [{ condition: 'ligne.cle = "net" OU ligne.cle = "ttc"', style: 'gras', fond: '=Si(ligne.cle = "net"; "fond_total"; Nul)' }],
        },
      ],
    },
  },
  {
    // Révision des prix du marché (lots G1, G3) : formule et périodes ; situation : pour information, calculée à ce jour.
    code: 'REVISION_PRIX', libelle: 'Révision des prix (formule, périodes, coefficients)',
    contenu: {
      type: 'pile', condition: 'revision', marges: { haut: 3 }, espacement: 1, enfants: [
        champ('="Révision des prix" & Si(revision.information; " (pour information, à ce jour)"; "") & " – mois zéro " & revision.mois_zero & " – Cn = " & revision.formule', { style: 'sous_titre' }),
        {
          type: 'tableau', collection: 'revision.periodes', remplir: false, report: false,
          colonnes: [
            { cle: 'piece', titre: 'Période', largeur: '*', valeur: '=ligne.piece & Si(ligne.commande; " – " & ligne.commande; "") & Si(ligne.regularisation; " (régularisation)"; "")' },
            { cle: 'mois', titre: 'Mois', largeur: '16mm', valeur: '{{ligne.mois}}' },
            { cle: 'index', titre: 'Index', largeur: '16mm', valeur: '{{ligne.mois_index}}' },
            { cle: 'base', titre: 'Base HT', largeur: '26mm', valeur: '{{ligne.base}}', format: 'montant', alignement: 'droite', style: 'montant' },
            { cle: 'coef', titre: 'Coefficient', largeur: '20mm', valeur: '=Si(ligne.coef; Simple(ligne.coef; 6); "index manquant") & Si(ligne.provisoire; " *"; "")', alignement: 'droite' },
            { cle: 'revision', titre: 'Révision due', largeur: '26mm', valeur: '{{ligne.revision}}', format: 'montant', alignement: 'droite', style: 'montant' },
            { cle: 'montant', titre: '=Si(revision.information; "À facturer"; "Facturé")', largeur: '26mm', valeur: '{{ligne.montant}}', format: 'montant', alignement: 'droite', style: 'montant' },
          ],
        },
        champ('* index provisoire ou dernier index connu : la révision sera régularisée.', { style: 'petit', condition: 'revision.provisoire' }),
      ],
    },
  },
  {
    code: 'MENTIONS_PAIEMENT', libelle: 'Mentions de paiement (pièces entre professionnels)',
    contenu: champ('=Joindre(" "; societe.mentions.penalites; societe.mentions.indemnite; societe.mentions.escompte; Si(societe.mentions.tva_debits; "Option pour le paiement de la TVA d’après les débits."; Nul))', { style: 'mentions', marges: { haut: 2 } }),
  },
  {
    code: 'MENTIONS_PARTICULIER', libelle: 'Mentions pour les particuliers (médiateur, rétractation)',
    contenu: {
      type: 'pile', marges: { haut: 2 }, enfants: [
        champ('=Si(societe.mentions.mediateur.nom; "Médiateur de la consommation : " & Joindre(" – "; societe.mentions.mediateur.nom; societe.mentions.mediateur.site); Nul)', { style: 'mentions' }),
        champ('{{societe.mentions.retractation}}', { style: 'mentions' }),
      ],
    },
  },
  {
    code: 'PIED_VENTES_ACHATS', libelle: 'Pied de page des ventes et achats (mentions obligatoires)',
    contenu: {
      type: 'pile', cadre: { haut: 'fin' }, marges: { haut: 1 }, enfants: [
        champ('=Joindre(" – "; societe.raison_sociale; Si(societe.forme_juridique; societe.forme_juridique & Si(societe.capital; " au capital de " & societe.capital; ""); Nul); societe.rcs; Si(societe.siret; "SIRET " & societe.siret; Nul); Si(societe.tva; "TVA " & societe.tva; Nul); Si(societe.naf; "NAF " & societe.naf; Nul))', { style: 'mentions', alignement: 'centre' }),
        champ('=Si(societe.mentions.decennale.assureur; "Assurance décennale : " & Joindre(", "; societe.mentions.decennale.assureur; societe.mentions.decennale.adresse; Si(societe.mentions.decennale.police; "police " & societe.mentions.decennale.police; Nul); Si(societe.mentions.decennale.couverture; "couverture " & societe.mentions.decennale.couverture; Nul)); Nul)', { style: 'mentions', alignement: 'centre' }),
        {
          type: 'rangee', enfants: [
            champ('{{document.type.libelle}} {{document.numero}}', { style: 'discret', largeur: '*' }),
            champ('Page {{Page()}} / {{NbPages()}}', { style: 'discret', alignement: 'droite', largeur: '30mm' }),
          ],
        },
      ],
    },
  },
  {
    code: 'PIED_INTERNE', libelle: 'Pied de page des documents internes (page, auteur, date)',
    contenu: {
      type: 'rangee', cadre: { haut: 'fin' }, marges: { haut: 1 }, enfants: [
        champ('Document interne – {{societe.raison_sociale}}', { style: 'discret', largeur: '*' }),
        champ('Édité le {{Date(Aujourdhui())}}', { style: 'discret', alignement: 'centre', largeur: '45mm' }),
        champ('Page {{Page()}} / {{NbPages()}}', { style: 'discret', alignement: 'droite', largeur: '30mm' }),
      ],
    },
  },
  {
    code: 'FILIGRANE_STATUT', libelle: 'Filigrane selon le statut (provisoire, annulé)',
    contenu: {
      type: 'absolu', x: 30, y: 200, largeur: 220,
      contenu: champ('=Si(document.statut.code = "ANNULE"; "ANNULÉ"; Si(NON document.verrouille; "PROVISOIRE"; Nul))', { style: 'filigrane', rotation: -35, multiligne: 'une' }),
    },
  },
  {
    code: 'RAPPEL_PAGES_SUIVANTES', libelle: 'Rappel du document en haut des pages suivantes',
    contenu: {
      type: 'rangee', cadre: { bas: 'fin' }, marges: { bas: 1 }, enfants: [
        champ('{{societe.raison_sociale}}', { style: 'gras', largeur: '*' }),
        champ('{{document.type.libelle}} {{document.numero}} du {{Date(document.date)}}', { alignement: 'droite', largeur: '*' }),
      ],
    },
  },
].map((b) => ({ ...b, genre: 'BLOC', contenu: { format_version: 1, code: b.code, libelle: b.libelle, genre: 'BLOC', parametres: b.parametres ?? [], contenu: b.contenu } }));

// ---------------------------------------------------------------------------------------------------------------
// Rapports

const bloc = (code, parametres) => ({ type: 'bloc', bloc: code, ...(parametres ? { parametres } : {}) });

const PRESENTATIONS_STANDARD = [
  { code: 'SANS_COMPOSANTES', libelle: 'Sans le détail des ouvrages', parametres: { composantes: false, prix: true, avancement: false } },
  { code: 'DETAILLEE', libelle: 'Détaillée (composantes des ouvrages)', parametres: { composantes: true, prix: true, avancement: false } },
  { code: 'SANS_PRIX', libelle: 'Quantitatif sans prix', parametres: { composantes: false, prix: false, avancement: false } },
];
const PRESENTATIONS_AVANCEMENT = [
  // Montants seuls d'abord : un document sans données d'avancement (repris d'avant) reste lisible.
  { code: 'SANS_COMPOSANTES', libelle: 'Montants de la période', parametres: { composantes: false, prix: true, avancement: false } },
  { code: 'AVANCEMENT', libelle: 'Avancement (marché, cumul, précédent, période)', parametres: { composantes: false, prix: true, avancement: true }, defaut_si: 'document.avancement' },
];

/**
 * Rapport d'une pièce : mêmes blocs liés, options propres (titre, accord, mentions, montant en lettres, pied).
 */
function piece({ code, libelle, types, titre = '', accord = false, lettres = false, paiement = false, particulier = false, presentations = PRESENTATIONS_STANDARD, pied = 'PIED_VENTES_ACHATS', libelleAdresse = 'Adresse des travaux', ordre = 0, marche = false, facturationMarche = false }) {
  return {
    code, libelle, genre: 'RAPPORT', cible: 'DOCUMENT', source: 'document', types, ordre,
    contenu: {
      format_version: 1, code, libelle, cible: 'DOCUMENT', source: 'document',
      page: { format: 'A4', orientation: 'portrait', flexible: ['A4', 'A3'], marges: { haut: 10, bas: 10, gauche: 12, droite: 12 } },
      presentations,
      // Sous-rapports des pièces de marché : sources annexes lues par le serveur dans le même appel (§ 15.2).
      ...(marche ? {
        sources_annexes: ['marche_documents', 'avancements_precedents'],
        parametres: [{ nom: 'facturation_marche', libelle: 'Facturé du marché', type: 'booleen', defaut: facturationMarche }],
      } : {}),
      bandes: [
        { type: 'FOND_PAGE', nom: 'filigrane', contenu: bloc('FILIGRANE_STATUT') },
        { type: 'ENTETE_PAGE', pages: 'SUIVANTES', contenu: bloc('RAPPEL_PAGES_SUIVANTES') },
        { type: 'PIED_PAGE', contenu: bloc(pied) },
        {
          type: 'TITRE', nom: 'entete',
          contenu: { type: 'pile', espacement: 4, enfants: [bloc('ENTETE_SOCIETE'), bloc('COORDONNEES_DOCUMENT', { titre, libelle_adresse: libelleAdresse }), champ('{{textes.intro}}', { html: true })] },
        },
        { type: 'CORPS', nom: 'lignes', contenu: bloc('LIGNES_DOCUMENT') },
        ...(marche ? [
          { type: 'CORPS', nom: 'marche', condition: 'NON Parametre("facturation_marche")', options: { garder_ensemble: true }, contenu: { type: 'sous_rapport', rapport: 'SR_DOCUMENTS_MARCHE', donnees: 'sources.marche_documents' } },
          { type: 'CORPS', nom: 'facturation_marche', condition: 'Parametre("facturation_marche")', options: { garder_ensemble: true }, contenu: { type: 'sous_rapport', rapport: 'SR_FACTURATION_MARCHE', donnees: 'sources.marche_documents' } },
          { type: 'CORPS', nom: 'precedents', options: { garder_ensemble: true }, contenu: { type: 'sous_rapport', rapport: 'SR_AVANCEMENTS_PRECEDENTS', donnees: 'sources.avancements_precedents' } },
          { type: 'CORPS', nom: 'revision', condition: 'revision', options: { garder_ensemble: true }, contenu: bloc('REVISION_PRIX') },
        ] : []),
        { type: 'RESUME', nom: 'totaux', options: { bas_de_page: true, garder_ensemble: true }, contenu: { type: 'pile', enfants: [
          ...(marche ? [bloc('TOTAUX_AVANCEMENT')] : []),
          bloc('TOTAUX_DOCUMENT', { accord, lettres }),
          ...(paiement ? [bloc('MENTIONS_PAIEMENT')] : []),
          ...(particulier ? [bloc('MENTIONS_PARTICULIER')] : []),
        ] } },
      ],
    },
  };
}

const RAPPORTS = [
  piece({ code: 'DEVIS', libelle: 'Devis', types: ['V_DEVIS'], accord: true, particulier: true, ordre: 10 }),
  piece({ code: 'COMMANDE_CLIENT', libelle: 'Commande client (accusé de réception)', types: ['V_COMMANDE'], titre: 'Accusé de réception de commande', ordre: 20 }),
  piece({ code: 'FACTURE', libelle: 'Facture, avoir, acompte', types: ['V_FACTURE', 'V_AVOIR', 'V_FACTURE_ACOMPTE', 'V_RECU_ACOMPTE', 'V_DEMANDE_ACOMPTE'], lettres: true, paiement: true, ordre: 30 }),
  piece({ code: 'SITUATION', libelle: 'Situation de travaux', types: ['V_SITUATION', 'V_PRODUCTION', 'V_REPRISE_AVT'], presentations: PRESENTATIONS_AVANCEMENT, ordre: 40, marche: true }),
  piece({ code: 'FACTURE_AVANCEMENT', libelle: "Facture d'avancement", types: ['V_FACTURE_AVT'], presentations: PRESENTATIONS_AVANCEMENT, lettres: true, paiement: true, ordre: 50, marche: true, facturationMarche: true }),
  piece({
    code: 'BON_LIVRAISON', libelle: 'Bon de livraison, bon de retour', types: ['V_RECEPTION', 'V_RETOUR'], accord: true, libelleAdresse: 'Livraison',
    presentations: [PRESENTATIONS_STANDARD[2], PRESENTATIONS_STANDARD[0]], ordre: 60,
  }),
  piece({
    code: 'COMMANDE_FOURNISSEUR', libelle: 'Commande et demande de prix fournisseur', types: ['A_COMMANDE', 'A_DEVIS', 'A_RECEPTION', 'A_RETOUR', 'T_AO', 'T_COMMANDE'],
    libelleAdresse: 'Adresse de livraison', ordre: 70,
  }),
  // Sous-traitance (ST7) : situation établie pour le sous-traitant, à signer par lui (« bon pour accord ») ; elle ne vaut
  // facture que sous mandat d'autofacturation (pièce du marché).
  piece({
    code: 'SITUATION_SOUS_TRAITANCE', libelle: 'Proposition de situation de sous-traitance', types: ['T_FACTURE_AVT', 'T_AVOIR'], titre: 'Proposition de situation',
    presentations: PRESENTATIONS_AVANCEMENT, accord: true, ordre: 80, marche: true,
  }),
  piece({
    code: 'PIECE_INTERNE', libelle: 'Document interne (stock, achats reçus)', types: [], pied: 'PIED_INTERNE', libelleAdresse: 'Adresse', ordre: 90,
    presentations: PRESENTATIONS_STANDARD,
  }),
];

// Sous-rapports (Q6) : rapports réutilisables inclus par d'autres, sur une source annexe ; type SOUS_RAPPORT (jamais
// proposés seuls à l'impression d'une pièce).
const sousRapport = (code, libelle, titre, colonnes, total = 'Total') => ({
  code, libelle, genre: 'RAPPORT', cible: 'DOCUMENT', source: 'document', types: ['SOUS_RAPPORT'], ordre: 100,
  contenu: {
    format_version: 1, code, libelle, cible: 'DOCUMENT', source: 'document',
    bandes: [{ type: 'CORPS', contenu: { type: 'pile', marges: { haut: 3 }, enfants: [
      champ(titre, { style: 'sous_titre' }),
      { type: 'tableau', collection: 'elements', remplir: false, report: false, total: { libelle: total }, colonnes },
    ] } }],
  },
});
const SOUS_RAPPORTS = [
  sousRapport('SR_DOCUMENTS_MARCHE', 'Sous-rapport : commande et avenants du marché', 'Commande et avenants du marché', [
    { cle: 'piece', titre: 'Pièce', largeur: '30mm', valeur: '=Si(element.role = "BASE"; "Commande"; "Avenant " & element.rang)' },
    { cle: 'numero', titre: 'N°', largeur: '30mm', valeur: '{{element.numero}}' },
    { cle: 'date', titre: 'Date', largeur: '22mm', valeur: '{{Date(element.date)}}' },
    { cle: 'objet', titre: 'Objet', largeur: '*', valeur: '{{element.objet}}' },
    { cle: 'mt', titre: 'Montant HT', largeur: '28mm', valeur: '{{element.montant_ht}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=element.montant_ht' },
  ], 'Total du marché'),
  // Variante : facturé cumulé de chaque pièce (factures d'avancement validées et ce document) et pourcentage facturé.
  sousRapport('SR_FACTURATION_MARCHE', 'Sous-rapport : facturé du marché par pièce (cumul, pourcentage)', 'Facturation du marché', [
    { cle: 'piece', titre: 'Pièce', largeur: '26mm', valeur: '=Si(element.role = "BASE"; "Commande"; "Avenant " & element.rang)' },
    { cle: 'numero', titre: 'N°', largeur: '28mm', valeur: '{{element.numero}}' },
    { cle: 'objet', titre: 'Objet', largeur: '*', valeur: '{{element.objet}}' },
    { cle: 'mt', titre: 'Montant HT', largeur: '27mm', valeur: '{{element.montant_ht}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=element.montant_ht' },
    { cle: 'facture', titre: 'Travaux facturés HT', largeur: '27mm', valeur: '{{element.facture_ht}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=element.facture_ht' },
    { cle: 'pct', titre: '% facturé', largeur: '18mm', valeur: '{{element.pct_facture}}', format: 'pourcent', alignement: 'droite', style: 'montant' },
  ], 'Total du marché'),
  sousRapport('SR_AVANCEMENTS_PRECEDENTS', 'Sous-rapport : situations et factures précédentes du marché', 'Situations et factures précédentes', [
    { cle: 'piece', titre: 'Pièce', largeur: '*', valeur: '{{element.type}}' },
    { cle: 'rang', titre: 'N° sit.', largeur: '16mm', valeur: '{{element.rang}}', alignement: 'centre' },
    { cle: 'numero', titre: 'N°', largeur: '30mm', valeur: '{{element.numero}}' },
    { cle: 'date', titre: 'Date', largeur: '20mm', valeur: '{{Date(element.date)}}' },
    { cle: 'ht', titre: 'Montant HT', largeur: '25mm', valeur: '{{element.montant_ht}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=Si(element.facture; element.montant_ht; Nul)' },
    { cle: 'ttc', titre: 'Montant TTC', largeur: '25mm', valeur: '{{element.montant_ttc}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=Si(element.facture; element.montant_ttc; Nul)' },
    { cle: 'reste', titre: 'Reste à payer', largeur: '25mm', valeur: '{{element.reste}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=element.reste' },
  ], 'Total facturé'),
];

// Fiches et listes (lot 6) : modèles génériques sur les sources « fiche » et « liste » du serveur.
const AUTRES = [
  {
    code: 'FICHE', libelle: 'Fiche (toutes les sections)', genre: 'RAPPORT', cible: 'FICHE', source: 'fiche', types: [], ordre: 10,
    contenu: {
      format_version: 1, code: 'FICHE', libelle: 'Fiche', cible: 'FICHE', source: 'fiche',
      page: { format: 'A4', orientation: 'portrait', marges: { haut: 10, bas: 10, gauche: 12, droite: 12 } },
      bandes: [
        { type: 'PIED_PAGE', contenu: bloc('PIED_INTERNE') },
        { type: 'TITRE', contenu: { type: 'pile', espacement: 1, marges: { bas: 3 }, cadre: { bas: 'normal' }, enfants: [
          champ('{{fiche.libelle}}', { style: 'petit' }), champ('{{fiche.titre}}', { style: 'titre' }), champ('{{fiche.sous_titre}}', { style: 'sous_titre' }),
        ] } },
        {
          type: 'CORPS', mode: 'REPETE', collection: 'sections', options: { garder_avec_suivant: false },
          contenu: { type: 'pile', espacement: 1, marges: { haut: 3 }, enfants: [
            champ('{{element.titre}}', { style: 'section', fond: 'fond_section', marges: 1 }),
            { type: 'repete', collection: 'element.groupes', espacement: 2, contenu: { type: 'pile', enfants: [
              champ('{{element.titre}}', { style: 'gras', cadre: { bas: 'fin' } }),
              { type: 'repete', collection: 'element.champs', contenu: { type: 'rangee', espacement: 3, secable: false, enfants: [
                champ('{{element.libelle}}', { style: 'discret', largeur: '35%' }), champ('{{element.valeur}}', { largeur: '*' }),
              ] } },
            ] } },
          ] },
        },
      ],
    },
  },
  {
    code: 'LISTE', libelle: 'Liste (colonnes de la vue)', genre: 'RAPPORT', cible: 'LISTE', source: 'liste', types: [], ordre: 10,
    contenu: {
      format_version: 1, code: 'LISTE', libelle: 'Liste', cible: 'LISTE', source: 'liste',
      page: { format: 'A4', orientation: 'paysage', flexible: ['A4', 'A3'], marges: { haut: 10, bas: 10, gauche: 10, droite: 10 } },
      bandes: [
        { type: 'ENTETE_PAGE', pages: 'SUIVANTES', contenu: champ('{{liste.nom}}', { style: 'gras', cadre: { bas: 'fin' } }) },
        { type: 'PIED_PAGE', contenu: bloc('PIED_INTERNE') },
        { type: 'TITRE', contenu: { type: 'pile', marges: { bas: 2 }, enfants: [
          { type: 'rangee', enfants: [champ('{{liste.nom}}', { style: 'titre', largeur: '*' }), champ('{{liste.nombre}} ligne(s)', { alignement: 'droite', style: 'discret', largeur: '50mm' })] },
          champ('=Si(liste.recherche; "Recherche : " & liste.recherche; Nul)', { style: 'discret' }),
          champ('=Si(liste.tronquee; "Liste limitée aux 5 000 premières lignes : affinez la recherche ou la vue."; Nul)', { style: { base: 'petit', couleur: 'alerte' } }),
        ] } },
        { type: 'CORPS', contenu: { type: 'tableau', collection: 'lignes', colonnes_source: 'colonnes', report: false, vide: 'Aucune ligne' } },
      ],
    },
  },
  {
    code: 'ETIQUETTES_3X8', libelle: 'Étiquettes 70 × 37 mm (3 × 8 par planche A4)', genre: 'RAPPORT', cible: 'LISTE', source: 'liste', types: [], ordre: 20,
    contenu: {
      format_version: 1, code: 'ETIQUETTES_3X8', libelle: 'Étiquettes 3 × 8', cible: 'LISTE', source: 'liste', mode: 'ETIQUETTES', collection: 'lignes',
      page: { format: 'A4', orientation: 'portrait', marges: { haut: 0, bas: 0, gauche: 0, droite: 0 } },
      planche: { colonnes: 3, rangees: 8, largeur: 70, hauteur: 37, marge_haut: 0.5, marge_gauche: 0, marge_interieure: 4 },
      parametres: [
        { nom: 'premiere_etiquette', libelle: 'Première étiquette (planche entamée)', type: 'nombre', defaut: 1 },
        { nom: 'copies', libelle: 'Exemplaires', type: 'nombre', defaut: 1 },
      ],
      bandes: [{ contenu: { type: 'pile', enfants: [
        champ('{{element._titre}}', { style: 'gras', multiligne: 'une', reduction_min: 7 }),
        champ('=Joindre(Ligne(); element._suite)', { multiligne: 'sauts', lignes_max: 3, ellipse: true }),
      ] } }],
    },
  },
];

// Éditions d'un marché de sous-traitance (module Sous-traitance, lot 5 ; ST17, ST29) : source « fiche » du marché et
// source annexe marche_sous_traitance (sous-traitant, maître d'ouvrage, chantier, marché de vente, commandes). Le DC4
// est une édition propre qui reprend les rubriques du formulaire officiel (pas de remplissage du PDF de l'administration).
const ST = 'sources.marche_sous_traitance';
const partie = (titre, chemin) => ({ type: 'pile', espacement: 1, secable: false, enfants: [
  champ(titre, { style: 'section', fond: 'fond_section', marges: 1 }),
  champ(`=PremierNonVide(${chemin}.raison_sociale; "(à compléter)")`, { style: 'gras' }),
  adresse(`${chemin}.adresse`),
  retrait('SIRET', `${chemin}.siret`, `${chemin}.siret`),
  retrait('TVA intracommunautaire', `${chemin}.tva_intra`, `${chemin}.tva_intra`),
  retrait('Courriel', `${chemin}.email`, `${chemin}.email`),
  retrait('Téléphone', `${chemin}.telephone`, `${chemin}.telephone`),
] });
const titulaire = (titre) => ({ type: 'pile', espacement: 1, secable: false, enfants: [
  champ(titre, { style: 'section', fond: 'fond_section', marges: 1 }),
  champ('{{societe.raison_sociale}}', { style: 'gras' }), adresse('societe.adresse'),
  retrait('SIRET', 'societe.siret', 'societe.siret'), retrait('TVA intracommunautaire', 'societe.tva', 'societe.tva'),
] });
const rubrique = (titre, enfants) => ({ type: 'pile', espacement: 1, secable: false, enfants: [champ(titre, { style: 'section', fond: 'fond_section', marges: 1 }), ...enfants] });
const commandesSt = { type: 'tableau', collection: `${ST}.commandes`, remplir: false, report: false, vide: 'Aucune commande validée', colonnes: [
  { cle: 'piece', titre: 'Pièce', largeur: '28mm', valeur: '=Si(element.role = "BASE"; "Commande"; "Avenant " & element.rang)' },
  { cle: 'numero', titre: 'N°', largeur: '30mm', valeur: '{{element.numero}}' },
  { cle: 'objet', titre: 'Objet', largeur: '*', valeur: '{{element.objet}}' },
  { cle: 'mt', titre: 'Montant HT', largeur: '30mm', valeur: '{{element.montant_ht}}', format: 'montant', alignement: 'droite', style: 'montant', cumul: '=element.montant_ht' },
], total: { libelle: 'Total' } };
const signatures = (gauche, droite) => ({ type: 'rangee', espacement: 10, marges: { haut: 8 }, secable: false, enfants: [
  { type: 'pile', largeur: '*', enfants: [champ(gauche, { style: 'gras' }), champ('Date, nom, qualité et signature', { style: 'discret' }), { type: 'espace', hauteur: 25 }] },
  { type: 'pile', largeur: '*', enfants: [champ(droite, { style: 'gras' }), champ('Date, nom, qualité et signature', { style: 'discret' }), { type: 'espace', hauteur: 25 }] },
] });
const montantMarche = `Montant(${ST}.marche.montant_ht) & " € HT" & Si(${ST}.marche.autoliquidation; " (autoliquidation de la TVA : article 283-2 nonies du CGI)"; "")`;

function rapportMarche({ code, libelle, titre, ordre, enfants }) {
  return {
    code, libelle, genre: 'RAPPORT', cible: 'FICHE', source: 'fiche', types: ['marche'], ordre,
    contenu: {
      format_version: 1, code, libelle, cible: 'FICHE', source: 'fiche', sources_annexes: ['marche_sous_traitance'],
      page: { format: 'A4', orientation: 'portrait', marges: { haut: 10, bas: 10, gauche: 14, droite: 14 } },
      bandes: [
        { type: 'PIED_PAGE', contenu: bloc('PIED_INTERNE') },
        { type: 'TITRE', contenu: { type: 'pile', espacement: 3, enfants: [bloc('ENTETE_SOCIETE'),
          { type: 'pile', espacement: 1, cadre: { bas: 'normal' }, marges: { bas: 2 }, enfants: [champ(titre, { style: 'titre' }),
            champ(`=Joindre(" – "; ${ST}.marche.code; ${ST}.marche.libelle; ${ST}.marche.nature)`, { style: 'sous_titre' })] }] } },
        { type: 'CORPS', contenu: { type: 'pile', espacement: 4, enfants } },
      ],
    },
  };
}

const MARCHES_ST = [
  rapportMarche({ code: 'ST_DC4', libelle: 'DC4 – Déclaration de sous-traitance', titre: 'Déclaration de sous-traitance (DC4)', ordre: 30, enfants: [
    champ('Rubriques du formulaire DC4 : acceptation du sous-traitant et agrément de ses conditions de paiement par le maître d’ouvrage.', { style: 'discret' }),
    { type: 'rangee', espacement: 6, meme_hauteur: false, enfants: [
      { ...partie('A – Maître d’ouvrage (acheteur)', `${ST}.maitre_ouvrage`), largeur: '*' }, { ...titulaire('C – Titulaire du marché'), largeur: '*' }] },
    rubrique('B – Objet du marché public', [
      retrait('Marché', `Joindre(" – "; ${ST}.marche_vente.code; ${ST}.marche_vente.libelle)`, `${ST}.marche_vente`),
      retrait('Chantier', `Joindre(" – "; ${ST}.chantier.code; ${ST}.chantier.libelle; ${ST}.chantier.adresse)`, `${ST}.chantier.code`)]),
    partie('D – Sous-traitant', `${ST}.sous_traitant`),
    rubrique('E – Nature et prix des prestations sous-traitées', [
      retrait('Prestations', `PremierNonVide(${ST}.marche.libelle; "")`), commandesSt,
      retrait('Montant maximum', montantMarche)]),
    rubrique('F – Conditions de paiement', [
      retrait('Paiement', `Si(${ST}.marche.paiement_direct; "Le sous-traitant est payé directement par le maître d’ouvrage."; PremierNonVide(${ST}.marche.garantie_libelle; "À préciser"))`),
      retrait('Montant agréé au paiement direct', `Montant(${ST}.marche.montant_agree) & " €"`, `${ST}.marche.montant_agree`),
      retrait('Retenue de garantie', `Simple(${ST}.marche.retenue_pct) & " %"`, `${ST}.marche.retenue_pct`),
      retrait('Délai d’exécution', `Joindre(" au "; Date(${ST}.marche.debut); Date(${ST}.marche.fin))`, `${ST}.marche.debut OU ${ST}.marche.fin`)]),
    rubrique('G – Attestations', [champ('Le sous-traitant déclare sur l’honneur ne pas entrer dans un des cas d’exclusion de la commande publique, être en règle de ses obligations sociales et fiscales, et produire les attestations d’assurance correspondant aux prestations sous-traitées.', { multiligne: 'auto' })]),
    signatures('Le titulaire', 'Le sous-traitant'),
    signatures('Le maître d’ouvrage (acceptation et agrément)', ''),
  ] }),
  rapportMarche({ code: 'ST_ACTE_SPECIAL', libelle: 'Acte spécial de sous-traitance', titre: 'Acte spécial de sous-traitance', ordre: 31, enfants: [
    champ('Acte spécial portant acceptation du sous-traitant et agrément de ses conditions de paiement (ou acte modificatif).', { style: 'discret' }),
    { type: 'rangee', espacement: 6, enfants: [{ ...partie('Maître d’ouvrage', `${ST}.maitre_ouvrage`), largeur: '*' }, { ...titulaire('Titulaire'), largeur: '*' }] },
    partie('Sous-traitant', `${ST}.sous_traitant`),
    rubrique('Prestations et montant', [retrait('Objet', `${ST}.marche.libelle`), commandesSt, retrait('Montant', montantMarche),
      retrait('Paiement direct', `Si(${ST}.marche.paiement_direct; "Oui, dans la limite de " & Montant(${ST}.marche.montant_agree) & " €"; "Non")`)]),
    signatures('Le titulaire', 'Le maître d’ouvrage'),
  ] }),
  rapportMarche({ code: 'ST_CONTRAT', libelle: 'Contrat de sous-traitance', titre: 'Contrat de sous-traitance', ordre: 32, enfants: [
    { type: 'rangee', espacement: 6, enfants: [{ ...titulaire('Entre l’entreprise principale'), largeur: '*' }, { ...partie('Et le sous-traitant', `${ST}.sous_traitant`), largeur: '*' }] },
    rubrique('Article 1 – Objet', [champ(`=Joindre(" – "; ${ST}.marche.libelle; "Chantier " & ${ST}.chantier.code & " " & ${ST}.chantier.libelle)`),
      retrait('Maître d’ouvrage', `${ST}.maitre_ouvrage.raison_sociale`, `${ST}.maitre_ouvrage`)]),
    rubrique('Article 2 – Prix', [commandesSt, retrait('Montant du contrat', montantMarche)]),
    rubrique('Article 3 – Délais', [retrait('Début', `Date(${ST}.marche.debut; "long")`, `${ST}.marche.debut`), retrait('Fin', `Date(${ST}.marche.fin; "long")`, `${ST}.marche.fin`),
      champ('Les dates d’intervention sont précisées par ordre de service.', { style: 'discret' })]),
    rubrique('Article 4 – Garantie de paiement', [champ(`=Si(${ST}.marche.paiement_direct; "Paiement direct du sous-traitant par le maître d’ouvrage (loi n° 75-1334 du 31 décembre 1975), dans la limite du montant agréé."; PremierNonVide(${ST}.marche.garantie_libelle; "Garantie à préciser (loi n° 75-1334 du 31 décembre 1975, article 14)."))`)]),
    rubrique('Article 5 – Retenue de garantie', [champ(`=Si(${ST}.marche.retenue_pct; "Retenue de " & Simple(${ST}.marche.retenue_pct) & " % de chaque situation, libérée un an après la réception sauf réserves, ou remplacée par une caution."; "Sans retenue de garantie.")`)]),
    rubrique('Article 6 – Pièces et assurances', [champ('Le sous-traitant fournit avant le début des travaux puis tous les six mois les attestations de vigilance, d’assurance et l’ensemble des pièces exigées ; leur défaut suspend les paiements.')]),
    signatures('L’entreprise principale', 'Le sous-traitant'),
  ] }),
  rapportMarche({ code: 'ST_ORDRE_SERVICE', libelle: 'Ordre de service au sous-traitant', titre: 'Ordre de service', ordre: 33, enfants: [
    { type: 'rangee', espacement: 6, enfants: [{ ...titulaire('Émetteur'), largeur: '*' }, { ...partie('Destinataire', `${ST}.sous_traitant`), largeur: '*' }] },
    rubrique('Ordre', [
      retrait('Chantier', `Joindre(" – "; ${ST}.chantier.code; ${ST}.chantier.libelle; ${ST}.chantier.adresse)`, `${ST}.chantier.code`),
      retrait('Marché', `Joindre(" – "; ${ST}.marche.code; ${ST}.marche.libelle)`),
      champ(`=Si(${ST}.marche.debut; "Il vous est prescrit de commencer les travaux le " & Date(${ST}.marche.debut; "long") & Si(${ST}.marche.fin; ", pour une fin au plus tard le " & Date(${ST}.marche.fin; "long"); "") & "."; "Date de démarrage : ________________")`)]),
    rubrique('Observations', [{ type: 'espace', hauteur: 30 }]),
    signatures('Pour l’entreprise principale', 'Reçu par le sous-traitant'),
  ] }),
];

// Application de terrain, lot 5 (ANALYSE-TERRAIN.md T14, T15) : procès-verbal de réception d'un ordre de pose, signé
// sur le terrain ; source annexe reception_pose (dernière réception de l'ordre), image SIGNATURE_RECEPTION fournie par
// le serveur depuis la table signature (EditionsBtp.CodeSignatureReception).
const PV = 'sources.reception_pose';
const RECEPTIONS = [{
  code: 'PV_RECEPTION', libelle: 'Procès-verbal de réception de pose', genre: 'RAPPORT', cible: 'DOCUMENT', source: 'document', types: ['E_PO'], ordre: 95,
  contenu: {
    format_version: 1, code: 'PV_RECEPTION', libelle: 'Procès-verbal de réception de pose', cible: 'DOCUMENT', source: 'document',
    page: { format: 'A4', orientation: 'portrait', marges: { haut: 10, bas: 10, gauche: 12, droite: 12 } },
    sources_annexes: ['reception_pose'],
    bandes: [
      { type: 'PIED_PAGE', contenu: bloc('PIED_VENTES_ACHATS') },
      { type: 'TITRE', nom: 'entete', contenu: { type: 'pile', espacement: 4, enfants: [
        bloc('ENTETE_SOCIETE'), bloc('COORDONNEES_DOCUMENT', { titre: 'Procès-verbal de réception', libelle_adresse: 'Adresse des travaux' }),
      ] } },
      { type: 'CORPS', nom: 'reception', contenu: { type: 'pile', espacement: 3, enfants: [
        champ('Décision', { style: 'section', fond: 'fond_section', marges: 1 }),
        champ(`=Si(${PV}.etat = "SANS_RESERVE"; "La réception des travaux est prononcée sans réserve."; Si(${PV}.etat = "AVEC_RESERVES"; "La réception des travaux est prononcée avec les réserves ci-dessous."; "La réception des travaux est refusée."))`, { style: 'gras' }),
        retrait('Date de réception', `Date(${PV}.date; "long")`, `${PV}.date`),
        champ('Réserves', { style: 'section', fond: 'fond_section', marges: 1, condition: `${PV}.etat = "AVEC_RESERVES"` }),
        { type: 'repete', collection: `${PV}.reserves`, condition: `${PV}.etat = "AVEC_RESERVES"`, contenu: champ('="• " & element') },
        retrait('Motif du refus', `${PV}.motif`, `${PV}.etat = "REFUSEE"`),
        { type: 'pile', espacement: 1, secable: false, marges: { haut: 6 }, enfants: [
          champ('Le client ou son représentant', { style: 'gras' }),
          champ(`=Joindre(" – "; ${PV}.signataire; ${PV}.qualite)`),
          champ(`="Signé sur le chantier le " & ${PV}.signe_le`, { style: 'discret', condition: `${PV}.signe` }),
          { type: 'image', ressource: 'SIGNATURE_RECEPTION', hauteur: 30, largeur: '70mm', condition: `${PV}.signe` },
          champ('Signature numérique simple : image tracée sur l’écran, horodatée par le serveur ; l’empreinte du présent document est conservée.', { style: 'petit' }),
        ] },
      ] } },
    ],
  },
}];

// Application de terrain, lot 6 (ANALYSE-TERRAIN.md T20 ; Exécution E12) : bon d'intervention SAV ; source annexe
// intervention_sav (dernier compte rendu de l'ordre), image SIGNATURE_SAV fournie par le serveur (table signature).
const IS = 'sources.intervention_sav';
const BONS_SAV = [{
  code: 'BON_SAV', libelle: "Bon d'intervention SAV", genre: 'RAPPORT', cible: 'DOCUMENT', source: 'document', types: ['E_SAV'], ordre: 96,
  contenu: {
    format_version: 1, code: 'BON_SAV', libelle: "Bon d'intervention SAV", cible: 'DOCUMENT', source: 'document',
    page: { format: 'A4', orientation: 'portrait', marges: { haut: 10, bas: 10, gauche: 12, droite: 12 } },
    sources_annexes: ['intervention_sav'],
    bandes: [
      { type: 'PIED_PAGE', contenu: bloc('PIED_VENTES_ACHATS') },
      { type: 'TITRE', nom: 'entete', contenu: { type: 'pile', espacement: 4, enfants: [
        bloc('ENTETE_SOCIETE'), bloc('COORDONNEES_DOCUMENT', { titre: "Bon d'intervention", libelle_adresse: "Lieu d'intervention" }),
      ] } },
      { type: 'CORPS', nom: 'intervention', contenu: { type: 'pile', espacement: 3, enfants: [
        retrait("Date d'intervention", `Date(${IS}.date; "long")`, `${IS}.date`),
        champ('Constat', { style: 'section', fond: 'fond_section', marges: 1 }),
        champ(`=${IS}.constat`),
        champ('Travaux réalisés', { style: 'section', fond: 'fond_section', marges: 1 }),
        champ(`=${IS}.travaux`),
        champ('Fournitures', { style: 'section', fond: 'fond_section', marges: 1 }),
        { type: 'repete', collection: `${IS}.fournitures`, contenu: champ('="• " & element') },
        champ(`=Si(${IS}.terminee; "Intervention terminée."; "Intervention à reprendre : une nouvelle visite est nécessaire.")`, { style: 'gras' }),
        { type: 'pile', espacement: 1, secable: false, marges: { haut: 6 }, enfants: [
          champ(`=Si(${IS}.absent; "Client absent : bon non signé."; "Le client ou son représentant")`, { style: 'gras' }),
          champ(`=Joindre(" – "; ${IS}.signataire; ${IS}.qualite)`, { condition: `${IS}.signe` }),
          champ(`="Signé sur place le " & ${IS}.signe_le`, { style: 'discret', condition: `${IS}.signe` }),
          { type: 'image', ressource: 'SIGNATURE_SAV', hauteur: 30, largeur: '70mm', condition: `${IS}.signe` },
          champ('Signature numérique simple : image tracée sur l’écran, horodatée par le serveur ; l’empreinte du présent document est conservée.', { style: 'petit', condition: `${IS}.signe` }),
        ] },
      ] } },
    ],
  },
}];

// Rapport interne de ventilation des frais annexes (CONCEPTION-VENTILATION-FRAIS.md ; vue « Frais annexes » de l'onglet
// Analyse) : données frais_annexes de la source document (tranches, bilan, parts par nature et par ligne de prix). Jamais
// retenu comme dernier modèle imprimé du document (ModelesEdition.FraisAnnexes).
const FA = 'frais_annexes';
const montantFa = (cle, titre, cumul = true) => ({ cle, titre, largeur: '26mm', valeur: `{{element.${cle}}}`, format: 'montant', alignement: 'droite', style: 'montant', ...(cumul ? { cumul: `=element.${cle}` } : {}) });
const FRAIS_ANNEXES = [{
  code: 'FRAIS_ANNEXES', libelle: 'Rapport de ventilation des frais annexes', genre: 'RAPPORT', cible: 'DOCUMENT', source: 'document', types: ['V_DEVIS', 'V_COMMANDE'], ordre: 97,
  contenu: {
    format_version: 1, code: 'FRAIS_ANNEXES', libelle: 'Rapport de ventilation des frais annexes', cible: 'DOCUMENT', source: 'document',
    page: { format: 'A4', orientation: 'portrait', marges: { haut: 10, bas: 10, gauche: 12, droite: 12 } },
    bandes: [
      { type: 'PIED_PAGE', contenu: bloc('PIED_INTERNE') },
      { type: 'TITRE', contenu: { type: 'pile', espacement: 1, marges: { bas: 3 }, cadre: { bas: 'normal' }, enfants: [
        champ('Ventilation des frais annexes', { style: 'titre' }),
        champ('=Joindre(" – "; document.type.libelle; document.numero; document.objet)', { style: 'sous_titre' }),
        champ(`=Si(${FA}; "Prévu " & Montant(${FA}.prevu) & " € · ventilé " & Montant(${FA}.ventile) & " € · écart " & Montant(${FA}.ecart) & " €"; "Aucune tranche de frais annexes dans ce document.")`, { style: 'gras' }),
        champ('Document non validé : rapport de la dernière version enregistrée.', { style: 'discret', condition: 'NON document.verrouille' }),
      ] } },
      {
        type: 'CORPS', mode: 'REPETE', collection: `${FA}.tranches`, options: { garder_avec_suivant: false },
        contenu: { type: 'pile', espacement: 2, marges: { haut: 3 }, enfants: [
          champ('{{element.libelle}}', { style: 'section', fond: 'fond_section', marges: 1 }),
          champ('="Portée : " & PremierNonVide(element.portee; "—") & " · " & Si(element.cles; "ventilée par clés"; "au prorata du montant hors frais")', { style: 'discret' }),
          champ('="Prévu " & Montant(element.prevu) & " € · ventilé " & Montant(element.ventile) & " € (" & Simple(element.pct_ventile) & " %) · ventilé réel " & Montant(element.ventile_reel) & " € · écart " & Montant(element.ecart) & " €"'),
          champ('Par nature', { style: 'gras' }),
          { type: 'tableau', collection: 'element.natures', remplir: false, report: false, vide: 'Aucune nature', total: { libelle: 'Total' }, colonnes: [
            { cle: 'code', titre: 'Code', largeur: '22mm', valeur: '{{element.code}}' },
            { cle: 'libelle', titre: 'Nature', largeur: '*', valeur: '{{element.libelle}}' },
            montantFa('hors_frais', 'Hors frais'), montantFa('part', 'Part reçue'),
          ] },
          champ('Par ligne de prix', { style: 'gras' }),
          { type: 'tableau', collection: 'element.lignes', remplir: false, report: true, vide: 'Aucune ligne ne reçoit de frais', total: { libelle: 'Total' }, colonnes: [
            { cle: 'numero', titre: 'N°', largeur: '16mm', valeur: '{{element.numero}}' },
            { cle: 'code', titre: 'Code', largeur: '22mm', valeur: '{{element.code}}' },
            { cle: 'libelle', titre: 'Libellé', largeur: '*', valeur: '{{element.libelle}}' },
            { cle: 'nature', titre: 'Nature', largeur: '16mm', valeur: '{{element.nature}}' },
            montantFa('hors_frais', 'Hors frais'), montantFa('part', 'Part reçue'),
            { cle: 'coef', titre: 'Coef. FA', largeur: '16mm', valeur: '{{element.coef_fa}}', alignement: 'droite' },
          ] },
        ] },
      },
    ],
  },
}];

export const MODELES_EDITION = [...BLOCS, ...SOUS_RAPPORTS, ...RAPPORTS, ...AUTRES, ...MARCHES_ST, ...RECEPTIONS, ...BONS_SAV, ...FRAIS_ANNEXES];

/** Modèle par défaut de chaque type de document (Q12 : un modèle par type). */
export const DEFAUTS_EDITION = [
  ...['V_DEVIS'].map((t) => ['DOCUMENT', t, 'DEVIS']),
  ...['V_COMMANDE'].map((t) => ['DOCUMENT', t, 'COMMANDE_CLIENT']),
  ...['V_FACTURE', 'V_AVOIR', 'V_FACTURE_ACOMPTE', 'V_RECU_ACOMPTE', 'V_DEMANDE_ACOMPTE'].map((t) => ['DOCUMENT', t, 'FACTURE']),
  ...['V_SITUATION', 'V_PRODUCTION', 'V_REPRISE_AVT'].map((t) => ['DOCUMENT', t, 'SITUATION']),
  ...['V_FACTURE_AVT'].map((t) => ['DOCUMENT', t, 'FACTURE_AVANCEMENT']),
  ...['V_RECEPTION', 'V_RETOUR'].map((t) => ['DOCUMENT', t, 'BON_LIVRAISON']),
  ...['A_COMMANDE', 'A_DEVIS', 'A_RECEPTION', 'A_RETOUR', 'T_AO', 'T_COMMANDE'].map((t) => ['DOCUMENT', t, 'COMMANDE_FOURNISSEUR']),
  ...['T_FACTURE_AVT', 'T_AVOIR'].map((t) => ['DOCUMENT', t, 'SITUATION_SOUS_TRAITANCE']),
  ...['A_FACTURE', 'A_FACTURE_AVT', 'A_AVOIR', 'S_DEMANDE', 'S_RESERVATION', 'S_ENTREE', 'S_SORTIE', 'S_TRANSFERT', 'S_INVENTAIRE'].map((t) => ['DOCUMENT', t, 'PIECE_INTERNE']),
].map(([cible, type, modele]) => ({ cible, type, modele }));
