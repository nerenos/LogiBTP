import { echapper } from '@logibtp/socle/ui';
import { normaliserDefinition, FORMATS, STYLE_VIDE } from '../src/modele.js';
import { compilerFormule, resolveurColonnes } from '../src/formule.js';

// Concepteur de vue de liste, en deux onglets :
//   Mise en forme        titres (multilignes), bulles, formats, couleurs, gras / italique / souligné / barré,
//                        ordre, largeur (fixe, proportionnelle, min / max), colonnes masquées, formules,
//                        règles de mise en forme conditionnelle, nom et partage de la vue
//   Colonnes et source   vue de la base ou requête manuelle (ADMIN), identifiant et type d'élément (ouverture
//                        de la fiche), colonnes affichées, colonnes de recherche, segments, tri par défaut

const LIB_FORMATS = { texte: 'Texte', nombre: 'Numérique', date: 'Date', coche: 'Case à cocher', combo: 'Liste (combo)', picto: 'Picto (petite image)' };
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
  constructor({ fournisseur, vue, peutRequete = false, appliquer, enregistrer, supprimer, message }) {
    this.fournisseur = fournisseur;
    this.vue = { ...structuredClone(vue), definition: normaliserDefinition(vue.definition) };
    this.peutRequete = peutRequete;
    this.cb = { appliquer, enregistrer, supprimer, message: message ?? (() => {}) };
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
    const fond = document.createElement('div');
    fond.className = 'concepteur-fond';
    fond.innerHTML = `
      <div class="concepteur" role="dialog" aria-label="Concepteur de vue">
        <header>
          <label>Nom de la vue <input data-vue="vli_nom" value="${echapper(this.vue.vli_nom ?? '')}"></label>
          <label>Partage <select data-vue="vli_partage">
            ${opt('P', 'Moi seul', this.vue.vli_partage)}${opt('G', 'Mon groupe', this.vue.vli_partage)}${opt('T', 'Tous', this.vue.vli_partage)}</select></label>
          <label class="groupe-partage">Groupe <input data-vue="vli_groupe" value="${echapper(this.vue.vli_groupe ?? '')}"></label>
          <nav>
            <button type="button" data-onglet="forme">Mise en forme</button>
            <button type="button" data-onglet="colonnes">Colonnes et source</button>
          </nav>
          <button type="button" data-action="fermer" title="Fermer (Échap)">✕</button>
        </header>
        <div class="concepteur-corps"></div>
        <footer>
          <span class="concepteur-message"></span>
          <button type="button" data-action="supprimer" ${this.vue.vli_id ? '' : 'hidden'}>Supprimer la vue</button>
          <button type="button" data-action="appliquer" title="Appliquer à la liste sans enregistrer">Appliquer</button>
          <button type="button" data-action="copie" ${this.vue.vli_id ? '' : 'hidden'}>Enregistrer comme nouvelle vue</button>
          <button type="button" class="principal" data-action="enregistrer">Enregistrer</button>
        </footer>
      </div>`;
    document.body.append(fond);
    this.fond = fond;
    this.corps = fond.querySelector('.concepteur-corps');
    fond.querySelectorAll('[data-vue]').forEach((el) => el.addEventListener('input', () => {
      this.vue[el.dataset.vue] = el.value || null;
      this.#majPartage();
    }));
    this.#majPartage();
    fond.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.onglet = b.dataset.onglet; this.rendre(); }));
    fond.querySelector('[data-action="fermer"]').addEventListener('click', () => this.fermer());
    fond.querySelector('[data-action="appliquer"]').addEventListener('click', () => { if (this.#valider(false)) this.cb.appliquer(structuredClone(this.vue)); });
    fond.querySelector('[data-action="enregistrer"]').addEventListener('click', () => this.#enregistrer(false));
    fond.querySelector('[data-action="copie"]').addEventListener('click', () => this.#enregistrer(true));
    fond.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm(`Supprimer la vue « ${this.vue.vli_nom} » ?`)) return;
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

  #erreur(texte) {
    const m = this.fond.querySelector('.concepteur-message');
    m.textContent = texte ?? '';
    m.classList.toggle('erreur', !!texte);
  }

  async #chargerSources() {
    this.sources = await this.fournisseur.sources();
    const s = this.def.source;
    if (s.mode === 'vue' && !s.vue && this.sources[0]) this.#choisirSource(this.sources[0].code);
    else if (s.mode === 'vue') this.colonnesSource = this.sources.find((x) => x.code === s.vue)?.colonnes ?? [];
    else if (s.requete && this.peutRequete) await this.#testerRequete(false);
    this.rendre();
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
      if (signaler) this.cb.message(`Requête valide : ${this.colonnesSource.length} colonne(s)`, 'succes');
    } catch (e) {
      this.colonnesSource = [];
      this.#erreur(e.message);
    }
  }

  #valider(complet) {
    const d = this.def;
    const erreurs = [];
    if (!this.vue.vli_nom?.trim()) erreurs.push('Nom de la vue obligatoire');
    if (d.source.mode === 'vue' ? !d.source.vue : !d.source.requete?.trim()) erreurs.push('Source de données à choisir');
    if (!d.source.colonne_id) erreurs.push('Colonne identifiant obligatoire (ouverture de la fiche)');
    if (!d.source.colonne_type && !d.source.type_element) erreurs.push('Type d\'élément obligatoire (colonne ou valeur constante)');
    if (!d.colonnes.length) erreurs.push('Au moins une colonne');
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
    if (copie) { v.vli_id = null; v.vli_nom = `${v.vli_nom} (copie)`; }
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
    if (this.onglet === 'forme') this.#rendreForme(); else this.#rendreColonnes();
  }

  // ---------------------------------------------------------------- onglet Mise en forme

  #rendreForme() {
    const d = this.def;
    this.corps.innerHTML = `
      <div class="concepteur-forme">
        <aside class="concepteur-liste">
          <ol>${d.colonnes.map((c, i) => `
            <li data-code="${echapper(c.code)}" class="${c.code === this.selection ? 'actif' : ''} ${c.masquee ? 'masquee' : ''}">
              <span class="nom">${echapper(premiereLigne(c.titre) || c.code)}${c.calcul ? ' <em>ƒ</em>' : ''}</span>
              <button type="button" data-masquer title="${c.masquee ? 'Afficher' : 'Masquer'}">${c.masquee ? '◌' : '◉'}</button>
              <button type="button" data-monter ${i === 0 ? 'disabled' : ''} title="Monter">↑</button>
              <button type="button" data-descendre ${i === d.colonnes.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
            </li>`).join('')}</ol>
          ${d.colonnes.length ? '' : '<p class="aide">Aucune colonne : choisissez-les dans l\'onglet « Colonnes et source ».</p>'}
          <fieldset><legend>Vue</legend>
            <label>Hauteur des lignes <select data-def="lignes">${opt('multi', 'Multiligne (texte complet)', d.lignes)}${opt('simple', 'Une ligne', d.lignes)}</select></label>
            <label>Lignes par lot <input type="number" min="20" max="1000" step="10" data-def="taille_lot" value="${d.taille_lot}"></label>
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
    if (!c) { zone.innerHTML = '<p class="aide">Sélectionnez une colonne.</p>'; return; }
    const s = c.style;
    const couleur = (cle, libelle) => `<label class="couleur">${libelle}
      <input type="color" data-style="${cle}" value="${echapper(s[cle] ?? (cle === 'fond' ? '#ffffff' : '#000000'))}">
      <label class="coche"><input type="checkbox" data-sans="${cle}" ${s[cle] ? '' : 'checked'}> aucune</label></label>`;
    const bascule = (cle, lettre, titre) => `<label class="bascule" title="${titre}"><input type="checkbox" data-style="${cle}" ${s[cle] ? 'checked' : ''}><span>${lettre}</span></label>`;
    const autres = this.def.colonnes.filter((x) => x.code !== c.code);
    zone.innerHTML = `
      <h3>${echapper(premiereLigne(c.titre) || c.code)} <small>${c.calcul ? 'colonne calculée' : `colonne ${echapper(c.code)} de la source`}</small></h3>
      <div class="formulaire">
        <label class="large">Titre (Entrée : nouvelle ligne) <textarea rows="2" data-col="titre">${echapper(c.titre ?? '')}</textarea></label>
        <label class="large">Bulle d'aide <input data-col="bulle" value="${echapper(c.bulle ?? '')}"></label>
        <label>Format <select data-col="format">${FORMATS.map((f) => opt(f, LIB_FORMATS[f], c.format)).join('')}</select></label>
        <label ${c.format === 'nombre' ? '' : 'hidden'}>Décimales <input type="number" min="0" max="6" data-col="decimales" value="${c.decimales ?? 2}"></label>
        <label>Alignement <select data-col="alignement">${opt('', 'Automatique', c.alignement)}${opt('gauche', 'Gauche', c.alignement)}${opt('centre', 'Centré', c.alignement)}${opt('droite', 'Droite', c.alignement)}</select></label>
        <label class="large" ${c.format === 'combo' || c.format === 'picto' ? '' : 'hidden'}>Valeurs (une par ligne : valeur | libellé | picto)
          <textarea rows="4" data-options placeholder="P | En panne | 🔴">${echapper(c.options.map((o) => [o.valeur, o.libelle, o.picto].filter((x) => x !== undefined && x !== null && x !== '').join(' | ')).join('\n'))}</textarea></label>
        <fieldset class="large"><legend>Mise en forme</legend>
          ${couleur('couleur', 'Texte')}${couleur('fond', 'Fond')}
          ${bascule('gras', 'G', 'Gras')}${bascule('italique', 'I', 'Italique')}${bascule('souligne', 'S', 'Souligné')}${bascule('barre', 'B', 'Barré')}
        </fieldset>
        <fieldset class="large"><legend>Largeur</legend>
          <label>Mode <select data-largeur="mode">${opt('auto', 'Automatique', c.largeur.mode)}${opt('fixe', 'Fixe (px)', c.largeur.mode)}${opt('proportionnel', 'Proportionnelle (poids)', c.largeur.mode)}</select></label>
          <label ${c.largeur.mode === 'auto' ? 'hidden' : ''}>${c.largeur.mode === 'fixe' ? 'Largeur (px)' : 'Poids'} <input type="number" min="0" data-largeur="valeur" value="${c.largeur.valeur ?? ''}"></label>
          <label>Min (px) <input type="number" min="0" data-largeur="min" value="${c.largeur.min ?? ''}"></label>
          <label>Max (px) <input type="number" min="0" data-largeur="max" value="${c.largeur.max ?? ''}"></label>
        </fieldset>
        <label class="coche"><input type="checkbox" data-col="masquee" ${c.masquee ? 'checked' : ''}> Masquée</label>
        ${c.calcul ? `
        <label class="large">Formule
          <textarea rows="3" data-col="formule" class="formule" placeholder='SI [Qté commandée] > [Qté livrée] ALORS "Reste à livrer" SINON ""'>${echapper(c.formule ?? '')}</textarea>
          <span class="validation" data-validation="formule"></span></label>
        <label>Insérer une colonne <select data-inserer="formule">${opt('', '—', '')}${autres.map((x) => opt(x.code, premiereLigne(x.titre) || x.code, '')).join('')}</select></label>
        <button type="button" data-action="supprimer-colonne">Supprimer la colonne calculée</button>` : ''}
        <fieldset class="large regles"><legend>Mise en forme conditionnelle (la première règle vraie s'ajoute au style, puis les suivantes)</legend>
          ${c.regles.map((r, i) => `
            <div class="regle" data-regle="${i}">
              <input class="formule" data-regle-champ="condition" value="${echapper(r.condition ?? '')}" placeholder='[État] = "En panne"'>
              <label title="Couleur du texte"><input type="checkbox" data-regle-avec="couleur" ${r.style?.couleur ? 'checked' : ''}>A<input type="color" data-regle-style="couleur" value="${echapper(r.style?.couleur ?? '#b42318')}"></label>
              <label title="Couleur de fond"><input type="checkbox" data-regle-avec="fond" ${r.style?.fond ? 'checked' : ''}>▇<input type="color" data-regle-style="fond" value="${echapper(r.style?.fond ?? '#fdecea')}"></label>
              ${['gras', 'italique', 'souligne', 'barre'].map((k) => `<label class="bascule" title="${k}"><input type="checkbox" data-regle-style="${k}" ${r.style?.[k] ? 'checked' : ''}><span>${{ gras: 'G', italique: 'I', souligne: 'S', barre: 'B' }[k]}</span></label>`).join('')}
              <button type="button" data-supprimer-regle title="Supprimer la règle">✕</button>
              <span class="validation" data-validation="regle-${i}"></span>
            </div>`).join('')}
          <button type="button" data-action="ajouter-regle">Ajouter une règle</button>
        </fieldset>
      </div>
      <p class="aide">Formules : [Colonne] (code ou titre), + − × ÷, &amp; (concaténation), = &lt;&gt; &lt; &gt;, ET, OU, NON,
        SI … ALORS … SINON …, SI(c; a; b), ARRONDI, ABS, MIN, MAX, ESTVIDE, CONCAT.</p>`;

    const rafraichirListe = () => {
      const li = this.corps.querySelector(`li[data-code="${CSS.escape(c.code)}"] .nom`);
      if (li) li.innerHTML = `${echapper(premiereLigne(c.titre) || c.code)}${c.calcul ? ' <em>ƒ</em>' : ''}`;
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
        .map(([valeur, libelle, picto]) => ({ valeur, libelle: libelle || valeur, ...(picto ? { picto } : {}) }));
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
      c.regles.push({ condition: '', style: { fond: '#fdecea' } });
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
        el.textContent = '✓';
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
        <fieldset><legend>Source des données</legend>
          <label class="coche"><input type="radio" name="mode-source" value="vue" ${s.mode === 'vue' ? 'checked' : ''}> Vue de la base</label>
          <select data-source-vue ${s.mode === 'vue' ? '' : 'disabled'}>${opt('', '—', s.vue)}${this.sources.map((x) => opt(x.code, x.libelle, s.vue)).join('')}</select>
          <label class="coche" title="${this.peutRequete ? '' : 'Réservé au profil ADMIN'}"><input type="radio" name="mode-source" value="requete" ${s.mode === 'requete' ? 'checked' : ''} ${this.peutRequete ? '' : 'disabled'}> Requête manuelle (SELECT)</label>
          <textarea rows="5" data-requete class="formule" ${s.mode === 'requete' && this.peutRequete ? '' : 'disabled'} placeholder="SELECT … FROM … (une seule instruction, lecture seule)">${echapper(s.requete ?? '')}</textarea>
          <button type="button" data-action="tester" ${s.mode === 'requete' && this.peutRequete ? '' : 'hidden'}>Tester la requête</button>
        </fieldset>
        <fieldset><legend>Ouverture de la fiche</legend>
          <label>Colonne identifiant <select data-source="colonne_id">${choixColonnes(s.colonne_id, '—')}</select></label>
          <label>Colonne type d'élément <select data-source="colonne_type">${choixColonnes(s.colonne_type, '(type constant)')}</select></label>
          <label ${s.colonne_type ? 'hidden' : ''}>Type constant <input data-source="type_element" value="${echapper(s.type_element ?? '')}" placeholder="devis, facture, salarie, materiel…"></label>
        </fieldset>
      </div>
      <table class="concepteur-table">
        <thead><tr><th>Colonne</th><th>Type</th><th>Afficher</th><th title="Incluse dans la barre de recherche (toute la base)">Recherche</th><th title="Filtre par segment (toute la base)">Segment</th><th>Tri par défaut</th></tr></thead>
        <tbody>${this.colonnesSource.map((c) => {
          const v = affichees.get(c.code);
          return `<tr data-code="${echapper(c.code)}">
            <td>${echapper(c.code)}</td><td><small>${echapper(c.type ?? '')}</small></td>
            <td><input type="checkbox" data-afficher ${v ? 'checked' : ''}></td>
            <td><input type="checkbox" data-recherche ${v?.recherche ? 'checked' : ''} ${v ? '' : 'disabled'}></td>
            <td><input type="checkbox" data-segment ${segments.has(c.code) ? 'checked' : ''}></td>
            <td><select data-tri>${opt('', '—', tri?.colonne === c.code ? tri.sens : '')}${opt('asc', 'Croissant', tri?.colonne === c.code ? tri.sens : '')}${opt('desc', 'Décroissant', tri?.colonne === c.code ? tri.sens : '')}</select></td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" class="aide">${s.mode === 'requete' ? 'Testez la requête pour obtenir ses colonnes.' : 'Choisissez une source.'}</td></tr>`}</tbody>
      </table>
      <fieldset class="concepteur-calculees"><legend>Colonnes calculées</legend>
        ${d.colonnes.filter((c) => c.calcul).map((c) => `<span class="pastille-colonne">${echapper(premiereLigne(c.titre))}</span>`).join('') || '<span class="aide">Aucune</span>'}
        <button type="button" data-action="ajouter-calcul">Ajouter une colonne calculée</button>
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
      tr.querySelector('[data-segment]').addEventListener('change', (e) => {
        d.segments = d.segments.filter((x) => x.colonne !== code);
        if (e.target.checked) d.segments.push({ colonne: code, titre: affichees.get(code)?.titre ?? titreDepuisCode(code) });
      });
      tr.querySelector('[data-tri]').addEventListener('change', (e) => {
        d.tri = e.target.value ? [{ colonne: code, sens: e.target.value }] : [];
        this.#rendreColonnes();
      });
    });
    this.corps.querySelector('[data-action="ajouter-calcul"]').addEventListener('click', () => {
      let n = 1;
      while (d.colonnes.some((c) => c.code === `calcul_${n}`)) n++;
      d.colonnes.push(normaliserDefinition({ colonnes: [{ code: `calcul_${n}`, calcul: true, titre: `Calcul ${n}`, formule: '""', style: { ...STYLE_VIDE } }] }).colonnes[0]);
      this.selection = `calcul_${n}`;
      this.onglet = 'forme';
      this.rendre();
    });
  }
}
