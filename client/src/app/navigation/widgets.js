// Widgets de l'accueil (cœur) : données lues par les fournisseurs des modules (listes : comptes par segment et
// premiers lots, appliqués par la base ; GED).
import { formatDate, formatDateHeure } from '@logibtp/socle/ui';

import { api } from '../api.js';

const demande = (vue_id, extra = {}) => ({ vue_id, definition: null, recherche: '', segments: {}, tri: [], ...extra });
// Valeurs de segment comparées en texte (la base renvoie « true », « PANNE »…).
const compte = (segments, valeur) => segments.find((s) => String(s.valeur) === String(valeur))?.nombre ?? 0;
const ETATS_MATERIEL = { DISPO: ['Disponible', '#2e9e5b'], CHANTIER: ['En chantier', '#1d5fbf'], PANNE: ['En panne', '#c0392b'], REBUT: ['Rebut', '#667085'] };
const NIVEAUX_RAPPEL = { ROUGE: 'erreur', ORANGE: 'alerte', VERT: 'info' };

export function catalogueWidgets(app) {
  const services = () => app.services();
  // Widgets d'un module désactivé (propriété module) retirés du catalogue.
  return [
    {
      code: 'crm-rappels', type: 'alertes', titre: 'Mes rappels', icone: '⏰', taille: 'moyen', url: '/crm/rappels', module: 'crm',
      description: 'Rappels du suivi (CRM) arrivés dans leur délai : rouge échu ou imminent, orange bientôt, vert à venir',
      charger: async () => {
        const rappels = await api.crm.rappels();
        return rappels.slice(0, 8).map((r) => ({
          niveau: NIVEAUX_RAPPEL[r.couleur] ?? 'info', texte: r.note?.objet ?? `Note ${r.note_id}`,
          detail: `${r.type === 'DATE' ? 'Rappel le' : 'Échéance le'} ${r.reference ? formatDateHeure(r.reference) : ''}${r.note?.element ? ` · ${r.note.element.libelle}` : ''}`,
          url: `/crm/note/${r.note_id}`,
        }));
      },
    },
    {
      code: 'oauth-alertes', type: 'alertes', titre: 'Connexions à reconnecter', icone: '🔐', taille: 'moyen', url: '/parametres/connexions',
      description: 'Connexions externes (Gmail…) à reconnecter ou dont l’autorisation expire bientôt (personnes autorisées)',
      charger: async () => (await api.oauth.alertes()).map((c) => ({
        niveau: c.pastille === 'ROUGE' ? 'erreur' : 'alerte', texte: c.nom,
        detail: c.etat === 'OK' ? `Autorisation jusqu'au ${formatDate(c.rafraichissement_expire_le ?? c.secret_expire_le)}` : c.etat === 'A_CONNECTER' ? 'À connecter' : 'À reconnecter',
        url: `/parametres/connexions?id=${c.id}`,
      })),
    },
    {
      code: 'chiffres', type: 'indicateurs', titre: 'Chiffres clés', icone: '📊', taille: 'large',
      description: 'Salariés actifs, matériels en panne, devis en cours, documents archivés',
      charger: async () => {
        const { liste, ged } = await services();
        const [actifs, etats, statuts, docs] = await Promise.all([
          liste.segments(demande(2), 'actif'), liste.segments(demande(3), 'etat'), liste.segments(demande(5), 'statut'), ged.lister({}),
        ]);
        const panne = compte(etats, 'PANNE');
        return [
          { libelle: 'Salariés actifs', valeur: compte(actifs, true), url: '/liste/salaries?vue=4' },
          { libelle: 'Matériels', valeur: etats.reduce((t, s) => t + s.nombre, 0), url: '/liste/materiels?vue=3' },
          { libelle: 'Matériels en panne', valeur: panne, niveau: panne ? 'erreur' : 'succes', url: '/liste/materiels?vue=3', detail: 'Segment État = En panne' },
          { libelle: 'Devis en brouillon', valeur: compte(statuts, 'Brouillon'), niveau: 'alerte', url: '/liste/devis?vue=5' },
          { libelle: 'Documents GED', valeur: docs.length, url: '/ged' },
          { libelle: 'Au coffre-fort', valeur: docs.filter((d) => d.coffre).length, url: '/ged?coffre=1' },
        ];
      },
    },
    {
      code: 'alertes', type: 'alertes', titre: 'Alertes', icone: '🔔', taille: 'moyen', url: '/liste/materiels?vue=3',
      description: 'Matériels en panne, contrats précaires, documents administratifs hors coffre-fort',
      charger: async () => {
        const { liste, ged } = await services();
        const [etats, contrats, docs, parametres] = await Promise.all([
          liste.segments(demande(3), 'etat'), liste.segments(demande(2), 'statut'), ged.lister({}), ged.parametres(),
        ]);
        const alertes = [];
        const panne = compte(etats, 'PANNE');
        if (panne) alertes.push({ niveau: 'erreur', texte: `${panne} matériel(s) en panne`, detail: 'À réparer ou à remplacer sur les chantiers', url: '/liste/materiels?vue=3' });
        const coffre = new Set(parametres.categories.filter((c) => c.coffre).map((c) => c.code));
        const horsCoffre = docs.filter((d) => coffre.has(d.categorie) && !d.coffre);
        if (horsCoffre.length) alertes.push({ niveau: 'alerte', texte: `${horsCoffre.length} document(s) administratif(s) hors coffre-fort`, detail: horsCoffre.slice(0, 3).map((d) => d.titre).join(' · '), url: `/ged/${horsCoffre[0].id}` });
        const precaires = compte(contrats, 'CDD') + compte(contrats, 'INTERIM');
        if (precaires) alertes.push({ niveau: 'info', texte: `${precaires} salarié(s) en CDD ou intérim`, detail: `${compte(contrats, 'CDD')} CDD · ${compte(contrats, 'INTERIM')} intérim`, url: '/liste/salaries?vue=2' });
        return alertes;
      },
    },
    {
      code: 'materiels-etat', type: 'graphique', titre: 'Matériels par état', icone: '🚜', taille: 'petit', url: '/liste/materiels?vue=3',
      description: 'Répartition du parc matériel',
      charger: async () => {
        const { liste } = await services();
        const etats = await liste.segments(demande(3), 'etat');
        return { unite: 'matériels', series: etats.map((s) => ({ libelle: ETATS_MATERIEL[s.valeur]?.[0] ?? s.valeur ?? '(vide)', valeur: s.nombre, couleur: ETATS_MATERIEL[s.valeur]?.[1], url: '/liste/materiels?vue=3' })) };
      },
    },
    {
      code: 'salaries-service', type: 'graphique', titre: 'Effectif par service', icone: '👷', taille: 'petit', url: '/liste/salaries?vue=2',
      description: 'Salariés par service',
      charger: async () => {
        const { liste } = await services();
        const services_ = await liste.segments(demande(2), 'service');
        return { unite: 'salariés', series: services_.sort((a, b) => b.nombre - a.nombre).map((s) => ({ libelle: s.valeur ?? '(vide)', valeur: s.nombre, url: '/liste/salaries?vue=2' })) };
      },
    },
    {
      code: 'documents-statut', type: 'graphique', titre: 'Documents par statut', icone: '📄', taille: 'petit', url: '/liste/documents?vue=1',
      description: 'Devis, commandes, factures par statut',
      charger: async () => {
        const { liste } = await services();
        const statuts = await liste.segments(demande(1), 'statut');
        return { unite: 'documents', series: statuts.sort((a, b) => b.nombre - a.nombre).map((s) => ({ libelle: s.valeur ?? '(vide)', valeur: s.nombre, url: '/liste/documents?vue=1' })) };
      },
    },
    {
      code: 'derniers-documents', type: 'tableau', titre: 'Derniers documents', icone: '🕘', taille: 'moyen', url: '/liste/documents?vue=1',
      description: 'Les documents les plus récents',
      charger: async () => {
        const { liste } = await services();
        const { lignes } = await liste.lot(demande(1, { tri: [{ colonne: 'date_document', sens: 'desc' }], taille: 6 }));
        return {
          colonnes: [{ code: 'numero', libelle: 'N°' }, { code: 'type_document', libelle: 'Type' }, { code: 'date', libelle: 'Date' }, { code: 'net_a_payer', libelle: 'Net à payer', nombre: true }],
          lignes: lignes.map((l) => ({ ...l, date: formatDate(l.date_document), _url: app.urlElement({ id: l._id, type: l._type }) })),
        };
      },
    },
    {
      code: 'ged-recents', type: 'tableau', titre: 'Documents GED récents', icone: '📎', taille: 'moyen', url: '/ged',
      description: 'Derniers documents déposés dans la GED',
      charger: async () => {
        const { ged } = await services();
        const docs = (await ged.lister({})).slice(0, 6);
        return {
          colonnes: [{ code: 'titre', libelle: 'Titre' }, { code: 'categorie', libelle: 'Catégorie' }, { code: 'date', libelle: 'Date' }, { code: 'coffre', libelle: '' }],
          lignes: docs.map((d) => ({ titre: d.titre, categorie: d.categorie ?? '', date: formatDate(d.date_document), coffre: d.coffre ? '🔒' : '', _url: `/ged/${d.id}` })),
        };
      },
    },
  ].filter((w) => (!w.module || app.moduleActif?.(w.module) !== false));
}

export const WIDGETS_DEFAUT = [{ code: 'chiffres' }, { code: 'crm-rappels' }, { code: 'oauth-alertes' }, { code: 'alertes' }, { code: 'derniers-documents' }, { code: 'materiels-etat' }, { code: 'salaries-service' }, { code: 'documents-statut' }];
