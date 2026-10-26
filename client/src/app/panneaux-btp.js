import { echapper, formatNombre, formatLibre, lireNombre, creerCombo, ListeDeroulante } from '@logibtp/socle/ui';
import { rendreExecution, sectionRepartition } from './execution/execution.js';
import { rendreEntretienOrdre } from './ressources/entretiens-ui.js';
import { PanneauxDocument, opt } from '@logibtp/document/ui';
import { estFamilleAchat } from '@logibtp/document';
import { ventilerFactureRecue, MESSAGES_VENTILATION } from '@logibtp/sous-traitance';
import { D, S } from '@logibtp/socle';
import { TL, estChiffree, estTranche, natureObligatoire, controlesValidation } from '../calcul/index.js';
import { sectionVariablesTranche, lierVariablesTranche } from './variables-tranche.js';
import { TableIntervenants } from './structure/intervenants.js';
import { intervenantPropre, changerNiveau } from './structure/structure.js';
import { champRattachement } from './structure/selection.js';
import { libelleCompte } from './comptes.js';
import {
  ORIGINES_ADRESSE, memeAdresse, adresseIdentiqueAuClient, payeurIdentiqueAuClient, lignesAdresse, saisirAdresse, choisirAdresse,
} from './structure/adresses.js';
import { api } from './api.js';
import {
  bilanTranche, partsLigne, dansPortee, cleLigne, ecrireCle, figerVentilation, repartirReste, remplacerCles,
} from './frais-annexes.js';

/** Individus actifs rattachés à notre société (annuaire) : rédacteurs proposés, [{ valeur (ind_id), libelle, detail }]. */
export async function individusSociete(annuaire) {
  const societe = await annuaire.societeBase().catch(() => null);
  if (!societe) return [];
  // Toutes les pages de rattachements (200 au plus par page).
  const lignes = [];
  for (let page = 1; page <= 50; page++) {
    const r = await annuaire.pageRattachements('personne', societe.id, { page, taille: 200 }).catch(() => ({ lignes: [], total: 0 }));
    lignes.push(...r.lignes);
    if (!r.lignes.length || lignes.length >= (r.total ?? 0)) break;
  }
  const vus = new Set();
  return lignes.filter((x) => x.actif !== false && !vus.has(x.ind_id) && vus.add(x.ind_id))
    .map((x) => ({ valeur: x.ind_id, libelle: x.individu, detail: x.fonction ?? '' }));
}

/**
 * Lieux de stock de l'entête par type de pièce (module Stock, § 4) : colonne → libellé ; une réception ou un retour
 * fournisseur porte le dépôt en destination, une livraison ou un retour client en origine.
 */
export const LIEUX_STOCK = {
  A_RECEPTION: { ent_stk_destination_id: 'Dépôt de réception' }, A_FACTURE: { ent_stk_destination_id: 'Dépôt de réception (sans réception)' },
  A_RETOUR: { ent_stk_destination_id: 'Dépôt de départ du retour' },
  V_RECEPTION: { ent_stk_origine_id: 'Dépôt de départ' }, V_FACTURE: { ent_stk_origine_id: 'Dépôt de départ (sans livraison)' },
  V_RETOUR: { ent_stk_origine_id: 'Dépôt de retour' },
  S_ENTREE: { ent_stk_destination_id: 'Destination' }, S_SORTIE: { ent_stk_origine_id: 'Origine' },
  S_TRANSFERT: { ent_stk_origine_id: 'Origine (vide : entrée)', ent_stk_destination_id: 'Destination (vide : sortie)' },
  // Lot 3 : sans mouvement, prévisions de la projection du disponible (date de besoin, livraison prévue).
  S_RESERVATION: { ent_stk_origine_id: 'Dépôt réservé' }, A_COMMANDE: { ent_stk_destination_id: 'Dépôt de livraison (vide : le chantier)' },
};

/** Date prévue des pièces sans mouvement (module Stock, lot 3) : colonne et libellé ; les autres portent la date du mouvement. */
const DATE_PREVUE_STOCK = { S_RESERVATION: ['ent_date_besoin', 'Date de besoin'], A_COMMANDE: ['ent_date_livraison', 'Livraison prévue'] };
/** Types qui reçoivent un accusé de réception de commande (↔ Structure.TypesArc). */
export const TYPES_ARC = new Set(['A_COMMANDE', 'T_COMMANDE']);

/**
 * Individus de notre structure, agences comprises (conducteur de travaux des chantiers) : lus par le serveur
 * (`GET /api/structure/individus`) ; hors ligne, rattachements de notre société dans l'annuaire de démonstration.
 */
export async function individusStructure(annuaire) {
  try { return await api.individusStructure(); } catch { return individusSociete(annuaire); }
}

/**
 * Panneaux du devis BTP : mode de calcul des ouvrages et variables du document ($$) dans l'entête,
 * quantité issue du métré, perte et blocages de prix dans le détail, déboursé et marge, coefficient de frais annexes.
 */
export class PanneauxBtp extends PanneauxDocument {
  /** options.bibliotheques : bibliothèques proposées pour l'appel des éléments (bibliothèque du document). */
  constructor(editeur, { bibliotheques = [], structure = null, rattacher = null, annuaire = null, intervenants = null, actualiserPrix = null, versBibliotheque = null, execution = null, stock = null, choisirTexte = null, arc = null } = {}) {
    super(editeur);
    // Accusé de réception des commandes (lot 9, A24e) : { enregistrer(entId, arc), deposer(fichier) } posé par la page en ligne.
    this.arc = arc;
    // Module Stock actif : { lieux() } (dépôts et chantiers qui tiennent un stock) ; bloc Stock de l'entête des pièces qui mouvementent.
    this.stock = stock;
    // Module Exécution (ordres, famille E) : { app, individus() } posé par la page ; panneau de l'entête, répartition du détail.
    this.execution = execution;
    this.choisirTexteBibliotheque = choisirTexte;
    this.bibliotheques = bibliotheques;
    // Structure des affaires : référentiels (projets, affaires, chantiers, marchés) et rattachement (page : document
    // modifiable → saisie ; validé → classement direct par l'API).
    this.structure = structure;
    this.rattacher = rattacher;
    // Annuaire du document : annuaire du cœur (recherche des tiers, contacts) ; intervenants(type, id) de la structure.
    this.annuaire = annuaire;
    this.intervenantsStructure = intervenants;
    this.actualiserPrix = actualiserPrix;
    this.versBibliotheque = versBibliotheque;
  }

  /** Tiers saisi dans l'annuaire du document (première ligne : client ou fournisseur). */
  champTiers(d) { return this.annuaire ? '' : super.champTiers(d); }

  // ------------------------------------------------------------------ coordonnées figées (client, payeur)

  /** Colonne de l'entête d'un rôle : CLIENT (client ou fournisseur du document) ou PAYEUR. */
  static colonneContact(role) { return role === 'PAYEUR' ? 'ent_contact_payeur' : 'ent_contact_client'; }

