import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, lirePreferences, ecrirePreferences, confirmer, ouvrirModale } from '@logibtp/socle/ui';

// Vues de colonnes de la grille des lignes : choix de la vue, dialogue des colonnes (visibilité, ordre, largeurs, mode
// débogage et colonnes système), enregistrement personnel ou global, vue par défaut d'un type et d'un modèle de document.
// La vue choisie est gardée dans le navigateur par type et modèle (préférence d'affichage, jamais dans la base).
// Colonnes déplacées ou redimensionnées dans la grille : disposition gardée dans le navigateur pour cette vue
// (dispositionColonnes, par identifiant de vue, « toutes » sans vue) ; enregistrer la vue (dialogue) y écrit l'ordre et
// les largeurs (colonnes [{ cle, largeur }]) et efface la disposition du navigateur.

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
    // Vue d'un type désigné par son code (tyd_code, données de démonstration) : rattachée à l'identifiant du type.
    return this.liste.map((v) => (v.tyd_code && v.tyd_code === type?.tyd_code ? { ...v, tyd_id: tydId } : v))
      .filter((v) => (v.globale || v.proprietaire === u) && ((v.tyd_id ?? null) === null ? !v.tyd_code : v.tyd_id === tydId)).map((v) => structuredClone(v));
  }

  async enregistrer(d) {
    if (!d.nom?.trim()) throw new Error(texte('document.vues.nom_obligatoire'));
    if ((d.globale || d.par_defaut) && !this.admin()) throw new Error(texte('document.vues.globale_reservee'));
    let v = d.id ? this.liste.find((x) => x.id === d.id) : null;
    if (v && !v.globale && v.proprietaire !== this.utilisateur()) throw new Error(texte('document.vues.autre_utilisateur'));
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
    if (v.globale ? !this.admin() : v.proprietaire !== this.utilisateur()) throw new Error(texte('document.vues.suppression_refusee'));
    this.liste.splice(i, 1);
  }
}

/**
 * Définition de la vue complétée par la disposition du navigateur ({ colonnes: [{ cle, largeur }] }) : colonnes de la vue
 * dans l'ordre de la disposition (les autres à la suite), largeur de la disposition sinon de la vue. Sans vue : toutes
 * les colonnes du catalogue (`cles`).
 */
