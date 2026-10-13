import { echapper, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';

// Vues de colonnes de la grille des lignes : choix de la vue, dialogue des colonnes (visibilité, ordre, mode débogage
// et colonnes système), enregistrement personnel ou global, vue par défaut d'un type et d'un modèle de document.
// La vue choisie est gardée dans le navigateur par type et modèle (préférence d'affichage, jamais dans la base).

/**
 * Fournisseur en mémoire (démo hors ligne) : mêmes règles que le service serveur (vue globale ou par défaut réservée
 * à un administrateur, une seule vue par défaut par type et modèle).
 */
export class FournisseurVuesMemoire {
  constructor({ vues = [], utilisateur = () => 'demo', admin = () => true } = {}) {
    this.liste = vues.map((v) => structuredClone(v));
    this.utilisateur = utilisateur;
    this.admin = admin;
  }

  async vues(type) {
    const tydId = type?.tyd_id ?? null;
    const u = this.utilisateur();
    return this.liste.filter((v) => (v.globale || v.proprietaire === u) && (v.tyd_id === null || v.tyd_id === tydId)).map((v) => structuredClone(v));
  }

  async enregistrer(d) {
    if (!d.nom?.trim()) throw new Error('Nom de la vue obligatoire');
    if ((d.globale || d.par_defaut) && !this.admin()) throw new Error('Vue globale réservée à un administrateur');
    let v = d.id ? this.liste.find((x) => x.id === d.id) : null;
    if (v && !v.globale && v.proprietaire !== this.utilisateur()) throw new Error('Vue d\'un autre utilisateur');
    if (!v) {
      v = { id: Math.max(0, ...this.liste.map((x) => x.id)) + 1 };
      this.liste.push(v);
    }
    const globale = Boolean(d.globale || d.par_defaut);
    Object.assign(v, {
      nom: d.nom.trim(), tyd_id: d.tyd_id ?? null, mod_code: d.mod_code || null, globale,
      proprietaire: globale ? null : this.utilisateur(), par_defaut: Boolean(d.par_defaut), definition: structuredClone(d.definition),
    });
    if (v.par_defaut) for (const x of this.liste) if (x !== v && x.par_defaut && x.tyd_id === v.tyd_id && x.mod_code === v.mod_code) x.par_defaut = false;
    return structuredClone(v);
  }

  async supprimer(id) {
    const i = this.liste.findIndex((x) => x.id === id);
    if (i < 0) return;
    const v = this.liste[i];
    if (v.globale ? !this.admin() : v.proprietaire !== this.utilisateur()) throw new Error('Suppression non autorisée');
    this.liste.splice(i, 1);
  }
}

/** Vue par défaut d'un type et d'un modèle : la plus précise (type et modèle, puis modèle seul, type seul, aucun). */
export function vueParDefaut(vues, tydId, modele) {
  const defaut = vues.filter((v) => v.par_defaut);
  const cherche = (t, m) => defaut.find((v) => v.tyd_id === t && (v.mod_code ?? null) === m);
  return (modele && (cherche(tydId, modele) ?? cherche(null, modele))) ?? cherche(tydId, null) ?? cherche(null, null)
    ?? defaut.find((v) => v.mod_code === 'COMPLET') ?? null;
}

/**
 * Choix et gestion des vues de colonnes d'un éditeur de document. `fournisseur` : vues(tydId), enregistrer(vue),
 * supprimer(id) (vues(type) : type de document { tyd_id, tyd_code }) ; `admin()` : vues globales et par défaut permises ; `message(texte)`.
 */
export class GestionVuesDocument {
  constructor(conteneur, { editeur, fournisseur, admin = () => false, message = () => {} }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.fournisseur = fournisseur;
    this.admin = admin;
    this.message = message;
    this.vues = [];
    this.courante = null;
  }

  get type() { return this.editeur.definition.type ?? {}; }
  get modele() { return this.editeur.saisie.document.ent_modele ?? null; }
  get clePreference() { return `${this.type.tyd_code ?? ''}|${this.modele ?? ''}`; }

  async charger() {
    this.vues = await this.fournisseur.vues(this.type).catch((e) => { this.message(`Vues de colonnes indisponibles : ${e.message}`); return []; });
    const memo = lirePreferences().vuesDocument?.[this.clePreference];
    const vue = this.vues.find((v) => v.id === memo) ?? vueParDefaut(this.vues, this.type.tyd_id ?? null, this.modele);
    this.appliquer(vue, { memoriser: false });
  }

  /** Modèle du document changé : la vue mémorisée (ou par défaut) de ce modèle est appliquée. */
  async changerModele() { await this.charger(); }

  appliquer(vue, { memoriser = true } = {}) {
    this.courante = vue ?? null;
    this.editeur.appliquerVue(vue?.definition ?? null);
    if (memoriser) {
      const p = lirePreferences().vuesDocument ?? {};
      ecrirePreferences({ vuesDocument: { ...p, [this.clePreference]: vue?.id ?? null } });
    }
    this.rendre();
  }

  rendre() {
    const c = this.conteneur;
    const globales = this.vues.filter((v) => v.globale);
    const miennes = this.vues.filter((v) => !v.globale);
    const option = (v) => `<option value="${v.id}" ${v.id === this.courante?.id ? 'selected' : ''}>${echapper(v.nom)}${v.par_defaut ? ' ★' : ''}${v.definition?.debogage ? ' 🐞' : ''}</option>`;
    c.classList.add('vues-document');
    c.innerHTML = `
      <select data-vue title="Vue de colonnes (★ : vue par défaut d'un modèle · 🐞 : débogage)">
        <option value="" ${this.courante ? '' : 'selected'}>Toutes les colonnes</option>
        ${globales.length ? `<optgroup label="Vues globales">${globales.map(option).join('')}</optgroup>` : ''}
        ${miennes.length ? `<optgroup label="Mes vues">${miennes.map(option).join('')}</optgroup>` : ''}
        ${this.courante && !this.vues.includes(this.courante) ? `<option value="tmp" selected>${echapper(this.courante.nom)} (non enregistrée)</option>` : ''}
      </select>
      <button type="button" data-colonnes title="Colonnes… : colonnes affichées, ordre, mode débogage, enregistrement de la vue">▦</button>`;
    c.querySelector('[data-vue]').addEventListener('change', (e) => {
      if (e.target.value === 'tmp') return;
      this.appliquer(this.vues.find((v) => v.id === Number(e.target.value)) ?? null);
      this.editeur.grille.focus();
    });
    c.querySelector('[data-colonnes]').addEventListener('click', () => this.ouvrirDialogue());
  }

  /** Dialogue des colonnes : la vue courante (ou toutes les colonnes) sert de point de départ. */
  ouvrirDialogue() {
    const ed = this.editeur;
    const catalogue = ed.colonnes();
    const base = this.courante?.definition;
    const visibles = base?.colonnes?.length ? base.colonnes.map((c) => c.cle).filter((k) => catalogue.some((c) => c.cle === k)) : catalogue.map((c) => c.cle);
    // Ordre : colonnes visibles dans leur ordre, puis les colonnes masquées.
    const etat = {
      ordre: [...visibles, ...catalogue.map((c) => c.cle).filter((k) => !visibles.includes(k))],
      visibles: new Set(visibles),
      debogage: Boolean(base?.debogage),
      systeme: new Set(base?.systeme ?? []),
    };
    const titres = new Map(catalogue.map((c) => [c.cle, c.titre]));
    const champsSysteme = ed.champsSysteme();
    const v = this.courante && this.vues.includes(this.courante) ? this.courante : null;
    const modifiable = !v || (v.globale ? this.admin() : true);
    const admin = this.admin();
    const modeles = ed.definition.modeles ?? [];

    const dlg = document.createElement('dialog');
    dlg.className = 'dialogue-vue';
    const listeColonnes = () => etat.ordre.map((k, i) => `<li data-cle="${k}">
        <input type="checkbox" data-visible ${etat.visibles.has(k) ? 'checked' : ''} id="vc-${k}"><span><label for="vc-${k}">${echapper(titres.get(k) ?? k)}</label></span>
        <button type="button" data-haut ${i === 0 ? 'disabled' : ''} title="Monter">↑</button><button type="button" data-bas ${i === etat.ordre.length - 1 ? 'disabled' : ''} title="Descendre">↓</button></li>`).join('');
    const listeSysteme = () => champsSysteme.map((k) => `<li class="systeme"><input type="checkbox" data-sys="${echapper(k)}" ${etat.systeme.has(k) ? 'checked' : ''}><span>${echapper(k === '_controles' ? 'Contrôles (codes des erreurs)' : k)}</span></li>`).join('');
    dlg.innerHTML = `<form method="dialog">
      <h3>Colonnes de la grille</h3>
      <div class="dialogue-colonnes">
        <section><h4>Colonnes (ordre d'affichage)</h4><ul class="colonnes-vue" data-liste>${listeColonnes()}</ul></section>
        <section>
          <h4><label><input type="checkbox" data-debogage ${etat.debogage ? 'checked' : ''}> Mode débogage</label></h4>
          <p class="aide">Ajoute les colonnes système (valeurs brutes, identifiants, liens, contrôles) masquées en saisie, pour comprendre une erreur. Aucune cochée : toutes.</p>
          <ul class="colonnes-vue" data-systeme ${etat.debogage ? '' : 'hidden'}>${listeSysteme()}</ul>
        </section>
      </div>
      <fieldset class="enregistrement"><legend>Enregistrer la vue</legend>
        <label>Nom <input data-nom value="${echapper(v?.nom ?? '')}" placeholder="Ma vue"></label>
        <label><input type="radio" name="portee" value="perso" ${!v?.globale ? 'checked' : ''}> Personnelle</label>
        <label title="${admin ? '' : 'Réservé à un administrateur'}"><input type="radio" name="portee" value="globale" ${v?.globale ? 'checked' : ''} ${admin ? '' : 'disabled'}> Globale</label>
        <label title="Types de documents concernés">Pour <select data-tyd><option value="">tous les types</option><option value="${this.type.tyd_id}" ${v?.tyd_id ? 'selected' : ''}>${echapper(this.type.tyd_libelle ?? 'ce type')}</option></select></label>
        <label>Modèle <select data-modele><option value="">tous les modèles</option>${modeles.map((m) => `<option value="${echapper(m.code)}" ${(v?.mod_code ?? this.modele) === m.code ? 'selected' : ''}>${echapper(m.libelle)}</option>`).join('')}</select></label>
        <label title="${admin ? 'Vue proposée à l\'ouverture des documents de ce type et de ce modèle' : 'Réservé à un administrateur'}"><input type="checkbox" data-defaut ${v?.par_defaut ? 'checked' : ''} ${admin ? '' : 'disabled'}> Vue par défaut</label>
      </fieldset>
      <div class="boutons">
        <button type="button" data-appliquer title="Appliquer sans enregistrer">Appliquer</button>
        ${v && modifiable ? '<button type="button" data-enregistrer class="principal">Enregistrer</button>' : ''}
        <button type="button" data-nouvelle ${v ? '' : 'class="principal"'}>Enregistrer comme nouvelle vue</button>
        ${v && modifiable ? '<button type="button" data-supprimer>Supprimer la vue</button>' : ''}
        <button type="button" data-tout>Toutes les colonnes</button>
        <button value="annuler">Fermer</button>
      </div></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    const fermer = () => { dlg.close(); dlg.remove(); };

    const liste = dlg.querySelector('[data-liste]');
    const redessiner = () => { liste.innerHTML = listeColonnes(); };
    liste.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const i = etat.ordre.indexOf(li.dataset.cle);
      const j = e.target.closest('[data-haut]') ? i - 1 : e.target.closest('[data-bas]') ? i + 1 : null;
      if (j === null || j < 0 || j >= etat.ordre.length) return;
      [etat.ordre[i], etat.ordre[j]] = [etat.ordre[j], etat.ordre[i]];
      redessiner();
    });
    liste.addEventListener('change', (e) => {
      const k = e.target.closest('li')?.dataset.cle;
      if (!k || !e.target.matches('[data-visible]')) return;
      if (e.target.checked) etat.visibles.add(k); else etat.visibles.delete(k);
    });
    dlg.querySelector('[data-debogage]').addEventListener('change', (e) => {
      etat.debogage = e.target.checked;
      dlg.querySelector('[data-systeme]').hidden = !etat.debogage;
    });
    dlg.querySelector('[data-systeme]').addEventListener('change', (e) => {
      const k = e.target.dataset.sys;
      if (k) { if (e.target.checked) etat.systeme.add(k); else etat.systeme.delete(k); }
    });

    const definition = () => ({
      colonnes: etat.ordre.filter((k) => etat.visibles.has(k)).map((cle) => ({ cle })),
      debogage: etat.debogage,
      systeme: etat.debogage ? champsSysteme.filter((k) => etat.systeme.has(k)) : [],
    });
    const valide = () => {
      if (!etat.visibles.size) { this.message('Au moins une colonne doit être affichée'); return false; }
      return true;
    };
    // Options d'enregistrement modifiées par l'utilisateur : une nouvelle vue ne reprend la portée globale et le statut
    // « par défaut » de la vue d'origine que s'ils ont été choisis explicitement.
    const touches = new Set();
    dlg.querySelector('fieldset.enregistrement').addEventListener('change', (e) => touches.add(e.target.name || Object.keys(e.target.dataset)[0]));
    const enregistrer = async (id) => {
      if (!valide()) return;
      const nom = dlg.querySelector('[data-nom]').value.trim();
      if (!nom) { this.message('Nom de la vue obligatoire'); dlg.querySelector('[data-nom]').focus(); return; }
      const nouvelle = !id;
      if (nouvelle && v && nom === v.nom) { this.message('Donnez un autre nom à la nouvelle vue'); dlg.querySelector('[data-nom]').select(); return; }
      const parDefaut = nouvelle && !touches.has('defaut') ? false : dlg.querySelector('[data-defaut]').checked;
      const globale = nouvelle && !touches.has('portee') ? false : dlg.querySelector('[name="portee"]:checked')?.value === 'globale';
      const tyd = dlg.querySelector('[data-tyd]').value;
      try {
        const sauvee = await this.fournisseur.enregistrer({
          id: id ?? 0, nom, tyd_id: tyd ? Number(tyd) : null, mod_code: dlg.querySelector('[data-modele]').value || null,
          globale: globale || parDefaut, par_defaut: parDefaut, definition: definition(),
        });
        this.vues = await this.fournisseur.vues(this.type);
        fermer();
        this.appliquer(this.vues.find((x) => x.id === sauvee.id) ?? sauvee);
        this.message(`Vue « ${sauvee.nom} » enregistrée`);
      } catch (e) { this.message(e.message); }
    };
    dlg.querySelector('[data-appliquer]').addEventListener('click', () => {
      if (!valide()) return;
      fermer();
      this.appliquer({ id: null, nom: v ? `${v.nom} modifiée` : 'Vue personnalisée', definition: definition() }, { memoriser: false });
    });
    dlg.querySelector('[data-enregistrer]')?.addEventListener('click', () => enregistrer(v.id));
    dlg.querySelector('[data-nouvelle]').addEventListener('click', () => enregistrer(null));
    dlg.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!confirm(`Supprimer la vue « ${v.nom} »${v.globale ? ' (vue globale, pour tous les utilisateurs)' : ''}${v.par_defaut ? ', vue par défaut de son modèle' : ''} ?`)) return;
      try {
        await this.fournisseur.supprimer(v.id);
        this.vues = this.vues.filter((x) => x.id !== v.id);
        fermer();
        this.appliquer(vueParDefaut(this.vues, this.type.tyd_id ?? null, this.modele));
      } catch (e) { this.message(e.message); }
    });
    dlg.querySelector('[data-tout]').addEventListener('click', () => {
      etat.ordre = catalogue.map((c) => c.cle);
      etat.visibles = new Set(etat.ordre);
      redessiner();
    });
    dlg.showModal();
  }
}
