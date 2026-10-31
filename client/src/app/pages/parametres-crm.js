import { texte, texteHtml, icone, iconeHtml, pairesParCode } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { FORMAT_PLAN_DEFAUT, analyserFormatPlan, extraireNomPlan } from '@logibtp/crm';
import { api } from '../api.js';
import { contexteCrm } from '../crm/crm.js';

/**
 * Paramétrage du CRM (administrateur) : types de notes (appel, courriel, visite…), globaux ou propres à un service ;
 * un type retiré déjà utilisé est désactivé.
 */
export class PageParametresCrm extends PageBase {
  icone = icone('crm_btp_suivi');

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('crm_btp.routes.parametres_crm');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('crm_btp_suivi')} ${texteHtml('crm_btp.routes.parametres_crm')}</h1><h2>${texteHtml('crm_btp.parametres.types')}</h2><div data-types></div>
      <h2>${texteHtml('crm_btp.parametres.couleurs')}</h2><div data-seuils></div>
      <h2>${texteHtml('crm_btp.parametres.format')}</h2><div data-format-plan></div>
      <h2>${texteHtml('crm_btp.parametres.statuts')}</h2><div data-statuts></div></div>`;
    this.ctx = await contexteCrm(app);
    this.types = await api.crm.typesNotes();
    this.rendreTypes();
    const parametres = await api.crm.parametres();
    this.rendreSeuils(parametres);
    this.rendreFormatPlan(parametres);
    this.statuts = await api.crm.statutsVisa();
    this.rendreStatuts();
  }

  /** Statuts de visa (effet : ACCEPTE bon pour exécution, REFUSE bloquant, NEUTRE pour information). */
  rendreStatuts() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-statuts]');
    const EFFETS = pairesParCode('crm_btp.parametres.effets', ['ACCEPTE', 'REFUSE', 'NEUTRE']).map(([valeur, libelle]) => ({ valeur, libelle }));
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('crm_btp.parametres.effet')}</th><th>${texteHtml('crm_btp.parametres.ordre')}</th><th>${texteHtml('crm_btp.parametres.actif')}</th><th></th></tr></thead><tbody>
      ${this.statuts.map((s, i) => `<tr data-i="${i}"${s.actif ? '' : ' class="discret"'}><td><input data-c="code" value="${echapper(s.code)}" size="6" maxlength="10" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="libelle" value="${echapper(s.libelle)}" size="28" maxlength="80" ${admin ? '' : 'disabled'}></td><td><span data-effet></span></td>
        <td><input data-c="ordre" value="${s.ordre}" size="4" ${admin ? '' : 'disabled'}></td><td><input type="checkbox" data-c="actif" ${s.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td>${admin ? `<button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? `<div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('crm_btp.parametres.statut')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('crm_btp.parametres.enregistrer_statuts')}</button></div>` : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const s = this.statuts[Number(tr.dataset.i)];
      const effet = creerCombo({ options: EFFETS, valeur: s.effet, vide: false });
      effet.readOnly = !admin;
      effet.addEventListener('change', () => { s.effet = effet.valeurCombo; this.modifie = true; });
      tr.querySelector('[data-effet]').replaceWith(effet);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { s[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value) || 0 : c.value; this.modifie = true; }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.statuts.splice(Number(tr.dataset.i), 1); this.modifie = true; this.rendreStatuts(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { this.statuts.push({ code: '', libelle: '', effet: 'NEUTRE', ordre: (this.statuts.length + 1) * 10, actif: true }); this.rendreStatuts(); });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try { this.statuts = await api.crm.enregistrerStatutsVisa(this.statuts); this.modifie = false; this.app.message(texte('crm_btp.parametres.statuts_enregistres'), 'succes'); this.rendreStatuts(); } catch (e) { this.app.erreur(e); }
    });
  }

  /** Seuils globaux des couleurs des rappels « avant l'échéance » (C19, C26). */
  rendreSeuils(p) {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-seuils]');
    zone.innerHTML = `<p class="aide">${texteHtml('crm_btp.parametres.seuils_aide')}</p>
      <div class="formulaire"><label>${texteHtml('crm_btp.parametres.orange')} <input data-orange size="4" inputmode="decimal" value="${echapper(String(p.seuils.orange))}" ${admin ? '' : 'disabled'}> ${texteHtml('crm_btp.parametres.orange_suite')}</label>
      <label>${texteHtml('crm_btp.parametres.rouge')} <input data-rouge size="4" inputmode="decimal" value="${echapper(String(p.seuils.rouge))}" ${admin ? '' : 'disabled'}> ${texteHtml('crm_btp.parametres.rouge_suite')}</label>
      ${admin ? `<button type="button" class="principal" data-enregistrer-seuils>${texteHtml('crm_btp.parametres.enregistrer_seuils')}</button>` : ''}</div>`;
    zone.querySelector('[data-enregistrer-seuils]')?.addEventListener('click', async () => {
      try {
        const lire = (s) => Number(String(zone.querySelector(s).value).replace(',', '.'));
        this.rendreSeuils(await api.crm.enregistrerParametres({ seuils: { orange: lire('[data-orange]'), rouge: lire('[data-rouge]') } }));
        this.app.message(texte('crm_btp.parametres.seuils_enregistres'), 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }

  /** Format global des noms de fichiers de plans : repère, nom, lot et indice lus à la création d'un plan ou d'un indice. */
  rendreFormatPlan(p) {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-format-plan]');
    zone.innerHTML = `<p class="aide">${texteHtml('crm_btp.parametres.format_aide')}</p>
      <div class="formulaire"><label>${texteHtml('crm_btp.parametres.format_champ')} <input data-format size="40" maxlength="120" value="${echapper(p.format_plan ?? FORMAT_PLAN_DEFAUT)}" ${admin ? '' : 'disabled'}></label>
        <label>${texteHtml('crm_btp.parametres.essai')} <input data-essai size="40" value="${texteHtml('crm_btp.parametres.essai_exemple')}"></label><span data-apercu class="aide"></span>
        ${admin ? `<button type="button" class="principal" data-enregistrer-format>${texteHtml('crm_btp.parametres.enregistrer_format')}</button>` : ''}</div>`;
    const $ = (s) => zone.querySelector(s);
    const apercu = () => {
      const a = analyserFormatPlan($('[data-format]').value);
      if (a.erreur) { $('[data-apercu]').innerHTML = `<span class="erreur">${echapper(a.erreur)}</span>`; return; }
      const r = extraireNomPlan($('[data-essai]').value, $('[data-format]').value);
      $('[data-apercu]').textContent = r ? [
        texte('crm_btp.parametres.apercu_repere', { repere: r.repere }),
        texte('crm_btp.parametres.apercu_nom', { nom: r.nom }),
        ...(r.lot ? [texte('crm_btp.parametres.apercu_lot', { lot: r.lot })] : []),
        r.indice ? texte('crm_btp.parametres.apercu_indice', { indice: r.indice }) : texte('crm_btp.parametres.apercu_indice_vide'),
      ].join(' · ') : texte('crm_btp.parametres.apercu_hors_format');
    };
    $('[data-format]').addEventListener('input', apercu);
    $('[data-essai]').addEventListener('input', apercu);
    apercu();
    $('[data-enregistrer-format]')?.addEventListener('click', async () => {
      try {
        const actuels = await api.crm.parametres();
        this.rendreFormatPlan(await api.crm.enregistrerParametres({ seuils: actuels.seuils, format_plan: $('[data-format]').value }));
        this.app.message(texte('crm_btp.parametres.format_enregistre'), 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }

  rendreTypes() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-types]');
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('crm_btp.parametres.icone')}</th><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('crm_btp.liste.service')}</th><th>${texteHtml('crm_btp.parametres.ordre')}</th><th>${texteHtml('crm_btp.parametres.actif')}</th><th></th></tr></thead><tbody>
      ${this.types.map((t, i) => `<tr data-i="${i}"${t.actif ? '' : ' class="discret"'}>
        <td><input data-c="icone" value="${echapper(t.icone ?? '')}" size="3" maxlength="8" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="code" value="${echapper(t.code)}" size="10" maxlength="20" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="libelle" value="${echapper(t.libelle)}" size="28" maxlength="80" ${admin ? '' : 'disabled'}></td>
        <td><span data-srv></span></td>
        <td><input data-c="ordre" value="${Number(t.ordre ?? 0)}" size="4" ${admin ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-c="actif" ${t.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td>${admin ? `<button type="button" data-retirer title="${texteHtml('crm_btp.parametres.retirer_type')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? `<div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('crm_btp.parametres.type')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('crm_btp.parametres.enregistrer_types')}</button></div>` : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = this.types[Number(tr.dataset.i)];
      const srv = creerCombo({ options: this.ctx.tous_services.map((s) => ({ valeur: s.id, libelle: s.libelle })), valeur: t.srv_id ?? '', titre: texte('crm_btp.parametres.type_global') });
      srv.readOnly = !admin;
      srv.addEventListener('change', () => { t.srv_id = srv.valeurCombo === '' ? null : Number(srv.valeurCombo); this.modifie = true; });
      tr.querySelector('[data-srv]').replaceWith(srv);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        t[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value) || 0 : c.value;
        this.modifie = true;
      }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.types.splice(Number(tr.dataset.i), 1); this.modifie = true; this.rendreTypes(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      this.types.push({ id: null, code: '', libelle: '', srv_id: null, icone: '', modele_html: null, ordre: (this.types.length + 1) * 10, actif: true });
      this.modifie = true;
      this.rendreTypes();
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.types = await api.crm.enregistrerTypesNotes(this.types);
        this.modifie = false;
        this.app.contexteCrm = null;
        this.app.message(texte('crm_btp.parametres.types_enregistres'), 'succes');
        this.rendreTypes();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
