import { texte, texteHtml, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE, SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { choisirPersonne, choisirIndividu, creerTiersProvisoire } from '@logibtp/annuaire/ui';
import { ETATS_DEMANDE, MOTIFS_SANS_SUITE, controlerDemande, MESSAGES_DEMANDE } from '@logibtp/crm';
import { api } from '../api.js';
import { contexteCrm, individusCrm, zoneRiche, lienElement } from '../crm/crm.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { pastilleDemande } from './crm-demandes.js';

const QUOI = textesParCode('crm_btp.historique', ['CREATION', 'ETAT', 'RESPONSABLE', 'SERVICE']);
const libelleEtat = (v) => ETATS_DEMANDE.find((e) => e.valeur === v)?.libelle ?? v;

/**
 * Demande (module CRM) : `/crm/demande/<id>` ou `/crm/demande/nouveau?tiers=`. Pré-dossier de veille : objet, tiers
 * (existant ou nouveau tiers provisoire), contact, origine, service et responsable (ou à prendre), réponse attendue,
 * montant estimé, description ; notes, tâches et courriels (Suivi), pièces (GED), historique ; « Créer le projet »
 * (demande transformée, notes rattachées au projet), sans suite avec motif.
 */
export class PageDemandeCrm extends PageBase {
  icone = icone('crm_btp_demandes');

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    [this.ctx, this.individus] = await Promise.all([contexteCrm(app), individusCrm(app)]);
    if (this.params.id === 'nouveau') {
      this.detail = null;
      this.saisie = { objet: '', description_html: null, etat: 'VEILLE', motif: null, tiers_id: this.requete.tiers ? Number(this.requete.tiers) : null, ind_id: null,
        srv_id: this.ctx.services[0]?.id ?? null, responsable_id: null, echeance: null, montant_estime: null, origine: '' };
      this.tiers = this.saisie.tiers_id ? (await api.crm.elements([{ type: TYPE_FICHE.PERSONNE, id: String(this.saisie.tiers_id) }]))[0] : null;
      this.contact = null;
      this.titre = texte('crm_btp.demandes.nouvelle');
    } else await this.charger(Number(this.params.id));
    this.rendre();
  }

  async charger(id) {
    this.detail = await api.crm.demande(id);
    const d = this.detail.demande;
    this.saisie = { objet: d.objet, description_html: d.description_html, etat: d.etat, motif: d.motif, tiers_id: d.tiers_id, ind_id: d.ind_id, srv_id: d.srv_id,
      responsable_id: d.responsable_id, echeance: d.echeance, montant_estime: d.montant_estime, origine: d.origine ?? '', maj_le: d.maj_le };
    this.tiers = d.tiers;
    this.contact = d.contact;
    this.titre = `${d.numero} – ${d.objet}`;
    this.modifie = false;
  }

  urlCourante() { return this.detail ? `/crm/demande/${this.detail.demande.id}` : null; }

  marquer() { this.modifie = true; this.app.majPage?.(); }

  rendre() {
    const d = this.detail?.demande;
    const s = this.saisie;
    const droits = this.detail?.droits ?? { modifier: true, supprimer: false, prendre: false, rendre: false };
    const lecture = !droits.modifier;
    const ouverte = !['TRANSFORMEE', 'SANS_SUITE'].includes(d?.etat);
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-note">
      <h1 class="page-titre">${iconeHtml('crm_btp_demandes')} ${echapper(d ? `${d.numero} – ${d.objet}` : texte('crm_btp.demandes.nouvelle'))} ${d ? pastilleDemande(d) : ''}</h1>
      <div class="boutons crm-actions">
        ${lecture ? '' : `<button type="button" class="principal" data-enregistrer title="${texteHtml('crm_btp.commun.enregistrer_titre')}">${texteHtml('commun.enregistrer')}</button>`}
        ${droits.prendre ? `<button type="button" data-prendre>${texteHtml('crm_btp.liste.prendre')}</button>` : ''}
        ${droits.rendre ? `<button type="button" data-rendre>${texteHtml('crm_btp.commun.rendre')}</button>` : ''}
        ${d && ouverte && !lecture ? `<button type="button" data-projet title="${texteHtml('crm_btp.demande.projet_titre')}">${iconeHtml('crm_btp_projet')} ${texteHtml('crm_btp.demande.projet')}</button>` : ''}
        ${d?.cible ? `<span>${texteHtml('crm_btp.demande.projet_lie')} ${lienElement(d.cible)}</span>` : ''}
        ${droits.supprimer ? `<button type="button" data-supprimer title="${texteHtml('crm_btp.demande.supprimer_titre')}">${texteHtml('commun.supprimer')}</button>` : ''}
      </div>
      <div class="crm-note-grille">
        <section class="crm-note-principal">
          <label class="crm-objet">${texteHtml('crm_btp.liste.objet')} <input data-c="objet" maxlength="200" value="${echapper(s.objet)}" ${lecture ? 'disabled' : ''} placeholder="${texteHtml('crm_btp.demande.objet_aide')}"></label>
          <div class="formulaire crm-formulaire">
            <label>${texteHtml('crm_btp.demandes.tiers')} <span class="crm-tiers">${this.tiers ? lienElement(this.tiers) : `<span class="aide">${iconeHtml('crm_btp_aucun')}</span>`}
              ${lecture ? '' : `<button type="button" data-choisir-tiers title="${texteHtml('crm_btp.demande.choisir_tiers')}">${iconeHtml('crm_btp_choisir')}</button><button type="button" data-nouveau-tiers title="${texteHtml('crm_btp.demande.nouveau_tiers')}">${iconeHtml('ajouter')}</button>`}</span></label>
            <label>${texteHtml('crm_btp.demande.contact')} <span class="crm-tiers">${this.contact ? lienElement(this.contact) : `<span class="aide">${iconeHtml('crm_btp_aucun')}</span>`}
              ${lecture ? '' : `<button type="button" data-choisir-contact title="${texteHtml('crm_btp.demande.choisir_contact')}">${iconeHtml('crm_btp_choisir')}</button>`}${!lecture && this.contact ? `<button type="button" data-retirer-contact title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</span></label>
            <label>${texteHtml('crm_btp.demande.origine')} <input data-c="origine" maxlength="80" value="${echapper(s.origine ?? '')}" ${lecture ? 'disabled' : ''} placeholder="${texteHtml('crm_btp.demande.origine_aide')}"></label>
            <label>${texteHtml('crm_btp.liste.etat')} <span data-etat></span></label>
            <label data-zone-motif ${s.etat === 'SANS_SUITE' ? '' : 'hidden'}>${texteHtml('crm_btp.demande.motif')} <span data-motif></span></label>
            <label>${texteHtml('crm_btp.liste.service')} <span data-srv></span></label>
            <label>${texteHtml('crm_btp.liste.responsable')} <span data-responsable></span></label>
            <label>${texteHtml('crm_btp.demandes.reponse')} <input type="date" data-c="echeance" value="${s.echeance ?? ''}" ${lecture ? 'disabled' : ''}></label>
            <label>${texteHtml('crm_btp.demande.montant_ht')} <input data-c="montant_estime" inputmode="decimal" value="${s.montant_estime ?? ''}" ${lecture ? 'disabled' : ''}></label>
          </div>
          <div data-description></div>
          <div class="crm-erreurs erreur" hidden></div>
          ${d ? `<h2>${texteHtml('crm_btp.routes.suivi')}</h2><div data-suivi></div>` : `<p class="aide">${texteHtml('crm_btp.commun.suivi_apres')}</p>`}
        </section>
        <aside class="crm-note-cote">
          ${d ? `<h2>${texteHtml('crm_btp.diffusions.pieces')}</h2><div data-pieces class="crm-pieces"></div>` : ''}
          ${d ? `<h2>${texteHtml('crm_btp.commun.historique')}</h2><ul class="crm-historique">${this.detail.historique.map((h) => `<li><span class="aide">${echapper(formatDateHeure(h.le))} · ${echapper(h.par ?? '')}</span>
            ${echapper(QUOI[h.quoi] ?? h.quoi)} ${h.quoi === 'ETAT' || h.quoi === 'CREATION' ? `${h.avant ? `${echapper(libelleEtat(h.avant))} ${iconeHtml('crm_btp_vers')} ` : ''}${echapper(libelleEtat(h.apres ?? ''))}` : `${echapper(h.avant ?? icone('crm_btp_aucun'))} ${iconeHtml('crm_btp_vers')} ${echapper(h.apres ?? icone('crm_btp_aucun'))}`}</li>`).join('')}</ul>` : ''}
        </aside>
      </div></div>`;
    this.brancher(lecture);
  }

  brancher(lecture) {
    const $ = (sel) => this.conteneur.querySelector(sel);
    const s = this.saisie;
    const combo = (sel, cle, options, vide = true, apres = () => {}) => {
      const c = creerCombo({ options, valeur: s[cle] ?? '', vide });
      c.readOnly = lecture;
      c.addEventListener('change', () => { s[cle] = c.valeurCombo === '' ? null : (typeof options[0]?.valeur === 'number' ? Number(c.valeurCombo) : c.valeurCombo); this.marquer(); apres(); this.controler(); });
      $(sel).replaceWith(c);
    };
    // Transformée : seul « Créer le projet » y conduit (état non proposé à la saisie).
    combo('[data-etat]', 'etat', ETATS_DEMANDE.filter((e) => e.valeur !== 'TRANSFORMEE' || s.etat === 'TRANSFORMEE'), false, () => {
      $('[data-zone-motif]').hidden = s.etat !== 'SANS_SUITE';
      if (s.etat !== 'SANS_SUITE') s.motif = null;
    });
    combo('[data-motif]', 'motif', MOTIFS_SANS_SUITE);
    combo('[data-srv]', 'srv_id', this.ctx.tous_services.map((x) => ({ valeur: x.id, libelle: x.libelle })));
    combo('[data-responsable]', 'responsable_id', this.individus);
    this.conteneur.querySelectorAll('input[data-c]').forEach((i) => i.addEventListener('input', () => {
      const c = i.dataset.c;
      s[c] = c === 'montant_estime' ? (i.value.trim() === '' ? null : String(i.value).replace(',', '.').replace(/\s/g, '')) : (i.value === '' && c === 'echeance' ? null : i.value);
      this.marquer();
      this.controler();
    }));
    this.description = zoneRiche(s.description_html, { lecture, surChange: () => this.marquer() });
    $('[data-description]').replaceWith(this.description.element);
    $('[data-choisir-tiers]')?.addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const p = await choisirPersonne({ annuaire, titre: texte('crm_btp.demande.tiers_titre') });
      if (p) this.definirTiers(p);
    });
    $('[data-nouveau-tiers]')?.addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const p = await creerTiersProvisoire({ annuaire, casquettes: ['CLIENT'], titre: texte('crm_btp.demande.prospect_titre') });
      if (p) this.definirTiers(p);
    });
    $('[data-choisir-contact]')?.addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const r = await choisirIndividu({ annuaire, titre: texte('crm_btp.demande.contact_titre') });
      if (r?.individu) { s.ind_id = r.individu.id; this.contact = { type: TYPE_FICHE.INDIVIDU, id: String(r.individu.id), libelle: r.individu.nom_complet, icone: icone('annuaire_individu'), url: urlFiche(TYPE_FICHE.INDIVIDU, r.individu.id) }; this.marquer(); this.rendre(); } else if (r?.nouveau) this.app.message(texte('crm_btp.demande.contact_a_creer'), 'avertissement');
    });
    $('[data-retirer-contact]')?.addEventListener('click', () => { s.ind_id = null; this.contact = null; this.marquer(); this.rendre(); });
    $('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    $('[data-prendre]')?.addEventListener('click', () => this.action(() => api.crm.prendreDemande(this.detail.demande.id), texte('crm_btp.demandes.prise')));
    $('[data-rendre]')?.addEventListener('click', () => this.action(() => api.crm.rendreDemande(this.detail.demande.id), texte('crm_btp.demande.rendue')));
    $('[data-projet]')?.addEventListener('click', async () => {
      if (this.modifie) { this.app.message(texte('crm_btp.demande.enregistrer_avant'), 'avertissement'); return; }
      if (!await confirmer(texte('crm_btp.demande.projet_confirmer'))) return;
      await this.action(() => api.crm.creerProjet(this.detail.demande.id), texte('crm_btp.demande.projet_cree'));
    });
    $('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('crm_btp.demande.supprimer_confirmer'))) return;
      try { await api.crm.supprimerDemande(this.detail.demande.id); this.modifie = false; this.app.publier(SUJET_FENETRE.CRM, {}); this.app.routeur.retour('/crm/demandes'); } catch (e) { this.app.erreur(e); }
    });
    if (this.detail) {
      this.suivi?.fermer();
      this.suivi = new PanneauSuivi($('[data-suivi]'), { app: this.app, type: 'crm_demande', id: this.detail.demande.id, libelle: this.detail.demande.numero });
      this.suivi.ouvrir().catch((e) => this.app.erreur(e));
      this.app.services().then((sv) => {
        this.ged = new ExplorateurGed($('[data-pieces]'), {
          fournisseur: sv.ged, contexte: { type_element: 'crm_demande', id_element: String(this.detail.demande.id), libelle: this.detail.demande.numero, icone: icone('crm_btp_demandes') }, compact: true,
          ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }), modifiable: !lecture, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(),
          message: (t, n) => this.app.message(t, n),
        });
      });
    }
    this.controler();
  }

  definirTiers(p) {
    this.saisie.tiers_id = p.id;
    this.tiers = { type: TYPE_FICHE.PERSONNE, id: String(p.id), libelle: p.nom_commercial || p.raison_sociale, icone: icone('annuaire_personne'), url: urlFiche(TYPE_FICHE.PERSONNE, p.id) };
    this.marquer();
    this.rendre();
  }

  controler() {
    const zone = this.conteneur.querySelector('.crm-erreurs');
    const erreurs = controlerDemande({ ...this.saisie, cible_type: this.detail?.demande.cible?.type, cible_id: this.detail?.demande.cible?.id });
    if (zone) { zone.hidden = !erreurs.length || !this.modifie; zone.innerHTML = erreurs.map((e) => `<div>${iconeHtml('avertissement')} ${echapper(MESSAGES_DEMANDE[e] ?? e)}</div>`).join(''); }
    return erreurs;
  }

  async enregistrer() {
    if (!this.conteneur.querySelector('[data-enregistrer]')) return;
    this.saisie.description_html = this.description?.valeur() ?? null;
    this.modifie = true;
    if (this.controler().length) { this.app.message(texte('crm_btp.demande.incomplete'), 'avertissement'); return; }
    try {
      const nouveau = !this.detail;
      const s = { ...this.saisie, montant_estime: this.saisie.montant_estime === null ? null : this.saisie.montant_estime };
      const d = nouveau ? await api.crm.creerDemande(s) : await api.crm.enregistrerDemande(this.detail.demande.id, s);
      await this.apres(d, texte('crm_btp.demande.enregistree'));
      if (nouveau) this.app.routeur.remplacerUrl(`/crm/demande/${d.demande.id}`);
    } catch (e) { this.app.erreur(e); }
  }

  async apres(d, message) {
    this.detail = d;
    await this.charger(d.demande.id);
    this.app.publier(SUJET_FENETRE.CRM, { demande: d.demande.id });
    this.app.message(message, 'succes');
    this.rendre();
  }

  async action(f, message) {
    if (this.modifie && !await confirmer(texte('crm_btp.commun.perdues'))) return;
    try { await this.apres(await f(), message); } catch (e) { this.app.erreur(e); }
  }

  fermer() { this.suivi?.fermer(); }
}
