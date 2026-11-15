// Module MCP, paramétrage administrateur : par profil, garde-fous levables, modèles de plafond permis, échéance maximale
// et quotas (garde-fou VOLUME). Composant sans métier : l'application fournit les appels et la liste des profils.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDateHeure, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';

export const GROUPE_RACCOURCIS_PARAMETRES = 'mcp_parametres';
declarerRaccourcis(GROUPE_RACCOURCIS_PARAMETRES, {
  libelle: texte('mcp.raccourcis.groupe_parametres'),
  actions: { enregistrer: { libelle: texte('mcp.raccourcis.enregistrer'), defaut: 'Ctrl+S' } },
});

/** Champs numériques d'une levée : clé de la saisie et borne maximale (null : sans borne). */
export const CHAMPS_NOMBRES = Object.freeze([['jours_max', 90], ['quota_appel', null], ['quota_jour', null], ['alerte', 100]]);

/** Levées affichées d'un profil : celles du serveur, sinon aucune levée, tous les modèles et les valeurs par défaut. */
export function leveeDuProfil(parametres, profil) {
  const l = (parametres?.profils ?? []).find((x) => x.profil === profil);
  return {
    profil,
    levables: l?.levables ?? [],
    modeles: l?.modeles ?? null,
    jours_max: l?.jours_max ?? null,
    quota_appel: l?.quota_appel ?? null,
    quota_jour: l?.quota_jour ?? null,
    alerte: l?.alerte ?? null,
    modifie_le: l?.modifie_le ?? null,
    modifie_par: l?.modifie_par ?? null,
  };
}

/** Saisie contrôlée d'une levée (même contrôle que le serveur) : champs en erreur (vide : valable). */
export function controlerLevee(l) {
  const fautes = [];
  for (const [cle, max] of CHAMPS_NOMBRES) {
    const v = l[cle];
    if (v === null || v === undefined || v === '') continue;
    if (!Number.isInteger(v) || v < 1 || (max !== null && v > max)) fautes.push(cle);
  }
  return fautes;
}

/** Corps de PUT /api/mcp/parametres/{profil} : modèles null quand tous sont permis (aucune restriction). */
export function corpsLevee(l, tousModeles) {
  const modeles = l.modeles && tousModeles.every((m) => l.modeles.includes(m)) ? null : l.modeles;
  return { levables: l.levables, modeles, jours_max: l.jours_max, quota_appel: l.quota_appel, quota_jour: l.quota_jour, alerte: l.alerte };
}

/**
 * Paramètres des agents (administrateur). options : { api: { parametres(), enregistrer(profil, corps) }, profils: [{ code,
 * libelle }] (profils des comptes), apresEcriture(), erreur(e) }.
 */
