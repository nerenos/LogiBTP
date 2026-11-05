import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { D } from '@logibtp/socle';
import { echapper, formatNombre, formatLibre, lireNombre, creerCombo, celluleCsv, telechargerCsv } from '@logibtp/socle/ui';
import { TL, estChiffree, estTranche, cleElementVentilation } from '../calcul/index.js';
import {
  LIBELLES_FA_LIGNES, LIBELLES_FA_MODE, bilanTranche, messagesFrais, ecrireCle, figerVentilation, repartirReste, remplacerCles,
} from './frais-annexes.js';

// Onglet Analyse, vue « Frais annexes » : réglages du document (lignes hors vente, mode), puis pour chaque tranche de
// frais son bilan (prévu, ventilé, réel, écart), ses actions (répartir le reste, figer, prorata) et la répartition par
// nature, par élément et par tranche jusqu'à la ligne. Les clés de nature (de la tranche ou globales) et d'élément se
// saisissent ici ; les clés de ligne aussi dans le détail de la ligne. Une part reçue par un ouvrage est attribuée à
// ses feuilles au prorata de leur montant (quantité totale × PV), comme le moteur répartit une clé de feuille.
// Le rapport s'exporte en CSV (saisie en cours, `lignesCsv`) et s'imprime par le module Édition (modèle FRAIS_ANNEXES,
// données `frais_annexes` de la source document calculées par le serveur sur le document enregistré).

const MODES_CLE = ['P', 'M'].map((valeur) => ({ valeur, get libelle() { return texte(`frais_annexes_btp.modes_cle.${valeur}`); } }));

export class RapportFraisAnnexes {
  /** imprimer() : impression par le module Édition (modèle FRAIS_ANNEXES du document enregistré) ; absent, pas de bouton. */
  constructor(conteneur, { editeur, natures = new Map(), message = () => {}, imprimer = null }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.natures = natures;
    this.message = message;
    this.imprimer = imprimer;
    this.ouverts = new Set(); // tranches de frais dépliées (le temps de la page)
  }

