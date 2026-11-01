import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, lireNombre, creerCombo, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ARRONDI_REVISION } from '../codes.js';
import { ajouterMois, controlerFormule, lireTermes, ecrireTermes, MESSAGES_REVISION } from '../structure/revision.js';

// Révision des prix (CONCEPTION-REVISION-PRIX.md, lot G1 ; Q5, Q6) : valeurs mensuelles des index (grille mois × index,
// provisoires puis définitives, corrections tracées), import CSV « index;mois;valeur;état[;base] » avec simulation,
// catalogue des index (raccordement d'une ancienne base) et modèles de formules. Pas de relève automatique de l'INSEE :
// saisie et import seulement. Écritures du catalogue et des modèles : administrateur.

const moisCourant = () => new Date().toISOString().slice(0, 7);
const ARRONDIS = () => [{ valeur: ARRONDI_REVISION.PROCHE, libelle: texte('revision_btp.arrondis.PROCHE') }, { valeur: ARRONDI_REVISION.SUPERIEUR, libelle: texte('revision_btp.parametres.superieur') }];

/** Lignes CSV « index;mois;valeur;état[;base] » (séparateur ; ou tabulation, en-tête ignoré) → valeurs ; erreurs de lecture. */
export function lireCsvIndex(contenu) {
  const valeurs = [];
  const erreurs = [];
  String(contenu ?? '').split(/\r?\n/).forEach((brut, n) => {
    const ligne = brut.trim();
    if (!ligne) return;
    const c = ligne.split(/[;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    if (n === 0 && /^index$/i.test(c[0])) return;
    const valeur = lireNombre(c[2]);
    if (c.length < 3 || valeur === undefined) { erreurs.push({ ligne: n + 1, erreur: texte('revision_btp.parametres.csv_illisible', { ligne }) }); return; }
    const etat = (c[3] ?? '').toUpperCase();
    valeurs.push({ index: c[0], mois: c[1], valeur, provisoire: etat.startsWith('P'), base: c[4] || null });
  });
  return { valeurs, erreurs };
}

export class PageParametresRevision extends PageBase {
  icone = icone('revision_btp_page');
  #modifie = false;

  get modifiee() { return this.#modifie; }

  async ouvrir() {
    this.titre = texte('revision_btp.routes.parametres');
    this.fin = moisCourant();
    this.nbMois = 24;
    this.tous = false;
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('revision_btp_page')} ${texteHtml('revision_btp.parametres.titre')}</h1></div>
      <p class="aide">${texteHtml('revision_btp.parametres.aide')}</p>
      <section data-valeurs></section><section data-import></section><section data-catalogue></section><section data-formules></section></div>`;
    await this.#charger();
  }

  async #charger() {
    [this.index, this.formules, this.valeurs] = await Promise.all([
      api.indexRevision(), api.formulesRevision(), api.valeursIndex({ du: ajouterMois(this.fin, -(this.nbMois - 1)), au: this.fin }),
    ]);
    this.#modifie = false;
    this.#rendreValeurs();
    this.#rendreImport();
    this.#rendreCatalogue();
    this.#rendreFormules();
  }

  // ------------------------------------------------------------------ valeurs

  #rendreValeurs() {
    const zone = this.conteneur.querySelector('[data-valeurs]');
    const avecValeur = new Set(this.valeurs.map((v) => v.index));
    const colonnes = this.index.filter((i) => this.tous || i.utilise || avecValeur.has(i.code));
    const mois = Array.from({ length: this.nbMois }, (_, k) => ajouterMois(this.fin, -k));
    const valeur = new Map(this.valeurs.map((v) => [`${v.index}|${v.mois}`, v]));
    zone.innerHTML = `<h2>${texteHtml('revision_btp.parametres.valeurs.titre')}</h2>
      <p class="ligne"><label>${texteHtml('revision_btp.parametres.valeurs.fin')} <input type="month" data-fin value="${this.fin}"></label>
        <label><input type="checkbox" data-tous ${this.tous ? 'checked' : ''}> ${texteHtml('revision_btp.parametres.valeurs.tous')}</label>
        <span class="aide">${texteHtml('revision_btp.parametres.valeurs.aide')}</span></p>
      ${colonnes.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('revision_btp.marche.col.mois')}</th>${colonnes.map((i) => `<th title="${echapper(i.libelle)}">${echapper(i.code)}</th>`).join('')}</tr></thead>
        <tbody>${mois.map((m) => `<tr><th>${m}</th>${colonnes.map((i) => {
    const v = valeur.get(`${i.code}|${m}`);
    const titre = v ? texte(v.source === 'IMPORT' ? 'revision_btp.parametres.valeurs.importee' : 'revision_btp.parametres.valeurs.saisie', { par: v.maj_par ?? '?', base: v.base ? texte('revision_btp.parametres.valeurs.base', { base: v.base }) : '' }) : '';
    return `<td class="${v?.provisoire ? 'provisoire' : ''}" title="${echapper(titre)}"><input size="7" inputmode="decimal" data-index="${echapper(i.code)}" data-mois="${m}"
      value="${v ? formatNombre(v.valeur, 4).replace(/,?0+$/, '') : ''}" data-base="${echapper(v?.base ?? '')}"><input type="checkbox" data-provisoire title="${texteHtml('revision_btp.parametres.valeurs.provisoire')}" ${v?.provisoire ? 'checked' : ''}></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>
        <p class="ligne"><button type="button" class="principal" data-enregistrer>${texteHtml('revision_btp.parametres.valeurs.enregistrer')}</button></p>`
    : `<p class="aide">${texteHtml('revision_btp.parametres.valeurs.aucun')}</p>`}`;
    zone.querySelector('[data-fin]').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      if (this.#modifie && !await confirmer(texte('revision_btp.parametres.valeurs.abandonner'))) { e.target.value = this.fin; return; }
      this.fin = e.target.value;
      await this.#charger();
    });
    zone.querySelector('[data-tous]').addEventListener('change', (e) => { this.tous = e.target.checked; this.#rendreValeurs(); });
    zone.querySelectorAll('td input').forEach((x) => x.addEventListener('change', () => { this.#modifie = true; x.closest('td').dataset.modifie = '1'; }));
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const valeurs = [];
      for (const td of zone.querySelectorAll('td[data-modifie]')) {
        const champ = td.querySelector('[data-index]');
        const v = lireNombre(champ.value);
        if (v === undefined) { this.app.message(texte('revision_btp.parametres.valeurs.illisible', { index: champ.dataset.index, mois: champ.dataset.mois }), 'avertissement'); return; }
        valeurs.push({ index: champ.dataset.index, mois: champ.dataset.mois, valeur: v, provisoire: td.querySelector('[data-provisoire]').checked, base: champ.dataset.base || null });
      }
      if (!valeurs.length) { this.app.message(texte('revision_btp.parametres.valeurs.aucune_modifiee'), 'info'); return; }
      await this.#ecrire(valeurs, false);
    });
  }

  /** Écriture de valeurs (bilan affiché) ; erreurs : rien n'est écrit. */
  async #ecrire(valeurs, importees) {
    try {
      const b = await api.enregistrerValeursIndex(valeurs, { import: importees });
      if (b.erreurs.length) { this.app.message(texte('revision_btp.parametres.ecriture.erreurs', { nombre: b.erreurs.length, detail: b.erreurs.slice(0, 3).map((e) => texte('revision_btp.parametres.ecriture.erreur_ligne', { ligne: e.ligne, erreur: e.erreur })).join(' ; ') }), 'erreur'); return false; }
      this.app.message(texte('revision_btp.parametres.ecriture.ok', { creees: b.creees, modifiees: b.modifiees, supprimees: b.supprimees }), 'succes');
      await this.#charger();
      return true;
    } catch (e) { this.app.message(e.message, 'erreur'); return false; }
  }

  // ------------------------------------------------------------------ import

  #rendreImport() {
    const zone = this.conteneur.querySelector('[data-import]');
    zone.innerHTML = `<h2>${texteHtml('revision_btp.parametres.import.titre')}</h2>
      <p class="aide">${texteHtml('revision_btp.parametres.import.aide_html')}</p>
      <p class="ligne"><input type="file" accept=".csv,.txt,text/csv" data-fichier></p>
      <textarea data-texte rows="5" cols="60" placeholder="${texteHtml('revision_btp.parametres.import.exemple')}"></textarea>
      <p class="ligne"><button type="button" data-simuler>${texteHtml('revision_btp.parametres.import.simuler')}</button> <button type="button" class="principal" data-importer disabled>${texteHtml('revision_btp.parametres.import.importer')}</button></p>
      <div data-bilan></div>`;
    const saisie = zone.querySelector('[data-texte]');
    const importer = zone.querySelector('[data-importer]');
    zone.querySelector('[data-fichier]').addEventListener('change', async (e) => {
      const fichier = e.target.files?.[0];
      if (fichier) saisie.value = await fichier.text();
      importer.disabled = true;
    });
    saisie.addEventListener('input', () => { importer.disabled = true; });
    let lues = null;
    zone.querySelector('[data-simuler]').addEventListener('click', async () => {
      const { valeurs, erreurs } = lireCsvIndex(saisie.value);
      const bilan = zone.querySelector('[data-bilan]');
      if (erreurs.length || !valeurs.length) {
        bilan.innerHTML = `<p class="erreur">${erreurs.length ? erreurs.map((x) => texteHtml('revision_btp.parametres.import.ligne', { ligne: x.ligne, erreur: x.erreur })).join('<br>') : texteHtml('revision_btp.parametres.import.aucune')}</p>`;
        return;
      }
      try {
        const b = await api.enregistrerValeursIndex(valeurs, { simulation: true, import: true });
        bilan.innerHTML = `<p>${texteHtml('revision_btp.parametres.import.bilan', { creees: b.creees, modifiees: b.modifiees, inchangees: b.inchangees })}${b.erreurs.length ? `, <span class="erreur">${texteHtml('revision_btp.parametres.import.nb_erreurs', { nombre: b.erreurs.length })}</span>` : ''}.</p>
          ${b.erreurs.length ? `<ul>${b.erreurs.map((x) => `<li>${texteHtml('revision_btp.parametres.import.ligne', { ligne: x.ligne, erreur: x.erreur })}</li>`).join('')}</ul>` : ''}`;
        lues = valeurs;
        importer.disabled = b.erreurs.length > 0 || b.creees + b.modifiees === 0;
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
    importer.addEventListener('click', async () => {
      if (lues && await this.#ecrire(lues, true)) lues = null;
    });
  }

  // ------------------------------------------------------------------ catalogue

  #rendreCatalogue() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-catalogue]');
    const ro = admin ? '' : 'readonly';
    const raccordements = (r) => Object.entries(r ?? {}).map(([b, k]) => `${b}=${String(k).replace('.', ',')}`).join(' ; ');
    zone.innerHTML = `<details><summary><h2>${texteHtml('revision_btp.parametres.catalogue.titre')}</h2></summary>
      <p class="aide">${texteHtml('revision_btp.parametres.catalogue.aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('revision_btp.parametres.catalogue.base')}</th><th>${texteHtml('revision_btp.parametres.catalogue.serie')}</th><th>${texteHtml('revision_btp.parametres.catalogue.raccordements')}</th><th>${texteHtml('revision_btp.parametres.actif')}</th><th class="cellule-boutons"></th></tr></thead>
      <tbody>${this.index.map((i, n) => `<tr data-n="${n}"><td><input data-c="code" size="8" value="${echapper(i.code)}" ${ro}></td>
        <td><input data-c="libelle" size="40" value="${echapper(i.libelle)}" ${ro}></td><td><input data-c="base" size="5" value="${echapper(i.base ?? '')}" ${ro}></td>
        <td><input data-c="serie_insee" size="10" value="${echapper(i.serie_insee ?? '')}" ${ro}></td>
        <td><input data-c="raccordements" size="18" value="${echapper(raccordements(i.raccordements))}" ${ro}></td>
        <td><input type="checkbox" data-c="actif" ${i.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${admin && !i.utilise ? `<button type="button" data-retirer title="${texteHtml('revision_btp.parametres.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? `<p class="ligne"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('revision_btp.parametres.catalogue.ajouter')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('revision_btp.parametres.catalogue.enregistrer')}</button></p>` : ''}</details>`;
    const lire = () => {
      for (const tr of zone.querySelectorAll('tr[data-n]')) {
        const i = this.index[Number(tr.dataset.n)];
        const v = (c) => tr.querySelector(`[data-c="${c}"]`);
        Object.assign(i, { code: v('code').value.trim(), libelle: v('libelle').value.trim(), base: v('base').value.trim() || null, serie_insee: v('serie_insee').value.trim() || null, actif: v('actif').checked });
        i.raccordements = Object.fromEntries(v('raccordements').value.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
          const [b, k] = x.split('=').map((y) => y.trim());
          return [b, lireNombre(k) ?? '0'];
        }));
      }
    };
    zone.querySelectorAll('input').forEach((x) => x.addEventListener('change', () => { this.#modifie = true; }));
    zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { lire(); this.index.splice(Number(b.closest('tr').dataset.n), 1); this.#rendreCatalogue(); this.#ouvrir(zone); }));
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      lire();
      this.index.push({ id: null, code: '', libelle: '', base: null, serie_insee: null, actif: true, raccordements: {} });
      this.#rendreCatalogue();
      this.#ouvrir(zone);
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      lire();
      try {
        this.index = await api.enregistrerIndexRevision(this.index.map(({ utilise, ...i }) => i));
        this.app.message(texte('revision_btp.parametres.catalogue.ok'), 'succes');
        await this.#charger();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }

  #ouvrir(zone) { zone.querySelector('details').open = true; }

  // ------------------------------------------------------------------ modèles de formules

  #rendreFormules() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-formules]');
    const ro = admin ? '' : 'readonly';
    zone.innerHTML = `<details><summary><h2>${texteHtml('revision_btp.parametres.formules.titre')}</h2></summary>
      <p class="aide">${texteHtml('revision_btp.parametres.formules.aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('revision_btp.marche.partie_fixe')}</th><th>${texteHtml('revision_btp.marche.termes')}</th><th>${texteHtml('revision_btp.marche.precision')}</th><th>${texteHtml('revision_btp.marche.arrondi')}</th><th>${texteHtml('revision_btp.parametres.actif')}</th><th></th><th class="cellule-boutons"></th></tr></thead>
      <tbody>${this.formules.map((f, n) => `<tr data-n="${n}"><td><input data-c="libelle" size="36" value="${echapper(f.libelle)}" ${ro}></td>
        <td><input data-c="partie_fixe" size="6" value="${echapper(String(f.partie_fixe).replace('.', ','))}" ${ro}></td>
        <td><input data-c="termes" size="30" value="${echapper(ecrireTermes(f.termes))}" ${ro}></td>
        <td><input data-c="precision" size="2" value="${f.precision}" ${ro}></td><td data-arrondi></td>
        <td><input type="checkbox" data-c="actif" ${f.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td><td data-erreur class="erreur"></td>
        <td class="cellule-boutons">${admin ? `<button type="button" data-retirer title="${texteHtml('revision_btp.parametres.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? `<p class="ligne"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('revision_btp.parametres.formules.ajouter')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('revision_btp.parametres.formules.enregistrer')}</button></p>` : ''}</details>`;
    const combos = [...zone.querySelectorAll('tr[data-n]')].map((tr) => {
      const c = creerCombo({ options: ARRONDIS(), valeur: this.formules[Number(tr.dataset.n)].arrondi, vide: false });
      c.readOnly = !admin;
      tr.querySelector('[data-arrondi]').append(c);
      return c;
    });
    const lire = () => {
      let ok = true;
      zone.querySelectorAll('tr[data-n]').forEach((tr, k) => {
        const f = this.formules[Number(tr.dataset.n)];
        const v = (c) => tr.querySelector(`[data-c="${c}"]`);
        const termes = lireTermes(v('termes').value);
        Object.assign(f, { libelle: v('libelle').value.trim(), partie_fixe: lireNombre(v('partie_fixe').value) ?? '0', termes: termes ?? [],
          precision: Number.parseInt(v('precision').value || '3', 10), arrondi: combos[k].valeurCombo, actif: v('actif').checked });
        const erreurs = termes === null ? [texte('revision_btp.parametres.formules.illisible')] : controlerFormule(f).map((e) => MESSAGES_REVISION[e] ?? e);
        tr.querySelector('[data-erreur]').textContent = erreurs.join(' ; ');
        ok &&= erreurs.length === 0;
      });
      return ok;
    };
    zone.querySelectorAll('input').forEach((x) => x.addEventListener('change', () => { this.#modifie = true; lire(); }));
    zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { lire(); this.formules.splice(Number(b.closest('tr').dataset.n), 1); this.#rendreFormules(); this.#ouvrir(zone); }));
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      lire();
      this.formules.push({ id: null, libelle: '', partie_fixe: '0.15', termes: [{ index: 'BT01', poids: '0.85' }], precision: 3, arrondi: ARRONDI_REVISION.PROCHE, actif: true });
      this.#rendreFormules();
      this.#ouvrir(zone);
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      if (!lire()) { this.app.message(texte('revision_btp.parametres.formules.a_corriger'), 'avertissement'); return; }
      try {
        this.formules = await api.enregistrerFormulesRevision(this.formules);
        this.app.message(texte('revision_btp.parametres.formules.ok'), 'succes');
        this.#modifie = false;
        this.#rendreFormules();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
  }
}
