import { texte, texteHtml, iconeHtml, couleurTheme } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';

// Paramétrage global de l'affichage des documents : étiquettes de lignes (couleur en début de ligne) et couleurs des
// modes de vente (seconde couleur de la pastille, coupée en diagonale). Un document peut ajouter ou personnaliser ses
// étiquettes (entête du document).

/**
 * Fournisseur en mémoire (démo hors ligne) : les listes passées sont modifiées en place (la définition de démo les
 * partage). Mêmes contrôles que le serveur.
 */
export class FournisseurAffichageMemoire {
  constructor({ etiquettes, couleurs, admin = () => true }) {
    this.liste = etiquettes;
    this.couleurs = couleurs;
    this.admin = admin;
  }

  async etiquettes() { return structuredClone(this.liste); }
  async couleursTypePrix() { return structuredClone(this.couleurs); }

  async enregistrerEtiquettes(liste) {
    if (!this.admin()) throw new Error(texte('document.parametrage.reserve'));
    const propres = controlerEtiquettes(liste);
    this.liste.splice(0, this.liste.length, ...propres);
    return this.etiquettes();
  }

  async enregistrerCouleurs(liste) {
    if (!this.admin()) throw new Error(texte('document.parametrage.reserve'));
    for (const c of liste) {
      const x = this.couleurs.find((y) => y.type === c.type);
      if (!x) throw new Error(texte('document.parametrage.mode_inconnu', { type: c.type }));
      if (!/^#[0-9a-f]{6}$/i.test(c.couleur)) throw new Error(texte('document.parametrage.couleur_attendue', { code: c.type }));
      x.couleur = c.couleur.toLowerCase();
    }
    return this.couleursTypePrix();
  }
}

/** Contrôle et normalisation des étiquettes (codes en majuscules, uniques ; libellé ; couleur #rrggbb). */
export function controlerEtiquettes(liste) {
  const codes = new Set();
  return liste.map((e, i) => {
    const code = String(e.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(code)) throw new Error(texte('document.parametrage.code_invalide', { code: e.code }));
    if (codes.has(code)) throw new Error(texte('document.parametrage.code_double', { code }));
    codes.add(code);
    if (!String(e.libelle ?? '').trim()) throw new Error(texte('document.parametrage.libelle_obligatoire', { code }));
    if (!/^#[0-9a-f]{6}$/i.test(e.couleur ?? '')) throw new Error(texte('document.parametrage.couleur_attendue', { code }));
    return { code, libelle: e.libelle.trim(), couleur: e.couleur.toLowerCase(), ordre: e.ordre ?? (i + 1) * 10, actif: e.actif !== false };
  });
}

/** Écran de paramétrage : liste ordonnée des étiquettes et couleurs des modes de vente. */
export class ParametrageAffichageDocument {
  constructor(conteneur, { fournisseur, admin = false, message = () => {} }) {
    this.conteneur = conteneur;
    this.fournisseur = fournisseur;
    this.admin = admin;
    this.message = message;
  }

  async ouvrir() {
    this.etiquettes = await this.fournisseur.etiquettes();
    this.couleurs = await this.fournisseur.couleursTypePrix();
    this.rendre();
  }

  rendre() {
    const ro = this.admin ? '' : 'disabled';
    const apercu = (c1, c2) => `<span class="pastille-couleur" style="background:${c1 && c2 ? `linear-gradient(135deg, ${c1} 50%, ${c2} 50%)` : c1 ?? `linear-gradient(135deg, transparent 50%, ${c2} 50%)`}"></span>`;
    this.conteneur.innerHTML = `
      ${this.admin ? '' : `<p class="aide">${texteHtml('document.parametrage.lecture_seule')}</p>`}
      <section class="panneau">
        <h2>${texteHtml('document.parametrage.etiquettes')}</h2>
        <p class="aide">${texteHtml('document.parametrage.etiquettes_aide')}</p>
        <table class="table-parametres tableau-compact largeur-contenu"><thead><tr><th></th><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('document.parametrage.couleur')}</th><th>${texteHtml('document.parametrage.active')}</th><th></th></tr></thead>
        <tbody>${this.etiquettes.map((e, i) => `<tr data-i="${i}">
          <td>${apercu(e.couleur)}</td>
          <td><input data-c="code" value="${echapper(e.code)}" size="14" ${ro}></td>
          <td><input data-c="libelle" value="${echapper(e.libelle)}" ${ro}></td>
          <td><input data-c="couleur" type="color" value="${echapper(e.couleur)}" ${ro}></td>
          <td><input data-c="actif" type="checkbox" ${e.actif !== false ? 'checked' : ''} ${ro}></td>
          <td><button type="button" data-haut ${ro || (i === 0 ? 'disabled' : '')} title="${texteHtml('document.parametrage.monter')}">${iconeHtml('document_haut')}</button><button type="button" data-bas ${ro || (i === this.etiquettes.length - 1 ? 'disabled' : '')} title="${texteHtml('document.parametrage.descendre')}">${iconeHtml('document_bas')}</button><button type="button" data-suppr ${ro} title="${texteHtml('commun.supprimer')}">${iconeHtml('retirer')}</button></td>
        </tr>`).join('')}</tbody></table>
        ${this.admin ? `<div class="boutons"><button type="button" data-ajout>${iconeHtml('ajouter')} ${texteHtml('document.parametrage.ajouter_etiquette')}</button><button type="button" class="principal" data-enreg-etq>${texteHtml('document.parametrage.enregistrer_etiquettes')}</button></div>` : ''}
      </section>
      <section class="panneau">
        <h2>${texteHtml('document.parametrage.couleurs')}</h2>
        <p class="aide">${texteHtml('document.parametrage.couleurs_aide')}</p>
        <table class="table-parametres tableau-compact largeur-contenu"><thead><tr><th></th><th>${texteHtml('document.parametrage.mode_vente')}</th><th>${texteHtml('document.parametrage.couleur')}</th></tr></thead>
        <tbody>${this.couleurs.map((c, i) => `<tr data-i="${i}"><td>${apercu(this.etiquettes[0]?.couleur, c.couleur)}</td><td>${echapper(c.libelle)}</td>
          <td><input data-couleur type="color" value="${echapper(c.couleur)}" ${ro}></td></tr>`).join('')}</tbody></table>
        ${this.admin ? `<div class="boutons"><button type="button" class="principal" data-enreg-coul>${texteHtml('document.parametrage.enregistrer_couleurs')}</button></div>` : ''}
      </section>`;
    if (!this.admin) return;
    const z = this.conteneur;
    z.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
      const e = this.etiquettes[Number(el.closest('tr').dataset.i)];
      e[el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.c === 'couleur') this.rendre();
    }));
    z.querySelectorAll('[data-haut], [data-bas], [data-suppr]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.closest('tr').dataset.i);
      if (b.dataset.suppr !== undefined) this.etiquettes.splice(i, 1);
      else {
        const j = b.dataset.haut !== undefined ? i - 1 : i + 1;
        [this.etiquettes[i], this.etiquettes[j]] = [this.etiquettes[j], this.etiquettes[i]];
      }
      this.rendre();
    }));
    z.querySelector('[data-ajout]').addEventListener('click', () => {
      let n = this.etiquettes.length + 1;
      while (this.etiquettes.some((e) => e.code === `ETIQUETTE_${n}`)) n += 1;
      this.etiquettes.push({ code: `ETIQUETTE_${n}`, libelle: texte('document.parametrage.etiquette_n', { n }), couleur: couleurTheme('--document-etiquette-defaut', '#64748b'), actif: true });
      this.rendre();
    });
    z.querySelector('[data-enreg-etq]').addEventListener('click', async () => {
      try {
        this.etiquettes = await this.fournisseur.enregistrerEtiquettes(controlerEtiquettes(this.etiquettes).map((e, i) => ({ ...e, ordre: (i + 1) * 10 })));
        this.rendre();
        this.message(texte('document.parametrage.etiquettes_enregistrees'));
      } catch (e) { this.message(e.message, 'erreur'); }
    });
    z.querySelectorAll('[data-couleur]').forEach((el) => el.addEventListener('change', () => {
      this.couleurs[Number(el.closest('tr').dataset.i)].couleur = el.value;
    }));
    z.querySelector('[data-enreg-coul]').addEventListener('click', async () => {
      try {
        this.couleurs = await this.fournisseur.enregistrerCouleurs(this.couleurs);
        this.rendre();
        this.message(texte('document.parametrage.couleurs_enregistrees'));
      } catch (e) { this.message(e.message, 'erreur'); }
    });
  }
}
