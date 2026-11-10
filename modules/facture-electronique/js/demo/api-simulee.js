// Démonstration des écrans du module : API /facture-electronique simulée en mémoire, avec la même forme de réponses
// que le serveur (snake_case) et le comportement de la plateforme simulée (PlateformeSimulee.cs) : dépôt, accusé Ok ou
// Error (marqueur « REJET » dans le numéro) à la relève, statuts 200 → 205 d'une facture émise, dépôt manuel en
// attente d'accusé, import d'un fichier reçu, journal en ajout seul chaîné par empreinte SHA-256. Rien n'est envoyé.
import {
  CONNECTEUR_FE, SENS_FLUX, ETAT_FLUX, TYPE_FLUX, SYNTAXE, PROFIL_FACTURE, STATUT_CDV, EVENEMENT_FE, ACTEUR_FE, ETAT_ACCUSE, SENS_STATUT,
  EMETTEUR_STATUT, TYPE_DOCUMENT_FLUX, DECOUPAGE_EREPORTING, ERREUR_FE, MOTIF_ACCUSE, statutAffiche,
} from '../src/index.js';
import { controlerParametres } from '../ui/modeles.js';

const UTILISATEUR = 'demo';
const MARQUEUR_REJET = 'REJET';

const hex = async (texte) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)))]
  .map((o) => o.toString(16).padStart(2, '0')).join('');

