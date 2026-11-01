import { texte, texteHtml, icone, iconeHtml, textesParCode, couleurTheme } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirModale, confirmer } from '@logibtp/socle/ui';
import { normaliserDefinition, FORMATS, TEINTES_PASTILLE, STYLE_VIDE, TOTAUX_COLONNE, CALCULS_INDICATEUR, FORMATS_INDICATEUR } from '../src/modele.js';
import { compilerFormule, resolveurColonnes } from '../src/formule.js';
import { OPERATEURS_VUE, COLONNE_USAGE } from '../src/requete.js';

const SANS_VALEUR = new Set(['vide', 'nonvide', 'vrai', 'faux']);

/** Libellé lisible d'un filtre de vue : « Actif est coché (vrai) », « Montant entre 10 et 20 »… */
export function libelleFiltreVue(f, titre = f.colonne) {
  const op = OPERATEURS_VUE.find(([v]) => v === f.op)?.[1] ?? f.op;
  if (SANS_VALEUR.has(f.op)) return `${titre} ${op}`;
  if (f.op === 'dans') return texte('liste.concepteur.filtre_dans', { titre, valeurs: (f.valeurs ?? []).join(', ') });
  if (f.op === 'entre') return texte('liste.concepteur.filtre_entre', { titre, valeur: f.valeur ?? '', valeur2: f.valeur2 ?? '' });
  return `${titre} ${op} ${f.valeur ?? ''}`;
}

// Concepteur de vue de liste, en trois onglets :
//   Mise en forme        titres (multilignes), bulles, formats, couleurs, gras / italique / souligné / barré,
//                        ordre, largeur (fixe, proportionnelle, min / max), colonnes masquées, formules,
//                        règles de mise en forme conditionnelle, nom et partage de la vue
//   Colonnes et source   vue de la base ou requête manuelle (ADMIN), identifiant et type d'élément (ouverture
//                        de la fiche), colonnes affichées, colonnes de recherche, segments, tri par défaut
//   Indicateurs          cartes du bandeau de synthèse (L4) : calcul, colonne, filtres, dénominateur d'un ratio,
//                        format, teinte (le total de pied d'une colonne se choisit dans la mise en forme)

const LIB_FORMATS = textesParCode('liste.formats', ['texte', 'nombre', 'date', 'coche', 'combo', 'picto', 'pastille']);
const opt = (v, l, courant) => `<option value="${echapper(v ?? '')}" ${String(courant ?? '') === String(v ?? '') ? 'selected' : ''}>${echapper(l)}</option>`;
const premiereLigne = (t) => String(t ?? '').replace(/\s*\n\s*/g, ' ');

/** Format proposé pour une colonne de la source d'après son type SQL. */
export function formatPourType(type) {
  const t = String(type ?? '').toLowerCase();
  if (/bool/.test(t)) return { format: 'coche' };
  if (/int|serial/.test(t)) return { format: 'nombre', decimales: 0 };
  if (/numeric|decimal|real|double|money|float/.test(t)) return { format: 'nombre', decimales: 2 };
  if (/date|time/.test(t)) return { format: 'date' };
  return { format: 'texte' };
}

