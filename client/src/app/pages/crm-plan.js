import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDate } from '@logibtp/socle/ui';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { api } from '../api.js';
import { zoneRiche, lienElement } from '../crm/crm.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { extraireNomPlan, caseTerrainPlan } from '@logibtp/crm';
import { pastillePlan } from './crm-plans.js';

/** Indice affiché : l'indice vide est le premier (avant A). */
export const libelleIndice = (i) => (i ? texte('crm_btp.plan.indice', { indice: i }) : texte('crm_btp.plan.premier_indice'));
/** Nom du répertoire de la GED d'un indice (sous l'élément crm_plan). */
const nomRepertoire = (i) => (i ? texte('crm_btp.plan.indice', { indice: i }) : texte('crm_btp.plan.repertoire_vide'));

/**
 * Plan ou pièce technique (module CRM, suivi des validations) : `/crm/plan/<id>` ou
 * `/crm/plan/nouveau?type_element=&id_element=`. Repère, repère CCTP, nom, lot, finition, case « Terrain », message ; indices (A, B…)
 * avec date de diffusion, motif et fichiers (pièces du plan dans la GED, un répertoire par indice ; l'indice vide est le
 * premier) ; visas attendus et reçus par tiers ; notes. Création : fichiers déposés avec le plan, repère, nom et indice
 * lus dans le nom du premier fichier selon le format des paramètres du CRM (`extraireNomPlan`).
 */
