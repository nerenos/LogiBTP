import { texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { echapper, alerter } from '@logibtp/socle/ui';
import { creerTiersProvisoire } from '@logibtp/annuaire/ui';
import { intervenantPropre } from './structure.js';
import { choisirTiers, choisirContactTiers, relationsFonction } from '../annuaire/choix.js';

// Intervenants (petit annuaire) d'un projet, d'une affaire, d'un chantier, d'un marché ou d'un document : fonction,
// tiers de l'annuaire (recherche), contact choisi parmi les rattachements du tiers, coordonnées du contact (courriel,
// téléphone), principal, paiement direct des sous-traitants (information : montants et agréments relèveront de la
// gestion de la sous-traitance), commentaire. Le composant
// tient sa liste et son DOM : chaque modification est signalée par surChange(liste) sans redessiner la page.

const nature = (coordonnees, n) => (coordonnees ?? []).filter((c) => c.nature === n && c.valeur).sort((a, b) => Number(b.principal) - Number(a.principal))[0]?.valeur ?? null;

export class TableIntervenants {
  /**
   * annuaire : fournisseur de l'annuaire (rechercherPersonnes, pageRattachements) ; fonctions : référentiel ;
   * portee : 'S' (structure) ou 'D' (document) ; lecture : consultation ; actions : boutons supplémentaires
   * [{ libelle, titre, action }] ; fixe : fonction de la ligne imposée (tiers du document), non supprimable ;
   * relationsFixe : relations de l'annuaire proposées pour cette ligne (sinon celles de sa fonction).
   */
  constructor({ annuaire, fonctions = [], portee = 'S', lecture = false, surChange = () => {}, actions = [], fixe = null, relationsFixe = null, tiersFige = false }) {
    this.annuaire = annuaire;
    this.fonctions = fonctions.filter((f) => f.actif !== false);
    this.portee = portee;
    this.lecture = lecture;
    this.surChange = surChange;
    this.actions = actions;
    this.fixe = fixe;
    this.relationsFixe = relationsFixe;
    // Document issu d'une transformation : le tiers de la ligne imposée ne change plus (P12).
    this.tiersFige = tiersFige;
    this.contacts = new Map(); // per_id → Promise<rattachements>
    this.el = document.createElement('div');
    this.el.className = 'intervenants';
  }

  fonction(code) { return this.fonctions.find((f) => f.code === code); }

  /** Fonctions proposées : celles de la portée (et la fonction déjà choisie, même hors portée). */
  fonctionsProposees(code) { return this.fonctions.filter((f) => f.portee === 'T' || f.portee === this.portee || f.code === code); }

  rendre(liste) {
    this.liste = (liste ?? []).map((x) => ({ ...x }));
    this.#dessiner();
    return this.el;
  }

  #changer() { this.surChange(this.liste.map(intervenantPropre)); }

  #contactsDe(perId) {
    if (!perId) return Promise.resolve([]);
    if (!this.contacts.has(perId)) {
      this.contacts.set(perId, this.annuaire.pageRattachements(TYPE_FICHE.PERSONNE, perId, { taille: 100 }).then((p) => p.lignes ?? []).catch(() => []));
    }
    return this.contacts.get(perId);
  }

  #dessiner() {
    const l = this.liste;
    const pd = l.filter((x) => x.paiement_direct);
    this.el.innerHTML = `
      <table class="table-intervenants ${this.lecture ? 'lecture' : ''}"><thead><tr>
        <th>${texteHtml('structure_btp.intervenants.colonnes.fonction')}</th><th>${texteHtml('structure_btp.intervenants.colonnes.tiers')}</th><th>${texteHtml('structure_btp.intervenants.colonnes.contact')}</th><th>${texteHtml('structure_btp.intervenants.colonnes.coordonnees')}</th><th title="${texteHtml('structure_btp.intervenants.colonnes.principal_aide')}">${texteHtml('structure_btp.intervenants.colonnes.principal')}</th>
        <th>${texteHtml('structure_btp.intervenants.colonnes.paiement_direct')}</th><th>${texteHtml('structure_btp.intervenants.colonnes.commentaire')}</th>${this.lecture ? '' : '<th></th>'}</tr></thead>
      <tbody>${l.length ? l.map((x, i) => this.#ligne(x, i)).join('') : `<tr><td colspan="8" class="aide">${texteHtml('structure_btp.intervenants.aucun')}</td></tr>`}</tbody></table>
      <div class="intervenants-pied">
        ${this.lecture ? '' : `<button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('structure_btp.intervenants.ajouter')}</button>`}
        ${this.actions.map((a, i) => `<button type="button" data-action-sup="${i}" title="${echapper(a.titre ?? '')}">${echapper(a.libelle)}</button>`).join('')}
        ${pd.length ? `<span class="intervenants-pd">${pluriel('structure_btp.intervenants.paiement_direct', pd.length)}</span>` : ''}
      </div>`;
    this.#lier();
    l.forEach((x, i) => this.#coordonnees(x, i));
  }

  #ligne(x, i) {
    const f = this.fonction(x.fonction);
    const fixe = this.fixe && i === 0 && x.fonction === this.fixe;
    const lienTiers = x.per_id ? `<a href="${urlFiche(TYPE_FICHE.PERSONNE, Number(x.per_id))}" title="${texteHtml('structure_btp.intervenants.ouvrir_tiers')}">${echapper(x.tiers ?? texte('structure_btp.intervenants.tiers', { id: x.per_id }))}</a>` : '—';
    const lienContact = x.ind_id ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, Number(x.ind_id))}" title="${texteHtml('structure_btp.intervenants.ouvrir_contact')}">${echapper(x.contact ?? texte('structure_btp.intervenants.contact', { id: x.ind_id }))}</a>` : '—';
    const paiement = f?.paiement_direct
      ? (this.lecture
        ? echapper(texte(x.paiement_direct ? 'commun.oui' : 'commun.non'))
        : `<label class="pd"><input type="checkbox" data-champ="paiement_direct" ${x.paiement_direct ? 'checked' : ''}> ${texteHtml('commun.oui')}</label>`)
      : '';
    if (this.lecture) {
      return `<tr data-i="${i}"><td>${echapper(f?.libelle ?? x.fonction ?? '')}</td><td>${lienTiers}</td><td>${lienContact}</td><td class="coordonnees"></td>
        <td>${x.principal ? iconeHtml('structure_btp_principal') : ''}</td><td>${paiement}</td><td>${echapper(x.commentaire ?? '')}</td></tr>`;
    }
    return `<tr data-i="${i}">
      <td><select data-champ="fonction" ${fixe ? 'disabled' : ''}>${this.fonctionsProposees(x.fonction).map((y) => `<option value="${y.code}" ${y.code === x.fonction ? 'selected' : ''}>${echapper(y.libelle)}</option>`).join('')}</select></td>
      <td class="tiers"><input type="search" data-tiers list="itv-tiers-${i}" value="${echapper(x.tiers ?? '')}" placeholder="${texteHtml('structure_btp.intervenants.rechercher')}" ${fixe && this.tiersFige && x.per_id ? `disabled title="${texteHtml('structure_btp.intervenants.tiers_fige')}"` : ''}><datalist id="itv-tiers-${i}"></datalist>
        ${fixe && this.tiersFige && x.per_id ? '' : `<button type="button" class="bouton-icone" data-liste-tiers title="${texteHtml('structure_btp.intervenants.choisir_tiers')}">${iconeHtml('rechercher')}</button>`}
        ${x.per_id ? `<a href="${urlFiche(TYPE_FICHE.PERSONNE, Number(x.per_id))}" title="${texteHtml('structure_btp.intervenants.ouvrir_tiers')}">${iconeHtml('structure_btp_ouvrir')}</a>` : ''}
        ${fixe && this.tiersFige && x.per_id ? '' : `<button type="button" data-nouveau-tiers title="${texteHtml('structure_btp.intervenants.nouveau_tiers')}">${iconeHtml('ajouter')}</button>`}</td>
      <td class="contact"><input data-contact-nom readonly value="${echapper(x.ind_id ? (x.contact ?? '') : '')}" placeholder="—">
        <button type="button" class="bouton-icone" data-liste-contact title="${texteHtml('structure_btp.intervenants.choisir_contact')}">${iconeHtml('rechercher')}</button>
        ${x.ind_id ? `<button type="button" class="bouton-icone" data-retirer-contact title="${texteHtml('structure_btp.intervenants.retirer_contact')}">${iconeHtml('retirer')}</button>` : ''}</td>
      <td class="coordonnees"></td>
      <td><input type="checkbox" data-champ="principal" ${x.principal ? 'checked' : ''}></td>
      <td>${paiement}</td>
      <td><input data-champ="commentaire" value="${echapper(x.commentaire ?? '')}"></td>
      <td>${fixe ? '' : `<button type="button" data-supprimer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>`}</td></tr>`;
  }

  /** Coordonnées du contact (rattachement au tiers) et liste des contacts du tiers. */
  async #coordonnees(x, i) {
    const tr = this.el.querySelector(`tr[data-i="${i}"]`);
    if (!tr || !x.per_id) return;
    // Nom du tiers inconnu (tiers du document saisi par son identifiant) : lu dans l'annuaire.
    if (!x.tiers) {
      const p = await this.annuaire.personne(Number(x.per_id)).catch(() => null);
      if (p) {
        x.tiers = p.raison_sociale;
        const champ = tr.querySelector('[data-tiers]');
        if (champ && document.activeElement !== champ) champ.value = p.raison_sociale;
        const lien = tr.querySelector('td:nth-child(2) a');
        if (lien && this.lecture) lien.textContent = p.raison_sociale;
      }
    }
    const contacts = await this.#contactsDe(Number(x.per_id));
    const r = contacts.find((c) => c.ind_id === Number(x.ind_id));
    const email = nature(r?.coordonnees, 'EMAIL');
    const tel = nature(r?.coordonnees, 'TELEPHONE');
    tr.querySelector('.coordonnees').innerHTML = [email ? `<a href="mailto:${echapper(email)}" title="${texteHtml('structure_btp.intervenants.ecrire')}">${iconeHtml('courriel')} ${echapper(email)}</a>` : '',
      tel ? `<a href="tel:${echapper(tel.replace(/\s/g, ''))}" title="${texteHtml('structure_btp.intervenants.appeler')}">${iconeHtml('telephone')} ${echapper(tel)}</a>` : ''].filter(Boolean).join('<br>');
  }

  #lier() {
    if (this.lecture) {
      this.el.querySelectorAll('[data-action-sup]').forEach((b) => b.addEventListener('click', () => this.actions[Number(b.dataset.actionSup)].action()));
      return;
    }
    const ligne = (el) => this.liste[Number(el.closest('tr').dataset.i)];
    this.el.querySelector('[data-ajouter]').addEventListener('click', () => {
      const deja = new Set(this.liste.map((x) => x.fonction));
      // Ligne imposée (tiers du document : fournisseur d'un achat, client d'une vente) d'abord, tant qu'elle manque.
      const f = (this.fixe && !deja.has(this.fixe) ? this.fonction(this.fixe) : null)
        ?? this.fonctionsProposees(null).find((y) => !(y.unique && deja.has(y.code))) ?? this.fonctions[0];
      this.liste.push({ fonction: f?.code ?? 'AUTRE', per_id: null, tiers: null, ind_id: null, contact: null, principal: false, paiement_direct: false });
      this.#dessiner();
      this.el.querySelector(`tr[data-i="${this.liste.length - 1}"] [data-tiers]`)?.focus();
    });
    this.el.querySelectorAll('[data-action-sup]').forEach((b) => b.addEventListener('click', () => this.actions[Number(b.dataset.actionSup)].action()));
    this.el.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', () => {
      this.liste.splice(Number(b.closest('tr').dataset.i), 1);
      this.#dessiner();
      this.#changer();
    }));
    this.el.querySelectorAll('[data-champ]').forEach((el) => el.addEventListener('change', () => {
      const x = ligne(el);
      const champ = el.dataset.champ;
      x[champ] = el.type === 'checkbox' ? el.checked : el.value || null;
      if (champ === 'fonction' && !this.fonction(x.fonction)?.paiement_direct) x.paiement_direct = false;
      if (champ === 'fonction' || champ === 'paiement_direct') this.#dessiner();
      this.#changer();
    }));
    // Contact choisi dans la liste des contacts, limité à ceux du tiers de l'intervenant (I1) ; sans tiers : refus.
    this.el.querySelectorAll('[data-liste-contact]').forEach((bouton) => bouton.addEventListener('click', async () => {
      const x = ligne(bouton);
      if (!x.per_id) { await alerter(texte('structure_btp.intervenants.contact_sans_tiers')); return; }
      const contacts = await this.#contactsDe(Number(x.per_id));
      const choisi = await choisirContactTiers({
        tiers: x.tiers ?? '', idsContacts: contacts.filter((c) => c.actif !== false || c.ind_id === Number(x.ind_id)).map((c) => c.ind_id),
      });
      if (!choisi) return;
      Object.assign(x, { ind_id: choisi.id, contact: choisi.nom_complet ?? contacts.find((c) => c.ind_id === choisi.id)?.individu ?? null });
      this.#dessiner();
      this.#changer();
    }));
    this.el.querySelectorAll('[data-retirer-contact]').forEach((bouton) => bouton.addEventListener('click', () => {
      Object.assign(ligne(bouton), { ind_id: null, contact: null });
      this.#dessiner();
      this.#changer();
    }));
    // Tiers absent de l'annuaire : créé provisoire (doublons proposés d'abord), validé ou fusionné plus tard.
    this.el.querySelectorAll('[data-nouveau-tiers]').forEach((b) => b.addEventListener('click', async () => {
      const x = ligne(b);
      const p = await creerTiersProvisoire({ annuaire: this.annuaire, raison_sociale: b.closest('td').querySelector('[data-tiers]').value.trim(), casquettes: [x.fonction].filter(Boolean) })
        .catch(() => null);
      if (!p) return;
      Object.assign(x, { per_id: p.id, tiers: p.raison_sociale, ind_id: null, contact: null });
      this.contacts.delete(p.id);
      this.#dessiner();
      this.#changer();
    }));
    // Tiers choisi (liste proposée en saisie ou liste complète) : contact principal du tiers proposé d'office.
    const prendreTiers = (x, choisi) => {
      Object.assign(x, { per_id: choisi.id, tiers: choisi.raison_sociale, ind_id: null, contact: null });
      this.#contactsDe(choisi.id).then((contacts) => {
        const p = contacts.find((c) => c.principal && c.actif !== false);
        if (p) Object.assign(x, { ind_id: p.ind_id, contact: p.individu });
        this.#dessiner();
        this.#changer();
      });
    };
    // Liste complète des tiers (I1), filtrée par défaut selon la fonction de l'intervenant.
    const ouvrirListe = async (el) => {
      const x = ligne(el);
      const saisie = el.closest('td').querySelector('[data-tiers]');
      const libelle = this.fonction(x.fonction)?.libelle ?? texte('structure_btp.intervenants.intervenant');
      const choisi = await choisirTiers({
        relations: x.fonction === this.fixe && this.relationsFixe ? [...this.relationsFixe] : relationsFonction(x.fonction), titre: texte('structure_btp.intervenants.choix_titre', { fonction: libelle }),
        recherche: x.per_id ? '' : saisie.value.trim(),
      });
      if (choisi) prendreTiers(x, choisi);
    };
    this.el.querySelectorAll('[data-liste-tiers]').forEach((b) => b.addEventListener('click', () => ouvrirListe(b)));
    this.el.querySelectorAll('[data-tiers]').forEach((input) => {
      let resultats = [];
      let minuterie = null;
      const liste = input.parentElement.querySelector('datalist');
      input.addEventListener('keydown', (e) => { if (e.key === 'F4') { e.preventDefault(); ouvrirListe(input); } });
      input.addEventListener('dblclick', () => ouvrirListe(input));
      input.addEventListener('input', () => {
        clearTimeout(minuterie);
        const x = ligne(input);
        const choisi = resultats.find((p) => `${p.code} – ${p.raison_sociale}` === input.value);
        if (choisi) { prendreTiers(x, choisi); return; }
        minuterie = setTimeout(async () => {
          resultats = await this.annuaire.rechercherPersonnes({ recherche: input.value, limite: 20 }).catch(() => []);
          liste.innerHTML = resultats.map((p) => `<option value="${echapper(`${p.code} – ${p.raison_sociale}`)}">${echapper(p.ville ?? '')}</option>`).join('');
        }, 250);
      });
      input.addEventListener('change', () => {
        const x = ligne(input);
        if (input.value.trim() === '' && x.per_id) { Object.assign(x, { per_id: null, tiers: null, ind_id: null, contact: null }); this.#dessiner(); this.#changer(); }
      });
    });
  }
}