  /** Lignes du résultat : index, enfants chiffrés, feuilles et poids. */
  #structure() {
    const r = this.editeur.resultat;
    const parId = new Map(r.lignes.map((l) => [l.lig_id, l]));
    const enfants = new Map();
    for (const l of r.lignes) {
      if (l.lig_parent_id === null || l.lig_parent_id === undefined) continue;
      if (!enfants.has(l.lig_parent_id)) enfants.set(l.lig_parent_id, []);
      enfants.get(l.lig_parent_id).push(l);
    }
    const feuilles = (l) => {
      const c = (enfants.get(l.lig_id) ?? []).filter(estChiffree);
      return c.length ? c.flatMap(feuilles) : [l];
    };
    const ancetres = (l) => {
      const res = [];
      for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) res.push(x);
      return res;
    };
    const poids = (x) => D(x.lig_qte_totale ?? 0).times(D(x.lig_pv ?? 0));
    return { r, parId, feuilles, ancetres, poids };
  }

  /**
   * Parts d'une tranche de frais reçues par les feuilles : [{ feuille, prix (ligne de prix), part, poids, tranches }].
   * Les feuilles des lignes de prix de la portée qui ne reçoivent rien figurent avec une part nulle.
   */
  partsFeuilles(bilan, s = this.#structure()) {
    const { r, feuilles, ancetres, poids } = s;
    const parts = new Map();
    for (const v of r.ventilations_lignes ?? []) {
      if (v.vfl_source_lig_id === bilan.lig_id) parts.set(v.vfl_lig_id, (parts.get(v.vfl_lig_id) ?? D(0)).plus(D(v.vfl_montant)));
    }
    const res = [];
    for (const l of r.lignes) {
      if (!estChiffree(l) || l.lig_type_prix === 'F' || l.lig_is_ecart_arrondi) continue;
      const chaine = ancetres(l);
      if (chaine.some((x) => estChiffree(x)) || !chaine.some((x) => x.lig_id === bilan.portee_id)) continue;
      // Options, variantes et pour mémoire : selon le réglage du document (comme le moteur).
      const type = [l, ...chaine].find((x) => (x.lig_type_prix ?? 'V') !== 'V')?.lig_type_prix ?? 'V';
      const horsVente = r.document.ent_fa_lignes ?? 'V';
      if (type !== 'V' && !((type === 'O' || type === 'A') && horsVente !== 'V') && !(type === 'M' && horsVente === 'OAM')) continue;
      const fs = feuilles(l);
      const total = fs.reduce((t, f) => t.plus(poids(f)), D(0));
      const part = parts.get(l.lig_id) ?? D(0);
      for (const f of fs) {
        const w = poids(f);
        res.push({
          feuille: f, prix: l, poids: w, part: total.isZero() ? (f === fs[0] ? part : D(0)) : part.times(w).div(total),
          tranches: [l, ...chaine].filter((x) => estTranche(x) && x !== l).map((x) => x.lig_id),
        });
      }
    }
    return res;
  }

  /**
   * Rapport en lignes CSV (séparateur « ; », décimales à la virgule) : une ligne par tranche de frais et par ligne de prix
   * de sa portée (part nulle comprise), avec le bilan de la tranche, la tranche de la ligne, sa nature, son montant hors
   * frais, la part reçue et son coefficient de frais annexes. Les feuilles d'un ouvrage sont regroupées sur sa ligne.
   */
  lignesCsv() {
    const s = this.#structure();
    const bilans = s.r.frais_annexes ?? [];
    const libelle = (id) => s.parId.get(id)?.lig_libelle_brut ?? '';
    const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const nature = (id) => { const n = this.natures.get(Number(id)); return n ? n.code : ''; };
    const colonnes = ['tranche', 'portee', 'prevu', 'ventile', 'ecart', 'tranche_ligne', 'numero', 'code', 'libelle', 'nature', 'hors_frais', 'part', 'coef_fa'];
    const lignes = [colonnes.map((c) => celluleCsv(texte(`frais_annexes_btp.rapport.csv.${c}`))).join(';')];
    for (const b of bilans) {
      const parPrix = new Map();
      for (const f of this.partsFeuilles(b, s)) {
        const x = parPrix.get(f.prix.lig_id) ?? { prix: f.prix, tranche: f.tranches[0] ?? b.portee_id, poids: D(0), part: D(0) };
        x.poids = x.poids.plus(f.poids);
        x.part = x.part.plus(f.part);
        parPrix.set(f.prix.lig_id, x);
      }
      for (const x of parPrix.values()) {
        lignes.push([
          celluleCsv(libelle(b.lig_id)), celluleCsv(libelle(b.portee_id)), num(b.prevu), num(b.ventile), num(b.ecart),
          celluleCsv(libelle(x.tranche)), celluleCsv(x.prix.lig_numerotation ?? ''), celluleCsv(x.prix.lig_code ?? ''), celluleCsv(x.prix.lig_libelle_brut ?? ''),
          celluleCsv(nature(x.prix.lig_nat_id)), num(x.poids.toFixed(2)), num(x.part.toFixed(2)), num(x.prix.lig_coef_fa ?? 1),
        ].join(';'));
      }
    }
    return lignes;
  }

  rendre() {
    const ed = this.editeur;
    const r = ed.resultat;
    const pm = ed.saisie.document.ent_precision_montant ?? 2;
    const lecture = !!ed.magasin?.lectureSeule;
    const bilans = r.frais_annexes ?? [];
    const messages = messagesFrais(r);
    const s = this.#structure();
    const libelle = (id) => s.parId.get(id)?.lig_libelle_brut || '—';
    const pct = (b) => (Number(b.prevu) ? `${formatLibre(Math.round(Number(b.ventile) / Number(b.prevu) * 1000) / 10, 1)} %` : '');

    this.conteneur.innerHTML = `
      <div class="frais-reglages">
        <label>${texteHtml('frais_annexes_btp.rapport.hors_vente')} <span data-reglage="ent_fa_lignes"></span></label>
        <label>${texteHtml('frais_annexes_btp.rapport.options')} <span data-reglage="ent_fa_mode"></span></label>
        ${bilans.length ? `<span class="groupe-outils">
          <button type="button" data-rapport-frais="csv" title="${texteHtml('frais_annexes_btp.rapport.exporter_aide')}">${iconeHtml('telecharger')} ${texteHtml('frais_annexes_btp.rapport.exporter')}</button>
          ${this.imprimer ? `<button type="button" data-rapport-frais="imprimer" title="${texteHtml('frais_annexes_btp.rapport.imprimer_aide')}">${iconeHtml('frais_annexes_btp_imprimer')} ${texteHtml('frais_annexes_btp.rapport.imprimer')}</button>` : ''}
        </span>` : ''}
      </div>
      ${messages.length ? `<ul class="frais-messages">${messages.map((m) => `<li><code>${echapper(m.code)}</code> ${echapper(m.message)}</li>`).join('')}</ul>` : ''}
      ${bilans.length ? '' : `<p class="aide">${texteHtml('frais_annexes_btp.rapport.aucune')}</p>`}
      <table class="table-analyse table-frais-bilan">
        <thead><tr><th>${texteHtml('frais_annexes_btp.rapport.colonnes.tranche')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.portee')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.prevu')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.ventile')}</th><th>%</th><th title="${texteHtml('frais_annexes_btp.rapport.colonnes.reel_aide')}">${texteHtml('frais_annexes_btp.rapport.colonnes.reel')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.ecart')}</th><th></th></tr></thead>
        <tbody>${bilans.map((b) => `
          <tr data-tranche="${b.lig_id}" class="${this.ouverts.has(b.lig_id) ? 'ouvert' : ''}">
            <th><button type="button" class="pli" data-plier="${b.lig_id}">${iconeHtml(this.ouverts.has(b.lig_id) ? 'frais_annexes_btp_ouvert' : 'frais_annexes_btp_ferme')}</button> ${echapper(libelle(b.lig_id))}</th>
            <td>${echapper(b.portee_id ? libelle(b.portee_id) : '—')}</td>
            <td class="nombre">${formatNombre(b.prevu, pm)}</td><td class="nombre">${formatNombre(b.ventile, pm)} <small>${texteHtml(b.cles ? 'frais_annexes_btp.rapport.cles' : 'frais_annexes_btp.rapport.prorata')}</small></td>
            <td class="nombre">${pct(b)}</td><td class="nombre">${formatNombre(b.ventile_reel, pm)}</td>
            <td class="nombre ${Number(b.ecart) ? 'coef-bas' : ''}">${formatNombre(b.ecart, pm)}</td>
            <td class="actions">${lecture ? '' : `
              <button type="button" data-action-frais="reste" title="${texteHtml('frais_annexes_btp.rapport.actions.reste_aide')}">${texteHtml('frais_annexes_btp.rapport.actions.reste')}</button>
              <button type="button" data-action-frais="figer" title="${texteHtml('frais_annexes_btp.rapport.actions.figer_aide')}">${texteHtml('frais_annexes_btp.rapport.actions.figer')}</button>
              ${b.cles ? `<button type="button" data-action-frais="prorata" title="${texteHtml('frais_annexes_btp.rapport.actions.prorata_aide')}">${texteHtml('frais_annexes_btp.rapport.actions.prorata')}</button>` : ''}`}</td>
          </tr>
          ${this.ouverts.has(b.lig_id) ? `<tr class="frais-detail"><td colspan="8">${this.detail(b, s, pm, lecture)}</td></tr>` : ''}`).join('')}
        </tbody>
      </table>`;

    // Réglages du document : combos du socle.
    const reglage = (champ, libelles) => {
      const combo = creerCombo({ options: Object.entries(libelles).map(([v, t]) => ({ valeur: v, libelle: t })), valeur: ed.saisie.document[champ] ?? Object.keys(libelles)[0], vide: false });
      combo.disabled = lecture;
      combo.addEventListener('change', () => ed.magasin.modifier((d) => { d.document[champ] = combo.valeurCombo; }, texte('frais_annexes_btp.rapport.etape')));
      this.conteneur.querySelector(`[data-reglage="${champ}"]`).append(combo);
    };
    reglage('ent_fa_lignes', LIBELLES_FA_LIGNES);
    reglage('ent_fa_mode', LIBELLES_FA_MODE);
    this.conteneur.querySelector('[data-rapport-frais="csv"]')?.addEventListener('click', () => {
      const d = ed.saisie.document;
      telechargerCsv(`${texte('frais_annexes_btp.rapport.csv.fichier')}-${d.ent_numero ?? d.ent_id}.csv`, this.lignesCsv());
    });
    this.conteneur.querySelector('[data-rapport-frais="imprimer"]')?.addEventListener('click', () => this.imprimer());

    this.conteneur.querySelectorAll('[data-plier]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.plier);
      if (this.ouverts.has(id)) this.ouverts.delete(id); else this.ouverts.add(id);
      this.rendre();
    }));
    this.conteneur.querySelectorAll('[data-action-frais]').forEach((b) => b.addEventListener('click', () => {
      const source = Number(b.closest('[data-tranche]').dataset.tranche);
      this.action(source, b.dataset.actionFrais);
    }));
    this.lierCles();
  }

  /** Détail d'une tranche de frais : par nature, par élément, par tranche (lignes). */
  detail(b, s, pm, lecture) {
    const ed = this.editeur;
    const feuilles = this.partsFeuilles(b, s);
    const cles = ed.saisie.ventilations ?? [];
    const cle = (source, cible, valeur) => cles.find((k) => (k.vfr_source_lig_id ?? null) === source && k.vfr_cible === cible
      && (cible === 'ELEMENT' ? k.vfr_element === valeur : Number(k.vfr_nat_id) === Number(valeur))) ?? null;
    const saisieCle = (source, cible, valeur) => {
      const k = cle(source, cible, valeur);
      return `<span class="saisie-cle" data-source="${source ?? ''}" data-cible="${cible}" data-valeur-cible="${echapper(valeur)}" data-mode="${k?.vfr_mode ?? 'P'}">
        <input class="nombre" value="${echapper(k ? formatLibre(k.vfr_valeur) : '')}" ${lecture ? 'disabled' : ''} title="${texteHtml('frais_annexes_btp.rapport.cle_vide')}"></span>`;
    };
    const grouper = (cleDe) => {
      const g = new Map();
      for (const f of feuilles) {
        const c = cleDe(f);
        if (c === null) continue;
        const x = g.get(c) ?? { cle: c, poids: D(0), part: D(0), feuilles: [] };
        x.poids = x.poids.plus(f.poids);
        x.part = x.part.plus(f.part);
        x.feuilles.push(f);
        g.set(c, x);
      }
      return [...g.values()].sort((a, c) => c.poids.cmp(a.poids));
    };
    const parNature = grouper((f) => f.feuille.lig_nat_id ?? null);
    const parElement = grouper((f) => (f.feuille.lig_tyl_id === TL.ELEMENT ? cleElementVentilation(f.feuille) : null));
    const prixDe = new Map();
    for (const f of feuilles) prixDe.set(f.prix.lig_id, (prixDe.get(f.prix.lig_id) ?? { prix: f.prix, poids: D(0), part: D(0), tranches: f.tranches }));
    for (const f of feuilles) { const x = prixDe.get(f.prix.lig_id); x.poids = x.poids.plus(f.poids); x.part = x.part.plus(f.part); }
    const parTranche = new Map();
    for (const x of prixDe.values()) {
      const t = x.tranches[0] ?? b.portee_id;
      const g = parTranche.get(t) ?? { tranche: t, poids: D(0), part: D(0), lignes: [] };
      g.poids = g.poids.plus(x.poids);
      g.part = g.part.plus(x.part);
      g.lignes.push(x);
      parTranche.set(t, g);
    }
    const nature = (id) => this.natures.get(Number(id));
    const m = (v) => formatNombre(v, pm);
    const libelle = (id) => s.parId.get(id)?.lig_libelle_brut || '—';
    return `<div class="frais-parties">
      <section><h4>${texteHtml('frais_annexes_btp.rapport.par_nature')}</h4><table class="table-analyse">
        <thead><tr><th>${texteHtml('frais_annexes_btp.rapport.colonnes.nature')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.hors_frais')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.part')}</th><th title="${texteHtml('frais_annexes_btp.rapport.colonnes.cle_tranche_aide')}">${texteHtml('frais_annexes_btp.rapport.colonnes.cle_tranche')}</th><th title="${texteHtml('frais_annexes_btp.rapport.colonnes.cle_globale_aide')}">${texteHtml('frais_annexes_btp.rapport.colonnes.cle_globale')}</th></tr></thead>
        <tbody>${parNature.map((g) => `<tr><th>${echapper(nature(g.cle) ? `${nature(g.cle).code} – ${nature(g.cle).libelle}` : `#${g.cle}`)}</th>
          <td class="nombre">${m(g.poids)}</td><td class="nombre">${m(g.part)}</td><td>${saisieCle(b.lig_id, 'NATURE', g.cle)}</td><td>${saisieCle(null, 'NATURE', g.cle)}</td></tr>`).join('')}</tbody>
      </table></section>
      <section><h4>${texteHtml('frais_annexes_btp.rapport.par_element')}</h4><table class="table-analyse">
        <thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.hors_frais')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.part')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.cle')}</th></tr></thead>
        <tbody>${parElement.map((g) => `<tr><td>${echapper(g.feuilles[0].feuille.lig_code ?? '')}</td><th>${echapper(g.feuilles[0].feuille.lig_libelle_brut ?? '')}</th>
          <td class="nombre">${m(g.poids)}</td><td class="nombre">${m(g.part)}</td><td>${saisieCle(b.lig_id, 'ELEMENT', g.cle)}</td></tr>`).join('')}</tbody>
      </table></section>
      <section><h4>${texteHtml('frais_annexes_btp.rapport.par_tranche')}</h4><table class="table-analyse">
        <thead><tr><th>${texteHtml('frais_annexes_btp.rapport.colonnes.tranche_ligne')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.hors_frais')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.part')}</th><th>${texteHtml('frais_annexes_btp.rapport.colonnes.coef_fa')}</th></tr></thead>
        <tbody>${[...parTranche.values()].map((g) => `<tr class="groupe"><th>${echapper(libelle(g.tranche))}</th><td class="nombre">${m(g.poids)}</td><td class="nombre">${m(g.part)}</td><td></td></tr>
          ${g.lignes.map((x) => `<tr><td class="indent"><a href="#" data-aller="${x.prix.lig_id}">${echapper(`${x.prix.lig_numerotation ?? ''} ${x.prix.lig_libelle_brut ?? ''}`)}</a></td>
            <td class="nombre">${m(x.poids)}</td><td class="nombre">${m(x.part)}</td><td class="nombre">${formatLibre(x.prix.lig_coef_fa ?? 1, 4)}</td></tr>`).join('')}`).join('')}</tbody>
      </table></section>
    </div>`;
  }

  /** Saisie des clés de nature et d'élément : valeur et mode (% de la tranche ou montant). */
  lierCles() {
    const ed = this.editeur;
    const m = ed.magasin;
    this.conteneur.querySelectorAll('.saisie-cle').forEach((span) => {
      const champ = span.querySelector('input');
      const mode = creerCombo({ options: MODES_CLE, valeur: span.dataset.mode, vide: false });
      mode.disabled = champ.disabled;
      span.append(mode);
      const ecrire = () => {
        const saisie = champ.value.trim();
        const v = saisie === '' ? null : lireNombre(saisie);
        if (v === undefined) { this.message(texte('frais_annexes_btp.rapport.nombre_invalide')); return; }
        const source = span.dataset.source === '' ? null : Number(span.dataset.source);
        const cible = span.dataset.cible === 'ELEMENT'
          ? { vfr_cible: 'ELEMENT', vfr_element: span.dataset.valeurCible }
          : { vfr_cible: 'NATURE', vfr_nat_id: Number(span.dataset.valeurCible) };
        const id = m.prochainId();
        m.modifier((d) => ecrireCle(d, source, cible, mode.valeurCombo || 'P', v, () => id), texte('frais_annexes_btp.rapport.etape_cle'));
      };
      champ.addEventListener('change', ecrire);
      mode.addEventListener('change', () => { if (champ.value.trim() !== '') ecrire(); });
    });
    this.conteneur.querySelectorAll('[data-aller]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      ed.allerA?.(Number(a.dataset.aller), { focus: true });
    }));
  }

  /** Actions d'une tranche de frais : répartir le reste, figer, revenir au prorata. */
  action(source, quoi) {
    const ed = this.editeur;
    const m = ed.magasin;
    let n = m.prochainId() + 1;
    const prochainId = () => --n;
    const r = ed.resultat;
    if (!bilanTranche(r, source)) return;
    const cles = quoi === 'prorata' ? [] : quoi === 'figer' ? figerVentilation(r, { source, prochainId }) : repartirReste(ed.entree(ed.saisie), r, source, prochainId);
    if (!cles) { this.message(texte('frais_annexes_btp.rapport.sans_ligne')); return; }
    m.modifier((d) => remplacerCles(d, source, cles), texte(`frais_annexes_btp.etapes.${quoi}`));
  }
}