export class PagePlanCrm extends PageBase {
  icone = icone('crm_btp_plans');

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    [this.statuts, this.parametres] = await Promise.all([api.crm.statutsVisa(), api.crm.parametres().catch(() => ({}))]);
    this.fichiersNouveaux = [];
    if (this.params.id === 'nouveau') {
      this.detail = null;
      const r = this.requete;
      this.saisie = { repere: '', repere_cctp: '', nom: '', lot: '', finition: '', terrain: false, message_html: null, type_element: r.type_element ?? null, id_element: r.id_element ?? null, indice: '' };
      this.element = r.type_element ? (await api.crm.elements([{ type: r.type_element, id: String(r.id_element) }]))[0] : null;
      this.titre = texte('crm_btp.plans.nouveau');
    } else await this.charger(Number(this.params.id));
    await this.rendre();
  }

  async charger(id) {
    this.detail = await api.crm.plan(id);
    const p = this.detail.plan;
    this.saisie = { repere: p.repere, repere_cctp: p.repere_cctp ?? '', nom: p.nom, lot: p.lot ?? '', finition: p.finition ?? '', terrain: Boolean(p.terrain), message_html: p.message_html,
      type_element: p.type_element, id_element: p.id_element, maj_le: p.maj_le };
    this.element = p.element;
    this.titre = `${p.repere} – ${p.nom}`;
    this.modifie = false;
  }

  urlCourante() { return this.detail ? `/crm/plan/${this.detail.plan.id}` : null; }

  async rendre() {
    const d = this.detail;
    const s = this.saisie;
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-note">
      <h1 class="page-titre">${iconeHtml('crm_btp_plans')} ${echapper(d ? `${d.plan.repere} – ${d.plan.nom}` : texte('crm_btp.plans.nouveau'))} ${d ? pastillePlan(d.plan.etat) : ''}</h1>
      <div class="boutons crm-actions"><button type="button" class="principal" data-enregistrer title="${texteHtml('crm_btp.commun.enregistrer_titre')}">${texteHtml('commun.enregistrer')}</button>
        ${d ? `<button type="button" data-diffuser title="${texteHtml('crm_btp.plan.diffuser_titre')}">${iconeHtml('crm_btp_bordereaux')} ${texteHtml('crm_btp.plan.diffuser')}</button><button type="button" data-supprimer>${texteHtml('commun.supprimer')}</button>` : ''}
        ${this.element ? `<span>${texteHtml('crm_btp.diffusion.rattache')} ${lienElement(this.element)}</span>` : ''}</div>
      <div class="crm-note-grille"><section class="crm-note-principal">
        <div class="formulaire crm-formulaire">
          <label>${texteHtml('crm_btp.plans.repere')} <input data-c="repere" maxlength="40" value="${echapper(s.repere)}"></label>
          <label>${texteHtml('crm_btp.plans.nom')} <input data-c="nom" maxlength="200" value="${echapper(s.nom)}"></label>
          <label>${texteHtml('crm_btp.plans.lot')} <input data-c="lot" maxlength="80" value="${echapper(s.lot)}"></label>
          <label>${texteHtml('crm_btp.plans.repere_cctp')} <input data-c="repere_cctp" maxlength="40" value="${echapper(s.repere_cctp)}"></label>
          <label>${texteHtml('crm_btp.plan.finition')} <input data-c="finition" maxlength="120" value="${echapper(s.finition)}" placeholder="${texteHtml('crm_btp.plan.finition_aide')}"></label>
          ${caseTerrainPlan(s.terrain)}
          ${d ? '' : `<label>${texteHtml('crm_btp.plans.indice')} <input data-c="indice" maxlength="5" size="5" value="${echapper(s.indice)}" placeholder="${texteHtml('crm_btp.plan.indice_aide')}" title="${texteHtml('crm_btp.plan.indice_titre')}"></label>`}
        </div>
        ${d ? '' : `<div class="crm-depot" data-depot-plan><label class="crm-photos"><input type="file" data-fichiers-plan multiple hidden>${iconeHtml('crm_btp_fichiers')} ${texteHtml('crm_btp.plan.fichiers')}</label>
          <span class="aide">${texteHtml('crm_btp.plan.depot', { format: this.parametres?.format_plan ?? '' })}</span>
          <ul class="crm-liens" data-liste-fichiers></ul></div>`}
        <div data-message></div>
        ${d ? `<h2>${texteHtml('crm_btp.plan.indices')}</h2>
          <p class="aide">${texteHtml('crm_btp.plan.en_vigueur')} <b>${echapper(d.plan.etat.en_vigueur === '' ? libelleIndice('') : d.plan.etat.en_vigueur ?? texte('crm_btp.plan.aucun_bpe'))}</b>${d.plan.etat.manquants ? ` · ${echapper(pluriel('crm_btp.plan.visas_attendus', d.plan.etat.manquants))}` : ''}${d.plan.etat.retards ? ` · <span class="crm-retard">${texteHtml('crm_btp.plan.en_retard', { nombre: d.plan.etat.retards })}</span>` : ''}</p>
          <div data-indices></div>
          <div class="crm-ajout-rappel"><input data-nouvel-indice size="4" placeholder="${texteHtml('crm_btp.plans.indice')}" title="${texteHtml('crm_btp.plan.indice_suivant')}"> <input type="date" data-date-indice title="${texteHtml('crm_btp.plan.date_titre')}">
            <input data-motif-indice size="28" placeholder="${texteHtml('crm_btp.plan.motif')}"> <span data-fichier-indice></span>
            <label class="crm-photos" title="${texteHtml('crm_btp.plan.fichiers_indice_titre')}"><input type="file" data-fichiers-indice multiple hidden>${iconeHtml('crm_btp_fichiers')} ${texteHtml('crm_btp.plan.fichiers_indice')}</label><span data-nb-fichiers class="aide"></span>
            <button type="button" data-ajouter-indice>${iconeHtml('ajouter')} ${texteHtml('crm_btp.plans.indice')}</button></div>
          <h2>${texteHtml('crm_btp.routes.suivi')}</h2><div data-suivi></div>` : `<p class="aide">${texteHtml('crm_btp.plan.apres')}</p>`}
      </section><aside class="crm-note-cote">${d ? `<h2>${texteHtml('crm_btp.plan.pieces')}</h2><div data-pieces class="crm-pieces"></div>` : ''}</aside></div></div>`;
    const $ = (sel) => this.conteneur.querySelector(sel);
    this.conteneur.querySelectorAll('input[data-c]').forEach((i) => i.addEventListener('input', () => { s[i.dataset.c] = i.value; this.modifie = true; }));
    $('[data-terrain]').addEventListener('change', (e) => { s.terrain = e.target.checked; this.modifie = true; });
    if (!d) this.brancherFichiersNouveaux();
    this.message = zoneRiche(s.message_html, { surChange: () => { this.modifie = true; } });
    $('[data-message]').replaceWith(this.message.element);
    $('[data-enregistrer]').addEventListener('click', () => this.enregistrer());
    $('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('crm_btp.plan.supprimer_confirmer'))) return;
      try { await api.crm.supprimerPlan(d.plan.id); this.modifie = false; this.app.publier(SUJET_FENETRE.CRM, {}); this.app.routeur.retour('/crm/plans'); } catch (e) { this.app.erreur(e); }
    });
    $('[data-diffuser]')?.addEventListener('click', () => this.app.naviguer(`/crm/diffusion/nouveau?plans=${d.plan.id}${s.type_element ? `&type_element=${encodeURIComponent(s.type_element)}&id_element=${encodeURIComponent(s.id_element)}` : ''}`));
    if (!d) return;
    const sv = await this.app.services();
    this.pieces = await sv.ged.lister({ type_element: 'crm_plan', id_element: String(d.plan.id) }).catch(() => []);
    this.fichiers = this.pieces.map((x) => ({ valeur: x.id, libelle: x.titre }));
    this.rendreIndices();
    const fichier = creerCombo({ options: this.fichiers, titre: texte('crm_btp.plan.fichier_indice') });
    $('[data-fichier-indice]').replaceWith(fichier);
    $('[data-fichiers-indice]').addEventListener('change', (e) => { const n = e.target.files.length; $('[data-nb-fichiers]').textContent = n ? pluriel('crm_btp.plan.nb_fichiers', n) : ''; });
    $('[data-ajouter-indice]').addEventListener('click', () => this.appliquer(async () => {
      const fichiers = [...$('[data-fichiers-indice]').files];
      let r = await api.crm.ajouterIndice(d.plan.id, {
        indice: $('[data-nouvel-indice]').value.trim() || null, date: $('[data-date-indice]').value || null, motif: $('[data-motif-indice]').value.trim() || null,
        dge_id: fichier.valeurCombo === '' ? null : Number(fichier.valeurCombo),
      });
      if (fichiers.length) r = await this.deposerIndice(r, r.indices[r.indices.length - 1], fichiers);
      return r;
    }));
    this.ged = new ExplorateurGed($('[data-pieces]'), {
      fournisseur: sv.ged, contexte: { type_element: 'crm_plan', id_element: String(d.plan.id), libelle: d.plan.repere, icone: icone('crm_btp_plans') }, compact: true,
      ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }), modifiable: true, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(),
      message: (t, n) => this.app.message(t, n),
    });
    this.suivi?.fermer();
    this.suivi = new PanneauSuivi($('[data-suivi]'), { app: this.app, type: 'crm_plan', id: d.plan.id, libelle: d.plan.repere });
    this.suivi.ouvrir().catch((e) => this.app.erreur(e));
  }

  rendreIndices() {
    const zone = this.conteneur.querySelector('[data-indices]');
    const indices = [...this.detail.indices].reverse();
    const titre = (id) => this.pieces.find((x) => x.id === id)?.titre ?? (id ? texte('crm_btp.plan.document', { id }) : '');
    zone.innerHTML = indices.length ? indices.map((i) => `<div class="crm-indice" data-indice="${i.id}">
      <div class="crm-indice-entete"><b>${echapper(libelleIndice(i.indice))}</b> <span class="aide">${i.date ? texteHtml('crm_btp.plan.diffuse_le', { date: formatDate(i.date) }) : texteHtml('crm_btp.plan.a_diffuser')}${i.motif ? ` · ${echapper(i.motif)}` : ''}</span>
        ${i.dge_id ? `<a href="/ged/${i.dge_id}">${iconeHtml('crm_btp_document')} ${echapper(titre(i.dge_id))}</a>` : ''}
        <label class="crm-photos" title="${texteHtml('crm_btp.plan.ajouter_fichiers')}"><input type="file" data-fichiers-de="${i.id}" multiple hidden>${iconeHtml('crm_btp_fichiers')}</label>
        <button type="button" data-supprimer-indice="${i.id}" title="${texteHtml('crm_btp.plan.supprimer_indice')}">${iconeHtml('retirer')}</button></div>
      ${(() => { const f = this.pieces.filter((x) => i.rge_id && x.repertoire_id === i.rge_id && x.id !== i.dge_id); return f.length ? `<ul class="crm-liens">${f.map((x) => `<li>${iconeHtml('crm_btp_document')} <a href="/ged/${x.id}">${echapper(x.titre)}</a></li>`).join('')}</ul>` : ''; })()}
      ${i.visas.length ? `<table class="crm-table"><thead><tr><th>${texteHtml('crm_btp.demandes.tiers')}</th><th>${texteHtml('crm_btp.plan.attendu_le')}</th><th>${texteHtml('crm_btp.diffusion.visa')}</th><th>${texteHtml('crm_btp.plan.recu_le')}</th><th>${texteHtml('crm_btp.plan.observation')}</th><th>${texteHtml('crm_btp.plan.retour')}</th><th></th></tr></thead><tbody>
        ${i.visas.map((v) => `<tr data-visa="${v.id}"><td>${lienElement(v.tiers)}${v.contact ? `<br><small>${lienElement(v.contact)}</small>` : ''}${v.diffusion_numero ? `<br><small class="aide">${echapper(v.diffusion_numero)}</small>` : ''}</td>
          <td class="${!v.statut && v.attendu_le && v.attendu_le < aujourdhui() ? 'crm-retard' : ''}">${formatDate(v.attendu_le)}</td>
          <td><span data-statut></span></td><td><input type="date" data-recu value="${v.recu_le ?? ''}"></td>
          <td><input data-observation size="22" value="${echapper(v.observation ?? '')}"></td><td><span data-retour></span></td>
          <td><button type="button" data-enregistrer-visa title="${texteHtml('crm_btp.plan.enregistrer_visa')}">${iconeHtml('crm_btp_lu')}</button><button type="button" data-supprimer-visa title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('crm_btp.plan.aucun_visa')}</p>`}
      <div class="crm-ajout-rappel"><button type="button" data-ajouter-visa title="${texteHtml('crm_btp.plan.ajouter_visa_titre')}">${iconeHtml('ajouter')} ${texteHtml('crm_btp.plan.ajouter_visa')}</button> <input type="date" data-attendu title="${texteHtml('crm_btp.plan.attendu_le')}"></div></div>`).join('')
      : `<p class="aide">${texteHtml('crm_btp.plan.aucun_indice')}</p>`;
    for (const i of this.detail.indices) {
      const bloc = zone.querySelector(`[data-indice="${i.id}"]`);
      bloc.querySelector('[data-fichiers-de]').addEventListener('change', (e) => {
        const fichiers = [...e.target.files];
        if (fichiers.length) this.appliquer(() => this.deposerIndice(this.detail, i, fichiers), pluriel('crm_btp.plan.fichiers_ajoutes', fichiers.length));
      });
      bloc.querySelector('[data-supprimer-indice]').addEventListener('click', async () => { if (await confirmer(texte('crm_btp.plan.supprimer_indice_confirmer', { indice: libelleIndice(i.indice) }))) this.appliquer(() => api.crm.supprimerIndice(i.id)); });
      bloc.querySelector('[data-ajouter-visa]').addEventListener('click', async () => {
        const { annuaire } = await this.app.services();
        const p = await choisirPersonne({ annuaire, titre: texte('crm_btp.plan.visa_titre', { indice: libelleIndice(i.indice).toLowerCase() }) });
        if (p) this.appliquer(() => api.crm.ajouterVisa(i.id, { tiers_id: p.id, ind_id: null, attendu_le: bloc.querySelector('[data-attendu]').value || null }));
      });
      for (const v of i.visas) {
        const tr = bloc.querySelector(`[data-visa="${v.id}"]`);
        const statut = creerCombo({ options: this.statuts.filter((x) => x.actif || x.code === v.statut).map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: v.statut ?? '', titre: texte('crm_btp.plan.statut_vide') });
        tr.querySelector('[data-statut]').replaceWith(statut);
        const retour = creerCombo({ options: this.fichiers, valeur: v.dge_retour_id ?? '', titre: texte('crm_btp.plan.retour_titre') });
        tr.querySelector('[data-retour]').replaceWith(retour);
        tr.querySelector('[data-enregistrer-visa]').addEventListener('click', () => this.appliquer(() => api.crm.saisirVisa(v.id, {
          statut: statut.valeurCombo === '' ? null : statut.valeurCombo, recu_le: tr.querySelector('[data-recu]').value || null,
          observation: tr.querySelector('[data-observation]').value || null, dge_retour_id: retour.valeurCombo === '' ? null : Number(retour.valeurCombo),
        }), texte('crm_btp.plan.visa_enregistre')));
        tr.querySelector('[data-supprimer-visa]').addEventListener('click', () => this.appliquer(() => api.crm.supprimerVisa(v.id)));
      }
    }
  }

  async appliquer(f, message = null) {
    try {
      this.detail = await f();
      this.app.publier(SUJET_FENETRE.CRM, { plan: this.detail.plan.id });
      if (message) this.app.message(message, 'succes');
      await this.charger(this.detail.plan.id);
      await this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  async enregistrer() {
    this.saisie.message_html = this.message?.valeur() ?? null;
    try {
      const nouveau = !this.detail;
      if (nouveau && !this.saisie.nom.trim() && this.fichiersNouveaux.length) this.saisie.nom = this.fichiersNouveaux[0].name.replace(/\.[^.]+$/, '');
      const r = nouveau ? await api.crm.creerPlan(this.saisie) : await api.crm.enregistrerPlan(this.detail.plan.id, this.saisie);
      if (nouveau && this.fichiersNouveaux.length) {
        // Premier indice (celui saisi, vide par défaut) et ses fichiers dans son répertoire de la GED.
        const avecIndice = await api.crm.ajouterIndice(r.plan.id, { indice: this.saisie.indice?.trim() || null, date: null, motif: null, dge_id: null });
        await this.deposerIndice(avecIndice, avecIndice.indices[avecIndice.indices.length - 1], this.fichiersNouveaux);
        this.fichiersNouveaux = [];
      }
      await this.charger(r.plan.id);
      if (nouveau) this.app.routeur.remplacerUrl(`/crm/plan/${r.plan.id}`);
      this.app.publier(SUJET_FENETRE.CRM, { plan: r.plan.id });
      this.app.message(texte('crm_btp.plan.enregistre'), 'succes');
      await this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  /** Fichiers choisis ou glissés à la création : le premier préremplit repère, nom et indice (format des paramètres). */
  brancherFichiersNouveaux() {
    const zone = this.conteneur.querySelector('[data-depot-plan]');
    const s = this.saisie;
    const ajouter = (fichiers) => {
      if (!fichiers.length) return;
      const premier = !this.fichiersNouveaux.length;
      this.fichiersNouveaux.push(...fichiers);
      this.modifie = true;
      if (premier) {
        const lu = extraireNomPlan(fichiers[0].name, this.parametres?.format_plan || undefined);
        const champs = lu ?? { nom: fichiers[0].name.replace(/\.[^.]+$/, '') };
        for (const c of ['repere', 'nom', 'lot', 'indice']) {
          if (!champs[c] || String(s[c] ?? '').trim()) continue;
          s[c] = champs[c];
          const input = this.conteneur.querySelector(`input[data-c="${c}"]`);
          if (input) input.value = champs[c];
        }
      }
      zone.querySelector('[data-liste-fichiers]').innerHTML = this.fichiersNouveaux.map((f) => `<li>${iconeHtml('crm_btp_document')} ${echapper(f.name)}</li>`).join('');
    };
    zone.querySelector('[data-fichiers-plan]').addEventListener('change', (e) => ajouter([...e.target.files]));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); ajouter([...e.dataTransfer.files]); });
  }

  /**
   * Fichiers d'un indice : répertoire de la GED de l'indice (créé au besoin sous l'élément crm_plan et retenu sur
   * l'indice), dépôt des fichiers ; le premier devient le fichier de l'indice s'il n'en a pas. Renvoie le plan relu.
   */
  async deposerIndice(detail, indice, fichiers) {
    const { ged } = await this.app.services();
    const plan = detail.plan.id;
    let rge = indice.rge_id;
    if (!rge) {
      const existants = await ged.repertoires({ type_element: 'crm_plan', id_element: String(plan) });
      rge = existants.find((x) => !x.parent_id && x.nom.toLowerCase() === nomRepertoire(indice.indice).toLowerCase())?.id
        ?? (await ged.creerRepertoire({ nom: nomRepertoire(indice.indice), type_element: 'crm_plan', id_element: String(plan) })).id;
    }
    let premier = null;
    for (const f of fichiers) {
      const doc = await ged.deposer({ fichier: f, nom_fichier: f.name, meta: { titre: f.name, categorie: 'crm', type_element: 'crm_plan', id_element: String(plan), repertoire_id: rge } });
      premier ??= doc?.id ?? null;
    }
    return api.crm.modifierIndice(indice.id, { date: indice.date, motif: indice.motif, dge_id: indice.dge_id ?? premier, rge_id: rge });
  }

  fermer() { this.suivi?.fermer(); }
}
