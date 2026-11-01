// Module Exécution, lot 2e (ANALYSE-MODULE-EXECUTION.md E50 à E53) : écran tactile des étapes à valider depuis
// l'atelier ou le chantier (page tablette, borne). Composant sans métier : l'application fournit les ordres et leurs
// étapes, la validation et la recherche par numéro (fournisseur) ; aucun contrôle du N+1 depuis cet écran.
//
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';

// fournisseur : { charger() → { ordres: [{ ent_id, numero, objet, chantier, en_cours, etapes: [{ code, libelle, nature,
//   date_obligatoire, prevu_le, valide_le, valide_par, en_retard }] }] }, valider(ent_id, code) → réponse, ordre(numero) → ordre | null }.

const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jour = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '');
const ICONES = { TACHE: 'execution_nature_tache', JALON: 'execution_nature_jalon', ATTENTE: 'execution_nature_attente' };

export class EcranEtapesAtelier {
  #zone;
  #f;
  #o;
  #ordres = [];
  #extra = [];

  /** options : { message(texte, nature), titre, aide } */
  constructor(zone, fournisseur, options = {}) {
    this.#zone = zone;
    this.#f = fournisseur;
    this.#o = { message: () => {}, titre: texte('execution.atelier.titre'), aide: '', ...options };
  }

  async ouvrir() {
    try { this.#ordres = (await this.#f.charger()).ordres ?? []; } catch (e) { this.#o.message(e.message, 'erreur'); this.#ordres = []; }
    this.rendre();
  }

  /** Étape proposée d'un ordre : l'étape en cours, sinon la première non validée. */
  static etapeProposee(o) {
    return o.etapes.find((e) => e.code === o.en_cours) ?? o.etapes.find((e) => !e.valide_le) ?? null;
  }

  rendre() {
    const ordres = [...this.#extra.filter((x) => !this.#ordres.some((o) => o.ent_id === x.ent_id)), ...this.#ordres];
    this.#zone.innerHTML = `<div class="atelier-etapes">
      <div class="atelier-entete"><h2>${echapper(this.#o.titre)}</h2>
        <form class="atelier-recherche"><input name="numero" placeholder="${texteHtml('execution.atelier.numero')}" autocomplete="off" inputmode="text"><button type="submit">${iconeHtml('rechercher')}</button></form></div>
      ${this.#o.aide ? `<p class="aide">${echapper(this.#o.aide)}</p>` : ''}
      ${ordres.length ? ordres.map((o, i) => {
        const p = EcranEtapesAtelier.etapeProposee(o);
        return `<section class="atelier-ordre" data-i="${i}">
          <header><strong>${echapper(o.numero ?? `#${o.ent_id}`)}</strong> ${echapper(o.objet ?? '')}<small>${echapper(o.chantier ?? '')}</small></header>
          <ol class="atelier-liste">${o.etapes.map((e) => `<li class="${e.valide_le ? 'validee' : ''}${p && e.code === p.code ? ' proposee' : ''}${e.en_retard ? ' retard' : ''}">
            <span>${ICONES[e.nature] ? iconeHtml(ICONES[e.nature]) : ''} ${echapper(e.libelle)}</span>
            <span>${e.valide_le ? `${iconeHtml('execution_etape_validee')} ${jour(e.valide_le)}` : e.prevu_le ? texteHtml('execution.atelier.prevu', { date: jour(e.prevu_le) }) : ''}</span></li>`).join('')}</ol>
          ${p ? `<button type="button" class="atelier-valider" data-valider="${echapper(p.code)}">${iconeHtml('execution_valider')} ${texteHtml('execution.atelier.termine', { etape: p.libelle })}</button>` : `<p class="aide">${texteHtml('execution.atelier.toutes')}</p>`}
        </section>`;
      }).join('') : `<p class="aide">${texteHtml('execution.atelier.aucune')}</p>`}</div>`;
    this.#zone.querySelector('.atelier-recherche').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const numero = ev.target.numero.value.trim();
      if (!numero) return;
      try {
        const o = await this.#f.ordre(numero);
        if (!o) { this.#o.message(texte('execution.atelier.introuvable'), 'avertissement'); return; }
        this.#extra = [o, ...this.#extra.filter((x) => x.ent_id !== o.ent_id)];
        this.rendre();
      } catch (e) { this.#o.message(e.message, 'erreur'); }
    });
    this.#zone.querySelectorAll('[data-valider]').forEach((b) => b.addEventListener('click', async () => {
      const o = ordres[Number(b.closest('[data-i]').dataset.i)];
      b.disabled = true;
      try {
        const r = await this.#f.valider(o.ent_id, b.dataset.valider);
        for (const m of r?.avertissements ?? []) this.#o.message(m, 'avertissement');
        this.#o.message(texte('execution.atelier.validee', { numero: o.numero ?? '' }), 'succes');
        if (r?.etapes) Object.assign(o, { etapes: r.etapes, en_cours: r.en_cours });
        this.rendre();
      } catch (e) { b.disabled = false; this.#o.message(e.message, 'erreur'); }
    }));
  }
}
