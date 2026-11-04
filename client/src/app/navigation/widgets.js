// Widgets de l'accueil (cœur) : données lues par les fournisseurs des modules (listes : comptes par segment et
// premiers lots, appliqués par la base ; GED).
import { texte, textesParCode, pluriel, icone, couleurTheme } from '@logibtp/socle/dictionnaire';
import { MODULE_FACULTATIF } from '../codes.js';
import { formatDate, formatDateHeure } from '@logibtp/socle/ui';

import { api } from '../api.js';

const demande = (vue_id, extra = {}) => ({ vue_id, definition: null, recherche: '', segments: {}, tri: [], ...extra });
// Valeurs de segment comparées en texte (la base renvoie « true », « PANNE »…).
const compte = (segments, valeur) => segments.find((s) => String(s.valeur) === String(valeur))?.nombre ?? 0;
// États du matériel : libellé « navigation_btp.widgets.etats_materiel.<code> », couleur du thème « --widget-materiel-<code> ».
// (couleur lue au chargement du widget : elle suit le thème choisi).
const ETATS_MATERIEL = textesParCode('navigation_btp.widgets.etats_materiel', ['DISPO', 'CHANTIER', 'PANNE', 'REBUT']);
const NIVEAUX_RAPPEL = { ROUGE: 'erreur', ORANGE: 'alerte', VERT: 'info' };

