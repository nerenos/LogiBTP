import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';

/** Modes de diffusion (crm_diffusion_destinataire.dfd_mode). */
export const MODES_DIFFUSION = [
  { valeur: 'COURRIEL', libelle: 'Courriel' },
  { valeur: 'PAPIER', libelle: 'Papier' },
  { valeur: 'PLATEFORME', libelle: 'Plateforme' },
  { valeur: 'MAIN_PROPRE', libelle: 'Remise en main propre' },
];

/** Fonctions d'intervenant qui visent les plans par défaut. */
const VISEURS = ['ARCHITECTE', 'MOE', 'MAITRE_OEUVRE', 'BUREAU_CONTROLE', 'CONTROLEUR', 'BET', 'CLIENT', 'MAITRE_OUVRAGE', 'MOA'];

const STRUCTURE = ['projet', 'affaire', 'chantier', 'marche'];
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Bordereau de diffusion (module CRM) : `/crm/diffusion/nouveau?plans=1,2&type_element=&id_element=` (saisie) ou
 * `/crm/diffusion/<id>` (consultation, impression). Pièces = dernier indice des plans choisis ; destinataires proposés
 * depuis les intervenants de l'élément ; ceux qui visent reçoivent des visas attendus et une tâche de retour.
 */
export class PageDiffusionCrm extends PageBase {
  icone = '📤';

  get modifiee() { return Boolean(this.saisie && this.modifie); }

  async ouvrir() {
    const app = this.app;
    if (!app.enLigne) { this.conteneur.innerHTML = '<p class="aide">Suivi (CRM) disponible en ligne seulement.</p>'; return; }
    if (this.params.id === 'nouveau') await this.preparer();
    else {
      this.diffusion = await api.crm.diffusion(Number(this.params.id));
      this.titre = `${this.diffusion.numero} – ${this.diffusion.objet}`;
      this.rendreBordereau();
    }
  }

  urlCourante() { return this.diffusion ? `/crm/diffusion/${this.diffusion.id}` : null; }

  async preparer() {
    const r = this.requete;
    this.element = r.type_element && r.id_element ? { type: r.type_element, id: String(r.id_element) } : null;
    const [e] = this.element ? await api.crm.elements([this.element]) : [null];
    const plans = await Promise.all(String(r.plans ?? '').split(',').filter(Boolean).map((id) => api.crm.plan(Number(id))));
    this.pieces = plans.filter((p) => p.indices.length).map((p) => {
      const i = p.indices[p.indices.length - 1];
      return { pin_id: i.id, libelle: `${p.plan.repere} – ${p.plan.nom} – ${i.indice ? `indice ${i.indice}` : 'premier indice'}`, choisi: true };
    });
    this.destinataires = [];
    if (this.element && STRUCTURE.includes(this.element.type)) {
      const intervenants = await api.structureIntervenants(this.element.type, this.element.id).catch(() => []);
      for (const x of intervenants.filter((y) => y.per_id)) {
        if (this.destinataires.some((d) => d.tiers_id === x.per_id)) continue;
        this.destinataires.push({ tiers_id: x.per_id, tiers: x.tiers, ind_id: x.ind_id ?? null, contact: x.contact ?? null, fonction: x.fonction, mode: 'COURRIEL', exemplaires: 1, attend_visa: VISEURS.includes(x.fonction) });
      }
    }
    this.saisie = { date: aujourdhui(), objet: `Diffusion de plans${e ? ` – ${e.libelle}` : ''}`.slice(0, 200), delai_visa_jours: 15 };
    this.titre = 'Nouveau bordereau de diffusion';
    this.rendreSaisie(e);
  }