  /**
   * Personne et contact d'un rôle d'après l'annuaire du document (ContactsDocument.Source côté serveur) : le tiers du
   * document pour CLIENT ; l'intervenant PAYEUR seulement pour PAYEUR (sans lui, le payeur est le client : bloc vide).
   */
  sourceContact(role) {
    const liste = this.intervenantsDocument();
    const tiers = liste.find((x) => x.fonction === this.fonctionTiers() && x.per_id);
    const x = role === 'PAYEUR' ? liste.find((y) => y.fonction === 'PAYEUR' && y.per_id) : tiers;
    return x ? { per_id: Number(x.per_id), ind_id: x.ind_id ? Number(x.ind_id) : null } : null;
  }

  /** Recharge les coordonnées d'un rôle depuis l'annuaire (instantané enregistré dans l'entête). */
  async rechargerContact(role, { silencieux = false } = {}) {
    const source = this.sourceContact(role);
    if (!source) { if (!silencieux) this.editeur.surMessage?.(`${role === 'PAYEUR' ? 'Payeur' : 'Tiers'} à choisir dans l'annuaire du document`); return; }
    let c = await api.contactDocument(source.per_id, source.ind_id);
    // Payeur identique au client : le bloc reste vide (lot F).
    const identique = role === 'PAYEUR' && payeurIdentiqueAuClient(c, this.editeur.saisie.document.ent_contact_client);
    if (identique) c = null;
    if ((this.editeur.saisie.document[PanneauxBtp.colonneContact(role)] ?? null) === null && c === null) {
      if (!silencieux) this.editeur.surMessage?.('Payeur identique au client');
      return;
    }
    this.editeur.magasin.modifier((b) => { b.document[PanneauxBtp.colonneContact(role)] = c; }, 'Coordonnées du document');
    if (!silencieux) this.editeur.surMessage?.(identique ? 'Payeur identique au client' : 'Coordonnées rechargées depuis l\'annuaire');
  }