class ErreurDemo extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Facture CII minimale (démonstration : seul le numéro compte). */
const facture = (numero) => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocument><ram:ID>${numero}</ram:ID><ram:TypeCode>380</ram:TypeCode></rsm:ExchangedDocument>
</rsm:CrossIndustryInvoice>`;

export function creerApiSimulee() {
  let parametres = {
    actif: true, connecteur: CONNECTEUR_FE.SIMULE, connexion_oauth: null, adresse_flux: null, adresse_annuaire: null, organisation: null,
    adresse_electronique: '123456789_FACTURES', schema_adresse: '0225', syntaxe: SYNTAXE.CII, profil: PROFIL_FACTURE.EN16931, frequence_releve: 15,
    delai_secondes: 30, decoupage_ereporting: DECOUPAGE_EREPORTING.UNIQUE,
  };
  const connecteurs = Object.values(CONNECTEUR_FE);
  const flux = [];
  const statuts = [];
  const erreurs = [];
  const fichiers = new Map();
  const journal = [];
  let ids = 0;
  let chaine = Promise.resolve();
  const maintenant = () => new Date().toISOString();

  /** Ajout au journal (rang suivant, empreinte = SHA-256(précédente | contenu)), dans l'ordre des appels. */
  const journaliser = (f, type, acteur, avant, apres, detail = null) => {
    chaine = chaine.then(async () => {
      const precedente = journal.at(-1)?.empreinte ?? '';
      const e = { id: journal.length + 1, rang: journal.length + 1, flux_id: f?.id ?? null, type_element: f?.type_element ?? null, id_element: f?.id_element ?? null,
        type, etat_avant: avant ?? null, etat_apres: apres ?? null, acteur, utilisateur: acteur === ACTEUR_FE.UTILISATEUR ? UTILISATEUR : null, detail, horodatage: maintenant() };
      e.empreinte = await hex(`${precedente}|${JSON.stringify({ ...e })}`);
      journal.push(e);
    });
    return chaine;
  };

  const changer = async (f, etat, type, acteur, detail) => {
    const avant = f.etat;
    f.etat = etat;
    await journaliser(f, type, acteur, avant, etat, detail);
  };

  const trouver = (id) => {
    const f = flux.find((x) => x.id === Number(id));
    if (!f) throw new ErreurDemo(ERREUR_FE.FLUX_INTROUVABLE, `Flux ${id} introuvable`);
    return f;
  };
  const historique = (f) => statuts.filter((s) => s.flux_id === f.id).map((s) => s.code);
  const dto = (f) => ({ ...f, statut_affiche: statutAffiche(historique(f)) });

  const nouveau = (o) => {
    const f = { id: ++ids, sens: SENS_FLUX.SORTANT, type: TYPE_FLUX.FACTURE_CLIENT, syntaxe: SYNTAXE.CII, profil: PROFIL_FACTURE.EN16931, regle: 'B2B', nom: '', numero: null,
      id_suivi: crypto.randomUUID().replaceAll('-', ''), id_flux: null, connecteur: parametres.connecteur, empreinte: '', ged_original_id: null, ged_converti_id: null,
      ged_lisible_id: null, type_element: null, id_element: null, etat: ETAT_FLUX.A_ENVOYER, accuse: null, accuse_details: null, essais: 0, prochain_essai: null,
      derniere_erreur: null, depose_le: null, modifie_pa_le: null, cree_le: maintenant(), ...o };
    flux.push(f);
    return f;
  };

  const garder = async (f, document, nom, contenu, type) => {
    fichiers.set(`${f.id}:${document}`, { document, nom, type_mime: type, taille: contenu.length, empreinte: await hex(contenu), contenu });
  };

  const statut = async (f, code, acteur = ACTEUR_FE.PLATEFORME) => {
    const avant = statutAffiche(historique(f));
    statuts.push({ id: statuts.length + 1, flux_id: f.id, numero_facture: f.numero, sens_facture: f.sens === SENS_FLUX.SORTANT ? 'E' : 'R', code, motif: null, action: null,
      montant: null, taux: null, emetteur: code === STATUT_CDV.APPROUVEE ? EMETTEUR_STATUT.ACHETEUR : EMETTEUR_STATUT.PA_E, sens: SENS_STATUT.RECU, flux_cdar_id: null,
      ged_cdar_id: null, date: maintenant(), erreurs: [] });
    await journaliser(f, EVENEMENT_FE.STATUT_RECU, acteur, avant, statutAffiche(historique(f)), { statut: code });
  };

  /** Dépôt des flux à envoyer (passage de la file) ; plateforme simulée : déposé, accusé attendu. */
  const passerFile = async () => {
    for (const f of flux.filter((x) => x.etat === ETAT_FLUX.A_ENVOYER)) {
      f.essais += 1;
      f.id_flux = crypto.randomUUID();
      f.depose_le = maintenant();
      f.accuse = ETAT_ACCUSE.EN_ATTENTE;
      await changer(f, ETAT_FLUX.ENVOYE, EVENEMENT_FE.DEPOT, ACTEUR_FE.SYSTEME, { id_flux: f.id_flux, essai: f.essais, connecteur: f.connecteur, manuel: f.connecteur === CONNECTEUR_FE.MANUEL });
    }
  };

  /** Relève : accusés des flux déposés sur la plateforme simulée, puis un statut de plus pour chaque facture acquittée. */
  const relever = async () => {
    await passerFile();
    for (const f of flux.filter((x) => x.connecteur === CONNECTEUR_FE.SIMULE && x.sens === SENS_FLUX.SORTANT)) {
      if (f.etat === ETAT_FLUX.ENVOYE) {
        const rejet = (f.numero ?? '').includes(MARQUEUR_REJET);
        f.accuse = rejet ? ETAT_ACCUSE.ERREUR : ETAT_ACCUSE.OK;
        f.modifie_pa_le = maintenant();
        if (rejet) {
          f.accuse_details = [{ niveau: 'Error', element: 'file', motif: MOTIF_ACCUSE.SCHEMA_INVALIDE, message: 'BR-FR-01' }];
          f.derniere_erreur = `${MOTIF_ACCUSE.SCHEMA_INVALIDE} : BR-FR-01`;
          erreurs.push({ id: erreurs.length + 1, flux_id: f.id, code: MOTIF_ACCUSE.SCHEMA_INVALIDE, niveau: 'Error', element: 'file', message: 'BR-FR-01', statut_http: null,
            request_id: null, essai: f.essais, cree_le: maintenant() });
          await journaliser(f, EVENEMENT_FE.ACCUSE, ACTEUR_FE.PLATEFORME, ETAT_FLUX.ENVOYE, ETAT_FLUX.ENVOYE, { accuse: f.accuse, details: f.accuse_details });
          await changer(f, ETAT_FLUX.ERREUR, EVENEMENT_FE.ERREUR, ACTEUR_FE.SYSTEME, { code: MOTIF_ACCUSE.SCHEMA_INVALIDE, message: 'BR-FR-01' });
        } else {
          await changer(f, ETAT_FLUX.ACQUITTE, EVENEMENT_FE.ACCUSE, ACTEUR_FE.PLATEFORME, { accuse: f.accuse, id_flux: f.id_flux });
        }
      } else if (f.etat === ETAT_FLUX.ACQUITTE) {
        const suite = [STATUT_CDV.DEPOSEE, STATUT_CDV.EMISE, STATUT_CDV.RECUE, STATUT_CDV.MISE_A_DISPOSITION, STATUT_CDV.PRISE_EN_CHARGE, STATUT_CDV.APPROUVEE];
        const prochain = suite.find((c) => !historique(f).includes(c));
        if (prochain) await statut(f, prochain);
      }
    }
    return { releves: flux.length };
  };

  return {
    /** Démonstration : facture émise mise en file (comme MettreEnFileAsync de l'application). */
    async emettre(numero, element = null) {
      const contenu = facture(numero);
      const f = nouveau({ nom: `${numero}.xml`, numero, connecteur: parametres.connecteur, type_element: element ? 'DOCUMENT' : null, id_element: element });
      await garder(f, TYPE_DOCUMENT_FLUX.ORIGINAL, f.nom, contenu, 'application/xml');
      f.empreinte = fichiers.get(`${f.id}:${TYPE_DOCUMENT_FLUX.ORIGINAL}`).empreinte;
      await journaliser(f, EVENEMENT_FE.PRODUCTION, ACTEUR_FE.SYSTEME, null, ETAT_FLUX.A_ENVOYER, { nom: f.nom, syntaxe: f.syntaxe, profil: f.profil, connecteur: f.connecteur });
      await passerFile();
      return dto(f);
    },

    async parametres() { return { ...parametres, connecteurs }; },
    async enregistrer(corps) {
      const champs = controlerParametres(corps, connecteurs);
      if (champs.length) throw new ErreurDemo(ERREUR_FE.PARAMETRE_INVALIDE, champs.join(', '));
      parametres = { ...parametres, ...corps };
      return { ...parametres, connecteurs };
    },
    async sante() {
      const t0 = performance.now();
      await new Promise((r) => { setTimeout(r, 120); });
      const ms = Math.round(performance.now() - t0);
      return parametres.connecteur === CONNECTEUR_FE.AFNOR
        ? { disponible: false, code: ERREUR_FE.PLATEFORME_INDISPONIBLE, duree: `00:00:00.${String(ms).padStart(3, '0')}0000` }
        : { disponible: true, code: null, duree: `00:00:00.${String(ms).padStart(3, '0')}0000` };
    },
    async flux(requete) {
      const q = new URLSearchParams(requete);
      let l = [...flux].sort((a, b) => b.id - a.id);
      for (const k of ['sens', 'etat', 'type']) if (q.get(k)) l = l.filter((x) => x[k] === q.get(k));
      if (q.get('erreurs')) l = l.filter((x) => erreurs.some((e) => e.flux_id === x.id) === (q.get('erreurs') === 'true'));
      if (q.get('du')) l = l.filter((x) => x.cree_le.slice(0, 10) >= q.get('du'));
      if (q.get('au')) l = l.filter((x) => x.cree_le.slice(0, 10) <= q.get('au'));
      if (q.get('avant')) l = l.filter((x) => x.id < Number(q.get('avant')));
      return l.slice(0, Number(q.get('limite') ?? 50)).map(dto);
    },
    async detail(id) {
      const f = trouver(id);
      await chaine;
      return {
        flux: dto(f), statuts: statuts.filter((s) => s.flux_id === f.id), erreurs: erreurs.filter((e) => e.flux_id === f.id),
        fichiers: [...fichiers.entries()].filter(([k]) => k.startsWith(`${f.id}:`)).map(([, x]) => ({ document: x.document, nom: x.nom, type_mime: x.type_mime, taille: x.taille, empreinte: x.empreinte })),
        chronologie: journal.filter((e) => e.flux_id === f.id),
      };
    },
    async fichier(id, document = TYPE_DOCUMENT_FLUX.ORIGINAL) {
      const f = trouver(id);
      const x = fichiers.get(`${f.id}:${document}`) ?? (document === TYPE_DOCUMENT_FLUX.LISIBLE && f.id_flux && f.connecteur === CONNECTEUR_FE.SIMULE
        ? { nom: `${f.numero}.txt`, contenu: `${f.numero}`, type_mime: 'text/plain' } : null);
      if (!x) throw new ErreurDemo(ERREUR_FE.RESSOURCE_INTROUVABLE, `Document ${document} absent du flux ${id}`);
      return { contenu: new Blob([x.contenu], { type: x.type_mime }), nom: x.nom, type: x.type_mime };
    },
    async chronologie(id) { await chaine; return journal.filter((e) => e.flux_id === Number(id)); },
    async chronologieElement(type, id) { await chaine; return journal.filter((e) => e.type_element === type && e.id_element === id); },
    async tentative(id) {
      const f = trouver(id);
      if (f.sens !== SENS_FLUX.SORTANT || ![ETAT_FLUX.ERREUR, ETAT_FLUX.A_ENVOYER].includes(f.etat)) throw new ErreurDemo(ERREUR_FE.ETAT_FLUX_INVALIDE, `Flux ${id} : nouvelle tentative impossible`);
      const redepot = Boolean(f.id_flux);
      if (redepot) Object.assign(f, { id_suivi: crypto.randomUUID().replaceAll('-', ''), id_flux: null, accuse: null, accuse_details: null });
      // Démonstration : le marqueur est retiré pour que le nouveau dépôt passe.
      f.numero = (f.numero ?? '').replace(MARQUEUR_REJET, '');
      f.essais = 0;
      f.derniere_erreur = null;
      await changer(f, ETAT_FLUX.A_ENVOYER, EVENEMENT_FE.ACTION_UTILISATEUR, ACTEUR_FE.UTILISATEUR, { action: 'NOUVELLE_TENTATIVE', nouveau_suivi: redepot ? f.id_suivi : null });
      await passerFile();
      return dto(f);
    },
    async confirmerDepot(id, corps) {
      const f = trouver(id);
      if (f.connecteur !== CONNECTEUR_FE.MANUEL || f.etat !== ETAT_FLUX.ENVOYE) throw new ErreurDemo(ERREUR_FE.ETAT_FLUX_INVALIDE, `Flux ${id} : aucun dépôt manuel en attente`);
      f.accuse = corps.etat;
      if (corps.etat === ETAT_ACCUSE.OK) await changer(f, ETAT_FLUX.ACQUITTE, EVENEMENT_FE.ACCUSE, ACTEUR_FE.UTILISATEUR, { accuse: corps.etat });
      else {
        f.derniere_erreur = `${corps.motif} : ${corps.message ?? ''}`;
        erreurs.push({ id: erreurs.length + 1, flux_id: f.id, code: corps.motif, niveau: 'Error', element: 'file', message: corps.message, statut_http: null, request_id: null,
          essai: f.essais, cree_le: maintenant() });
        await journaliser(f, EVENEMENT_FE.ACCUSE, ACTEUR_FE.UTILISATEUR, ETAT_FLUX.ENVOYE, ETAT_FLUX.ENVOYE, { accuse: corps.etat, motif: corps.motif });
        await changer(f, ETAT_FLUX.ERREUR, EVENEMENT_FE.ERREUR, ACTEUR_FE.SYSTEME, { code: corps.motif, message: corps.message });
      }
      return dto(f);
    },
    async importer(corps) {
      const contenu = atob(corps.contenu);
      if (!contenu.length) throw new ErreurDemo(ERREUR_FE.DEMANDE_INVALIDE, 'Fichier vide');
      const cdar = contenu.includes('CrossDomainAcknowledgementAndResponse');
      const numero = /<ram:ID>([^<]+)<\/ram:ID>/.exec(contenu)?.[1] ?? null;
      const f = nouveau({ sens: SENS_FLUX.ENTRANT, type: cdar ? corps.type_statut : TYPE_FLUX.FACTURE_FOURNISSEUR, syntaxe: cdar ? SYNTAXE.CDAR : SYNTAXE.CII,
        profil: cdar ? PROFIL_FACTURE.NON_DEFINI : PROFIL_FACTURE.EN16931, nom: corps.nom, numero, connecteur: CONNECTEUR_FE.MANUEL, id_flux: crypto.randomUUID(), etat: ETAT_FLUX.RECU });
      await garder(f, TYPE_DOCUMENT_FLUX.ORIGINAL, f.nom, contenu, 'application/xml');
      await journaliser(f, EVENEMENT_FE.IMPORT_MANUEL, ACTEUR_FE.UTILISATEUR, null, ETAT_FLUX.RECU, { nom: f.nom, syntaxe: f.syntaxe });
      await changer(f, ETAT_FLUX.TRAITE, EVENEMENT_FE.CONTROLE, ACTEUR_FE.SYSTEME, { numero: f.numero, cree: false });
      return dto(f);
    },
    relever,
    async verifierJournal() {
      await chaine;
      return { ok: true, entrees: journal.length, rang_rompu: null, raison: null, derniere_empreinte: journal.at(-1)?.empreinte ?? null };
    },
  };
}
