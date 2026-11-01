import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { individusSociete } from '../panneaux-btp.js';

/** Natures de service (db/193 : srv_nature). */
export const NATURES_SERVICE = ['PRODUCTION', 'ETUDE', 'LOGISTIQUE', 'ADMINISTRATIF']
  .map((valeur) => Object.freeze({ valeur, get libelle() { return texte(`parametres_btp.services.natures.${valeur}`); } }));

/**
 * Services de l'entreprise et salariés rattachés (db/193 ; ANALYSE-MODULES-TRANSVERSE.md § 4.1, CRM C18 / C30) :
 * deux niveaux (service, sous-service), un salarié dans un ou plusieurs services dont un principal. Un service retiré
 * de la liste est supprimé s'il est libre, sinon mis en sommeil.
 */
export class PageParametresServices extends PageBase {
  icone = icone('parametres_btp_services');

  get modifiee() { return Boolean(this.servicesModifies || this.membresModifies); }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.services.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('parametres_btp_services')} ${texteHtml('parametres_btp.services.titre')}</h1>
      <div data-services></div><h2 data-titre-membres>${texteHtml('parametres_btp.services.membres.titre')}</h2><div data-membres><p class="aide">${texteHtml('parametres_btp.services.membres.choisir')}</p></div></div>`;
    this.admin = app.estAdmin();
    this.services = await api.services();
    const { annuaire } = await app.services();
    this.individus = await individusSociete(annuaire);
    this.rendreServices();
  }

  rendreServices() {
    const zone = this.conteneur.querySelector('[data-services]');
    const parents = () => this.services.filter((s) => !s.parent_code).map((s) => ({ valeur: s.code, libelle: s.libelle, detail: s.code }));
    zone.innerHTML = `<p class="aide">${texteHtml('parametres_btp.services.aide')}</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('parametres_btp.services.colonnes.parent')}</th><th>${texteHtml('parametres_btp.services.colonnes.nature')}</th><th>${texteHtml('parametres_btp.services.colonnes.responsable')}</th><th>${texteHtml('parametres_btp.services.colonnes.ordre')}</th><th>${texteHtml('parametres_btp.documents.actif')}</th>
        <th class="nombre">${texteHtml('parametres_btp.services.membres.titre')}</th><th></th></tr></thead><tbody>
      ${this.services.map((s, i) => `<tr data-i="${i}"${s.actif ? '' : ' class="discret"'}>
        <td><input data-c="code" value="${echapper(s.code)}" size="10" maxlength="20" ${this.admin ? '' : 'disabled'}></td>
        <td><input data-c="libelle" value="${echapper(s.libelle)}" size="26" maxlength="80" ${this.admin ? '' : 'disabled'}></td>
        <td><span data-parent></span></td><td><span data-nature></span></td><td><span data-responsable></span></td>
        <td><input data-c="ordre" value="${Number(s.ordre ?? 0)}" size="4" inputmode="numeric" ${this.admin ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-c="actif" ${s.actif ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td>
        <td class="nombre">${s.id ? Number(s.nb_membres ?? 0) : ''}</td>
        <td>${s.id ? `<button type="button" data-membres title="${texteHtml('parametres_btp.services.membres.aide')}">${texteHtml('parametres_btp.services.membres.bouton')}</button>` : ''}
          ${this.admin ? `<button type="button" data-retirer title="${texteHtml('parametres_btp.services.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      ${this.admin ? `<div class="boutons"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('parametres_btp.services.ajouter')}</button>
        <button type="button" class="principal" data-enregistrer>${texteHtml('parametres_btp.services.enregistrer')}</button></div>` : `<p class="aide">${texteHtml('parametres_btp.services.lecture')}</p>`}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const s = this.services[Number(tr.dataset.i)];
      const combo = (options, valeur, vide, champ) => {
        const c = creerCombo({ options, valeur: valeur ?? '', vide });
        c.readOnly = !this.admin;
        c.addEventListener('change', () => { s[champ] = c.valeurCombo === '' ? null : c.valeurCombo; this.servicesModifies = true; });
        return c;
      };
      tr.querySelector('[data-parent]').replaceWith(combo(parents().filter((p) => p.valeur !== s.code), s.parent_code, true, 'parent_code'));
      tr.querySelector('[data-nature]').replaceWith(combo(NATURES_SERVICE, s.nature, false, 'nature'));
      tr.querySelector('[data-responsable]').replaceWith(combo(this.individus, s.responsable_id, true, 'responsable_id'));
      tr.querySelectorAll('[data-c]').forEach((champ) => champ.addEventListener('change', () => {
        const c = champ.dataset.c;
        s[c] = c === 'actif' ? champ.checked : c === 'ordre' ? Number(champ.value) || 0 : champ.value;
        this.servicesModifies = true;
      }));
      tr.querySelector('[data-membres]')?.addEventListener('click', () => this.ouvrirMembres(s));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => {
        this.services.splice(Number(tr.dataset.i), 1);
        this.servicesModifies = true;
        this.rendreServices();
      });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      this.services.push({ id: null, code: '', libelle: '', parent_code: null, nature: 'PRODUCTION', responsable_id: null, ordre: (this.services.length + 1) * 10, actif: true });
      this.servicesModifies = true;
      this.rendreServices();
      zone.querySelector('tr:last-child [data-c="code"]')?.focus();
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', () => this.enregistrerServices());
  }

  async enregistrerServices() {
    try {
      this.services = await api.enregistrerServices(this.services.map((s) => ({
        id: s.id ?? null, code: s.code, libelle: s.libelle, parent_code: s.parent_code ?? null, nature: s.nature,
        responsable_id: s.responsable_id ?? null, ordre: Number(s.ordre ?? 0), actif: s.actif !== false,
      })));
      this.servicesModifies = false;
      this.app.message(texte('parametres_btp.services.enregistres'), 'succes');
      this.rendreServices();
    } catch (e) { this.app.erreur(e); }
  }

  async ouvrirMembres(service) {
    if (this.membresModifies && !await confirmer(texte('parametres_btp.services.membres.quitter'))) return;
    this.service = service;
    this.membres = await api.membresService(service.id);
    this.membresModifies = false;
    this.rendreMembres();
  }

  rendreMembres() {
    const zone = this.conteneur.querySelector('[data-membres]');
    this.conteneur.querySelector('[data-titre-membres]').textContent = texte('parametres_btp.services.membres.titre_service', { service: this.service.libelle });
    const presents = new Set(this.membres.map((m) => m.ind_id));
    zone.innerHTML = `<p class="aide">${texteHtml('parametres_btp.services.membres.explication')}</p>
      ${this.membres.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('parametres_btp.services.membres.salarie')}</th><th>${texteHtml('parametres_btp.services.membres.principal')}</th><th></th></tr></thead><tbody>
        ${this.membres.map((m, i) => `<tr data-i="${i}"${m.actif === false ? ' class="discret"' : ''}><td>${echapper(m.individu)}</td>
          <td><input type="checkbox" data-principal ${m.principal ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td>
          <td>${this.admin ? `<button type="button" data-retirer title="${texteHtml('parametres_btp.services.membres.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('parametres_btp.services.membres.aucun')}</p>`}
      ${this.admin ? `<div class="boutons"><span data-ajout></span> <button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('commun.ajouter')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('parametres_btp.services.membres.enregistrer')}</button></div>` : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const m = this.membres[Number(tr.dataset.i)];
      tr.querySelector('[data-principal]').addEventListener('change', (e) => { m.principal = e.target.checked; this.membresModifies = true; });
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.membres.splice(Number(tr.dataset.i), 1); this.membresModifies = true; this.rendreMembres(); });
    });
    if (!this.admin) return;
    const ajout = creerCombo({ options: this.individus.filter((x) => !presents.has(x.valeur)), titre: texte('parametres_btp.services.membres.ajout') });
    zone.querySelector('[data-ajout]').replaceWith(ajout);
    zone.querySelector('[data-ajouter]').addEventListener('click', () => {
      const id = ajout.resoudre();
      if (id === '' || id === undefined || id === null) return;
      const individu = this.individus.find((x) => String(x.valeur) === String(id));
      this.membres.push({ ind_id: Number(id), individu: individu?.libelle ?? `#${id}`, principal: false, actif: true });
      this.membresModifies = true;
      this.rendreMembres();
    });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.membres = await api.enregistrerMembresService(this.service.id, this.membres.map((m) => ({ ind_id: m.ind_id, principal: Boolean(m.principal) })));
        this.membresModifies = false;
        this.services = await api.services();
        this.rendreServices();
        this.rendreMembres();
        this.app.message(texte('parametres_btp.services.membres.enregistres'), 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }
}
