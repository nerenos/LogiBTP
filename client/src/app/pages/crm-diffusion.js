import { texte, texteHtml, pluriel, icone, iconeHtml, pairesParCode } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, formatDate } from '@logibtp/socle/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';

/** Modes de diffusion (crm_diffusion_destinataire.dfd_mode). */
export const MODES_DIFFUSION = pairesParCode('crm_btp.modes_diffusion', ['COURRIEL', 'PAPIER', 'PLATEFORME', 'MAIN_PROPRE']).map(([valeur, libelle]) => ({ valeur, libelle }));

/** Fonctions d'intervenant qui visent les plans par défaut. */
const VISEURS = ['ARCHITECTE', 'MOE', 'MAITRE_OEUVRE', 'BUREAU_CONTROLE', 'CONTROLEUR', 'BET', 'CLIENT', 'MAITRE_OUVRAGE', 'MOA'];

const STRUCTURE = ['projet', 'affaire', 'chantier', 'marche'];

/**
 * Bordereau de diffusion (module CRM) : `/crm/diffusion/nouveau?plans=1,2&type_element=&id_element=` (saisie) ou
 * `/crm/diffusion/<id>` (consultation, impression). Pièces = dernier indice des plans choisis ; destinataires proposés
 * depuis les intervenants de l'élément ; ceux qui visent reçoivent des visas attendus et une tâche de retour.
 */
export class PageDiffusionCrm extends PageBase {
  icone = icone('crm_btp_bordereaux');

  get modifiee() { return Boolean(this.saisie && this.modifie); }

  async ouvrir() {
    const app = this.app;
    if (this.params.id === 'nouveau') await this.preparer();
    else {
      this.diffusion = await api.crm.diffusion(Number(this.params.id));
      this.titre = `${this.diffusion.numero} – ${this.diffusion.objet}`;
      this.rendreBordereau();
    }
  }

  urlCourante() { return this.diffusion ? `/crm/diffusion/${this.diffusion.id}` : null; }

  async preparer() {
    const r = this.requete;
    this.element = r.type_element && r.id_element ? { type: r.type_element, id: String(r.id_element) } : null;
    const [e] = this.element ? await api.crm.elements([this.element]) : [null];
    const plans = await Promise.all(String(r.plans ?? '').split(',').filter(Boolean).map((id) => api.crm.plan(Number(id))));
    this.pieces = plans.filter((p) => p.indices.length).map((p) => {
      const i = p.indices[p.indices.length - 1];
      return { pin_id: i.id, libelle: `${p.plan.repere} – ${p.plan.nom} – ${i.indice ? texte('crm_btp.diffusion.indice', { indice: i.indice }) : texte('crm_btp.diffusion.premier_indice')}`, choisi: true };
    });
    this.destinataires = [];
    if (this.element && STRUCTURE.includes(this.element.type)) {
      const intervenants = await api.structureIntervenants(this.element.type, this.element.id).catch(() => []);
      for (const x of intervenants.filter((y) => y.per_id)) {
        if (this.destinataires.some((d) => d.tiers_id === x.per_id)) continue;
        this.destinataires.push({ tiers_id: x.per_id, tiers: x.tiers, ind_id: x.ind_id ?? null, contact: x.contact ?? null, fonction: x.fonction, mode: 'COURRIEL', exemplaires: 1, attend_visa: VISEURS.includes(x.fonction) });
      }
    }
    this.saisie = { date: aujourdhui(), objet: (e ? texte('crm_btp.diffusion.objet_element', { libelle: e.libelle }) : texte('crm_btp.diffusion.objet')).slice(0, 200), delai_visa_jours: 15 };
    this.titre = texte('crm_btp.diffusion.nouveau');
    this.rendreSaisie(e);
  }