  /**
   * Bloc de coordonnées figées : raison sociale, contact, adresse, courriel, téléphone, SIRET, TVA, date du relevé ;
   * bouton ⟳ (document modifiable). Vide et tiers connu : rempli d'office depuis l'annuaire (document modifiable).
   */
  rendreContact(bloc, role) {
    const d = this.editeur.saisie.document;
    const c = d[PanneauxBtp.colonneContact(role)] ?? null;
    // Document validé : coordonnées figées (complétées par le serveur à la validation), ni rechargement ni remplissage.
    const lecture = !!this.editeur.magasin.lectureSeule || this.editeur.fige;
    const titre = role === 'PAYEUR' ? 'Payeur' : estFamilleAchat(this.editeur.definition.type?.tyd_famille) ? 'Fournisseur' : 'Client';
    const a = c?.adresse ?? {};
    const lignes = c ? [
      `<strong>${echapper(c.raison_sociale ?? '')}</strong>${c.code ? ` <small>${echapper(c.code)}</small>` : ''}`,
      c.contact?.nom ? `${echapper(c.contact.nom)}${c.contact.fonction ? ` — ${echapper(c.contact.fonction)}` : ''}` : '',
      ...[a.ligne1, a.ligne2, a.ligne3].filter(Boolean).map(echapper),
      [a.code_postal, a.ville].filter(Boolean).map(echapper).join(' ') + (a.pays && a.pays !== 'FR' ? ` (${echapper(a.pays)})` : ''),
      [c.email ? `✉ ${echapper(c.email)}` : '', c.telephone ? `☎ ${echapper(c.telephone)}` : ''].filter(Boolean).join(' · '),
      [c.siret ? `SIRET ${echapper(c.siret)}` : '', c.tva_intra ? `TVA ${echapper(c.tva_intra)}` : ''].filter(Boolean).join(' · '),
      c.releve_le ? `<small class="aide">relevé le ${echapper(c.releve_le)}</small>` : '',
    ].filter((x) => x && x.trim()) : [`<span class="aide">${role === 'PAYEUR' ? 'Identique au client' : 'Non renseignées'}</span>`];
    bloc.className = 'contact-document';
    bloc.innerHTML = `<div class="contact-titre"><b>${titre}</b>${lecture ? '' : ' <button type="button" class="bouton-icone" data-recharger title="Recharger depuis l\'annuaire">⟳</button>'}</div>
      <div>${lignes.join('<br>')}</div>`;
    bloc.querySelector('[data-recharger]')?.addEventListener('click', () => this.rechargerContact(role).catch((e) => this.editeur.surMessage?.(e.message)));
    // Vide : instantané pris d'office (une fois par rôle et par tiers).
    const source = this.sourceContact(role);
    const cle = `${role}:${source?.per_id}:${source?.ind_id}`;
    this.contactsRemplis ??= new Set();
    if (!c && !lecture && source && !this.contactsRemplis.has(cle)) {
      this.contactsRemplis.add(cle);
      this.rechargerContact(role, { silencieux: true }).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ adresse des travaux / de livraison (lot F)

  /** Adresse d'un chantier (cache par chantier) ; null si introuvable. */
  async adresseChantier(chaId) {
    this.adressesChantier ??= new Map();
    if (!this.adressesChantier.has(chaId)) this.adressesChantier.set(chaId, api.adressesLivraison({ chantier: chaId }).then((r) => r.chantier ?? null).catch(() => null));
    return this.adressesChantier.get(chaId);
  }

  /** Écrit l'adresse (null : vide) ; ventes : vide si identique au client. */
  definirAdresse(x, libelle = 'Adresse des travaux') {
    const vente = !estFamilleAchat(this.editeur.definition.type?.tyd_famille);
    const valeur = vente && adresseIdentiqueAuClient(x, this.editeur.saisie.document.ent_contact_client) ? null : x;
    if (x && !valeur) this.editeur.surMessage?.('Adresse identique au client : le bloc reste vide');
    this.editeur.magasin.modifier((b) => { b.document.ent_adresse_livraison = valeur; }, libelle);
  }

  /**
   * Bloc de l'adresse des travaux (ventes) ou de livraison (achats) : reprise du document parent (entête copié), sinon du
   * chantier (vide à l'affectation du chantier) ; achats : chantier, dépôt de l'entreprise, retrait au comptoir du
   * fournisseur ou saisie libre ; avertissement si elle diffère de l'adresse du chantier. Obligatoire pour valider une
   * commande fournisseur.
   */
  rendreAdresse(bloc) {
    const ed = this.editeur;
    const d = ed.saisie.document;
    const achat = estFamilleAchat(ed.definition.type?.tyd_famille);
    const x = d.ent_adresse_livraison ?? null;
    const lecture = !!ed.magasin.lectureSeule || ed.fige;
    const chaId = d.ent_chantier_id ? Number(d.ent_chantier_id) : null;
    const chantier = chaId ? this.adressesChantierLues?.get(chaId) : undefined;
    const obligatoire = ed.definition.type?.tyd_code === 'A_COMMANDE';
    const vide = achat ? `<span class="${obligatoire ? 'erreur' : 'aide'}">${obligatoire ? 'À choisir (obligatoire pour valider)' : 'Non renseignée'}</span>` : '<span class="aide">Identique au client</span>';
    const ecart = x && chantier && !memeAdresse(x.adresse, chantier.adresse) ? '<span class="alerte">⚠ Adresse différente de celle du chantier</span>' : '';
    const bouton = (action, texte, titre) => `<button type="button" class="bouton-icone" data-adresse-action="${action}" title="${titre}">${texte}</button>`;
    bloc.className = 'contact-document adresse-document';
    bloc.innerHTML = `<div class="contact-titre"><b>${achat ? 'Livraison' : 'Adresse des travaux'}</b>${x?.origine && !x.mention ? ` <small>${ORIGINES_ADRESSE[x.origine] ?? ''}</small>` : ''}
        ${lecture ? '' : `${chaId ? bouton('chantier', '⟳', 'Reprendre l\'adresse du chantier') : ''}${achat ? `${bouton('depot', '🏭', 'Dépôt de l\'entreprise')}${bouton('comptoir', '🛒', 'Retrait au comptoir du fournisseur')}` : ''}
          ${bouton('saisir', '✎', 'Saisie libre ou modification (contact sur place, téléphone, instructions)')}${x ? bouton('vider', '✕', 'Vider') : ''}`}</div>
      <div>${x ? lignesAdresse(x).join('<br>') : vide}</div>${ecart}`;
    const actions = {
      chantier: async () => { const c = await this.adresseChantier(chaId); if (c) this.definirAdresse(c); else ed.surMessage?.('Chantier sans adresse'); },
      depot: async () => {
        const r = await api.adressesLivraison();
        const c = await choisirAdresse(r.depots ?? [], { titre: 'Dépôt de l\'entreprise' });
        if (c) this.definirAdresse(c, 'Adresse de livraison');
      },
      comptoir: async () => {
        if (!d.ent_tiers_id) { ed.surMessage?.('Fournisseur à choisir dans l\'annuaire du document'); return; }
        const r = await api.adressesLivraison({ fournisseur: d.ent_tiers_id });
        const c = await choisirAdresse(r.comptoirs ?? [], { titre: 'Retrait au comptoir' });
        if (c) this.definirAdresse(c, 'Adresse de livraison');
      },
      saisir: async () => {
        const c = await saisirAdresse(x, { titre: achat ? 'Adresse de livraison' : 'Adresse des travaux' });
        if (c !== undefined) this.definirAdresse(c);
      },
      vider: () => this.definirAdresse(null),
    };
    bloc.querySelectorAll('[data-adresse-action]').forEach((b) => b.addEventListener('click', () => {
      b.blur();
      actions[b.dataset.adresseAction]().catch((e) => ed.surMessage?.(e.message));
    }));
    if (!chaId) return;
    // Adresse du chantier : avertissement d'écart ; bloc vide à l'affectation du chantier : reprise d'office (une fois).
    this.adressesChantierLues ??= new Map();
    if (chantier === undefined) {
      this.adresseChantier(chaId).then((c) => { this.adressesChantierLues.set(chaId, c); if (bloc.isConnected) this.rendreAdresse(bloc); });
      return;
    }
    this.adressesRemplies ??= new Set();
    if (!x && chantier && !lecture && !this.adressesRemplies.has(chaId)) {
      this.adressesRemplies.add(chaId);
      if (achat || !adresseIdentiqueAuClient(chantier, d.ent_contact_client)) this.definirAdresse(chantier);
    }
  }

  /** Fonction du tiers du document : fournisseur pour un achat, client sinon. */
  fonctionTiers() { return estFamilleAchat(this.editeur.definition.type?.tyd_famille) ? 'FOURNISSEUR' : 'CLIENT'; }

  /** Intervenants du document, le tiers du document (ent_tiers_id) en première ligne. */
  intervenantsDocument(d = this.editeur.saisie.document) {
    const liste = [...(d.ent_intervenants ?? [])];
    const fixe = this.fonctionTiers();
    const i = liste.findIndex((x) => x.fonction === fixe);
    const tiers = i >= 0 ? liste.splice(i, 1)[0] : d.ent_tiers_id ? { fonction: fixe, per_id: d.ent_tiers_id, principal: true } : null;
    return tiers ? [tiers, ...liste] : liste;
  }

  /** Enregistre la liste dans la saisie ; le tiers de la première ligne devient le tiers du document. */
  modifierIntervenants(liste, libelle = 'Annuaire du document') {
    const fixe = this.fonctionTiers();
    this.editeur.magasin.modifier((b) => {
      b.document.ent_intervenants = liste.map(intervenantPropre);
      const tiers = liste.find((x) => x.fonction === fixe);
      if (tiers?.per_id) b.document.ent_tiers_id = Number(tiers.per_id);
    }, libelle);
  }

  /**
   * Reprise des intervenants du marché, du chantier puis du projet (fonctions proposées dans les documents), sans
   * doublon (même fonction, même tiers et même contact) ni seconde occurrence d'une fonction unique. Retourne le
   * nombre d'intervenants ajoutés.
   */
  async reprendreIntervenants() {
    const d = this.editeur.saisie.document;
    if (!this.intervenantsStructure || this.editeur.magasin.lectureSeule) return 0;
    const sources = [['marche', d.ent_marche_id], ['chantier', d.ent_chantier_id], ['projet', d.ent_projet_id]].filter(([, id]) => id);
    const fonctions = this.structure?.fonctions ?? [];
    const liste = this.intervenantsDocument();
    let ajoutes = 0;
    for (const [type, id] of sources) {
      for (const x of await this.intervenantsStructure(type, id).catch(() => [])) {
        const f = fonctions.find((y) => y.code === x.fonction);
        if (!f || f.portee === 'S') continue;
        if (liste.some((y) => y.fonction === x.fonction && (f.unique || (y.per_id === x.per_id && y.ind_id === x.ind_id)))) continue;
        liste.push({ ...x });
        ajoutes++;
      }
    }
    if (ajoutes) this.modifierIntervenants(liste, 'Reprise des intervenants');
    return ajoutes;
  }

  champsEntete(d) {
    const defaut = this.bibliotheques.find((b) => b.defaut);
    // Document d'avancement : numéro de situation (attribué à la validation, modifiable : reprise d'un autre logiciel).
    const rang = d.ent_avt_presentation ? [`<label title="Numéro de situation du marché : attribué à la validation s'il est vide (saisi : reprise d'un autre logiciel)">N° de situation
      <input data-champ="ent_rang_avancement" data-entier inputmode="numeric" size="4" value="${d.ent_rang_avancement ?? ''}"></label>`] : [];
    return [...rang,...(this.annuaire ? [`<label title="Rédacteur du document : salarié de notre société (annuaire) ; saisir pour filtrer">Rédacteur
      <input data-redacteur autocomplete="off" value="${echapper(this.libelleRedacteur(d.ent_redacteur_id))}"></label>`] : []),
    `<label>Calcul des ouvrages
      <select data-champ="ent_mode_calcul_ouvrage">${opt('V', 'Somme des PV', d.ent_mode_calcul_ouvrage)}${opt('D', 'Déboursé', d.ent_mode_calcul_ouvrage)}${opt('B', 'Bordereau (PV fixe sans ventilation)', d.ent_mode_calcul_ouvrage)}</select></label>`,
    `<label title="Bibliothèque des codes saisis sans préfixe ; les autres s'appellent par BIB:CODE">Bibliothèque
      <select data-champ="ent_bib_id" data-entier>${opt('', `Par défaut${defaut ? ` (${defaut.code})` : ''}`, d.ent_bib_id ?? '')}${this.bibliotheques.filter((b) => b.actif || b.id === d.ent_bib_id)
        .map((b) => opt(String(b.id), `${b.code} – ${b.libelle}`, d.ent_bib_id === null || d.ent_bib_id === undefined ? '' : String(d.ent_bib_id))).join('')}</select></label>`];
  }

  /** Individus de notre société (annuaire), proposés comme rédacteurs : [{ valeur, libelle, detail }]. */
  async redacteurs() {
    this.listeRedacteurs ??= individusSociete(this.annuaire);
    return this.listeRedacteurs;
  }

  libelleRedacteur(id) {
    if (id === null || id === undefined) return '';
    return this.redacteursCharges?.find((r) => r.valeur === Number(id))?.libelle ?? `#${id}`;
  }

  /** Rédacteur : combo saisissable du socle (la saisie filtre, le texte reconnu désigne l'individu). */
  async lierRedacteur(zone) {
    const place = zone.querySelector('[data-redacteur]');
    if (!place) return;
    const m = this.editeur.magasin;
    this.redacteursCharges = await this.redacteurs();
    if (!place.isConnected) return; // entête redessiné pendant le chargement
    const champ = creerCombo({ options: this.redacteursCharges, valeur: this.editeur.saisie.document.ent_redacteur_id ?? '' });
    champ.dataset.redacteur = '';
    champ.title = place.title;
    champ.readOnly = !!m.lectureSeule;
    champ.addEventListener('change', () => {
      const v = champ.valeurCombo;
      const id = v === '' || v === null ? null : Number(v);
      if (id !== (this.editeur.saisie.document.ent_redacteur_id ?? null)) m.modifier((b) => { b.document.ent_redacteur_id = id; }, 'Rédacteur');
    });
    place.replaceWith(champ);
  }

  variablesDocument() {
    return this.editeur.saisie.variables.filter((v) => v.var_lig_id === null && v.var_mtr_id === null);
  }

  /**
   * Rattachement à la structure des affaires : pour chaque niveau, libellé, zone de saisie du code (double-clic ou F4 :
   * liste de choix) et, dessous, le libellé de l'élément en lien vers sa fiche (composant champRattachement).
   */
  sectionRattachement() {
    return this.structure ? '<fieldset class="rattachement-document"><legend>Rattachement</legend><div class="rattachement-niveaux" data-rattachements></div></fieldset>' : '';
  }

  /** Rattachement modifié sur un niveau : les parents suivent (completerRattachement), un enfant incohérent est retiré. */
  changerRattachement(cle, id) {
    this.rattacher?.(changerNiveau(this.editeur.saisie.document, cle, id, this.structure));
  }

  sectionsEntete() {
    // Variables du document ($$) : dans le métré de la ligne de section (F4) ; sans section, rappel seulement.
    const section = this.editeur.saisie.lignes.some((l) => l.lig_tyl_id === TL.SECTION);
    const nbVars = this.variablesDocument().length;
    return `${this.sectionRattachement(this.editeur.saisie.document)}
      ${this.annuaire ? '<fieldset class="annuaire-document"><legend>Annuaire du document</legend><div data-intervenants></div></fieldset>' : ''}
      ${this.annuaire ? `<fieldset class="contacts-document"><legend>Coordonnées du document</legend>
        <p class="aide">Enregistrées dans le document pour les éditions et conservées à la transformation ; ⟳ les recharge depuis l'annuaire.</p>
        <div class="contacts-blocs"><div data-contact="CLIENT"></div>${estFamilleAchat(this.editeur.definition.type?.tyd_famille) ? '' : '<div data-contact="PAYEUR"></div>'}<div data-adresse></div></div></fieldset>` : ''}
      ${!section && nbVars ? `<p class="aide">${nbVars} variable(s) du document ($$) : ajoutez une ligne de section pour les modifier (F4 sur la section).</p>` : ''}
      ${this.estOrdre() ? '<fieldset class="execution-document"><legend>Exécution</legend><div data-execution></div></fieldset>' : ''}
      ${this.estOrdre() && this.editeur.definition.type?.tyd_code === 'E_ENT' ? '<fieldset class="entretien-document"><legend>Matériel entretenu</legend><div data-entretien></div></fieldset>' : ''}
      ${this.editeur.definition.type?.tyd_code === 'T_FACTURE_AVT' ? '<fieldset class="facture-st"><legend>Facture du sous-traitant</legend><div data-facture-st></div></fieldset>' : ''}
      ${this.stock && LIEUX_STOCK[this.editeur.definition.type?.tyd_code] ? '<fieldset class="stock-document"><legend>Stock</legend><div data-stock></div></fieldset>' : ''}
      ${this.arc && TYPES_ARC.has(this.editeur.definition.type?.tyd_code) ? '<fieldset class="arc-document"><legend>Accusé de réception (ARC)</legend><div data-arc></div></fieldset>' : ''}`;
  }

  /**
   * Stock (module Stock, § 4, S9 à S12) : date-heure du mouvement (la validation par défaut, à la minute) et lieux
   * d'origine et / ou de destination selon le type ; un lieu qui ne tient pas de stock (chantier client) consomme
   * l'entrée, une pièce sans dépôt ne mouvemente pas.
   */
  rendreStock(bloc) {
    const ed = this.editeur;
    const m = ed.magasin;
    const d = ed.saisie.document;
    const lecture = Boolean(m.lectureSeule || ed.fige);
    const champs = LIEUX_STOCK[ed.definition.type.tyd_code];
    const local = d.ent_date_mouvement ? new Date(d.ent_date_mouvement) : null;
    const valeurLocale = local ? new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    const prevue = DATE_PREVUE_STOCK[ed.definition.type.tyd_code];
    bloc.innerHTML = `<p class="ligne">${prevue
      ? `<label>${prevue[1]} <input type="date" data-stk-prevue value="${echapper(d[prevue[0]] ?? '')}" ${lecture ? 'disabled' : ''}></label>
        <small class="aide">${d[prevue[0]] ? '' : 'Vide : la date de la pièce.'} Sert à la projection du disponible (ruptures à venir).</small>`
      : `<label>Date du mouvement <input type="datetime-local" data-stk-date value="${valeurLocale}" ${lecture ? 'disabled' : ''}></label>
        <small class="aide">${local ? '' : 'Vide : l\'instant de la validation.'}</small>`}</p>
      <p class="ligne">${Object.entries(champs).map(([cle, titre]) => `<label>${echapper(titre)} <span data-stk-lieu="${cle}"></span></label>`).join(' ')}</p>
      <p class="aide">Seuls les articles gérés en stock bougent ; un chantier qui ne tient pas de stock consomme ce qu'il reçoit.</p>`;
    bloc.querySelector('[data-stk-prevue]')?.addEventListener('change', (e) => {
      const v = e.target.value;
      m.modifier((b) => { b.document[prevue[0]] = v || null; }, prevue[1]);
    });
    bloc.querySelector('[data-stk-date]')?.addEventListener('change', (e) => {
      const v = e.target.value;
      m.modifier((b) => { b.document.ent_date_mouvement = v ? new Date(v).toISOString() : null; }, 'Date du mouvement');
    });
    const lieux = this.lieuxStock ?? [];
    const depots = new Set(lieux.filter((l) => l.depot).map((l) => l.id));
    const tenus = new Set(lieux.map((l) => l.id));
    const chantiers = [...(this.structure?.chantiers ?? [])].sort((a, b) => (depots.has(b.id) - depots.has(a.id)) || (tenus.has(b.id) - tenus.has(a.id)));
    const options = chantiers.map((c) => ({ valeur: c.id, libelle: `${depots.has(c.id) ? '📦 ' : tenus.has(c.id) ? '🏗 ' : ''}${c.code} – ${c.libelle ?? ''}` }));
    bloc.querySelectorAll('[data-stk-lieu]').forEach((span) => {
      const cle = span.dataset.stkLieu;
      const c = creerCombo({ options, valeur: d[cle] ?? '', titre: '📦 dépôt, 🏗 chantier qui tient un stock' });
      c.readOnly = lecture;
      c.addEventListener('change', () => m.modifier((b) => { b.document[cle] = c.valeurCombo === '' ? null : Number(c.valeurCombo); }, 'Lieu de stock'));
      span.append(c);
    });
    if (!this.lieuxStock) this.stock.lieux().then((l) => { this.lieuxStock = l; if (bloc.isConnected) this.rendreStock(bloc); }).catch(() => { this.lieuxStock = []; });
  }

  /**
   * Accusé de réception de la commande (lot 9, A24e) : numéro, date et livraison confirmée, enregistrés à part du document
   * (même validé : PUT /api/structure/documents/{id}/arc) ; la livraison confirmée remplace la livraison prévue pour les
   * lignes sans date propre. 📎 range le fichier de l'ARC dans la GED du document (catégorie « arc »).
   */
  rendreArc(bloc) {
    const d = this.editeur.saisie.document;
    if (!d.ent_id || d.ent_id < 0) { bloc.innerHTML = "<p class=\"aide\">Enregistrez la commande pour saisir l'accusé de réception.</p>"; return; }
    bloc.innerHTML = `<p class="ligne"><label>N° <input data-arc="ent_arc_numero" size="14" maxlength="50" value="${echapper(d.ent_arc_numero ?? '')}"></label>
        <label>Date <input type="date" data-arc="ent_arc_date" value="${echapper(d.ent_arc_date ?? '')}"></label>
        <label>Livraison confirmée <input type="date" data-arc="ent_arc_livraison" value="${echapper(d.ent_arc_livraison ?? '')}"></label>
        <button type="button" data-arc-enregistrer title="Enregistre l'accusé de réception (même sur une commande validée)">💾</button>
        <label class="bouton-fichier" title="Ranger le fichier de l'accusé de réception dans les pièces du document">📎<input type="file" data-arc-fichier hidden></label></p>
      <p class="aide">La livraison confirmée remplace la livraison prévue pour les lignes sans date propre (projection du stock).</p>`;
    const valeur = (cle) => bloc.querySelector(`[data-arc="${cle}"]`).value.trim() || null;
    bloc.querySelector('[data-arc-enregistrer]').addEventListener('click', async () => {
      try {
        const r = await this.arc.enregistrer(d.ent_id, { ent_arc_numero: valeur('ent_arc_numero'), ent_arc_date: valeur('ent_arc_date'), ent_arc_livraison: valeur('ent_arc_livraison') });
        Object.assign(d, r);
        this.editeur.surMessage?.('Accusé de réception enregistré', 'succes');
        this.editeur.grille?.rendre();
      } catch (e) { this.editeur.surMessage?.(e.message, 'erreur'); }
    });
    bloc.querySelector('[data-arc-fichier]').addEventListener('change', async (e) => {
      const fichier = e.target.files?.[0];
      e.target.value = '';
      if (!fichier) return;
      try {
        await this.arc.deposer(fichier, valeur('ent_arc_numero'));
        this.editeur.surMessage?.(`${fichier.name} rangé dans les pièces du document`, 'succes');
      } catch (x) { this.editeur.surMessage?.(x.message, 'erreur'); }
    });
  }

  /**
   * Facture de sous-traitance (Sous-traitance, lot 3, § 5.4) : saisie à l'avancement (situation établie pour le
   * sous-traitant) ou facture reçue (son numéro et sa date : référence externe et date fournisseur ; ses montants) ;
   * « Ventiler au prorata » répartit le HT reçu sur les lignes au prorata de leur reste (ventilerFactureRecue ↔
   * ReglesVentilation.cs) ; l'écart restant est refusé à la validation au-delà de la règle ECART_FACTURE_RECUE.
   */
  rendreFactureSt(bloc) {
    const ed = this.editeur;
    const m = ed.magasin;
    const d = ed.saisie.document;
    const lecture = Boolean(m.lectureSeule || ed.fige);
    const recue = d.ent_st_saisie === 'RECUE';
    const total = ed.resultat?.document?.ent_total_ht ?? null;
    const ecart = recue && d.ent_st_recu_ht !== null && d.ent_st_recu_ht !== undefined && total !== null ? D(d.ent_st_recu_ht).minus(D(total)) : null;
    bloc.innerHTML = `<p class="ligne"><label><input type="radio" name="st-saisie" value="AVANCEMENT" ${recue ? '' : 'checked'} ${lecture ? 'disabled' : ''}> À l'avancement
        <small class="aide">(situation établie pour le sous-traitant)</small></label>
      <label><input type="radio" name="st-saisie" value="RECUE" ${recue ? 'checked' : ''} ${lecture ? 'disabled' : ''}> Facture reçue du sous-traitant</label></p>
      ${recue ? `<p class="aide">Numéro et date de la facture : « Référence externe » et « Date fournisseur » ci-dessus. Le PDF se range dans l'onglet Pièces.</p>
      <p class="ligne"><label>HT de la période <input data-st="ent_st_recu_ht" size="12" value="${echapper(d.ent_st_recu_ht ?? '')}" ${lecture ? 'disabled' : ''}></label>
        <label>TVA <input data-st="ent_st_recu_tva" size="10" value="${echapper(d.ent_st_recu_tva ?? '')}" ${lecture ? 'disabled' : ''}></label>
        <label>TTC <input data-st="ent_st_recu_ttc" size="12" value="${echapper(d.ent_st_recu_ttc ?? '')}" ${lecture ? 'disabled' : ''}></label>
        ${lecture ? '' : '<button type="button" data-ventiler title="Répartit le HT reçu sur les lignes au prorata de leur reste à facturer">⚖ Ventiler au prorata</button>'}</p>
      ${ecart !== null ? `<p class="${ecart.isZero() ? 'aide' : 'avertissement'}">Ventilé sur les lignes : ${formatNombre(Number(total), 2)} € HT${ecart.isZero() ? ' (égal au reçu)' : ` — écart ${formatNombre(Number(ecart), 2)} €`}</p>` : ''}` : ''}`;
    bloc.querySelectorAll('input[name="st-saisie"]').forEach((r) => r.addEventListener('change', () => {
      m.modifier((b) => { b.document.ent_st_saisie = r.value; }, 'Saisie de la facture');
      this.rendreFactureSt(bloc);
    }));
    bloc.querySelectorAll('[data-st]').forEach((i) => i.addEventListener('change', () => {
      const v = i.value.trim().replace(/\s/g, '').replace(',', '.');
      m.modifier((b) => { b.document[i.dataset.st] = v === '' ? null : S(D(v)); }, 'Facture reçue');
    }));
    bloc.querySelector('[data-ventiler]')?.addEventListener('click', () => {
      const lignes = ed.saisie.lignes.filter((l) => l.lig_avt_montant_marche !== null && l.lig_avt_montant_marche !== undefined && !l._virtuelle);
      const r = ventilerFactureRecue({
        lignes: lignes.map((l) => ({ id: l.lig_id, marche: l.lig_avt_montant_marche, precedent: l.lig_avt_montant_precedent ?? 0 })),
        periode: ed.saisie.document.ent_st_recu_ht, precision: ed.saisie.document.ent_precision_montant ?? 2,
      });
      for (const e of r.erreurs) this.editeur.surMessage?.(MESSAGES_VENTILATION[e] ?? e, e === 'VENT_DEPASSEMENT' ? 'avertissement' : 'erreur');
      if (!r.lignes.length) return;
      const cumuls = new Map(r.lignes.map((x) => [x.id, x.cumul]));
      m.modifier((b) => {
        for (const l of b.lignes) if (cumuls.has(l.lig_id)) { l.lig_avt_mode = 'M'; l.lig_avt_valeur = cumuls.get(l.lig_id); }
      }, 'Ventilation de la facture reçue');
    });
  }

  /** Textes de l'édition : éléments TEXTE de la bibliothèque (lot 7, A18d). */
  peutChoisirTexte() { return Boolean(this.choisirTexteBibliotheque); }

  async choisirTexte() { return (await this.choisirTexteBibliotheque?.())?.libelle_html ?? null; }

  /** Ordre du module Exécution (famille E) avec le module actif. */
  estOrdre() { return Boolean(this.execution) && this.editeur.definition.type?.tyd_famille === 'E'; }

  lierEntete(zone) {
    const m = this.editeur.magasin;
    const exe = zone.querySelector('[data-execution]');
    if (exe) {
      rendreExecution(exe, { app: this.execution.app, entId: this.editeur.saisie.document.ent_id, typeCode: this.editeur.definition.type.tyd_code, individus: this.execution.individus })
        .catch((e) => this.execution.app.erreur(e));
    }
    const ent = zone.querySelector('[data-entretien]');
    if (ent) rendreEntretienOrdre(ent, { app: this.execution.app, entId: this.editeur.saisie.document.ent_id }).catch((e) => this.execution.app.erreur(e));
    const fst = zone.querySelector('[data-facture-st]');
    if (fst) this.rendreFactureSt(fst);
    const stk = zone.querySelector('[data-stock]');
    if (stk) this.rendreStock(stk);
    const arc = zone.querySelector('[data-arc]');
    if (arc) this.rendreArc(arc);
    this.lierRedacteur(zone).catch(() => {});
    zone.querySelectorAll('[data-contact]').forEach((bloc) => this.rendreContact(bloc, bloc.dataset.contact));
    zone.querySelectorAll('[data-adresse]').forEach((bloc) => this.rendreAdresse(bloc));
    const conteneur = zone.querySelector('[data-intervenants]');
    if (conteneur) {
      const d = this.editeur.saisie.document;
      const lecture = !!m.lectureSeule;
      conteneur.append(new TableIntervenants({
        annuaire: this.annuaire, fonctions: this.structure?.fonctions ?? [], portee: 'D', lecture, fixe: this.fonctionTiers(),
        tiersFige: this.editeur.saisie.lignes.some((l) => l.lig_origine_id),
        surChange: (liste) => this.modifierIntervenants(liste),
        actions: !lecture && (d.ent_marche_id || d.ent_chantier_id || d.ent_projet_id) ? [{
          libelle: '↧ Reprendre du marché / chantier', titre: 'Ajoute les intervenants du marché, du chantier et du projet (client, payeur, sous-traitants…)',
          action: () => this.reprendreIntervenants().then((n) => this.editeur.surMessage?.(n ? `${n} intervenant(s) repris` : 'Aucun intervenant à reprendre')),
        }] : [],
      }).rendre(this.intervenantsDocument(d)));
    }
    const ratt = zone.querySelector('[data-rattachements]');
    if (ratt) {
      const d = this.editeur.saisie.document;
      const niveau = (type, cle, titre, filtre = null) => champRattachement({
        type, titre, refs: this.structure, valeur: d[cle], filtre, choisir: (id) => this.changerRattachement(cle, id),
      });
      ratt.append(
        niveau('projet', 'ent_projet_id', 'Projet'),
        niveau('affaire', 'ent_affaire_id', 'Affaire'),
        niveau('chantier', 'ent_chantier_id', 'Chantier', d.ent_affaire_id ? { libelle: 'Chantiers de l\'affaire', test: (x) => x.aff_id === d.ent_affaire_id } : null),
        niveau('marche', 'ent_marche_id', 'Marché', d.ent_chantier_id ? { libelle: 'Marchés du chantier', test: (x) => x.cha_id === d.ent_chantier_id } : null),
      );
    }
  }

  aideLigneAbsente(calculee) {
    return calculee?.lig_is_ecart_arrondi
      ? '<p class="aide">Ligne d\'écart d\'arrondi : calculée, non modifiable, masquée à l\'impression.</p>'
      : super.aideLigneAbsente(calculee);
  }

  champsDetail(l, f) {
    const champs = super.champsDetail(l, f);
    if (estChiffree(l)) {
      // Après la quantité relative / absolue et avant les décimales.
      const i = champs.findIndex((c) => c.includes('data-champ="lig_precision_qte"'));
      champs.splice(i, 0,
        f.sel('lig_qte_source', 'Source de la quantité', [['S', 'Saisie'], ['M', 'Métré (F4)']]),
        f.txt('lig_coef_perte', 'Coefficient de perte', true));
      const j = champs.findIndex((c) => c.includes('data-champ="lig_code"'));
      const blocages = [f.coche('lig_pv_fixe', 'PV fixe (avant frais annexes et remise)')];
      if (this.regles.estLigneDePrix(this.editeur.saisie.lignes, l)) {
        blocages.push(f.coche('lig_pv_affiche_fixe', 'PV affiché fixe (avec frais annexes)'), f.txt('lig_pv_affiche', 'PV affiché imposé', true));
      }
      champs.splice(j, 0, ...blocages);
      // Nature (obligatoire pour valider) : avant le code article.
      const natures = (this.editeur.natures ?? []).filter((n) => n.actif !== false || n.id === l.lig_nat_id);
      const k = champs.findIndex((c) => c.includes('data-champ="lig_code"'));
      champs.splice(k < 0 ? 0 : k, 0, f.sel('lig_nat_id', `Nature${natureObligatoire(l) ? ' *' : ''}`, [['', '—'], ...natures.map((n) => [n.id, `${n.code} – ${n.libelle}`])], true),
        this.champCompte(l));
    }
    return champs;
  }

  /** Compte comptable : saisie libre (plan de comptes proposé), code et libellé dessous ; compte hérité souligné. */
  champCompte(l) {
    const c = this.editeur.compteLigne(l);
    const lib = c ? echapper(libelleCompte(c.code, this.editeur.comptes)) : '';
    const info = !c ? 'Aucun compte' : c.herite ? `<u class="compte-herite">${lib}</u> <em>(hérité : ${echapper(c.detail)})</em>` : lib;
    return `<label class="large" title="Vide : compte de la ventilation (nature et taux de TVA, nature, taux, puis compte par défaut du type comptable du document)">Compte comptable
      <input data-champ="lig_cpt_code" data-comptes maxlength="20" autocomplete="off" value="${echapper(l.lig_cpt_code ?? '')}" placeholder="${c?.herite ? echapper(c.code) : ''}">
      <small class="compte-libelle">${info}</small></label>`;
  }

  /** Liste du plan de comptes sur le champ du compte (saisie libre : un code absent du plan reste accepté). */
  lierCompte(zone) {
    const champ = zone.querySelector('[data-comptes]');
    if (!champ) return;
    const options = (this.editeur.comptes ?? []).filter((c) => c.actif !== false).map((c) => ({ valeur: c.code, libelle: c.libelle }));
    let liste = null;
    champ.addEventListener('focus', () => { if (!liste && !champ.readOnly) liste = new ListeDeroulante(champ, options); });
    champ.addEventListener('keydown', (e) => { if (liste?.clavier(e)) e.preventDefault(); });
    champ.addEventListener('blur', () => { liste?.detruire(); liste = null; });
  }

  calculDetail(c) {
    if (!estChiffree(c)) return super.calculDetail(c);
    return [
      ['Qté vendue', formatLibre(c.lig_qte_vendue)], ['Qté totale', formatLibre(c.lig_qte_totale)],
      ['PR', formatNombre(c.lig_pr, 4)], ['PV affiché', formatNombre(c.lig_pv_affiche, c.lig_precision_pv ?? 2)],
      ['Coef FA', formatLibre(c.lig_coef_fa)],
      ...(this.regles.estLigneDePrix(this.editeur.saisie.lignes, c) ? [['Coef prorata', formatLibre(c.lig_coef_prorata ?? 1)]] : []), ['Déboursé', formatNombre(c.lig_montant_pa, 2)],
      ['Revient', formatNombre(c.lig_montant_pr, 2)], ['Marge', formatNombre(Number(c.lig_montant_ht ?? 0) - Number(c.lig_montant_pr ?? 0), 2)],
    ];
  }

  lignesTotaux(d) {
    return Number(d.ent_coef_fa) !== 1 ? [['Coef. frais annexes', formatLibre(d.ent_coef_fa)]] : [];
  }

  /**
   * Détail de la ligne : actions de la bibliothèque (prix, envoi) sur la sélection ou la ligne ; pour une tranche
   * (titre, section), ses paramètres ($largeur, $hauteur…) sous le formulaire ; pour la section, les variables du
   * document ($$) dans son métré (F4).
   */
  rendreDetail(zone, ligId) {
    if (zone.contains(document.activeElement)) return;
    super.rendreDetail(zone, ligId);
    const l = this.editeur.saisie.lignes.find((x) => x.lig_id === ligId);
    if (!l) return;
    this.lierCompte(zone);
    const lecture = !!this.editeur.magasin.lectureSeule;
    const ids = () => {
      const sel = this.editeur.grille.selection ?? [];
      return sel.includes(ligId) ? sel : [ligId];
    };
    const actions = [
      this.actualiserPrix && !lecture && !this.editeur.estAvancement ? '<button type="button" data-action-ligne="prix" title="Reprendre les prix de la bibliothèque (lignes sélectionnées ou cette ligne)">⟳ Prix bibliothèque</button>' : '',
      this.versBibliotheque && !lecture ? '<button type="button" data-action-ligne="envoi" title="Mettre à jour ou créer les éléments de la bibliothèque (élément → article, ouvrage → ouvrage, titre → ensemble)">📤 Vers la bibliothèque</button>' : '',
      l.lig_tyl_id === TL.SECTION ? '<button type="button" data-action-ligne="variables" title="Variables du document ($$) dans le métré de la section (F4)">$$ Variables du document</button>' : '',
    ].filter(Boolean);
    if (actions.length) {
      const h3 = zone.querySelector('h3');
      (h3 ?? zone.firstChild)?.insertAdjacentHTML?.('afterend', `<div class="actions-ligne">${actions.join('')}</div>`);
      zone.querySelector('[data-action-ligne="prix"]')?.addEventListener('click', () => this.actualiserPrix(ids()));
      zone.querySelector('[data-action-ligne="envoi"]')?.addEventListener('click', () => this.versBibliotheque(ids()));
      zone.querySelector('[data-action-ligne="variables"]')?.addEventListener('click', () => this.editeur.creerMetre(ligId));
    }
    this.sectionFrais(zone, l);
    this.sectionRepartition(zone, l);
    if (!estTranche(l)) return;
    zone.insertAdjacentHTML('beforeend', sectionVariablesTranche(this.editeur, ligId, { modifiable: !this.editeur.magasin.lectureSeule }));
    lierVariablesTranche(zone, this.editeur);
  }

  /**
   * Ordre suivant (famille E hors ordre d'exécution) : bloc « Exécution » de la ligne (ordre parent, déjà réparti, reste ;
   * E17), lu une fois par version enregistrée du document.
   */
  sectionRepartition(zone, l) {
    const d = this.editeur.saisie.document;
    if (!this.estOrdre() || this.editeur.definition.type.tyd_code === 'E_OE' || !d.ent_id) return;
    const cle = `${d.ent_id}:${d.ent_version}`;
    if (this.repartition?.cle !== cle) this.repartition = { cle, promesse: api.execution.repartition(d.ent_id).catch(() => []) };
    this.repartition.promesse.then((liste) => {
      const info = liste.find((x) => x.lig_id === l.lig_id);
      if (info && zone.isConnected && !zone.querySelector('.execution-repartition')) zone.insertAdjacentHTML('beforeend', sectionRepartition(info));
    });
  }

  /**
   * Frais annexes dans le détail : sur une tranche F, bilan (prévu, ventilé, écart) et actions (répartir le reste,
   * figer) ; sur une ligne de prix, part reçue de chaque tranche de frais de sa portée et clé de ligne (% de la
   * tranche ou montant par unité ; vide : pas de clé).
   */
  sectionFrais(zone, l) {
    const ed = this.editeur;
    if (ed.definition.regles && ed.definition.regles.FRAIS_ANNEXES === false) return;
    const r = ed.resultat;
    const pm = ed.saisie.document.ent_precision_montant ?? 2;
    const lecture = !!ed.magasin.lectureSeule;
    const m = ed.magasin;
    const bilan = bilanTranche(r, l.lig_id);
    const libelle = (id) => r.lignes.find((x) => x.lig_id === id)?.lig_libelle_brut || 'Frais annexes';
    if (bilan) {
      const pct = Number(bilan.prevu) ? ` (${formatLibre(Math.round(Number(bilan.ventile) / Number(bilan.prevu) * 1000) / 10, 1)} %)` : '';
      zone.insertAdjacentHTML('beforeend', `<section class="detail-frais"><h4>Ventilation des frais annexes</h4>
        <dl class="calcul">
          <dt>Prévu</dt><dd>${formatNombre(bilan.prevu, pm)}</dd>
          <dt>Ventilé${bilan.cles ? ' (clés)' : ' (prorata)'}</dt><dd>${formatNombre(bilan.ventile, pm)}${pct}</dd>
          <dt>Ventilé réel</dt><dd title="Montants HT avec frais − sans frais, après arrondi des PV">${formatNombre(bilan.ventile_reel, pm)}</dd>
          <dt>Écart</dt><dd class="${Number(bilan.ecart) ? 'manquant' : ''}">${formatNombre(bilan.ecart, pm)}</dd>
          <dt>Portée</dt><dd>${echapper(bilan.portee_id ? libelle(bilan.portee_id) : '—')}</dd>
        </dl>
        ${lecture ? '' : `<div class="actions-ligne">
          <button type="button" data-frais="reste" title="Fige la ventilation actuelle en clés de ligne et répartit le montant non ventilé au prorata sur les lignes qui ne reçoivent encore rien de cette tranche">Répartir le reste</button>
          <button type="button" data-frais="figer" title="Remplace les clés de la tranche par des clés de ligne en montant par unité : les prix ne bougeront plus si le devis change">Figer la ventilation</button>
          ${bilan.cles ? '<button type="button" data-frais="prorata" title="Supprime les clés de la tranche : ventilation au prorata du montant hors frais">Revenir au prorata</button>' : ''}
        </div>`}</section>`);
      const action = (quoi) => {
        // Identifiants temporaires négatifs consécutifs (prochainId du magasin ne change qu'après modification).
        let n = m.prochainId() + 1;
        const prochainId = () => --n;
        const cles = quoi === 'prorata' ? [] : quoi === 'figer' ? figerVentilation(r, { source: l.lig_id, prochainId }) : repartirReste(ed.entree(ed.saisie), r, l.lig_id, prochainId);
        if (!cles) { ed.surMessage?.('Aucune ligne pour recevoir les frais'); return; }
        m.modifier((d) => remplacerCles(d, l.lig_id, cles), { reste: 'Répartir le reste des frais', figer: 'Figer la ventilation', prorata: 'Ventilation au prorata' }[quoi]);
      };
      zone.querySelectorAll('[data-frais]').forEach((b) => b.addEventListener('click', () => action(b.dataset.frais)));
      return;
    }
    if (!this.regles.estLigneDePrix(ed.saisie.lignes, l) || l.lig_type_prix === 'F') return;
    const unites = (r.frais_annexes ?? []).filter((b) => dansPortee(ed.saisie.lignes, b, l.lig_id));
    if (!unites.length) return;
    const parts = partsLigne(r, l.lig_id);
    zone.insertAdjacentHTML('beforeend', `<section class="detail-frais"><h4>Frais annexes reçus</h4>
      <table class="table-frais"><thead><tr><th>Tranche de frais</th><th>Part reçue</th><th>Clé de la ligne</th><th></th></tr></thead><tbody>
      ${unites.map((b) => {
        const k = cleLigne(ed.saisie.ventilations, b.lig_id, l.lig_id);
        const part = parts.filter((p) => p.source === b.lig_id).reduce((s, p) => s + Number(p.montant), 0);
        return `<tr data-source="${b.lig_id}"><td>${echapper(libelle(b.lig_id))}</td><td class="nombre">${part ? formatNombre(part, pm) : '—'}</td>
          <td><input class="nombre" data-cle-valeur value="${echapper(k ? formatLibre(k.vfr_valeur) : '')}" ${lecture ? 'disabled' : ''}
            title="Vide : pas de clé (prorata, ou part décidée par les clés d'élément et de nature)"></td><td data-cle-mode></td></tr>`;
      }).join('')}
      </tbody></table></section>`);
    zone.querySelectorAll('.table-frais tr[data-source]').forEach((tr) => {
      const source = Number(tr.dataset.source);
      const k = cleLigne(ed.saisie.ventilations, source, l.lig_id);
      const mode = creerCombo({ options: [{ valeur: 'P', libelle: '% de la tranche' }, { valeur: 'M', libelle: '€ par unité' }], valeur: k?.vfr_mode ?? 'M', vide: false });
      mode.disabled = lecture;
      tr.querySelector('[data-cle-mode]').append(mode);
      const ecrire = () => {
        const saisie = tr.querySelector('[data-cle-valeur]').value.trim();
        const v = saisie === '' ? null : lireNombre(saisie);
        if (v === undefined) { ed.surMessage?.('Nombre invalide'); return; }
        const id = m.prochainId();
        m.modifier((d) => ecrireCle(d, source, { vfr_cible: 'LIGNE', vfr_lig_id: l.lig_id }, mode.valeurCombo || 'M', v, () => id), 'Clé de frais annexes');
      };
      tr.querySelector('[data-cle-valeur]').addEventListener('change', ecrire);
      mode.addEventListener('change', () => { if (tr.querySelector('[data-cle-valeur]').value.trim() !== '') ecrire(); });
    });
  }
}