export function fusionnerDisposition(definition, disposition, cles = []) {
  if (!disposition?.colonnes?.length) return definition;
  const base = definition?.colonnes?.length ? definition.colonnes : cles.map((cle) => ({ cle }));
  const parCle = new Map(base.map((c) => [c.cle, c]));
  const reglees = new Map(disposition.colonnes.map((c) => [c.cle, c]));
  const ordre = [...disposition.colonnes.map((c) => c.cle).filter((k) => parCle.has(k)), ...base.map((c) => c.cle).filter((k) => !reglees.has(k))];
  const colonnes = ordre.map((cle) => {
    const largeur = reglees.has(cle) ? reglees.get(cle).largeur : parCle.get(cle).largeur;
    // Titre renommé dans la vue : gardé (la disposition de la grille ne porte que l'ordre et les largeurs).
    const titre = parCle.get(cle)?.titre;
    return { cle, ...(largeur ? { largeur } : {}), ...(titre ? { titre } : {}) };
  });
  return { debogage: false, systeme: [], ...definition, colonnes };
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
    editeur.surDisposition = (vue) => this.memoriserDisposition(vue);
  }

  /** Clé de la disposition du navigateur : vue enregistrée, ou « toutes » sans vue (vue appliquée sans enregistrement : aucune). */
  get cleDisposition() { return this.courante ? (this.courante.id ? `vue:${this.courante.id}` : null) : 'toutes'; }

  memoriserDisposition(vue) {
    const cle = this.cleDisposition;
    if (cle === null) { if (this.courante) this.courante = { ...this.courante, definition: vue }; return; }
    const p = lirePreferences().dispositionColonnes ?? {};
    ecrirePreferences({ dispositionColonnes: { ...p, [cle]: { colonnes: vue.colonnes } } });
  }

  oublierDisposition(cle) {
    const p = { ...(lirePreferences().dispositionColonnes ?? {}) };
    if (!(cle in p)) return;
    delete p[cle];
    ecrirePreferences({ dispositionColonnes: p });
  }

  get type() { return this.editeur.definition.type ?? {}; }
  get modele() { return this.editeur.saisie.document.ent_modele ?? null; }
  get clePreference() { return `${this.type.tyd_code ?? ''}|${this.modele ?? ''}`; }

  async charger() {
    this.vues = await this.fournisseur.vues(this.type).catch((e) => { this.message(texte('document.vues.indisponibles', { message: e.message })); return []; });
    const memo = lirePreferences().vuesDocument?.[this.clePreference];
    const vue = this.vues.find((v) => v.id === memo) ?? vueParDefaut(this.vues, this.type.tyd_id ?? null, this.modele);
    this.appliquer(vue, { memoriser: false });
  }

  /** Modèle du document changé : la vue mémorisée (ou par défaut) de ce modèle est appliquée. */
  async changerModele() { await this.charger(); }

  appliquer(vue, { memoriser = true } = {}) {
    this.courante = vue ?? null;
    const cle = this.cleDisposition;
    const disposition = cle ? lirePreferences().dispositionColonnes?.[cle] : null;
    this.editeur.appliquerVue(fusionnerDisposition(vue?.definition ?? null, disposition, this.editeur.colonnes().map((c) => c.cle)));
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
    const option = (v) => `<option value="${v.id}" ${v.id === this.courante?.id ? 'selected' : ''}>${echapper(v.nom)}${v.par_defaut ? ` ${iconeHtml('document_vue_defaut')}` : ''}${v.definition?.debogage ? ` ${iconeHtml('document_debogage')}` : ''}</option>`;
    c.classList.add('vues-document');
    c.innerHTML = `
      <select data-vue title="${texteHtml('document.vues.choix_aide', { defaut: icone('document_vue_defaut'), debogage: icone('document_debogage') })}">
        <option value="" ${this.courante ? '' : 'selected'}>${texteHtml('document.vues.toutes')}</option>
        ${globales.length ? `<optgroup label="${texteHtml('document.vues.globales')}">${globales.map(option).join('')}</optgroup>` : ''}
        ${miennes.length ? `<optgroup label="${texteHtml('document.vues.miennes')}">${miennes.map(option).join('')}</optgroup>` : ''}
        ${this.courante && !this.vues.includes(this.courante) ? `<option value="tmp" selected>${texteHtml('document.vues.non_enregistree', { nom: this.courante.nom })}</option>` : ''}
      </select>
      <button type="button" data-colonnes title="${texteHtml('document.vues.colonnes_aide')}">${iconeHtml('document_colonnes')}</button>`;
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
    // Point de départ : la vue affichée, disposition du navigateur comprise (ordre et largeurs réglés dans la grille).
    const base = ed.vue ?? this.courante?.definition;
    const visibles = base?.colonnes?.length ? base.colonnes.map((c) => c.cle).filter((k) => catalogue.some((c) => c.cle === k)) : catalogue.map((c) => c.cle);
    // Ordre : colonnes visibles dans leur ordre, puis les colonnes masquées.
    const etat = {
      ordre: [...visibles, ...catalogue.map((c) => c.cle).filter((k) => !visibles.includes(k))],
      visibles: new Set(visibles),
      debogage: Boolean(base?.debogage),
      systeme: new Set(base?.systeme ?? []),
      largeurs: new Map((base?.colonnes ?? []).filter((c) => c.largeur).map((c) => [c.cle, c.largeur])),
      // Titres renommés dans la vue (vide : titre d'origine de la colonne).
      renommes: new Map((base?.colonnes ?? []).filter((c) => c.titre).map((c) => [c.cle, c.titre])),
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
        <input data-titre size="14" maxlength="40" value="${echapper(etat.renommes.get(k) ?? '')}" placeholder="${echapper(titres.get(k) ?? k)}" title="${texteHtml('document.vues.titre_aide')}">
        <button type="button" data-haut ${i === 0 ? 'disabled' : ''} title="${texteHtml('document.parametrage.monter')}">${iconeHtml('document_haut')}</button><button type="button" data-bas ${i === etat.ordre.length - 1 ? 'disabled' : ''} title="${texteHtml('document.parametrage.descendre')}">${iconeHtml('document_bas')}</button></li>`).join('');
    const listeSysteme = () => champsSysteme.map((k) => `<li class="systeme"><input type="checkbox" data-sys="${echapper(k)}" ${etat.systeme.has(k) ? 'checked' : ''}><span>${echapper(k === '_controles' ? texte('document.vues.controles') : k)}</span></li>`).join('');
    dlg.innerHTML = `<form method="dialog">
      <h3>${texteHtml('document.vues.titre')}</h3>
      <div class="dialogue-colonnes">
        <section><h4>${texteHtml('document.vues.ordre')}</h4><ul class="colonnes-vue" data-liste>${listeColonnes()}</ul></section>
        <section>
          <p class="aide">${texteHtml('document.vues.ordre_aide')}
            <button type="button" data-largeurs ${etat.largeurs.size ? '' : 'disabled'}>${texteHtml('document.vues.largeurs_auto')}</button></p>
          <h4><label><input type="checkbox" data-debogage ${etat.debogage ? 'checked' : ''}> ${texteHtml('document.vues.debogage')}</label></h4>
          <p class="aide">${texteHtml('document.vues.debogage_aide')}</p>
          <ul class="colonnes-vue" data-systeme ${etat.debogage ? '' : 'hidden'}>${listeSysteme()}</ul>
        </section>
      </div>
      <fieldset class="enregistrement"><legend>${texteHtml('document.vues.enregistrer_vue')}</legend>
        <label>${texteHtml('document.vues.nom')} <input data-nom value="${echapper(v?.nom ?? '')}" placeholder="${texteHtml('document.vues.nom_exemple')}"></label>
        <label><input type="radio" name="portee" value="perso" ${!v?.globale ? 'checked' : ''}> ${texteHtml('document.vues.personnelle')}</label>
        <label title="${admin ? '' : texteHtml('document.vues.reserve_admin')}"><input type="radio" name="portee" value="globale" ${v?.globale ? 'checked' : ''} ${admin ? '' : 'disabled'}> ${texteHtml('document.vues.globale')}</label>
        <label title="${texteHtml('document.vues.types_aide')}">${texteHtml('document.vues.pour')} <select data-tyd><option value="">${texteHtml('document.vues.tous_types')}</option><option value="${this.type.tyd_id}" ${v?.tyd_id ? 'selected' : ''}>${echapper(this.type.tyd_libelle ?? texte('document.vues.ce_type'))}</option></select></label>
        <label>${texteHtml('document.vues.modele')} <select data-modele><option value="">${texteHtml('document.vues.tous_modeles')}</option>${modeles.map((m) => `<option value="${echapper(m.code)}" ${(v?.mod_code ?? this.modele) === m.code ? 'selected' : ''}>${echapper(m.libelle)}</option>`).join('')}</select></label>
        <label title="${texteHtml(admin ? 'document.vues.defaut_aide' : 'document.vues.reserve_admin')}"><input type="checkbox" data-defaut ${v?.par_defaut ? 'checked' : ''} ${admin ? '' : 'disabled'}> ${texteHtml('document.vues.par_defaut')}</label>
      </fieldset>
      <div class="boutons">
        <button type="button" data-appliquer title="${texteHtml('document.vues.appliquer_aide')}">${texteHtml('document.vues.appliquer')}</button>
        ${v && modifiable ? `<button type="button" data-enregistrer class="principal">${texteHtml('commun.enregistrer')}</button>` : ''}
        <button type="button" data-nouvelle ${v ? '' : 'class="principal"'}>${texteHtml('document.vues.nouvelle')}</button>
        ${v && modifiable ? `<button type="button" data-supprimer>${texteHtml('document.vues.supprimer')}</button>` : ''}
        <button type="button" data-tout>${texteHtml('document.vues.toutes')}</button>
        <button value="annuler">${texteHtml('commun.fermer')}</button>
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
      if (k && e.target.matches('[data-titre]')) {
        const t = e.target.value.trim();
        if (t) etat.renommes.set(k, t); else etat.renommes.delete(k);
        return;
      }
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
      colonnes: etat.ordre.filter((k) => etat.visibles.has(k)).map((cle) => ({
        cle, ...(etat.largeurs.has(cle) ? { largeur: etat.largeurs.get(cle) } : {}), ...(etat.renommes.has(cle) ? { titre: etat.renommes.get(cle) } : {}),
      })),
      debogage: etat.debogage,
      systeme: etat.debogage ? champsSysteme.filter((k) => etat.systeme.has(k)) : [],
    });
    const valide = () => {
      if (!etat.visibles.size) { this.message(texte('document.vues.une_colonne')); return false; }
      return true;
    };
    // Options d'enregistrement modifiées par l'utilisateur : une nouvelle vue ne reprend la portée globale et le statut
    // « par défaut » de la vue d'origine que s'ils ont été choisis explicitement.
    const touches = new Set();
    dlg.querySelector('fieldset.enregistrement').addEventListener('change', (e) => touches.add(e.target.name || Object.keys(e.target.dataset)[0]));
    const enregistrer = async (id) => {
      if (!valide()) return;
      const nom = dlg.querySelector('[data-nom]').value.trim();
      if (!nom) { this.message(texte('document.vues.nom_obligatoire')); dlg.querySelector('[data-nom]').focus(); return; }
      const nouvelle = !id;
      if (nouvelle && v && nom === v.nom) { this.message(texte('document.vues.autre_nom')); dlg.querySelector('[data-nom]').select(); return; }
      const parDefaut = nouvelle && !touches.has('defaut') ? false : dlg.querySelector('[data-defaut]').checked;
      const globale = nouvelle && !touches.has('portee') ? false : dlg.querySelector('[name="portee"]:checked')?.value === 'globale';
      const tyd = dlg.querySelector('[data-tyd]').value;
      try {
        const sauvee = await this.fournisseur.enregistrer({
          id: id ?? 0, nom, tyd_id: tyd ? Number(tyd) : null, mod_code: dlg.querySelector('[data-modele]').value || null,
          globale: globale || parDefaut, par_defaut: parDefaut, definition: definition(),
        });
        this.vues = await this.fournisseur.vues(this.type);
        // L'ordre et les largeurs sont maintenant dans la vue : la disposition du navigateur n'a plus lieu d'être.
        this.oublierDisposition(`vue:${sauvee.id}`);
        fermer();
        this.appliquer(this.vues.find((x) => x.id === sauvee.id) ?? sauvee);
        this.message(texte('document.vues.enregistree', { nom: sauvee.nom }));
      } catch (e) { this.message(e.message); }
    };
    dlg.querySelector('[data-appliquer]').addEventListener('click', () => {
      if (!valide()) return;
      fermer();
      this.appliquer({ id: null, nom: v ? texte('document.vues.modifiee', { nom: v.nom }) : texte('document.vues.personnalisee'), definition: definition() }, { memoriser: false });
    });
    dlg.querySelector('[data-enregistrer]')?.addEventListener('click', () => enregistrer(v.id));
    dlg.querySelector('[data-nouvelle]').addEventListener('click', () => enregistrer(null));
    dlg.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte(`document.vues.supprimer_confirmer${v.globale ? '_globale' : ''}${v.par_defaut ? '_defaut' : ''}`, { nom: v.nom }))) return;
      try {
        await this.fournisseur.supprimer(v.id);
        this.vues = this.vues.filter((x) => x.id !== v.id);
        fermer();
        this.appliquer(vueParDefaut(this.vues, this.type.tyd_id ?? null, this.modele));
      } catch (e) { this.message(e.message); }
    });
    dlg.querySelector('[data-largeurs]').addEventListener('click', (e) => {
      etat.largeurs.clear();
      e.target.disabled = true;
    });
    dlg.querySelector('[data-tout]').addEventListener('click', () => {
      etat.ordre = catalogue.map((c) => c.cle);
      etat.visibles = new Set(etat.ordre);
      redessiner();
    });
    ouvrirModale(dlg, () => dlg.close());
  }
}
