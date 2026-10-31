import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirModale, confirmer } from '@logibtp/socle/ui';

// Gestion des thèmes de vues (profil ADMIN) : la liste n'est pas figée. Un thème regroupe des vues et déclare
// les types d'élément qu'il couvre : plusieurs (Ressources : équipe, salarié, intérim, matériel, sous-traitant)
// ou un seul pour filtrer une source plus large (Devis : V_DEVIS parmi tous les documents). Aucun type = tous.

/** « code = libellé ; code = libellé » ⇄ [{ code, libelle }]. */
export const typesVersTexte = (types) => (types ?? []).map((t) => (t.libelle && t.libelle !== t.code ? `${t.code} = ${t.libelle}` : t.code)).join(' ; ');
export const texteVersTypes = (texte) => String(texte ?? '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
  const [code, ...libelle] = x.split('=');
  return { code: code.trim(), libelle: libelle.join('=').trim() || code.trim() };
});

export class GestionThemes {
  constructor({ fournisseur, message, fermer }) {
    this.fournisseur = fournisseur;
    this.message = message ?? (() => {});
    this.surFermer = fermer;
    this.fond = document.createElement('dialog');
    this.fond.className = 'concepteur-fond dialogue-plein';
    this.fond.innerHTML = `
      <div class="concepteur themes" role="dialog" aria-label="${texteHtml('liste.themes.titre')}">
        <header><strong>${texteHtml('liste.themes.titre')}</strong><span class="aide">${texteHtml('liste.themes.aide')}</span>
          <button type="button" data-action="fermer" title="${texteHtml('liste.themes.fermer')}">${iconeHtml('retirer')}</button></header>
        <div class="concepteur-corps"></div>
        <footer><span class="concepteur-message"></span><button type="button" data-action="ajouter">${texteHtml('liste.themes.nouveau')}</button></footer>
      </div>`;
    ouvrirModale(this.fond);
    this.corps = this.fond.querySelector('.concepteur-corps');
    this.fond.querySelector('[data-action="fermer"]').addEventListener('click', () => this.fermer());
    this.fond.querySelector('[data-action="ajouter"]').addEventListener('click', () => this.#ajouter());
    this.clavier = (e) => { if (e.key === 'Escape') this.fermer(); };
    document.addEventListener('keydown', this.clavier);
    this.charger().catch((e) => this.#erreur(e.message));
  }

  fermer() {
    document.removeEventListener('keydown', this.clavier);
    this.fond.remove();
    this.surFermer?.();
  }

  #erreur(t) {
    const m = this.fond.querySelector('.concepteur-message');
    m.textContent = t ?? '';
    m.classList.toggle('erreur', !!t);
  }

  async charger() {
    this.themes = await this.fournisseur.themes();
    this.rendre();
  }

  rendre() {
    this.corps.innerHTML = `
      <table class="concepteur-table themes-table">
        <thead><tr>${['icone', 'code', 'libelle', 'ordre', 'types'].map((c) => `<th>${texteHtml(`liste.themes.colonnes.${c}`)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${this.themes.map((t, i) => `
          <tr data-i="${i}">
            <td><input data-c="thl_icone" value="${echapper(t.thl_icone ?? '')}" maxlength="4" size="3"></td>
            <td><input data-c="thl_code" value="${echapper(t.thl_code)}" ${t.nouveau ? '' : 'readonly'} size="10"></td>
            <td><input data-c="thl_libelle" value="${echapper(t.thl_libelle ?? '')}"></td>
            <td><input data-c="thl_ordre" type="number" value="${t.thl_ordre ?? 0}" style="width:4.5rem"></td>
            <td><input data-c="thl_types" class="large" value="${echapper(typesVersTexte(t.thl_types))}" placeholder="${texteHtml('liste.themes.types_vide')}"></td>
            <td><button type="button" data-enregistrer class="principal">${texteHtml('commun.enregistrer')}</button> <button type="button" data-supprimer title="${texteHtml('liste.themes.supprimer_aide')}">${iconeHtml('retirer')}</button></td>
          </tr>`).join('') || `<tr><td colspan="6" class="aide">${texteHtml('liste.themes.aucun')}</td></tr>`}</tbody>
      </table>`;
    this.corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = this.themes[Number(tr.dataset.i)];
      tr.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
        const k = el.dataset.c;
        t[k] = k === 'thl_types' ? texteVersTypes(el.value) : k === 'thl_ordre' ? Number(el.value) : el.value.trim();
      }));
      tr.querySelector('[data-enregistrer]').addEventListener('click', async () => {
        try {
          const { nouveau, ...theme } = t;
          await this.fournisseur.enregistrerTheme({ thl_actif: true, ...theme });
          delete t.nouveau;
          this.#erreur('');
          this.message(texte('liste.themes.enregistre', { libelle: t.thl_libelle }), 'succes');
          await this.charger();
        } catch (e) { this.#erreur(e.message); }
      });
      tr.querySelector('[data-supprimer]').addEventListener('click', async () => {
        if (t.nouveau) { this.themes.splice(Number(tr.dataset.i), 1); this.rendre(); return; }
        if (!await confirmer(texte('liste.themes.supprimer', { libelle: t.thl_libelle }))) return;
        try { await this.fournisseur.supprimerTheme(t.thl_code); await this.charger(); } catch (e) { this.#erreur(e.message); }
      });
    });
  }

  #ajouter() {
    this.themes.push({ thl_code: '', thl_libelle: '', thl_icone: '', thl_ordre: (this.themes.at(-1)?.thl_ordre ?? 0) + 10, thl_types: [], nouveau: true });
    this.rendre();
    this.corps.querySelector('tr:last-child [data-c="thl_code"]')?.focus();
  }
}
