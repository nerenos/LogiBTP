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
const libelleFiche = (p) => `${{ personne: '🏢', individu: '👤', rattachement: '🤝' }[p.type] ?? ''} ${p.libelle}${p.usage ? ` (${libelleUsage(null, p.usage) || p.usage})` : ''}`;

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
    const titre = `Non remise le ${formatDateHeure(u.non_remis_le)}${u.non_remis_motif ? ` : ${u.non_remis_motif}` : ''}`;
    return this.options.effacerNonRemise
      ? `<button type="button" class="coord-partage change" data-non-remise title="${echapper(titre)} (cliquer pour effacer la marque)">⚠ non remise</button>`
      : `<span class="coord-partage change" title="${echapper(titre)}">⚠ non remise</span>`;
  }

  #partage(u) {
    const n = u.partages?.length ?? 0;
    if (!n) return '';
    const titre = `Partagée avec : ${u.partages.map(libelleFiche).join(', ')}`;
    if (coordonneeChangee(u)) {
      const choix = { MODIFICATION: 'modifiée partout', AUTRE: 'autre information' }[u.choix];
      return `<span class="coord-partage change" title="${echapper(titre)}">🔗 ${n} · ${choix ?? 'choix à l\'enregistrement'}</span>`;
    }
    return `<button type="button" class="coord-partage" data-partages title="${echapper(titre)}">🔗 ${n}</button>`;
  }

  rendre() {
    const { modifiable } = this.options;
    const usages = this.usages;
    const parNature = NATURES.map((n) => ({ ...n, lignes: usages.map((u, i) => ({ u, i })).filter(({ u }) => u.nature === n.code) }));
    this.conteneur.innerHTML = `<div class="coord ${this.options.compact ? 'compact' : ''}">
      ${parNature.filter((n) => modifiable || n.lignes.some(({ u }) => !estVide(u))).map((n) => `<section class="coord-nature" data-nature="${n.code}">
        <h4>${n.icone} ${n.libelle}</h4>
        ${n.lignes.filter(({ u }) => modifiable || !estVide(u)).map(({ u, i }) => this.#ligne(n, u, i)).join('') || '<p class="aide">Aucune.</p>'}
      </section>`).join('') || '<p class="aide">Aucune coordonnée.</p>'}
      ${modifiable ? `<p class="coord-ajouts">${NATURES.map((n) => `<button type="button" data-ajout="${n.code}">＋ ${n.un}</button>`).join('')}
        ${this.options.proposer ? '<button type="button" data-reprendre title="Reprendre une coordonnée d\'une fiche liée : elle reste partagée (même identifiant)">⤵ Reprendre d\'une fiche liée…</button>' : ''}</p>` : ''}
    </div>`;
    this.#brancher();
  }

  #ligne(n, u, i) {
    const { modifiable } = this.options;
    const usage = `<select data-c="usage" ${modifiable ? '' : 'disabled'}><option value=""></option>${n.usages.map(([c, l]) => `<option value="${c}" ${c === u.usage ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    if (!modifiable) {
      return `<div class="coord-ligne lecture" data-i="${i}">${u.principal ? '<span class="coord-principal" title="Principal">★</span>' : '<span class="coord-principal"></span>'}
        <span class="coord-usage">${echapper(libelleUsage(n.code, u.usage))}${u.libelle ? ` · ${echapper(u.libelle)}` : ''}</span>
        <span class="coord-valeur">${u.nature === 'WEB' && u.reseau ? `<small>${echapper(RESEAUX.find(([c]) => c === u.reseau)?.[1] ?? u.reseau)}</small> ` : ''}${lien(u)}</span>
        <span class="coord-etat">${this.#etat(u)}</span>${u.coo_id && this.options.historique ? `<button type="button" class="coord-histo" data-historique title="Historique des valeurs">🕘</button>` : ''}</div>`;
    }
    const champ = (c, place, classe = '', type = 'text') => `<input type="${type}" data-c="${c}" class="${classe}" placeholder="${place}" value="${echapper(u[c] ?? '')}">`;
    const valeurs = {
      ADRESSE: `<div class="coord-adresse">${champ('ligne1', 'N° et voie', 'l1')}${champ('ligne2', 'Complément', 'l2')}${champ('code_postal', 'CP', 'cp')}${champ('ville', 'Ville', 'ville')}${champ('pays', 'Pays', 'pays')}</div>`,
      TELEPHONE: champ('valeur', 'Numéro', '', 'tel'),
      EMAIL: champ('valeur', 'adresse@exemple.fr', '', 'email'),
      WEB: `<select data-c="reseau"><option value="">Lien</option>${RESEAUX.map(([c, l]) => `<option value="${c}" ${c === u.reseau ? 'selected' : ''}>${l}</option>`).join('')}</select>${champ('valeur', 'https://… ou pseudo')}`,
    }[n.code];
    return `<div class="coord-ligne" data-i="${i}">
      <label class="coord-principal" title="Coordonnée principale"><input type="radio" name="principal-${n.code}-${this.options.nom ?? ''}" data-principal ${u.principal ? 'checked' : ''}>★</label>
      ${usage}<input data-c="libelle" class="coord-libelle" placeholder="Libellé" value="${echapper(u.libelle ?? '')}">
      <div class="coord-valeurs">${valeurs}</div>
      <span class="coord-etat">${this.#etat(u)}</span>
      <button type="button" data-supprimer title="Retirer de cette fiche">✕</button></div>`;
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
    const d = dialogue('🔗 Coordonnée partagée', `<p><b>${echapper(texteCoordonnee(u))}</b></p>
      <p>Même coordonnée (même identifiant) utilisée par :</p><ul class="coord-fiches">${u.partages.map((p, i) => `<li><a href="#" data-f="${i}">${echapper(libelleFiche(p))}</a></li>`).join('')}</ul>
      <p class="aide">Une modification de cette coordonnée vous demandera, à l'enregistrement, si elle vaut pour toutes ces fiches ou seulement pour celle-ci.</p>`);
    d.corps.querySelectorAll('[data-f]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); d.fermer(); this.options.ouvrirFiche?.(u.partages[Number(a.dataset.f)]); }));
  }

  async #effacerNonRemise(i) {
    const u = this.usages[i];
    if (!await confirmer(`Effacer la marque « non remise » de ${texteCoordonnee(u)} ?`)) return;
    await this.options.effacerNonRemise(u.coo_id);
    this.#modifier(i, { non_remis_le: null, non_remis_motif: null, choix: u.choix }, true);
  }

  async #historique(u) {
    const h = await this.options.historique(u.coo_id);
    dialogue('🕘 Historique de la coordonnée', `<p>Valeur actuelle : <b>${echapper(texteCoordonnee(u))}</b></p>
      ${h.length ? `<table class="coord-table"><thead><tr><th>Remplacée le</th><th>Par</th><th>Valeur précédente</th></tr></thead><tbody>
        ${h.map((x) => `<tr><td>${formatDateHeure(x.le)}</td><td>${echapper(x.par ?? '')}</td><td>${echapper(texteCoordonnee({ ...x.avant, nature: u.nature }))}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune modification enregistrée.</p>'}`);
  }

  /** Reprise d'une coordonnée d'une fiche liée : même identifiant (partagée), valeurs d'origine conservées. */
  async #reprendre() {
    const proposees = (await this.options.proposer()).filter((p) => !this.usages.some((u) => u.coo_id === p.coo_id));
    const d = dialogue('⤵ Reprendre une coordonnée', proposees.length
      ? `<p class="aide">La coordonnée reste partagée avec la fiche d'origine (même identifiant) : une correction faite d'un côté pourra valoir pour les deux.</p>
        <table class="coord-table"><tbody>${proposees.map((p, i) => `<tr><td><label><input type="checkbox" data-p="${i}"> ${NATURES.find((n) => n.code === p.nature)?.icone ?? ''} ${echapper(texteCoordonnee(p))}</label></td>
          <td class="aide">${echapper(libelleUsage(p.nature, p.usage))}</td><td class="aide">${echapper(libelleFiche(p.source))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucune coordonnée à reprendre : les fiches liées (niveaux supérieurs et inférieurs, contacts, personnes rattachées) n\'en ont pas d\'autre.</p>',
    proposees.length ? 'Reprendre' : null);
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
    <header><h2>${echapper(titre)}</h2><button type="button" data-fermer title="Fermer (Échap)">✕</button></header>
    <div class="fiche-dialogue-corps">${html}</div>
    <footer><span class="fiche-dialogue-message"></span>${action ? `<button type="button" data-annuler>Annuler</button><button type="button" class="principal" data-ok>${echapper(action)}</button>` : '<button type="button" data-annuler>Fermer</button>'}</footer></section>`;
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
