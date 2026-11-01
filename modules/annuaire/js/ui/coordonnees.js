import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirModale, formatDateHeure, confirmer } from '@logibtp/socle/ui';
import { NATURES, RESEAUX, texteCoordonnee, memesValeurs, estVide } from '../src/coordonnees.js';
import { formaterTelephone } from '../src/identifiants.js';

// Éditeur des coordonnées d'une fiche (personne, individu ou rattachement) : adresses, téléphones, e-mails, web et
// réseaux, avec usage, libellé et principal ; coordonnées partagées signalées (🔗), reprise d'une coordonnée d'une
// fiche liée (même identifiant), historique des valeurs. La valeur éditée est le tableau des usages (champ géré).

const lien = (u) => {
  const t = texteCoordonnee(u);
  if (!t) return '';
  switch (u.nature) {
    case 'TELEPHONE': return `<a href="tel:${echapper(t.replace(/[^0-9+]/g, ''))}">${echapper(formaterTelephone(t))}</a>`;
    case 'EMAIL': return `<a href="mailto:${echapper(t)}">${echapper(t)}</a>`;
    case 'WEB': return /^https?:\/\//i.test(t) ? `<a href="${echapper(t)}" target="_blank" rel="noopener">${echapper(t)}</a>` : echapper(t);
    default: return echapper(t);
  }
};

const libelleUsage = (nature, code) => NATURES.find((n) => n.code === nature)?.usages.find(([c]) => c === code)?.[1] ?? code ?? '';
const ICONES_FICHE = { personne: 'annuaire_personne', individu: 'annuaire_individu', rattachement: 'annuaire_rattachement' };
const libelleFiche = (p) => `${ICONES_FICHE[p.type] ? icone(ICONES_FICHE[p.type]) : ''} ${p.libelle}${p.usage ? ` (${libelleUsage(null, p.usage) || p.usage})` : ''}`;

/** La coordonnée a été changée par rapport à sa valeur d'origine (lue ou reprise). */
export const coordonneeChangee = (u) => !!u.coo_id && !!u.origine && !memesValeurs(u, u.origine);

/** Coordonnée partagée modifiée sans choix de l'utilisateur. */
export const choixAttendu = (u) => coordonneeChangee(u) && (u.partages?.length ?? 0) > 0 && !u.choix && !estVide(u);