const titreDepuisCode = (code) => code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export class ConcepteurVue {
  constructor({ fournisseur, vue, peutRequete = false, appliquer, enregistrer, supprimer, message, largeursAjustees = {}, ordreAjuste = null, oublierLargeurs, themes = [] }) {
    this.fournisseur = fournisseur;
    this.vue = { ...structuredClone(vue), definition: normaliserDefinition(vue.definition) };
    this.peutRequete = peutRequete;
    this.cb = { appliquer, enregistrer, supprimer, message: message ?? (() => {}), oublierLargeurs };
    this.largeursAjustees = largeursAjustees;
    this.ordreAjuste = ordreAjuste;
    this.themes = themes;
    this.onglet = 'forme';
    this.selection = this.def.colonnes[0]?.code ?? null;
    this.sources = [];
    this.colonnesSource = [];
    this.#construire();
    this.#chargerSources().catch((e) => this.#erreur(e.message));
  }

  get def() { return this.vue.definition; }
  colonne(code = this.selection) { return this.def.colonnes.find((c) => c.code === code) ?? null; }

  #construire() {
    const fond = document.createElement('dialog');
    fond.className = 'concepteur-fond dialogue-plein';
    fond.innerHTML = `
      <div class="concepteur" role="dialog" aria-label="${texteHtml('liste.concepteur.titre')}">
        <header>
          <label>${texteHtml('liste.concepteur.nom')} <input data-vue="vli_nom" value="${echapper(this.vue.vli_nom ?? '')}"></label>
          <label>${texteHtml('liste.concepteur.partage')} <select data-vue="vli_partage">
            ${['P', 'G', 'T'].map((p) => opt(p, texte(`liste.concepteur.partages.${p}`), this.vue.vli_partage)).join('')}</select></label>
          <label class="groupe-partage">${texteHtml('liste.concepteur.groupe')} <input data-vue="vli_groupe" value="${echapper(this.vue.vli_groupe ?? '')}"></label>
          <label title="${texteHtml('liste.concepteur.theme_aide')}">${texteHtml('liste.concepteur.theme')} <select data-theme>
            ${opt('', texte('liste.concepteur.aucun'), this.def.theme)}${this.themes.map((t) => opt(t.thl_code, `${t.thl_icone ?? ''} ${t.thl_libelle}`.trim(), this.def.theme)).join('')}</select></label>
          <nav>
            <button type="button" data-onglet="forme">${texteHtml('liste.concepteur.onglets.forme')}</button>
            <button type="button" data-onglet="colonnes">${texteHtml('liste.concepteur.onglets.colonnes')}</button>
            <button type="button" data-onglet="indicateurs">${texteHtml('liste.concepteur.onglets.indicateurs')}</button>
          </nav>
          <button type="button" data-action="fermer" title="${texteHtml('liste.themes.fermer')}">${iconeHtml('retirer')}</button>
        </header>
        <div class="concepteur-corps"></div>
        <footer>
          <span class="concepteur-message"></span>
          <button type="button" data-action="supprimer" ${this.vue.vli_id ? '' : 'hidden'}>${texteHtml('liste.concepteur.supprimer')}</button>
          <button type="button" data-action="appliquer" title="${texteHtml('liste.concepteur.appliquer_aide')}">${texteHtml('liste.concepteur.appliquer')}</button>
          <button type="button" data-action="copie" ${this.vue.vli_id ? '' : 'hidden'}>${texteHtml('liste.concepteur.copie')}</button>
          <button type="button" class="principal" data-action="enregistrer">${texteHtml('commun.enregistrer')}</button>
        </footer>
      </div>`;
    ouvrirModale(fond);
    this.fond = fond;
    this.corps = fond.querySelector('.concepteur-corps');
    fond.querySelectorAll('[data-vue]').forEach((el) => el.addEventListener('input', () => {
      this.vue[el.dataset.vue] = el.value || null;
      this.#majPartage();
    }));
    this.#majPartage();
    fond.querySelector('[data-theme]').addEventListener('change', (e) => { this.def.theme = e.target.value || null; });
    fond.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.onglet = b.dataset.onglet; this.rendre(); }));
    fond.querySelector('[data-action="fermer"]').addEventListener('click', () => this.fermer());
    fond.querySelector('[data-action="appliquer"]').addEventListener('click', () => { if (this.#valider(false)) this.cb.appliquer(structuredClone(this.vue)); });
    fond.querySelector('[data-action="enregistrer"]').addEventListener('click', () => this.#enregistrer(false));
    fond.querySelector('[data-action="copie"]').addEventListener('click', () => this.#enregistrer(true));
    fond.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!await confirmer(texte('liste.concepteur.supprimer_confirmer', { nom: this.vue.vli_nom }))) return;
      try { await this.cb.supprimer(this.vue); this.fermer(); } catch (e) { this.#erreur(e.message); }
    });
    this.clavier = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.liste-menu')) this.fermer(); };
    document.addEventListener('keydown', this.clavier);
    this.rendre();
  }

  #majPartage() {
    this.fond.querySelector('.groupe-partage').hidden = this.vue.vli_partage !== 'G';
  }

  fermer() {
    document.removeEventListener('keydown', this.clavier);
    this.fond.remove();
  }

  #erreur(message) {
    const m = this.fond.querySelector('.concepteur-message');
    m.textContent = message ?? '';
    m.classList.toggle('erreur', !!message);
  }

  async #chargerSources() {
    this.sources = await this.fournisseur.sources();
    const s = this.def.source;
    if (s.mode === 'vue' && !s.vue && this.sources[0]) this.#choisirSource(this.sources[0].code);
    else if (s.mode === 'vue') this.colonnesSource = this.sources.find((x) => x.code === s.vue)?.colonnes ?? [];
    else if (s.requete && this.peutRequete) await this.#testerRequete(false);
    this.rendre();
  }

  /** Source déclarée modifiable par l'application (une requête manuelle ne l'est jamais). */
  sourceModifiable() {
    return this.def.source.mode === 'vue' && !!this.sources.find((x) => x.code === this.def.source.vue)?.modifiable;
  }

  #choisirSource(code) {
    const src = this.sources.find((x) => x.code === code);
    const s = this.def.source;
    s.mode = 'vue';
    s.vue = code;
    s.colonne_id = src?.colonne_id ?? null;
    s.colonne_type = src?.colonne_type ?? null;
    s.type_element = src?.type_element ?? null;
    this.colonnesSource = src?.colonnes ?? [];
  }

  async #testerRequete(signaler = true) {
    try {
      this.colonnesSource = await this.fournisseur.colonnesRequete(this.def.source.requete);
      if (signaler) this.#erreur('');
      if (signaler) this.cb.message(texte('liste.concepteur.requete_valide', { nombre: this.colonnesSource.length }), 'succes');
    } catch (e) {
      this.colonnesSource = [];
      this.#erreur(e.message);
    }
  }

  #valider(complet) {
    const d = this.def;
    const erreurs = [];
    if (!this.vue.vli_nom?.trim()) erreurs.push(texte('liste.concepteur.erreurs.nom'));
    if (d.source.mode === 'vue' ? !d.source.vue : !d.source.requete?.trim()) erreurs.push(texte('liste.concepteur.erreurs.source'));
    if (!d.source.colonne_id) erreurs.push(texte('liste.concepteur.erreurs.identifiant'));
    if (!d.source.colonne_type && !d.source.type_element) erreurs.push(texte('liste.concepteur.erreurs.type'));
    if (!d.colonnes.length) erreurs.push(texte('liste.concepteur.erreurs.colonne'));
    const controlerFiltres = (filtres, quoi) => {
      for (const f of filtres) {
        if (!f.colonne) erreurs.push(texte('liste.concepteur.erreurs.filtre_colonne', { quoi }));
        else if (!SANS_VALEUR.has(f.op) && f.op !== 'dans' && (f.valeur ?? '') === '') erreurs.push(texte('liste.concepteur.erreurs.filtre_valeur', { quoi, colonne: f.colonne }));
        else if (f.op === 'entre' && (f.valeur2 ?? '') === '') erreurs.push(texte('liste.concepteur.erreurs.filtre_valeur2', { quoi, colonne: f.colonne }));
        else if (f.op === 'dans' && !(f.valeurs ?? []).length) erreurs.push(texte('liste.concepteur.erreurs.filtre_valeurs', { quoi, colonne: f.colonne }));
      }
    };
    controlerFiltres(d.filtres, texte('liste.concepteur.erreurs.quoi_vue'));
    for (const ind of d.indicateurs) {
      const nom = texte('liste.concepteur.erreurs.quoi_indicateur', { titre: ind.titre || ind.code });
      if (!['compte', 'ratio'].includes(ind.calcul) && !ind.colonne) erreurs.push(texte('liste.concepteur.erreurs.indicateur_colonne', { quoi: nom }));
      controlerFiltres(ind.filtres, texte('liste.concepteur.erreurs.quoi_filtre', { quoi: nom }));
      if (ind.calcul === 'ratio') controlerFiltres(ind.denominateur, texte('liste.concepteur.erreurs.quoi_denominateur', { quoi: nom }));
    }
    const resoudre = resolveurColonnes(d.colonnes);
    for (const c of d.colonnes) {
      const formules = [...(c.calcul ? [c.formule] : []), ...c.regles.map((r) => r.condition)];
      for (const f of formules) {
        try { compilerFormule(f, resoudre); } catch (e) { erreurs.push(`${premiereLigne(c.titre)} : ${e.message}`); }
      }
    }
    if (complet || erreurs.length) this.#erreur(erreurs[0] ?? '');
    return !erreurs.length;
  }

  async #enregistrer(copie) {
    if (!this.#valider(true)) return;
    const v = structuredClone(this.vue);
    if (copie) { v.vli_id = null; v.vli_nom = texte('liste.concepteur.nom_copie', { nom: v.vli_nom }); }
    try {
      const enregistree = await this.cb.enregistrer(v);
      this.fermer();
      return enregistree;
    } catch (e) {
      this.#erreur(e.message);
      return null;
    }
  }

  // ---------------------------------------------------------------- rendu

  rendre() {
    this.fond.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === this.onglet));
    if (this.onglet === 'forme') this.#rendreForme();
    else if (this.onglet === 'indicateurs') this.#rendreIndicateurs();
    else this.#rendreColonnes();
  }

  // ---------------------------------------------------------------- onglet Mise en forme

  #rendreForme() {
    const d = this.def;
    this.corps.innerHTML = `
      <div class="concepteur-forme">
        <aside class="concepteur-liste">
          <ol>${d.colonnes.map((c, i) => `
            <li data-code="${echapper(c.code)}" class="${c.code === this.selection ? 'actif' : ''} ${c.masquee ? 'masquee' : ''}">
              <span class="nom">${echapper(premiereLigne(c.titre) || c.code)}${c.calcul ? ` <em>${iconeHtml('liste_formule')}</em>` : ''}</span>
              <button type="button" data-masquer title="${texteHtml(c.masquee ? 'liste.concepteur.afficher' : 'liste.concepteur.masquer')}">${iconeHtml(c.masquee ? 'liste_masquee' : 'liste_affichee')}</button>
              <button type="button" data-monter ${i === 0 ? 'disabled' : ''} title="${texteHtml('liste.concepteur.monter')}">${iconeHtml('liste_monter')}</button>
              <button type="button" data-descendre ${i === d.colonnes.length - 1 ? 'disabled' : ''} title="${texteHtml('liste.concepteur.descendre')}">${iconeHtml('liste_descendre')}</button>
            </li>`).join('')}</ol>
          ${d.colonnes.length ? '' : `<p class="aide">${texteHtml('liste.concepteur.aucune_colonne')}</p>`}
          <fieldset><legend>${texteHtml('liste.concepteur.vue')}</legend>
            <label>${texteHtml('liste.concepteur.hauteur')} <select data-def="lignes">${opt('multi', texte('liste.concepteur.lignes_multi'), d.lignes)}${opt('simple', texte('liste.concepteur.lignes_simple'), d.lignes)}</select></label>
            <label>${texteHtml('liste.concepteur.taille_lot')} <input type="number" min="20" max="1000" step="10" data-def="taille_lot" value="${d.taille_lot}"></label>
            ${Object.keys(this.largeursAjustees).length || this.ordreAjuste?.length ? `<button type="button" data-action="reprendre-largeurs"
              title="${texteHtml('liste.concepteur.reprendre_aide')}">${texteHtml('liste.concepteur.reprendre')}</button>` : ''}
          </fieldset>
        </aside>
        <section class="concepteur-colonne"></section>
      </div>`;
    this.corps.querySelectorAll('li[data-code]').forEach((li) => {
      const code = li.dataset.code;
      li.addEventListener('click', (e) => { if (!e.target.closest('button')) { this.selection = code; this.#rendreForme(); } });
      li.querySelector('[data-masquer]').addEventListener('click', () => { const c = this.colonne(code); c.masquee = !c.masquee; this.#rendreForme(); });
      li.querySelector('[data-monter]').addEventListener('click', () => this.#deplacer(code, -1));
      li.querySelector('[data-descendre]').addEventListener('click', () => this.#deplacer(code, 1));
    });
    this.corps.querySelector('[data-def="lignes"]').addEventListener('change', (e) => { d.lignes = e.target.value; });
    this.corps.querySelector('[data-def="taille_lot"]').addEventListener('change', (e) => { d.taille_lot = Math.min(Math.max(Number(e.target.value) || 100, 20), 1000); });
    this.corps.querySelector('[data-action="reprendre-largeurs"]')?.addEventListener('click', () => {
      for (const [code, px] of Object.entries(this.largeursAjustees)) {
        const c = this.colonne(code);
        if (c) c.largeur = { ...c.largeur, mode: 'fixe', valeur: px };
      }
      if (this.ordreAjuste?.length) {
        const rang = new Map(this.ordreAjuste.map((code, i) => [code, i]));
        const ordonnees = this.def.colonnes.filter((c) => rang.has(c.code)).sort((a, b) => rang.get(a.code) - rang.get(b.code));
        let k = 0;
        // Les colonnes ordonnées reprennent leurs places successives ; les autres (masquées…) ne bougent pas.
        this.def.colonnes = this.def.colonnes.map((c) => (rang.has(c.code) ? ordonnees[k++] : c));
      }
      this.largeursAjustees = {};
      this.ordreAjuste = null;
      this.cb.oublierLargeurs?.();
      this.#rendreForme();
    });
    this.#rendreColonneForme();
  }

  #deplacer(code, sens) {
    const l = this.def.colonnes;
    const i = l.findIndex((c) => c.code === code);
    const j = i + sens;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    this.#rendreForme();
  }

  #rendreColonneForme() {
    const zone = this.corps.querySelector('.concepteur-colonne');
    const c = this.colonne();
    if (!c) { zone.innerHTML = `<p class="aide">${texteHtml('liste.concepteur.selectionner')}</p>`; return; }
    const s = c.style;
    const couleur = (cle, libelle) => `<label class="couleur">${libelle}
      <input type="color" data-style="${cle}" value="${echapper(s[cle] ?? couleurTheme(cle === 'fond' ? '--liste-fond-defaut' : '--liste-texte-defaut', cle === 'fond' ? '#ffffff' : '#000000'))}">
      <label class="coche"><input type="checkbox" data-sans="${cle}" ${s[cle] ? '' : 'checked'}> ${texteHtml('liste.concepteur.couleur_aucune')}</label></label>`;
    const bascule = (cle, lettre, titre) => `<label class="bascule" title="${titre}"><input type="checkbox" data-style="${cle}" ${s[cle] ? 'checked' : ''}><span>${lettre}</span></label>`;
    const autres = this.def.colonnes.filter((x) => x.code !== c.code);
    zone.innerHTML = `
      <h3>${echapper(premiereLigne(c.titre) || c.code)} <small>${c.calcul ? texteHtml('liste.concepteur.colonne_calculee') : texteHtml('liste.concepteur.colonne_source', { code: c.code })}</small></h3>
      <div class="formulaire">
        <label class="large">${texteHtml('liste.concepteur.champs.titre')} <textarea rows="2" data-col="titre">${echapper(c.titre ?? '')}</textarea></label>
        <label class="large">${texteHtml('liste.concepteur.champs.bulle')} <input data-col="bulle" value="${echapper(c.bulle ?? '')}"></label>
        <label>${texteHtml('liste.concepteur.champs.format')} <select data-col="format">${FORMATS.map((f) => opt(f, LIB_FORMATS[f], c.format)).join('')}</select></label>
        <label ${c.format === 'nombre' ? '' : 'hidden'}>${texteHtml('liste.concepteur.champs.decimales')} <input type="number" min="0" max="6" data-col="decimales" value="${c.decimales ?? 2}"></label>
        <label ${c.format === 'nombre' && !c.calcul ? '' : 'hidden'} title="${texteHtml('liste.concepteur.champs.total_aide')}">${texteHtml('liste.concepteur.champs.total')}
          <select data-col="total">${opt('', texte('liste.concepteur.champs.total_aucun'), c.total)}${Object.entries(TOTAUX_COLONNE).map(([v, l]) => opt(v, l, c.total)).join('')}</select></label>
        <label>${texteHtml('liste.concepteur.champs.alignement')} <select data-col="alignement">${['', 'gauche', 'centre', 'droite'].map((a) => opt(a, texte(`liste.concepteur.alignements.${a || 'auto'}`), c.alignement)).join('')}</select></label>
        <label class="large" ${['combo', 'picto', 'pastille'].includes(c.format) ? '' : 'hidden'}>${c.format === 'pastille'
          ? texteHtml('liste.concepteur.champs.valeurs_pastille', { teintes: TEINTES_PASTILLE.join(', ') }) : texteHtml('liste.concepteur.champs.valeurs')}
          <textarea rows="4" data-options placeholder="${texteHtml(`liste.concepteur.champs.${c.format === 'pastille' ? 'valeurs_pastille_exemple' : 'valeurs_exemple'}`)}">${echapper(c.options.map((o) => [o.valeur, o.libelle, c.format === 'pastille' ? o.teinte : o.picto].filter((x) => x !== undefined && x !== null && x !== '').join(' | ')).join('\n'))}</textarea></label>
        <fieldset class="large"><legend>${texteHtml('liste.concepteur.onglets.forme')}</legend>
          ${couleur('couleur', texteHtml('liste.concepteur.couleur_texte'))}${couleur('fond', texteHtml('liste.concepteur.couleur_fond'))}
          ${['gras', 'italique', 'souligne', 'barre'].map((k) => bascule(k, texteHtml(`liste.concepteur.lettres.${k}`), texteHtml(`liste.menu.styles.${k}`))).join('')}
        </fieldset>
        <fieldset class="large"><legend>${texteHtml('liste.concepteur.largeur.titre')}</legend>
          <label>${texteHtml('liste.concepteur.largeur.mode')} <select data-largeur="mode">${['auto', 'fixe', 'proportionnel'].map((m) => opt(m, texte(`liste.concepteur.largeur.modes.${m}`), c.largeur.mode)).join('')}</select></label>
          <label ${c.largeur.mode === 'auto' ? 'hidden' : ''}>${texteHtml(c.largeur.mode === 'fixe' ? 'liste.concepteur.largeur.px' : 'liste.concepteur.largeur.poids')} <input type="number" min="0" data-largeur="valeur" value="${c.largeur.valeur ?? ''}"></label>
          <label>${texteHtml('liste.concepteur.largeur.min')} <input type="number" min="0" data-largeur="min" value="${c.largeur.min ?? ''}"></label>
          <label>${texteHtml('liste.concepteur.largeur.max')} <input type="number" min="0" data-largeur="max" value="${c.largeur.max ?? ''}"></label>
        </fieldset>
        <label class="coche"><input type="checkbox" data-col="masquee" ${c.masquee ? 'checked' : ''}> ${texteHtml('liste.concepteur.masquee')}</label>
        ${c.calcul ? `
        <label class="large">${texteHtml('liste.concepteur.formule')}
          <textarea rows="3" data-col="formule" class="formule" placeholder="${texteHtml('liste.concepteur.formule_exemple')}">${echapper(c.formule ?? '')}</textarea>
          <span class="validation" data-validation="formule"></span></label>
        <label>${texteHtml('liste.concepteur.inserer')} <select data-inserer="formule">${opt('', '—', '')}${autres.map((x) => opt(x.code, premiereLigne(x.titre) || x.code, '')).join('')}</select></label>
        <button type="button" data-action="supprimer-colonne">${texteHtml('liste.concepteur.supprimer_calculee')}</button>` : ''}
        <fieldset class="large regles"><legend>${texteHtml('liste.concepteur.regles')}</legend>
          ${c.regles.map((r, i) => `
            <div class="regle" data-regle="${i}">
              <input class="formule" data-regle-champ="condition" value="${echapper(r.condition ?? '')}" placeholder="${texteHtml('liste.concepteur.regle_exemple')}">
              <label title="${texteHtml('liste.concepteur.regle_couleur')}"><input type="checkbox" data-regle-avec="couleur" ${r.style?.couleur ? 'checked' : ''}>${texteHtml('liste.concepteur.regle_couleur_lettre')}<input type="color" data-regle-style="couleur" value="${echapper(r.style?.couleur ?? couleurTheme('--liste-regle-texte', '#b42318'))}"></label>
              <label title="${texteHtml('liste.menu.fond')}"><input type="checkbox" data-regle-avec="fond" ${r.style?.fond ? 'checked' : ''}>${iconeHtml('liste_fond')}<input type="color" data-regle-style="fond" value="${echapper(r.style?.fond ?? couleurTheme('--liste-regle-fond', '#fdecea'))}"></label>
              ${['gras', 'italique', 'souligne', 'barre'].map((k) => `<label class="bascule" title="${texteHtml(`liste.menu.styles.${k}`)}"><input type="checkbox" data-regle-style="${k}" ${r.style?.[k] ? 'checked' : ''}><span>${texteHtml(`liste.concepteur.lettres.${k}`)}</span></label>`).join('')}
              <button type="button" data-supprimer-regle title="${texteHtml('liste.concepteur.regle_supprimer')}">${iconeHtml('retirer')}</button>
              <span class="validation" data-validation="regle-${i}"></span>
            </div>`).join('')}
          <button type="button" data-action="ajouter-regle">${texteHtml('liste.concepteur.regle_ajouter')}</button>
        </fieldset>
      </div>
      <p class="aide">${texteHtml('liste.concepteur.formules_aide')}</p>`;

    const rafraichirListe = () => {
      const li = this.corps.querySelector(`li[data-code="${CSS.escape(c.code)}"] .nom`);
      if (li) li.innerHTML = `${echapper(premiereLigne(c.titre) || c.code)}${c.calcul ? ` <em>${iconeHtml('liste_formule')}</em>` : ''}`;
    };
    zone.querySelectorAll('[data-col]').forEach((el) => {
      const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const k = el.dataset.col;
        c[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value || (k === 'titre' ? '' : null);
        if (k === 'titre') rafraichirListe();
        if (k === 'format' || k === 'masquee') this.#rendreForme();
        if (k === 'formule') this.#validerFormules(zone, c);
      });
    });
    zone.querySelector('[data-options]')?.addEventListener('input', (e) => {
      c.options = e.target.value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] !== '')
        .map(([valeur, libelle, image]) => ({ valeur, libelle: libelle || valeur,
          ...(image ? (c.format === 'pastille' ? { teinte: TEINTES_PASTILLE.includes(image) ? image : 'neutre' } : { picto: image }) : {}) }));
    });
    zone.querySelectorAll('[data-style]').forEach((el) => el.addEventListener(el.type === 'color' ? 'input' : 'change', () => {
      const k = el.dataset.style;
      if (el.type === 'color') { c.style[k] = el.value; zone.querySelector(`[data-sans="${k}"]`).checked = false; } else c.style[k] = el.checked;
    }));
    zone.querySelectorAll('[data-sans]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.sans;
      c.style[k] = el.checked ? null : zone.querySelector(`[data-style="${k}"]`).value;
    }));
    zone.querySelectorAll('[data-largeur]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.largeur;
      c.largeur[k] = k === 'mode' ? el.value : el.value === '' ? null : Number(el.value);
      if (k === 'mode') this.#rendreColonneForme();
    }));
    zone.querySelector('[data-inserer]')?.addEventListener('change', (e) => {
      const x = this.colonne(e.target.value);
      if (!x) return;
      const ta = zone.querySelector('[data-col="formule"]');
      const ref = `[${premiereLigne(x.titre) || x.code}]`;
      const p = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, p) + ref + ta.value.slice(ta.selectionEnd ?? p);
      ta.dispatchEvent(new Event('input'));
      ta.focus();
      e.target.value = '';
    });
    zone.querySelector('[data-action="supprimer-colonne"]')?.addEventListener('click', () => {
      this.def.colonnes = this.def.colonnes.filter((x) => x !== c);
      this.selection = this.def.colonnes[0]?.code ?? null;
      this.#rendreForme();
    });
    zone.querySelectorAll('[data-regle]').forEach((div) => {
      const r = c.regles[Number(div.dataset.regle)];
      r.style ??= {};
      div.querySelector('[data-regle-champ]').addEventListener('input', (e) => { r.condition = e.target.value; this.#validerFormules(zone, c); });
      div.querySelectorAll('[data-regle-avec]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.regleAvec;
        r.style[k] = el.checked ? div.querySelector(`[data-regle-style="${k}"]`).value : null;
      }));
      div.querySelectorAll('[data-regle-style]').forEach((el) => el.addEventListener(el.type === 'color' ? 'input' : 'change', () => {
        const k = el.dataset.regleStyle;
        if (el.type === 'color') { r.style[k] = el.value; div.querySelector(`[data-regle-avec="${k}"]`).checked = true; } else r.style[k] = el.checked || null;
      }));
      div.querySelector('[data-supprimer-regle]').addEventListener('click', () => { c.regles.splice(Number(div.dataset.regle), 1); this.#rendreColonneForme(); });
    });
    zone.querySelector('[data-action="ajouter-regle"]').addEventListener('click', () => {
      c.regles.push({ condition: '', style: { fond: couleurTheme('--liste-regle-fond', '#fdecea') } });
      this.#rendreColonneForme();
    });
    this.#validerFormules(zone, c);
  }

  #validerFormules(zone, c) {
    const resoudre = resolveurColonnes(this.def.colonnes);
    const marquer = (cle, source) => {
      const el = zone.querySelector(`[data-validation="${cle}"]`);
      if (!el) return;
      if (!String(source ?? '').trim()) { el.textContent = ''; el.className = 'validation'; return; }
      try {
        compilerFormule(source, resoudre);
        el.textContent = icone('liste_valide');
        el.className = 'validation ok';
      } catch (e) {
        el.textContent = e.message;
        el.className = 'validation erreur';
      }
    };
    if (c.calcul) marquer('formule', c.formule);
    c.regles.forEach((r, i) => marquer(`regle-${i}`, r.condition));
  }

  // ---------------------------------------------------------------- onglet Colonnes et source

  #rendreColonnes() {
    const d = this.def;
    const s = d.source;
    const affichees = new Map(d.colonnes.filter((c) => !c.calcul).map((c) => [c.code, c]));
    const segments = new Set(d.segments.map((x) => x.colonne));
    const tri = d.tri[0] ?? null;
    const choixColonnes = (courant, vide) => `${vide ? opt('', vide, courant) : ''}${this.colonnesSource.map((c) => opt(c.code, c.code, courant)).join('')}`;
    this.corps.innerHTML = `
      <div class="concepteur-source">
        <fieldset><legend>${texteHtml('liste.concepteur.source.titre')}</legend>
          <label class="coche"><input type="radio" name="mode-source" value="vue" ${s.mode === 'vue' ? 'checked' : ''}> ${texteHtml('liste.concepteur.source.vue')}</label>
          <select data-source-vue ${s.mode === 'vue' ? '' : 'disabled'}>${opt('', '—', s.vue)}${this.sources.map((x) => opt(x.code, x.libelle, s.vue)).join('')}</select>
          <label class="coche" title="${this.peutRequete ? '' : texteHtml('liste.concepteur.source.admin')}"><input type="radio" name="mode-source" value="requete" ${s.mode === 'requete' ? 'checked' : ''} ${this.peutRequete ? '' : 'disabled'}> ${texteHtml('liste.concepteur.source.requete')}</label>
          <textarea rows="5" data-requete class="formule" ${s.mode === 'requete' && this.peutRequete ? '' : 'disabled'} placeholder="${texteHtml('liste.concepteur.source.requete_aide')}">${echapper(s.requete ?? '')}</textarea>
          <button type="button" data-action="tester" ${s.mode === 'requete' && this.peutRequete ? '' : 'hidden'}>${texteHtml('liste.concepteur.source.tester')}</button>
        </fieldset>
        <fieldset><legend>${texteHtml('liste.concepteur.fiche.titre')}</legend>
          <label>${texteHtml('liste.concepteur.fiche.identifiant')} <select data-source="colonne_id">${choixColonnes(s.colonne_id, '—')}</select></label>
          <label>${texteHtml('liste.concepteur.fiche.colonne_type')} <select data-source="colonne_type">${choixColonnes(s.colonne_type, texte('liste.concepteur.fiche.type_constant_vide'))}</select></label>
          <label ${s.colonne_type ? 'hidden' : ''}>${texteHtml('liste.concepteur.fiche.type_constant')} <input data-source="type_element" value="${echapper(s.type_element ?? '')}" placeholder="${texteHtml('liste.concepteur.fiche.type_exemple')}"></label>
        </fieldset>
      </div>
      <table class="concepteur-table">
        <thead><tr><th>${texteHtml('liste.concepteur.table.colonne')}</th><th>${texteHtml('liste.concepteur.table.type')}</th><th>${texteHtml('liste.concepteur.table.afficher')}</th><th title="${texteHtml('liste.concepteur.table.recherche_aide')}">${texteHtml('liste.concepteur.table.recherche')}</th><th title="${texteHtml('liste.concepteur.table.segment_aide')}">${texteHtml('liste.concepteur.table.segment')}</th>
          <th title="${texteHtml('liste.concepteur.table.modifiable_aide', { icone: icone('liste_saisie') })}">${texteHtml('liste.concepteur.table.modifiable')}</th><th>${texteHtml('liste.concepteur.table.tri')}</th></tr></thead>
        <tbody>${this.colonnesSource.map((c) => {
          const v = affichees.get(c.code);
          return `<tr data-code="${echapper(c.code)}">
            <td>${echapper(c.code)}</td><td><small>${echapper(c.type ?? '')}</small></td>
            <td><input type="checkbox" data-afficher ${v ? 'checked' : ''}></td>
            <td><input type="checkbox" data-recherche ${v?.recherche ? 'checked' : ''} ${v ? '' : 'disabled'}></td>
            <td><input type="checkbox" data-segment ${segments.has(c.code) ? 'checked' : ''}></td>
            <td><input type="checkbox" data-modifiable ${v?.modifiable ? 'checked' : ''} ${v && c.modifiable && this.sourceModifiable() ? '' : 'disabled'}
              title="${!this.sourceModifiable() ? texteHtml('liste.concepteur.table.lecture_seule') : !c.modifiable ? texteHtml('liste.concepteur.table.non_modifiable') : v ? '' : texteHtml('liste.concepteur.table.afficher_avant')}"></td>
            <td><select data-tri>${opt('', '—', tri?.colonne === c.code ? tri.sens : '')}${opt('asc', texte('liste.concepteur.table.croissant'), tri?.colonne === c.code ? tri.sens : '')}${opt('desc', texte('liste.concepteur.table.decroissant'), tri?.colonne === c.code ? tri.sens : '')}</select></td>
          </tr>`;
        }).join('') || `<tr><td colspan="7" class="aide">${s.mode === 'requete' ? texteHtml('liste.concepteur.table.tester') : texteHtml('liste.concepteur.table.choisir')}</td></tr>`}</tbody>
      </table>
      <fieldset class="concepteur-filtres"><legend>${texteHtml('liste.concepteur.filtres.titre')}</legend>
        ${this.#htmlFiltres(d.filtres, 'vue') || `<p class="aide">${texteHtml('liste.concepteur.filtres.aucun')}</p>`}
        <button type="button" data-action="ajouter-filtre" ${this.colonnesSource.length ? '' : 'disabled'}>${texteHtml('liste.concepteur.filtres.ajouter')}</button>
        ${this.colonnesSource.some((c) => c.code === COLONNE_USAGE) ? `<label class="fiche-option" title="${texteHtml('liste.concepteur.filtres.sommeil_aide')}"><input type="checkbox" data-sommeil ${d.sommeil ? 'checked' : ''}> ${texteHtml('liste.concepteur.filtres.sommeil')}</label>` : ''}
      </fieldset>
      <fieldset class="concepteur-calculees"><legend>${texteHtml('liste.concepteur.calculees.titre')}</legend>
        ${d.colonnes.filter((c) => c.calcul).map((c) => `<span class="pastille-colonne">${echapper(premiereLigne(c.titre))}</span>`).join('') || `<span class="aide">${texteHtml('liste.concepteur.calculees.aucune')}</span>`}
        <button type="button" data-action="ajouter-calcul">${texteHtml('liste.concepteur.calculees.ajouter')}</button>
      </fieldset>`;

    this.corps.querySelectorAll('[name="mode-source"]').forEach((r) => r.addEventListener('change', () => {
      s.mode = r.value;
      this.colonnesSource = s.mode === 'vue' ? this.sources.find((x) => x.code === s.vue)?.colonnes ?? [] : [];
      this.#rendreColonnes();
    }));
    this.corps.querySelector('[data-source-vue]').addEventListener('change', (e) => { this.#choisirSource(e.target.value); this.#rendreColonnes(); });
    this.corps.querySelector('[data-requete]').addEventListener('input', (e) => { s.requete = e.target.value; });
    this.corps.querySelector('[data-action="tester"]')?.addEventListener('click', async () => { await this.#testerRequete(); this.#rendreColonnes(); });
    this.corps.querySelectorAll('[data-source]').forEach((el) => el.addEventListener('change', () => {
      s[el.dataset.source] = el.value || null;
      if (el.dataset.source === 'colonne_type') this.#rendreColonnes();
    }));
    this.corps.querySelectorAll('tr[data-code]').forEach((tr) => {
      const code = tr.dataset.code;
      const src = this.colonnesSource.find((c) => c.code === code);
      tr.querySelector('[data-afficher]').addEventListener('change', (e) => {
        if (e.target.checked) {
          d.colonnes.push(normaliserDefinition({ colonnes: [{ code, titre: titreDepuisCode(code), recherche: !/bool|int|numeric|date|time/.test(src?.type ?? ''), ...formatPourType(src?.type) }] }).colonnes[0]);
        } else d.colonnes = d.colonnes.filter((c) => c.calcul || c.code !== code);
        this.#rendreColonnes();
      });
      tr.querySelector('[data-recherche]').addEventListener('change', (e) => { const c = affichees.get(code); if (c) c.recherche = e.target.checked; });
      tr.querySelector('[data-modifiable]').addEventListener('change', (e) => { const c = affichees.get(code); if (c) c.modifiable = e.target.checked; });
      tr.querySelector('[data-segment]').addEventListener('change', (e) => {
        d.segments = d.segments.filter((x) => x.colonne !== code);
        if (e.target.checked) d.segments.push({ colonne: code, titre: affichees.get(code)?.titre ?? titreDepuisCode(code) });
      });
      tr.querySelector('[data-tri]').addEventListener('change', (e) => {
        d.tri = e.target.value ? [{ colonne: code, sens: e.target.value }] : [];
        this.#rendreColonnes();
      });
    });
    this.#brancherFiltres(this.corps, d.filtres, 'vue', () => this.#rendreColonnes());
    this.corps.querySelector('[data-sommeil]')?.addEventListener('change', (e) => { d.sommeil = e.target.checked; });
    this.corps.querySelector('[data-action="ajouter-filtre"]').addEventListener('click', () => {
      d.filtres.push(this.#nouveauFiltre());
      this.#rendreColonnes();
    });
    this.corps.querySelector('[data-action="ajouter-calcul"]').addEventListener('click', () => {
      let n = 1;
      while (d.colonnes.some((c) => c.code === `calcul_${n}`)) n++;
      d.colonnes.push(normaliserDefinition({ colonnes: [{ code: `calcul_${n}`, calcul: true, titre: texte('liste.concepteur.calculees.nom', { numero: n }), formule: '""', style: { ...STYLE_VIDE } }] }).colonnes[0]);
      this.selection = `calcul_${n}`;
      this.onglet = 'forme';
      this.rendre();
    });
  }
  #nouveauFiltre() {
    const booleen = this.colonnesSource.find((c) => /bool/.test(c.type ?? ''));
    return booleen ? { colonne: booleen.code, op: 'vrai' } : { colonne: this.colonnesSource[0]?.code ?? '', op: '=', valeur: '' };
  }

  /** Lignes d'édition d'une liste de filtres (filtres de la vue, d'un indicateur, de son dénominateur). */
  #htmlFiltres(filtres, groupe) {
    return filtres.map((f, i) => {
      const src = this.colonnesSource.find((c) => c.code === f.colonne);
      const type = /date|time/.test(src?.type ?? '') ? 'date' : 'text';
      return `<div class="filtre-vue" data-filtres="${echapper(groupe)}" data-i="${i}">
        <select data-f="colonne">${opt('', texte('liste.concepteur.filtres.colonne'), f.colonne)}${this.colonnesSource.map((c) => opt(c.code, c.code, f.colonne)).join('')}</select>
        <select data-f="op">${OPERATEURS_VUE.map(([v, l]) => opt(v, l, f.op)).join('')}</select>
        <input data-f="valeur" type="${type}" value="${echapper(f.op === 'dans' ? (f.valeurs ?? []).join(' ; ') : f.valeur ?? '')}" ${SANS_VALEUR.has(f.op) ? 'hidden' : ''} placeholder="${texteHtml(f.op === 'dans' ? 'liste.concepteur.filtres.valeurs' : 'liste.concepteur.filtres.valeur')}">
        <input data-f="valeur2" type="${type}" value="${echapper(f.valeur2 ?? '')}" ${f.op === 'entre' ? '' : 'hidden'} placeholder="${texteHtml('liste.menu.et')}">
        <button type="button" data-supprimer-filtre title="${texteHtml('liste.concepteur.filtres.supprimer')}">${iconeHtml('retirer')}</button>
      </div>`;
    }).join('');
  }

  #brancherFiltres(racine, filtres, groupe, rendre) {
    racine.querySelectorAll(`[data-filtres="${CSS.escape(groupe)}"]`).forEach((div) => {
      const f = filtres[Number(div.dataset.i)];
      div.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.f;
        if (k === 'valeur' && f.op === 'dans') { f.valeurs = el.value.split(';').map((x) => x.trim()).filter(Boolean); delete f.valeur; }
        else f[k] = el.value || null;
        if (k === 'op' || k === 'colonne') {
          if (f.op === 'dans') { f.valeurs = f.valeur ? [f.valeur] : f.valeurs ?? []; delete f.valeur; } else delete f.valeurs;
          if (SANS_VALEUR.has(f.op)) { delete f.valeur; delete f.valeur2; }
          if (f.op !== 'entre') delete f.valeur2;
          rendre();
        }
      }));
      div.querySelector('[data-supprimer-filtre]').addEventListener('click', () => { filtres.splice(Number(div.dataset.i), 1); rendre(); });
    });
  }

  // ---------------------------------------------------------------- onglet Indicateurs

  /** Cartes du bandeau de synthèse : calculées par la base sur toute la sélection ; un clic pose leurs filtres. */
  #rendreIndicateurs() {
    const d = this.def;
    const numeriques = this.colonnesSource.filter((c) => /int|numeric|decimal|real|double|money|float/.test(String(c.type ?? '').toLowerCase()));
    this.corps.innerHTML = `
      <p class="aide">${texteHtml('liste.concepteur.indicateurs.aide')}</p>
      ${d.indicateurs.map((ind, i) => `
        <fieldset class="concepteur-indicateur" data-indicateur="${i}"><legend>${echapper(ind.titre || ind.code)}</legend>
          <div class="formulaire">
            <label>${texteHtml('liste.concepteur.indicateurs.titre')} <input data-ind="titre" value="${echapper(ind.titre ?? '')}"></label>
            <label>${texteHtml('liste.concepteur.indicateurs.calcul')} <select data-ind="calcul">${Object.entries(CALCULS_INDICATEUR).map(([v, l]) => opt(v, l, ind.calcul)).join('')}</select></label>
            <label ${['compte', 'ratio'].includes(ind.calcul) ? 'hidden' : ''}>${texteHtml('liste.concepteur.indicateurs.colonne')} <select data-ind="colonne">${opt('', texte('liste.concepteur.indicateurs.aucune_colonne'), ind.colonne)}${numeriques.map((c) => opt(c.code, c.code, ind.colonne)).join('')}</select></label>
            <label>${texteHtml('liste.concepteur.champs.format')} <select data-ind="format">${Object.entries(FORMATS_INDICATEUR).map(([v, l]) => opt(v, l, ind.format)).join('')}</select></label>
            <label>${texteHtml('liste.concepteur.indicateurs.teinte')} <select data-ind="teinte">${TEINTES_PASTILLE.filter((t) => t !== 'barre').map((t) => opt(t, t, ind.teinte)).join('')}</select></label>
            <label class="large">${texteHtml('liste.concepteur.champs.bulle')} <input data-ind="bulle" value="${echapper(ind.bulle ?? '')}"></label>
          </div>
          <div class="filtres-indicateur"><strong>${texteHtml(`liste.concepteur.indicateurs.${ind.calcul === 'ratio' ? 'numerateur' : 'filtres'}`)}</strong>
            ${this.#htmlFiltres(ind.filtres, `ind-${i}`) || `<span class="aide">${texteHtml('liste.concepteur.indicateurs.sans_filtre')}</span>`}
            <button type="button" data-ajouter-filtre="filtres">${texteHtml('liste.concepteur.filtres.ajouter')}</button></div>
          ${ind.calcul === 'ratio' ? `<div class="filtres-indicateur"><strong>${texteHtml('liste.concepteur.indicateurs.denominateur')}</strong>
            ${this.#htmlFiltres(ind.denominateur, `den-${i}`) || `<span class="aide">${texteHtml('liste.concepteur.indicateurs.sans_filtre')}</span>`}
            <button type="button" data-ajouter-filtre="denominateur">${texteHtml('liste.concepteur.filtres.ajouter')}</button></div>` : ''}
          <div class="concepteur-indicateur-actions">
            <button type="button" data-monter ${i ? '' : 'disabled'} title="${texteHtml('liste.concepteur.monter')}">${iconeHtml('liste_monter')}</button>
            <button type="button" data-descendre ${i < d.indicateurs.length - 1 ? '' : 'disabled'} title="${texteHtml('liste.concepteur.descendre')}">${iconeHtml('liste_descendre')}</button>
            <button type="button" data-supprimer-indicateur>${texteHtml('liste.concepteur.indicateurs.supprimer')}</button>
          </div>
        </fieldset>`).join('') || `<p class="aide">${texteHtml('liste.concepteur.indicateurs.aucun')}</p>`}
      <button type="button" data-action="ajouter-indicateur" ${this.colonnesSource.length ? '' : 'disabled'}>${texteHtml('liste.concepteur.indicateurs.ajouter')}</button>`;

    const rendre = () => this.#rendreIndicateurs();
    this.corps.querySelectorAll('[data-indicateur]').forEach((fs) => {
      const i = Number(fs.dataset.indicateur);
      const ind = d.indicateurs[i];
      fs.querySelectorAll('[data-ind]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        ind[el.dataset.ind] = el.value || null;
        if (el.dataset.ind === 'titre') fs.querySelector('legend').textContent = el.value || ind.code;
        if (el.dataset.ind === 'calcul') {
          if (ind.calcul === 'ratio') ind.format = 'pourcentage';
          if (['compte', 'ratio'].includes(ind.calcul)) ind.colonne = null;
          rendre();
        }
      }));
      this.#brancherFiltres(fs, ind.filtres, `ind-${i}`, rendre);
      if (ind.calcul === 'ratio') this.#brancherFiltres(fs, ind.denominateur, `den-${i}`, rendre);
      fs.querySelectorAll('[data-ajouter-filtre]').forEach((b) => b.addEventListener('click', () => { ind[b.dataset.ajouterFiltre].push(this.#nouveauFiltre()); rendre(); }));
      const deplacer = (j) => { const [x] = d.indicateurs.splice(i, 1); d.indicateurs.splice(j, 0, x); rendre(); };
      fs.querySelector('[data-monter]').addEventListener('click', () => deplacer(i - 1));
      fs.querySelector('[data-descendre]').addEventListener('click', () => deplacer(i + 1));
      fs.querySelector('[data-supprimer-indicateur]').addEventListener('click', () => { d.indicateurs.splice(i, 1); rendre(); });
    });
    this.corps.querySelector('[data-action="ajouter-indicateur"]').addEventListener('click', () => {
      let n = 1;
      while (d.indicateurs.some((x) => x.code === `ind_${n}`)) n++;
      d.indicateurs.push(normaliserDefinition({ indicateurs: [{ code: `ind_${n}`, titre: texte('liste.concepteur.indicateurs.nouveau', { n }) }] }).indicateurs[0]);
      rendre();
    });
  }
}