  rendreSaisie(e) {
    const s = this.saisie;
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">📤 Nouveau bordereau de diffusion</h1>
      ${e ? `<p>Rattaché à ${lienElement(e)}</p>` : ''}
      <div class="formulaire crm-formulaire"><label>Objet <input data-s="objet" maxlength="200" value="${echapper(s.objet)}"></label>
        <label>Date <input type="date" data-s="date" value="${s.date}"></label>
        <label>Délai de visa (jours) <input data-s="delai_visa_jours" size="4" inputmode="numeric" value="${s.delai_visa_jours}"></label></div>
      <h2>Pièces</h2>${this.pieces.length ? `<ul class="crm-liens">${this.pieces.map((p, i) => `<li><label><input type="checkbox" data-piece="${i}" ${p.choisi ? 'checked' : ''}> 📐 ${echapper(p.libelle)}</label></li>`).join('')}</ul>`
        : '<p class="aide">Aucune pièce : choisissez des plans dans la liste des plans (« Diffuser la sélection »).</p>'}
      <h2>Destinataires</h2><div data-destinataires></div>
      <div class="boutons"><button type="button" data-ajouter title="Destinataire choisi dans l'annuaire">＋ Destinataire…</button>
        <button type="button" class="principal" data-creer>Créer le bordereau</button></div></div>`;
    this.modifie = true;
    this.conteneur.querySelectorAll('[data-s]').forEach((i) => i.addEventListener('input', () => { s[i.dataset.s] = i.dataset.s === 'delai_visa_jours' ? Number(i.value) || 0 : i.value; }));
    this.conteneur.querySelectorAll('[data-piece]').forEach((c) => c.addEventListener('change', () => { this.pieces[Number(c.dataset.piece)].choisi = c.checked; }));
    this.conteneur.querySelector('[data-ajouter]').addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const p = await choisirPersonne({ annuaire, titre: 'Destinataire du bordereau', exclure: this.destinataires.map((d) => d.tiers_id) });
      if (p) { this.destinataires.push({ tiers_id: p.id, tiers: p.nom_commercial || p.raison_sociale, ind_id: null, contact: null, mode: 'COURRIEL', exemplaires: 1, attend_visa: false }); this.rendreDestinataires(); }
    });
    this.conteneur.querySelector('[data-creer]').addEventListener('click', () => this.creer());
    this.rendreDestinataires();
  }

  rendreDestinataires() {
    const zone = this.conteneur.querySelector('[data-destinataires]');
    zone.innerHTML = this.destinataires.length ? `<table class="crm-table"><thead><tr><th>Tiers</th><th>Contact</th><th>Mode</th><th>Exemplaires</th><th>Vise les plans</th><th></th></tr></thead><tbody>
      ${this.destinataires.map((d, i) => `<tr data-i="${i}"><td>${echapper(d.tiers ?? `#${d.tiers_id}`)}${d.fonction ? ` <small class="aide">${echapper(d.fonction)}</small>` : ''}</td><td>${echapper(d.contact ?? '')}</td>
        <td><span data-mode></span></td><td><input data-exemplaires size="3" value="${d.exemplaires}"></td><td><input type="checkbox" data-visa ${d.attend_visa ? 'checked' : ''}></td>
        <td><button type="button" data-retirer>✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun destinataire.</p>';
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const d = this.destinataires[Number(tr.dataset.i)];
      const mode = creerCombo({ options: MODES_DIFFUSION, valeur: d.mode, vide: false });
      mode.addEventListener('change', () => { d.mode = mode.valeurCombo; });
      tr.querySelector('[data-mode]').replaceWith(mode);
      tr.querySelector('[data-exemplaires]').addEventListener('input', (e) => { d.exemplaires = Math.max(0, Number(e.target.value) || 0); });
      tr.querySelector('[data-visa]').addEventListener('change', (e) => { d.attend_visa = e.target.checked; });
      tr.querySelector('[data-retirer]').addEventListener('click', () => { this.destinataires.splice(Number(tr.dataset.i), 1); this.rendreDestinataires(); });
    });
  }

  async creer() {
    const s = this.saisie;
    try {
      const d = await api.crm.creerDiffusion({
        date: s.date, objet: s.objet, type_element: this.element?.type ?? null, id_element: this.element?.id ?? null, delai_visa_jours: s.delai_visa_jours,
        pieces: this.pieces.filter((p) => p.choisi).map((p) => ({ pin_id: p.pin_id, dge_id: null, libelle: p.libelle })),
        destinataires: this.destinataires.map((x) => ({ tiers_id: x.tiers_id, ind_id: x.ind_id, mode: x.mode, exemplaires: x.exemplaires, attend_visa: x.attend_visa })),
      });
      this.modifie = false;
      this.saisie = null;
      this.diffusion = d;
      this.titre = `${d.numero} – ${d.objet}`;
      this.app.routeur.remplacerUrl(`/crm/diffusion/${d.id}`);
      this.app.publier('crm', { diffusion: d.id });
      this.app.message('Bordereau créé : visas attendus et tâches de retour posés', 'succes');
      this.rendreBordereau();
    } catch (e) { this.app.erreur(e); }
  }

  /** Bordereau en consultation, imprimable (la page d'impression masque le bandeau et les boutons). */
  rendreBordereau() {
    const d = this.diffusion;
    const mode = (m) => MODES_DIFFUSION.find((x) => x.valeur === m)?.libelle ?? m;
    this.conteneur.innerHTML = `<div class="page-parametres crm-bordereau">
      <div class="boutons crm-actions"><button type="button" class="principal" data-imprimer title="Imprimer le bordereau">🖨 Imprimer</button>
        ${d.element ? `<a href="/crm/diffusions?type=${encodeURIComponent(d.type_element)}&id=${encodeURIComponent(d.id_element)}">Autres bordereaux</a>` : ''}</div>
      <h1 class="page-titre">Bordereau de diffusion ${echapper(d.numero)}</h1>
      <p><b>${echapper(d.objet)}</b><br>Date : ${new Date(d.date).toLocaleDateString('fr-FR')}${d.element ? ` · ${lienElement(d.element)}` : ''} · émis par ${echapper(d.cree_par)}</p>
      <h2>Pièces diffusées</h2><table class="crm-table"><thead><tr><th>N°</th><th>Pièce</th></tr></thead><tbody>
        ${d.pieces.map((p, i) => `<tr><td>${i + 1}</td><td>${p.plan_id ? `<a href="/crm/plan/${p.plan_id}">${echapper(p.libelle)}</a>` : echapper(p.libelle)}</td></tr>`).join('')}</tbody></table>
      <h2>Destinataires</h2><table class="crm-table"><thead><tr><th>Destinataire</th><th>Contact</th><th>Mode</th><th class="nombre">Ex.</th><th>Visa</th></tr></thead><tbody>
        ${d.destinataires.map((x) => `<tr><td>${lienElement(x.tiers)}</td><td>${lienElement(x.contact)}</td><td>${echapper(mode(x.mode))}</td><td class="nombre">${x.exemplaires}</td>
          <td>${x.attend_visa ? `attendu sous ${d.delai_visa_jours} j${x.visas_attendus ? ` · ${x.visas_recus}/${x.visas_attendus} reçu(s)` : ''}${x.note_id ? ` · <a href="/crm/note/${x.note_id}" class="crm-ecran">tâche</a>` : ''}` : 'pour information'}</td></tr>`).join('')}</tbody></table>
      <p class="crm-signature">Visa de réception :</p></div>`;
    this.conteneur.querySelector('[data-imprimer]').addEventListener('click', () => window.print());
  }
}