export function catalogueWidgets(app) {
  const services = () => app.services();
  // Widgets d'un module désactivé (propriété module) ou dont le compte n'a pas les droits (propriété droit : nœuds du
  // module Droits dont le widget lit les données, tous exigés) retirés du catalogue, comme les raccourcis.
  return [
    {
      code: 'crm-rappels', type: 'alertes', titre: texte('navigation_btp.widgets.rappels.titre'), icone: icone('navigation_btp_widget_rappels'), taille: 'moyen', url: '/crm/rappels', module: MODULE_FACULTATIF.CRM, droit: ['crm'],
      description: texte('navigation_btp.widgets.rappels.description'),
      charger: async () => {
        const rappels = await api.crm.rappels();
        return rappels.slice(0, 8).map((r) => ({
          niveau: NIVEAUX_RAPPEL[r.couleur] ?? 'info', texte: r.note?.objet ?? texte('navigation_btp.widgets.rappels.note', { id: r.note_id }),
          detail: `${r.type === 'DATE' ? texte('navigation_btp.widgets.rappels.rappel_le', { date: r.reference ? formatDateHeure(r.reference) : '' }) : texte('navigation_btp.widgets.rappels.echeance_le', { date: r.reference ? formatDateHeure(r.reference) : '' })}${r.note?.element ? ` · ${r.note.element.libelle}` : ''}`,
          url: `/crm/note/${r.note_id}`,
        }));
      },
    },
    {
      code: 'oauth-alertes', type: 'alertes', titre: texte('navigation_btp.widgets.oauth.titre'), icone: icone('navigation_btp_widget_oauth'), taille: 'moyen', url: '/parametres/connexions', droit: ['connexions'],
      description: texte('navigation_btp.widgets.oauth.description'),
      charger: async () => (await api.oauth.alertes()).map((c) => ({
        niveau: c.pastille === 'ROUGE' ? 'erreur' : 'alerte', texte: c.nom,
        detail: c.etat === 'OK' ? texte('navigation_btp.widgets.oauth.jusquau', { date: formatDate(c.rafraichissement_expire_le ?? c.secret_expire_le) }) : texte(`oauth_btp.etats.${c.etat === 'A_CONNECTER' ? 'A_CONNECTER' : 'A_RECONNECTER'}`),
        url: `/parametres/connexions?id=${c.id}`,
      })),
    },
    {
      code: 'chiffres', type: 'indicateurs', titre: texte('navigation_btp.widgets.chiffres.titre'), icone: icone('navigation_btp_widget_chiffres'), taille: 'large', droit: ['ressources', 'documents', 'ged'],
      description: texte('navigation_btp.widgets.chiffres.description'),
      charger: async () => {
        const { liste, ged } = await services();
        const [actifs, etats, statuts, docs] = await Promise.all([
          liste.segments(demande(2), 'actif'), liste.segments(demande(3), 'etat'), liste.segments(demande(5), 'statut'), ged.lister({}),
        ]);
        const panne = compte(etats, 'PANNE');
        return [
          { libelle: texte('navigation_btp.widgets.chiffres.salaries'), valeur: compte(actifs, true), url: '/liste/salaries?vue=4' },
          { libelle: texte('navigation_btp.widgets.chiffres.materiels'), valeur: etats.reduce((t, s) => t + s.nombre, 0), url: '/liste/materiels?vue=3' },
          { libelle: texte('navigation_btp.widgets.chiffres.panne'), valeur: panne, niveau: panne ? 'erreur' : 'succes', url: '/liste/materiels?vue=3', detail: texte('navigation_btp.widgets.chiffres.panne_detail') },
          { libelle: texte('navigation_btp.widgets.chiffres.devis'), valeur: compte(statuts, 'Brouillon'), niveau: 'alerte', url: '/liste/devis?vue=5' },
          { libelle: texte('navigation_btp.widgets.chiffres.ged'), valeur: docs.length, url: '/ged' },
          { libelle: texte('navigation_btp.widgets.chiffres.coffre'), valeur: docs.filter((d) => d.coffre).length, url: '/ged?coffre=1' },
        ];
      },
    },
    {
      code: 'alertes', type: 'alertes', titre: texte('navigation_btp.widgets.alertes.titre'), icone: icone('navigation_btp_widget_alertes'), taille: 'moyen', url: '/liste/materiels?vue=3', droit: ['ressources', 'ged'],
      description: texte('navigation_btp.widgets.alertes.description'),
      charger: async () => {
        const { liste, ged } = await services();
        const [etats, contrats, docs, parametres] = await Promise.all([
          liste.segments(demande(3), 'etat'), liste.segments(demande(2), 'statut'), ged.lister({}), ged.parametres(),
        ]);
        const alertes = [];
        const panne = compte(etats, 'PANNE');
        if (panne) alertes.push({ niveau: 'erreur', texte: pluriel('navigation_btp.widgets.alertes.panne', panne), detail: texte('navigation_btp.widgets.alertes.panne_detail'), url: '/liste/materiels?vue=3' });
        const coffre = new Set(parametres.categories.filter((c) => c.coffre).map((c) => c.code));
        const horsCoffre = docs.filter((d) => coffre.has(d.categorie) && !d.coffre);
        if (horsCoffre.length) alertes.push({ niveau: 'alerte', texte: pluriel('navigation_btp.widgets.alertes.hors_coffre', horsCoffre.length), detail: horsCoffre.slice(0, 3).map((d) => d.titre).join(' · '), url: `/ged/${horsCoffre[0].id}` });
        const precaires = compte(contrats, 'CDD') + compte(contrats, 'INTERIM');
        if (precaires) alertes.push({ niveau: 'info', texte: pluriel('navigation_btp.widgets.alertes.precaires', precaires), detail: texte('navigation_btp.widgets.alertes.precaires_detail', { cdd: compte(contrats, 'CDD'), interim: compte(contrats, 'INTERIM') }), url: '/liste/salaries?vue=2' });
        return alertes;
      },
    },
    {
      code: 'materiels-etat', type: 'graphique', titre: texte('navigation_btp.widgets.materiels.titre'), icone: icone('navigation_btp_widget_materiels'), taille: 'petit', url: '/liste/materiels?vue=3', droit: ['ressources'],
      description: texte('navigation_btp.widgets.materiels.description'),
      charger: async () => {
        const { liste } = await services();
        const etats = await liste.segments(demande(3), 'etat');
        return { unite: texte('navigation_btp.widgets.materiels.unite'), series: etats.map((s) => ({ libelle: ETATS_MATERIEL[s.valeur] ?? s.valeur ?? texte('navigation_btp.widgets.vide'), valeur: s.nombre, couleur: ETATS_MATERIEL[s.valeur] ? couleurTheme(`--widget-materiel-${String(s.valeur).toLowerCase()}`) : undefined, url: '/liste/materiels?vue=3' })) };
      },
    },
    {
      code: 'salaries-service', type: 'graphique', titre: texte('navigation_btp.widgets.salaries.titre'), icone: icone('navigation_btp_widget_salaries'), taille: 'petit', url: '/liste/salaries?vue=2', droit: ['ressources'],
      description: texte('navigation_btp.widgets.salaries.description'),
      charger: async () => {
        const { liste } = await services();
        const services_ = await liste.segments(demande(2), 'service');
        return { unite: texte('navigation_btp.widgets.salaries.unite'), series: services_.sort((a, b) => b.nombre - a.nombre).map((s) => ({ libelle: s.valeur ?? texte('navigation_btp.widgets.vide'), valeur: s.nombre, url: '/liste/salaries?vue=2' })) };
      },
    },
    {
      code: 'documents-statut', type: 'graphique', titre: texte('navigation_btp.widgets.documents.titre'), icone: icone('navigation_btp_widget_documents'), taille: 'petit', url: '/liste/documents?vue=1', droit: ['documents'],
      description: texte('navigation_btp.widgets.documents.description'),
      charger: async () => {
        const { liste } = await services();
        const statuts = await liste.segments(demande(1), 'statut');
        return { unite: texte('navigation_btp.widgets.documents.unite'), series: statuts.sort((a, b) => b.nombre - a.nombre).map((s) => ({ libelle: s.valeur ?? texte('navigation_btp.widgets.vide'), valeur: s.nombre, url: '/liste/documents?vue=1' })) };
      },
    },
    {
      code: 'derniers-documents', type: 'tableau', titre: texte('navigation_btp.widgets.derniers.titre'), icone: icone('navigation_btp_widget_derniers'), taille: 'moyen', url: '/liste/documents?vue=1', droit: ['documents'],
      description: texte('navigation_btp.widgets.derniers.description'),
      charger: async () => {
        const { liste } = await services();
        const { lignes } = await liste.lot(demande(1, { tri: [{ colonne: 'date_document', sens: 'desc' }], taille: 6 }));
        return {
          colonnes: [{ code: 'numero', libelle: texte('navigation_btp.widgets.derniers.numero') }, { code: 'type_document', libelle: texte('navigation_btp.widgets.derniers.type') }, { code: 'date', libelle: texte('navigation_btp.widgets.date') }, { code: 'net_a_payer', libelle: texte('navigation_btp.widgets.derniers.net'), nombre: true }],
          lignes: lignes.map((l) => ({ ...l, date: formatDate(l.date_document), _url: app.urlElement({ id: l._id, type: l._type }) })),
        };
      },
    },
    {
      code: 'ged-recents', type: 'tableau', titre: texte('navigation_btp.widgets.ged.titre'), icone: icone('navigation_btp_widget_ged'), taille: 'moyen', url: '/ged', droit: ['ged'],
      description: texte('navigation_btp.widgets.ged.description'),
      charger: async () => {
        const { ged } = await services();
        const docs = (await ged.lister({})).slice(0, 6);
        return {
          colonnes: [{ code: 'titre', libelle: texte('navigation_btp.widgets.ged.colonne_titre') }, { code: 'categorie', libelle: texte('navigation_btp.widgets.ged.categorie') }, { code: 'date', libelle: texte('navigation_btp.widgets.date') }, { code: 'coffre', libelle: '' }],
          lignes: docs.map((d) => ({ titre: d.titre, categorie: d.categorie ?? '', date: formatDate(d.date_document), coffre: d.coffre ? icone('verrou') : '', _url: `/ged/${d.id}` })),
        };
      },
    },
  ].filter((w) => (!w.module || app.moduleActif?.(w.module) !== false) && (w.droit ?? []).every((n) => app.acces?.(n) !== false));
}

export const WIDGETS_DEFAUT = [{ code: 'chiffres' }, { code: 'crm-rappels' }, { code: 'oauth-alertes' }, { code: 'alertes' }, { code: 'derniers-documents' }, { code: 'materiels-etat' }, { code: 'salaries-service' }, { code: 'documents-statut' }];