export class ParametresAgents {
  #zone;
  #o;
  #parametres = null;
  #modif = new Map();

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, profils: [], apresEcriture: () => {}, erreur: () => {}, ...options };
    this.#zone.addEventListener('change', (e) => this.#changement(e));
    this.#zone.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-enregistrer]');
      if (b) this.enregistrer(b.dataset.enregistrer);
    });
    this.#zone.addEventListener('keydown', (e) => {
      if (actionDe(e, GROUPE_RACCOURCIS_PARAMETRES) !== 'enregistrer') return;
      const profil = e.target.closest('tr[data-profil]')?.dataset.profil;
      if (profil) { e.preventDefault(); this.enregistrer(profil); }
    });
  }

  async charger() {
    try {
      this.#parametres = await this.#o.api.parametres();
      this.#modif.clear();
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  levee(profil) { return this.#modif.get(profil) ?? leveeDuProfil(this.#parametres, profil); }

  #rendre() {
    const p = this.#parametres;
    if (!p) { this.#zone.innerHTML = ''; return; }
    const gardes = p.gardes_fous ?? [];
    const modeles = p.modeles ?? [];
    const profils = [...new Set([...this.#o.profils.map((x) => x.code), ...(p.profils ?? []).map((x) => x.profil)])];
    const libelle = (code) => this.#o.profils.find((x) => x.code === code)?.libelle ?? code;
    const nombre = (l, cle, max, defaut) => `<td><input type="number" min="1" ${max ? `max="${max}"` : ''} step="1" data-champ="${cle}" value="${l[cle] ?? ''}" placeholder="${echapper(String(defaut))}" size="5" aria-label="${echapper(texte(`mcp.parametres.${cle}`))}"></td>`;
    const ligne = (code) => {
      const l = this.levee(code);
      const fautes = controlerLevee(l);
      return `<tr data-profil="${echapper(code)}" class="${this.#modif.has(code) ? 'mcp-modifie' : ''}"><th scope="row">${echapper(libelle(code))}</th>
        ${gardes.map((g) => `<td><input type="checkbox" data-levable="${g}" ${l.levables.includes(g) ? 'checked' : ''} aria-label="${echapper(texte(`mcp.gardes_fous.${g}`))}"></td>`).join('')}
        ${modeles.map((m) => `<td><input type="checkbox" data-modele="${m}" ${!l.modeles || l.modeles.includes(m) ? 'checked' : ''} aria-label="${echapper(texte(`mcp.modeles.${m}`))}"></td>`).join('')}
        ${nombre(l, 'jours_max', p.echeance_max, p.echeance_max)}${nombre(l, 'quota_appel', null, p.quota_appel)}${nombre(l, 'quota_jour', null, p.quota_jour)}${nombre(l, 'alerte', 100, p.alerte_quota)}
        <td><small class="aide">${l.modifie_par ? `${echapper(l.modifie_par)}, ${formatDateHeure(l.modifie_le)}` : ''}</small></td>
        <td class="cellule-boutons"><button type="button" class="bouton-icone" data-enregistrer="${echapper(code)}" ${this.#modif.has(code) && !fautes.length ? '' : 'disabled'} title="${echapper(texte('mcp.parametres.enregistrer'))}">${iconeHtml('mcp_enregistrer')}</button></td></tr>`;
    };
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('mcp_parametres')} ${texteHtml('mcp.parametres.titre')}</h2>
      <p class="aide">${texteHtml('mcp.parametres.aide')}</p>
      <table class="tableau-compact mcp-table mcp-levees"><thead>
        <tr><th rowspan="2">${texteHtml('mcp.parametres.profil')}</th><th colspan="${gardes.length}">${texteHtml('mcp.parametres.levables')}</th>
          <th colspan="${modeles.length}">${texteHtml('mcp.parametres.modeles')}</th><th rowspan="2">${texteHtml('mcp.parametres.jours_max')}</th>
          <th rowspan="2">${texteHtml('mcp.parametres.quota_appel')}</th><th rowspan="2">${texteHtml('mcp.parametres.quota_jour')}</th><th rowspan="2">${texteHtml('mcp.parametres.alerte')}</th>
          <th rowspan="2">${texteHtml('mcp.parametres.modifie')}</th><th rowspan="2"></th></tr>
        <tr>${gardes.map((g) => `<th title="${echapper(texte(`mcp.gardes_fous_aide.${g}`))}">${texteHtml(`mcp.gardes_fous.${g}`)}</th>`).join('')}
          ${modeles.map((m) => `<th title="${echapper(texte(`mcp.modeles_aide.${m}`))}">${texteHtml(`mcp.modeles.${m}`)}</th>`).join('')}</tr></thead>
      <tbody>${profils.map(ligne).join('')}</tbody></table>`;
  }

  #changement(e) {
    const t = e.target;
    const profil = t.closest('tr[data-profil]')?.dataset.profil;
    if (!profil) return;
    const l = { ...this.levee(profil) };
    const tous = this.#parametres?.modeles ?? [];
    if (t.dataset.levable) {
      l.levables = t.checked ? [...new Set([...l.levables, t.dataset.levable])] : l.levables.filter((g) => g !== t.dataset.levable);
    } else if (t.dataset.modele) {
      const actuels = l.modeles ?? tous;
      l.modeles = t.checked ? tous.filter((m) => actuels.includes(m) || m === t.dataset.modele) : actuels.filter((m) => m !== t.dataset.modele);
    } else if (t.dataset.champ) {
      const n = Number(t.value);
      l[t.dataset.champ] = t.value === '' ? null : n;
    } else return;
    this.#modif.set(profil, l);
    this.#rendre();
  }

  /** Enregistre les levées modifiées d'un profil si elles sont valables ; celles du serveur les remplacent ensuite. */
  async enregistrer(profil) {
    const l = this.#modif.get(profil);
    if (!l || controlerLevee(l).length) return;
    try {
      await this.#o.api.enregistrer(profil, corpsLevee(l, this.#parametres?.modeles ?? []));
      this.#o.apresEcriture();
      await this.charger();
    } catch (e) {
      this.#o.erreur(e);
    }
  }
}