export class EditeurCoordonnees {
  /**
   * options : valeur() → usages ; definir(usages) ; modifiable ; proposer() → coordonnées des fiches liées (reprise) ;
   * historique(cooId) → [{ avant, le, par }] ; ouvrirFiche({ type, id, individu_id, personne_id }) ; compact (sans titres).
   */
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.options = options;
    this.rendre();
  }

  get usages() { return this.options.valeur() ?? []; }

  #definir(usages) {
    this.options.definir(usages);
    this.rendre();
  }

  #modifier(i, changement, rendre = false) {
    const usages = this.usages.map((u, j) => (j === i ? { ...u, ...changement } : u));
    // Changement de la valeur d'une coordonnée partagée : le choix précédent ne vaut plus.
    if (!('choix' in changement) && !('principal' in changement) && !('usage' in changement) && !('libelle' in changement)) delete usages[i].choix;
    if (changement.principal) usages.forEach((u, j) => { if (j !== i && u.nature === usages[i].nature) usages[j] = { ...u, principal: false }; });
    this.options.definir(usages);
    if (rendre) this.rendre();
    else this.#majEtat(i);
  }

  /** Signalement d'une coordonnée partagée modifiée (sans tout redessiner pendant la saisie). */
  #majEtat(i) {
    const u = this.usages[i];
    const el = this.conteneur.querySelector(`[data-i="${i}"] .coord-etat`);
    if (el) el.innerHTML = this.#etat(u);
  }

  #etat(u) {
    return `${this.#nonRemise(u)}${this.#partage(u)}`;
  }

  /** Adresse signalée non remise par la messagerie : effaçable une fois vérifiée, retirée si la valeur change. */
  #nonRemise(u) {
    if (!u.non_remis_le || coordonneeChangee(u)) return '';
    const le = formatDateHeure(u.non_remis_le);
    const titre = u.non_remis_motif ? texte('annuaire.coordonnees.non_remise_motif', { le, motif: u.non_remis_motif }) : texte('annuaire.coordonnees.non_remise_le', { le });
    return this.options.effacerNonRemise
      ? `<button type="button" class="coord-partage change" data-non-remise title="${texteHtml('annuaire.coordonnees.non_remise_effacer', { titre })}">${iconeHtml('avertissement')} ${texteHtml('annuaire.coordonnees.non_remise')}</button>`
      : `<span class="coord-partage change" title="${echapper(titre)}">${iconeHtml('avertissement')} ${texteHtml('annuaire.coordonnees.non_remise')}</span>`;
  }

  #partage(u) {
    const n = u.partages?.length ?? 0;
    if (!n) return '';
    const titre = texte('annuaire.coordonnees.partagee_avec', { fiches: u.partages.map(libelleFiche).join(', ') });
    if (coordonneeChangee(u)) {
      const choix = u.choix ? texteHtml(`annuaire.coordonnees.choix.${u.choix}`) : texteHtml('annuaire.coordonnees.choix_a_faire');
      return `<span class="coord-partage change" title="${echapper(titre)}">${iconeHtml('annuaire_partage')} ${n} · ${choix}</span>`;
    }
    return `<button type="button" class="coord-partage" data-partages title="${echapper(titre)}">${iconeHtml('annuaire_partage')} ${n}</button>`;
  }

  rendre() {
    const { modifiable } = this.options;
    const usages = this.usages;
    const parNature = NATURES.map((n) => ({ ...n, lignes: usages.map((u, i) => ({ u, i })).filter(({ u }) => u.nature === n.code) }));
    this.conteneur.innerHTML = `<div class="coord ${this.options.compact ? 'compact' : ''}">
      ${parNature.filter((n) => modifiable || n.lignes.some(({ u }) => !estVide(u))).map((n) => `<section class="coord-nature" data-nature="${n.code}">
        <h4>${n.icone} ${echapper(n.libelle)}</h4>
        ${n.lignes.filter(({ u }) => modifiable || !estVide(u)).map(({ u, i }) => this.#ligne(n, u, i)).join('') || `<p class="aide">${texteHtml('annuaire.coordonnees.aucune')}</p>`}
      </section>`).join('') || `<p class="aide">${texteHtml('annuaire.coordonnees.aucune_coordonnee')}</p>`}
      ${modifiable ? `<p class="coord-ajouts">${NATURES.map((n) => `<button type="button" data-ajout="${n.code}">${iconeHtml('ajouter')} ${echapper(n.un)}</button>`).join('')}
        ${this.options.proposer ? `<button type="button" data-reprendre title="${texteHtml('annuaire.coordonnees.reprendre_aide')}">${iconeHtml('annuaire_reprendre')} ${texteHtml('annuaire.coordonnees.reprendre_bouton')}</button>` : ''}</p>` : ''}
    </div>`;
    this.#brancher();
  }

  #ligne(n, u, i) {
    const { modifiable } = this.options;
    const usage = `<select data-c="usage" ${modifiable ? '' : 'disabled'}><option value=""></option>${n.usages.map(([c, l]) => `<option value="${c}" ${c === u.usage ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select>`;
    if (!modifiable) {
      return `<div class="coord-ligne lecture" data-i="${i}">${u.principal ? `<span class="coord-principal" title="${texteHtml('annuaire.coordonnees.principal')}">${iconeHtml('annuaire_principal')}</span>` : '<span class="coord-principal"></span>'}
        <span class="coord-usage">${echapper(libelleUsage(n.code, u.usage))}${u.libelle ? ` · ${echapper(u.libelle)}` : ''}</span>
        <span class="coord-valeur">${u.nature === 'WEB' && u.reseau ? `<small>${echapper(RESEAUX.find(([c]) => c === u.reseau)?.[1] ?? u.reseau)}</small> ` : ''}${lien(u)}</span>
        <span class="coord-etat">${this.#etat(u)}</span>${u.coo_id && this.options.historique ? `<button type="button" class="coord-histo" data-historique title="${texteHtml('annuaire.coordonnees.historique_aide')}">${iconeHtml('annuaire_historique')}</button>` : ''}</div>`;
    }
    const champ = (c, place, classe = '', type = 'text') => `<input type="${type}" data-c="${c}" class="${classe}" placeholder="${echapper(place)}" value="${echapper(u[c] ?? '')}">`;
    const valeurs = {
      ADRESSE: `<div class="coord-adresse">${champ('ligne1', texte('annuaire.coordonnees.champs.ligne1'), 'l1')}${champ('ligne2', texte('annuaire.coordonnees.champs.ligne2'), 'l2')}${champ('code_postal', texte('annuaire.coordonnees.champs.code_postal'), 'cp')}${champ('ville', texte('annuaire.coordonnees.champs.ville'), 'ville')}${champ('pays', texte('annuaire.coordonnees.champs.pays'), 'pays')}</div>`,
      TELEPHONE: champ('valeur', texte('annuaire.coordonnees.champs.numero'), '', 'tel'),
      EMAIL: champ('valeur', texte('annuaire.coordonnees.champs.email'), '', 'email'),
      WEB: `<select data-c="reseau"><option value="">${texteHtml('annuaire.coordonnees.champs.lien')}</option>${RESEAUX.map(([c, l]) => `<option value="${c}" ${c === u.reseau ? 'selected' : ''}>${echapper(l)}</option>`).join('')}</select>${champ('valeur', texte('annuaire.coordonnees.champs.web'))}`,
    }[n.code];
    return `<div class="coord-ligne" data-i="${i}">
      <label class="coord-principal" title="${texteHtml('annuaire.coordonnees.principale_aide')}"><input type="radio" name="principal-${n.code}-${this.options.nom ?? ''}" data-principal ${u.principal ? 'checked' : ''}>${iconeHtml('annuaire_principal')}</label>
      ${usage}<input data-c="libelle" class="coord-libelle" placeholder="${texteHtml('commun.libelle')}" value="${echapper(u.libelle ?? '')}">
      <div class="coord-valeurs">${valeurs}</div>
      <span class="coord-etat">${this.#etat(u)}</span>
      <button type="button" data-supprimer title="${texteHtml('annuaire.coordonnees.retirer_aide')}">${iconeHtml('retirer')}</button></div>`;
  }

  #brancher() {
    const c = this.conteneur;
    c.querySelectorAll('.coord-ligne[data-i]').forEach((ligne) => {
      const i = Number(ligne.dataset.i);
      ligne.querySelectorAll('[data-c]').forEach((el) => {
        const evt = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(evt, () => this.#modifier(i, { [el.dataset.c]: el.value === '' ? null : el.value }));
      });
      ligne.querySelector('[data-principal]')?.addEventListener('change', () => this.#modifier(i, { principal: true }));
      ligne.querySelector('[data-supprimer]')?.addEventListener('click', () => this.#definir(this.usages.filter((_, j) => j !== i)));
      ligne.querySelector('[data-historique]')?.addEventListener('click', () => this.#historique(this.usages[i]).catch(() => {}));
      ligne.querySelector('[data-partages]')?.addEventListener('click', () => this.#partages(this.usages[i]));
      ligne.querySelector('[data-non-remise]')?.addEventListener('click', () => this.#effacerNonRemise(i).catch((e) => this.options.message?.(e.message, 'erreur')));
    });
    c.querySelectorAll('[data-ajout]').forEach((b) => b.addEventListener('click', () => {
      const nature = b.dataset.ajout;
      const premier = !this.usages.some((u) => u.nature === nature);
      const usage = NATURES.find((n) => n.code === nature).usages[0][0];
      this.#definir([...this.usages, { uco_id: null, coo_id: null, nature, usage, principal: premier, ...(nature === 'ADRESSE' ? { pays: 'FR' } : {}) }]);
      c.querySelector(`[data-nature="${nature}"] .coord-ligne:last-of-type input[data-c="${nature === 'ADRESSE' ? 'ligne1' : 'valeur'}"]`)?.focus();
    }));
    c.querySelector('[data-reprendre]')?.addEventListener('click', () => this.#reprendre().catch((e) => this.options.message?.(e.message, 'erreur')));
  }

  #partages(u) {
    const d = dialogue(texte('annuaire.coordonnees.partagee.titre', { icone: icone('annuaire_partage') }), `<p><b>${echapper(texteCoordonnee(u))}</b></p>
      <p>${texteHtml('annuaire.coordonnees.partagee.utilisee_par')}</p><ul class="coord-fiches">${u.partages.map((p, i) => `<li><a href="#" data-f="${i}">${echapper(libelleFiche(p))}</a></li>`).join('')}</ul>
      <p class="aide">${texteHtml('annuaire.coordonnees.partagee.aide')}</p>`);
    d.corps.querySelectorAll('[data-f]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); d.fermer(); this.options.ouvrirFiche?.(u.partages[Number(a.dataset.f)]); }));
  }

  async #effacerNonRemise(i) {
    const u = this.usages[i];
    if (!await confirmer(texte('annuaire.coordonnees.non_remise_confirmer', { coordonnee: texteCoordonnee(u) }))) return;
    await this.options.effacerNonRemise(u.coo_id);
    this.#modifier(i, { non_remis_le: null, non_remis_motif: null, choix: u.choix }, true);
  }

  async #historique(u) {
    const h = await this.options.historique(u.coo_id);
    dialogue(texte('annuaire.coordonnees.historique.titre', { icone: icone('annuaire_historique') }), `<p>${texteHtml('annuaire.coordonnees.historique.actuelle')} <b>${echapper(texteCoordonnee(u))}</b></p>
      ${h.length ? `<table class="coord-table"><thead><tr><th>${texteHtml('annuaire.coordonnees.historique.le')}</th><th>${texteHtml('annuaire.coordonnees.historique.par')}</th><th>${texteHtml('annuaire.coordonnees.historique.avant')}</th></tr></thead><tbody>
        ${h.map((x) => `<tr><td>${formatDateHeure(x.le)}</td><td>${echapper(x.par ?? '')}</td><td>${echapper(texteCoordonnee({ ...x.avant, nature: u.nature }))}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('annuaire.coordonnees.historique.aucune')}</p>`}`);
  }

  /** Reprise d'une coordonnée d'une fiche liée : même identifiant (partagée), valeurs d'origine conservées. */
  async #reprendre() {
    const proposees = (await this.options.proposer()).filter((p) => !this.usages.some((u) => u.coo_id === p.coo_id));
    const d = dialogue(texte('annuaire.coordonnees.reprise.titre', { icone: icone('annuaire_reprendre') }), proposees.length
      ? `<p class="aide">${texteHtml('annuaire.coordonnees.reprise.aide')}</p>
        <table class="coord-table"><tbody>${proposees.map((p, i) => `<tr><td><label><input type="checkbox" data-p="${i}"> ${NATURES.find((n) => n.code === p.nature)?.icone ?? ''} ${echapper(texteCoordonnee(p))}</label></td>
          <td class="aide">${echapper(libelleUsage(p.nature, p.usage))}</td><td class="aide">${echapper(libelleFiche(p.source))}</td></tr>`).join('')}</tbody></table>`
      : `<p class="aide">${texteHtml('annuaire.coordonnees.reprise.aucune')}</p>`,
    proposees.length ? texte('annuaire.coordonnees.reprise.action') : null);
    const ok = await d.resultat;
    if (!ok) return;
    const choisies = [...d.corps.querySelectorAll('[data-p]:checked')].map((x) => proposees[Number(x.dataset.p)]);
    const usages = [...this.usages];
    for (const p of choisies) {
      const premier = !usages.some((u) => u.nature === p.nature && !estVide(u));
      // Ligne vide proposée par défaut remplacée par la coordonnée reprise.
      const vide = usages.findIndex((u) => u.nature === p.nature && estVide(u) && !u.uco_id);
      const { source, uco_id: _u, ...reste } = p;
      const ligne = { ...reste, uco_id: null, principal: premier || (vide >= 0 && usages[vide].principal), partages: [...(p.partages ?? []), { ...source, usage: p.usage }] };
      if (vide >= 0) usages[vide] = ligne; else usages.push(ligne);
    }
    this.#definir(usages);
  }
}

/** Petit dialogue (classes du dialogue des fiches) : { corps, fermer, resultat } ; resultat : true (bouton d'action) ou false. */
export function dialogue(titre, html, action = null, { large = false } = {}) {
  const fond = document.createElement('dialog');
  fond.className = 'fiche-dialogue-fond dialogue-plein';
  fond.innerHTML = `<section class="fiche-dialogue annuaire-dialogue ${large ? 'large' : ''}" role="dialog" aria-label="${echapper(titre)}">
    <header><h2>${echapper(titre)}</h2><button type="button" data-fermer title="${texteHtml('commun.fermer_echap')}">${iconeHtml('retirer')}</button></header>
    <div class="fiche-dialogue-corps">${html}</div>
    <footer><span class="fiche-dialogue-message"></span>${action ? `<button type="button" data-annuler>${texteHtml('commun.annuler')}</button><button type="button" class="principal" data-ok>${echapper(action)}</button>` : `<button type="button" data-annuler>${texteHtml('commun.fermer')}</button>`}</footer></section>`;
  ouvrirModale(fond);
  let resoudre;
  const resultat = new Promise((r) => { resoudre = r; });
  const fermer = (v = false) => { fond.remove(); resoudre(v); };
  fond.querySelector('[data-fermer]').addEventListener('click', () => fermer());
  fond.querySelector('[data-annuler]').addEventListener('click', () => fermer());
  fond.querySelector('[data-ok]')?.addEventListener('click', () => fermer(true));
  fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } });
  (fond.querySelector('input, select, [data-ok], [data-annuler]'))?.focus();
  return { corps: fond.querySelector('.fiche-dialogue-corps'), message: fond.querySelector('.fiche-dialogue-message'), fermer, resultat, fond };
}