  rendreSaisie(e) {
    const s = this.saisie;
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">${iconeHtml('crm_btp_bordereaux')} ${texteHtml('crm_btp.diffusion.nouveau')}</h1>
      ${e ? `<p>${texteHtml('crm_btp.diffusion.rattache')} ${lienElement(e)}</p>` : ''}
      <div class="formulaire crm-formulaire"><label>${texteHtml('crm_btp.liste.objet')} <input data-s="objet" maxlength="200" value="${echapper(s.objet)}"></label>
        <label>${texteHtml('crm_btp.diffusions.date')} <input type="date" data-s="date" value="${s.date}"></label>
        <label>${texteHtml('crm_btp.diffusion.delai')} <input data-s="delai_visa_jours" size="4" inputmode="numeric" value="${s.delai_visa_jours}"></label></div>
      <h2>${texteHtml('crm_btp.diffusions.pieces')}</h2>${this.pieces.length ? `<ul class="crm-liens">${this.pieces.map((p, i) => `<li><label><input type="checkbox" data-piece="${i}" ${p.choisi ? 'checked' : ''}> ${iconeHtml('crm_btp_plans')} ${echapper(p.libelle)}</label></li>`).join('')}</ul>`
        : `<p class="aide">${texteHtml('crm_btp.diffusion.aucune_piece')}</p>`}
      <h2>${texteHtml('crm_btp.diffusions.destinataires')}</h2><div data-destinataires></div>
      <div class="boutons"><button type="button" data-ajouter title="${texteHtml('crm_btp.diffusion.ajouter_titre')}">${iconeHtml('ajouter')} ${texteHtml('crm_btp.diffusion.ajouter')}</button>
        <button type="button" class="principal" data-creer>${texteHtml('crm_btp.diffusion.creer')}</button></div></div>`;
    this.modifie = true;
    this.conteneur.querySelectorAll('[data-s]').forEach((i) => i.addEventListener('input', () => { s[i.dataset.s] = i.dataset.s === 'delai_visa_jours' ? Number(i.value) || 0 : i.value; }));
    this.conteneur.querySelectorAll('[data-piece]').forEach((c) => c.addEventListener('change', () => { this.pieces[Number(c.dataset.piece)].choisi = c.checked; }));
    this.conteneur.querySelector('[data-ajouter]').addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const p = await choisirPersonne({ annuaire, titre: texte('crm_btp.diffusion.destinataire_titre'), exclure: this.destinataires.map((d) => d.tiers_id) });
      if (p) { this.destinataires.push({ tiers_id: p.id, tiers: p.nom_commercial || p.raison_sociale, ind_id: null, contact: null, mode: 'COURRIEL', exemplaires: 1, attend_visa: false }); this.rendreDestinataires(); }
    });
    this.conteneur.querySelector('[data-creer]').addEventListener('click', () => this.creer());
    this.rendreDestinataires();
  }

  rendreDestinataires() {
    const zone = this.conteneur.querySelector('[data-destinataires]');
    zone.innerHTML = this.destinataires.length ? `<table class="crm-table"><thead><tr><th>${texteHtml('crm_btp.demandes.tiers')}</th><th>${texteHtml('crm_btp.demande.contact')}</th><th>${texteHtml('crm_btp.diffusion.mode')}</th><th>${texteHtml('crm_btp.diffusion.exemplaires')}</th><th>${texteHtml('crm_btp.diffusion.vise')}</th><th></th></tr></thead><tbody>
      ${this.destinataires.map((d, i) => `<tr data-i="${i}"><td>${echapper(d.tiers ?? `#${d.tiers_id}`)}${d.fonction ? ` <small class="aide">${echapper(d.fonction)}</small>` : ''}</td><td>${echapper(d.contact ?? '')}</td>
        <td><span data-mode></span></td><td><input data-exemplaires size="3" value="${d.exemplaires}"></td><td><input type="checkbox" data-visa ${d.attend_visa ? 'checked' : ''}></td>
        <td><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('crm_btp.diffusion.aucun_destinataire')}</p>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const d = this.destinataires[Number(tr.dataset.i)];
      const mode = creerCombo({ options: MODES_DIFFUSION, valeur: d.mode, vide: false });
      mode.addEventListener('change', () => { d.mode = mode.valeurCombo; });
      tr.querySelector('[data-mode]').replaceWith(mode);
      tr.querySelector('[data-exemplaires]').addEventListener('input', (e) => { d.exemplaires = Math.max(0, Number(e.target.value) || 0); });
      tr.querySelector('[data-visa]').addEventListener('change', (e) => { d.attend_visa = e.target.checked; });
      tr.querySelector('[data-retirer]').addEventListener('click', () => { this.destinataires.splice(Number(tr.dataset.i), 1); this.rendreDestinataires(); });
    });
  }

  async creer() {
    const s = this.saisie;
    try {
      const d = await api.crm.creerDiffusion({
        date: s.date, objet: s.objet, type_element: this.element?.type ?? null, id_element: this.element?.id ?? null, delai_visa_jours: s.delai_visa_jours,
        pieces: this.pieces.filter((p) => p.choisi).map((p) => ({ pin_id: p.pin_id, dge_id: null, libelle: p.libelle })),
        destinataires: this.destinataires.map((x) => ({ tiers_id: x.tiers_id, ind_id: x.ind_id, mode: x.mode, exemplaires: x.exemplaires, attend_visa: x.attend_visa })),
      });
      this.modifie = false;
      this.saisie = null;
      this.diffusion = d;
      this.titre = `${d.numero} – ${d.objet}`;
      this.app.routeur.remplacerUrl(`/crm/diffusion/${d.id}`);
      this.app.publier(SUJET_FENETRE.CRM, { diffusion: d.id });
      this.app.message(texte('crm_btp.diffusion.cree'), 'succes');
      this.rendreBordereau();
    } catch (e) { this.app.erreur(e); }
  }

  /** Bordereau en consultation, imprimable (la page d'impression masque le bandeau et les boutons). */
  rendreBordereau() {
    const d = this.diffusion;
    const mode = (m) => MODES_DIFFUSION.find((x) => x.valeur === m)?.libelle ?? m;
    this.conteneur.innerHTML = `<div class="page-parametres crm-bordereau">
      <div class="boutons crm-actions"><button type="button" class="principal" data-imprimer title="${texteHtml('crm_btp.diffusion.imprimer_titre')}">${iconeHtml('crm_btp_imprimer')} ${texteHtml('crm_btp.diffusion.imprimer')}</button>
        <button type="button" data-courriel title="${texteHtml('crm_btp.diffusion.courriel_titre')}">${iconeHtml('crm_btp_courriel')} ${texteHtml('crm_btp.diffusion.courriel')}</button>
        ${d.element ? `<a href="/crm/diffusions?type=${encodeURIComponent(d.type_element)}&id=${encodeURIComponent(d.id_element)}">${texteHtml('crm_btp.diffusion.autres')}</a>` : ''}</div>
      <h1 class="page-titre">${texteHtml('crm_btp.diffusion.titre', { numero: d.numero })}</h1>
      <p><b>${echapper(d.objet)}</b><br>${texteHtml('crm_btp.diffusion.date_le', { date: formatDate(d.date) })}${d.element ? ` · ${lienElement(d.element)}` : ''} · ${texteHtml('crm_btp.diffusion.emis_par', { nom: d.cree_par })}</p>
      <h2>${texteHtml('crm_btp.diffusion.pieces_diffusees')}</h2><table class="crm-table"><thead><tr><th>${texteHtml('crm_btp.demandes.numero')}</th><th>${texteHtml('crm_btp.diffusion.piece')}</th></tr></thead><tbody>
        ${d.pieces.map((p, i) => `<tr><td>${i + 1}</td><td>${p.plan_id ? `<a href="/crm/plan/${p.plan_id}">${echapper(p.libelle)}</a>` : echapper(p.libelle)}</td></tr>`).join('')}</tbody></table>
      <h2>${texteHtml('crm_btp.diffusions.destinataires')}</h2><table class="crm-table"><thead><tr><th>${texteHtml('crm_btp.diffusion.destinataire')}</th><th>${texteHtml('crm_btp.demande.contact')}</th><th>${texteHtml('crm_btp.diffusion.mode')}</th><th class="nombre">${texteHtml('crm_btp.diffusion.ex')}</th><th>${texteHtml('crm_btp.diffusion.visa')}</th></tr></thead><tbody>
        ${d.destinataires.map((x) => `<tr><td>${lienElement(x.tiers)}</td><td>${lienElement(x.contact)}</td><td>${echapper(mode(x.mode))}</td><td class="nombre">${x.exemplaires}</td>
          <td>${x.attend_visa ? `${texteHtml('crm_btp.diffusion.attendu', { jours: d.delai_visa_jours })}${x.visas_attendus ? ` · ${echapper(pluriel('crm_btp.diffusion.recus', x.visas_attendus, { recus: x.visas_recus }))}` : ''}${x.note_id ? ` · <a href="/crm/note/${x.note_id}" class="crm-ecran">${texteHtml('crm_btp.diffusion.tache')}</a>` : ''}` : texteHtml('crm_btp.diffusion.information')}</td></tr>`).join('')}</tbody></table>
      <p class="crm-signature">${texteHtml('crm_btp.diffusion.signature')}</p></div>`;
    this.conteneur.querySelector('[data-imprimer]').addEventListener('click', () => window.print());
    this.conteneur.querySelector('[data-courriel]').addEventListener('click', () => this.app.naviguer(`/mail/nouveau?type=crm_diffusion&id=${this.params.id}`, { nouvelleFenetre: true }));
  }
}
