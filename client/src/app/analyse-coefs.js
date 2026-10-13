import { echapper, formatNombre, formatLibre, lireNombre, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { TL, estPied, estTranche } from '../calcul/index.js';
import {
  feuillesAnalyse, agreger, forcerMontant, paEcart, MONTANTS_FORCABLES, elementsAnalyse, modificationsElement, VALEURS_ELEMENT,
} from './analyse-calcul.js';

// Onglet Analyse : ventilation par nature de la portée choisie dans l'arbre des tranches (document entier, section,
// titres), avec le total de la portée ; du déboursé au prix client, frais annexes ventilés, marges brute et nette.
// Un arbre des natures (regroupements, natures) filtre aussi les lignes. Partie Éléments : les éléments regroupés par
// code et libellé, avec leurs prix et coefficients (deux extrêmes sur fond coloré quand les lignes diffèrent) ; une
// valeur saisie est écrite sur toutes les lignes du groupe dans le filtre. Aide à la saisie : un
// coefficient ou un montant saisi est écrit sur les lignes (une étape d'annulation) ; les montants sont les vraies
// valeurs (voir analyse-calcul.js : absorption de l'arrondi, ligne d'écart en dernier recours).

/** Colonnes du tableau ; `saisie` : coef (coefficient écrit sur les feuilles), prorata (lignes vendues), montant (forcé). */
export const COLONNES_ANALYSE = [
  { cle: 'nb', titre: 'Lignes', type: 'entier', defaut: false, aide: 'Nombre de lignes chiffrées sans composante' },
  { cle: 'ds', titre: 'Déboursé', type: 'montant', defaut: true, aide: 'Σ quantité totale × PA' },
  { cle: 'fg', titre: 'FG', type: 'coef', defaut: true, saisie: 'coef', champ: 'lig_coef_fg', aide: 'Coefficient de frais généraux (revient / déboursé)' },
  { cle: 'rev', titre: 'Revient', type: 'montant', defaut: true, saisie: 'montant', aide: 'Σ quantité totale × PR' },
  { cle: 'benef', titre: 'Bénéf.', type: 'coef', defaut: true, saisie: 'coef', champ: 'lig_coef_benef', aide: 'Coefficient de bénéfice (PV / revient)' },
  { cle: 'pv', titre: 'PV avant FA', type: 'montant', defaut: true, saisie: 'montant', aide: 'Σ quantité totale × PV, avant frais annexes' },
  { cle: 'coefFa', titre: 'Coef. FA', type: 'coef', defaut: false, aide: 'Coefficient de frais annexes (PV avec FA / PV)' },
  { cle: 'fa', titre: 'FA ventilés', type: 'montant', defaut: true, aide: 'Frais annexes ventilés : PV avec FA − PV' },
  { cle: 'pvFa', titre: 'PV avec FA', type: 'montant', defaut: true, aide: 'PV × coefficient de frais annexes' },
  { cle: 'prorata', titre: 'Prorata', type: 'coef', defaut: false, saisie: 'prorata', champ: 'lig_coef_prorata', aide: 'Prorata des lignes vendues' },
  { cle: 'client', titre: 'Prix client', type: 'montant', defaut: true, saisie: 'montant', aide: 'PV avec FA × prorata × remise' },
  { cle: 'global', titre: 'Coef. global', type: 'coef', defaut: false, aide: 'Prix client / déboursé' },
  { cle: 'margeBrute', titre: 'Marge brute', type: 'montant', defaut: true, aide: 'Prix client − déboursé (PA)' },
  { cle: 'tauxBrute', titre: '% brute', type: 'pct', defaut: false, aide: 'Marge brute / prix client' },
  { cle: 'margeNette', titre: 'Marge nette', type: 'montant', defaut: true, aide: 'PV remisé sans frais annexes ni prorata − revient' },
  { cle: 'tauxNette', titre: '% nette', type: 'pct', defaut: true, aide: 'Marge nette / PV remisé sans frais annexes ni prorata' },
];

const LIBELLES_COEF = { fg: 'frais généraux', benef: 'bénéfice', prorata: 'prorata' };

/** Tri de la liste des éléments : valeur comparée par colonne (valeurs divergentes : le minimum). */
const TRIS_ELEMENTS = {
  code: { titre: 'Code', texte: true, valeur: (g) => g.code },
  libelle: { titre: 'Libellé', texte: true, valeur: (g) => g.libelle },
  unite: { titre: 'U', texte: true, valeur: (g) => [...g.unites].join(' / ') },
  nb: { titre: 'Lignes', valeur: (g) => g.feuilles.length, aide: 'Nombre de lignes' },
  qt: { titre: 'Qté totale', valeur: (g) => g.qt },
  pa: { titre: VALEURS_ELEMENT.pa.titre, valeur: (g) => g.valeurs.pa?.min ?? null },
  fg: { titre: VALEURS_ELEMENT.fg.titre, valeur: (g) => g.valeurs.fg?.min ?? null },
  pr: { titre: VALEURS_ELEMENT.pr.titre, valeur: (g) => g.valeurs.pr?.min ?? null },
  benef: { titre: VALEURS_ELEMENT.benef.titre, valeur: (g) => g.valeurs.benef?.min ?? null },
  pv: { titre: VALEURS_ELEMENT.pv.titre, valeur: (g) => g.valeurs.pv?.min ?? null },
  montant: { titre: 'Montant PV', valeur: (g) => g.montant },
  nature: { titre: 'Nature', texte: true, valeur: (g, natures) => [...g.natures].map((n) => natures.get(n)?.code ?? '').join(', ') },
};

export class AnalyseCoefficients {
  constructor(conteneur, { editeur, natures = [], message = () => {} }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.natures = new Map(natures.map((n) => [n.id, n]));
    this.message = message;
    const p = lirePreferences().analyse ?? {};
    this.horsTotal = Boolean(p.horsTotal);
    this.colonnes = new Set(Array.isArray(p.colonnes) ? p.colonnes : COLONNES_ANALYSE.filter((c) => c.defaut).map((c) => c.cle));
    // Partage de la zone : part des coefficients (en %) et partie masquée ('coefs', 'elements' ou null).
    this.partage = Number.isFinite(p.partage) ? Math.min(85, Math.max(15, p.partage)) : 45;
    this.masquee = ['coefs', 'elements'].includes(p.masquee) ? p.masquee : null;
    // Part de l'arbre des tranches dans la colonne de gauche (en %), tri de la liste des éléments.
    this.partageGauche = Number.isFinite(p.partageGauche) ? Math.min(85, Math.max(15, p.partageGauche)) : 60;
    this.tri = p.tri && TRIS_ELEMENTS[p.tri.cle] ? { cle: p.tri.cle, sens: p.tri.sens === -1 ? -1 : 1 } : null;
    this.portee = null; // null : document entier ; sinon identifiant d'une tranche
    this.arbreReplies = new Set(); // nœuds repliés de l'arbre des tranches (portée)
    this.filtreNature = null; // null : toutes ; 'r:<regroupement>', 'n:<id>' ou 'n:' (sans nature)
    this.naturesReplies = new Set();
    this.recherche = '';
    conteneur.classList.add('analyse-coefs');
    conteneur.addEventListener('change', (e) => this.#changement(e));
    conteneur.addEventListener('click', (e) => this.#clic(e));
    conteneur.addEventListener('input', (e) => {
      if (!e.target.matches('[data-recherche]')) return;
      this.recherche = e.target.value;
      this.rendreElements();
    });
  }

  /** Feuille retenue par le filtre de nature (regroupement, nature ou sans nature). */
  correspondNature(f) {
    const n = this.filtreNature;
    if (n === null) return true;
    if (n === 'n:') return f.nature === null || f.nature === undefined;
    if (n.startsWith('n:')) return f.nature === Number(n.slice(2));
    return this.natures.get(f.nature)?.regroupement === n.slice(2);
  }

  libelleFiltreNature() {
    const n = this.filtreNature;
    if (n === null) return null;
    if (n === 'n:') return 'sans nature';
    if (n.startsWith('n:')) { const x = this.natures.get(Number(n.slice(2))); return x ? x.libelle : `nature ${n.slice(2)}`; }
    return `regroupement ${n.slice(2)}`;
  }

  get resultat() { return this.editeur.resultat; }
  get coefFa() { return Number(this.resultat.document.ent_coef_fa ?? 1); }

  memoriser() {
    ecrirePreferences({ analyse: {
      horsTotal: this.horsTotal, colonnes: [...this.colonnes], partage: this.partage, masquee: this.masquee, partageGauche: this.partageGauche, tri: this.tri,
    } });
  }

  /** Partage appliqué : hauteur de la partie Coefficients, partie masquée. */
  appliquerPartage() {
    const principal = this.conteneur.querySelector('.analyse-principal');
    if (!principal) return;
    principal.style.setProperty('--part-coefs', `${this.partage}%`);
    principal.dataset.masquee = this.masquee ?? '';
    for (const b of principal.querySelectorAll('[data-masquer-partie]')) {
      const masquee = this.masquee === b.dataset.masquerPartie;
      b.textContent = masquee ? '▸' : '▾';
      b.title = masquee ? 'Afficher cette partie' : 'Masquer cette partie (l\'autre prend toute la place)';
      b.setAttribute('aria-expanded', String(!masquee));
    }
  }

  /** Limite verticale déplacée par glisser (Pointer Events) : part en % de la zone (15 à 85) ; double-clic : défaut. */
  #separateur(sep, { zone, fixer, defaut }) {
    if (!sep) return;
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      const haut = zone().getBoundingClientRect();
      document.body.classList.add('redimensionnement-vertical');
      const bouger = (ev) => fixer(Math.round(Math.min(85, Math.max(15, ((ev.clientY - haut.top) / haut.height) * 100))));
      const finir = () => {
        sep.removeEventListener('pointermove', bouger);
        sep.removeEventListener('pointerup', finir);
        sep.removeEventListener('pointercancel', finir);
        document.body.classList.remove('redimensionnement-vertical');
        this.memoriser();
      };
      sep.addEventListener('pointermove', bouger);
      sep.addEventListener('pointerup', finir);
      sep.addEventListener('pointercancel', finir);
    });
    sep.addEventListener('dblclick', () => { fixer(defaut); this.memoriser(); });
  }

  /** Tranches (sections, titres) dans l'ordre du document avec leur profondeur. */
  tranches() {
    const lignes = this.resultat.lignes;
    const parId = new Map(lignes.map((l) => [l.lig_id, l]));
    const profondeur = (l) => { let n = 0; for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) n += 1; return n; };
    return lignes.filter(estTranche).map((l) => ({ ligne: l, profondeur: profondeur(l), parent: l.lig_parent_id }));
  }

  libelleTranche(l) {
    return `${l.lig_numerotation ?? ''} ${l.lig_libelle_brut || (l.lig_tyl_id === TL.SECTION ? 'Section' : 'Titre')}`.trim();
  }

  /** Groupes du tableau : les natures de la portée [{ cle, libelle, feuilles, agregat, nature }], et le total de la portée. */
  groupes() {
    const portee = feuillesAnalyse(this.resultat, this.editeur.saisie, { portee: this.portee, horsTotal: this.horsTotal });
    this.feuillesPortee = portee;
    const feuilles = portee.filter((f) => this.correspondNature(f));
    this.feuilles = feuilles;
    const libelleTotal = this.filtreNature !== null ? `Total (${this.libelleFiltreNature()})` : this.portee === null ? 'Total du document' : 'Total de la portée';
    const total = { cle: 'total', libelle: libelleTotal, feuilles, agregat: agreger(feuilles, this.coefFa) };
    const groupes = new Map();
    for (const f of feuilles) {
      const cle = `n:${f.nature ?? ''}`;
      if (!groupes.has(cle)) {
        const n = this.natures.get(f.nature);
        groupes.set(cle, { cle, libelle: n ? `${n.code} · ${n.libelle}` : f.nature ? `Nature ${f.nature}` : 'Sans nature', feuilles: [], nature: f.nature });
      }
      groupes.get(cle).feuilles.push(f);
    }
    const liste = [...groupes.values()].map((g) => ({ ...g, agregat: agreger(g.feuilles, this.coefFa) })).sort((a, b) => b.agregat.ds - a.agregat.ds);
    return { liste, total };
  }

  rendre() {
    if (this.conteneur.contains(document.activeElement) && document.activeElement.matches('input[data-saisie]')) return;
    const pm = this.editeur.saisie.document.ent_precision_montant ?? 2;
    const tranches = this.tranches();
    if (this.portee !== null && !tranches.some((t) => t.ligne.lig_id === this.portee)) this.portee = null;
    const { liste, total } = this.groupes();
    const lectureSeule = this.editeur.magasin?.lectureSeule;
    const defauts = this.editeur.coefsDefaut ?? {};
    const colonnes = COLONNES_ANALYSE.filter((c) => this.colonnes.has(c.cle));
    const arr = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

    const cellule = (g, c, estTotal) => {
      const v = g.agregat[c.cle];
      if (v === null || v === undefined) return '<td></td>';
      let txt;
      let classe = '';
      if (c.type === 'coef') {
        const r = arr(v, 4);
        txt = formatLibre(r, 4);
        if (['fg', 'benef', 'prorata'].includes(c.cle)) classe = r < 1 ? 'coef-bas' : r < Number(c.cle === 'prorata' ? 1 : defauts[c.cle] ?? 1) ? 'coef-moyen' : 'coef-ok';
      } else if (c.type === 'pct') txt = `${formatLibre(arr(v * 100, 1), 1)} %`;
      else if (c.type === 'entier') txt = String(v);
      else {
        txt = formatNombre(v, pm);
        if (c.cle.startsWith('marge') && v < 0) classe = 'coef-bas';
      }
      // Prorata : saisi sur les lignes vendues, donc au total de la portée (pas par nature).
      const saisissable = c.saisie && !lectureSeule && g.feuilles.length && (c.saisie !== 'prorata' || estTotal);
      if (!saisissable) return `<td class="nombre ${classe}">${txt}</td>`;
      const valeur = c.type === 'montant' ? formatNombre(arr(v, pm), pm) : txt;
      const aide = c.saisie === 'montant'
        ? `Saisir le ${MONTANTS_FORCABLES[c.cle].libelle} : les coefficients des lignes sont recalculés, l'arrondi est absorbé par les plus fortes lignes`
        : `Saisir un coefficient de ${LIBELLES_COEF[c.cle]} : il est écrit sur les lignes ${c.saisie === 'prorata' ? 'vendues' : 'chiffrées sans composante'} du groupe`;
      return `<td class="nombre"><input class="${classe} ${c.type === 'montant' ? 'montant' : ''}" data-saisie="${c.saisie}" data-groupe="${echapper(g.cle)}" data-cle="${c.cle}"
        value="${echapper(valeur)}" title="${echapper(aide)}"></td>`;
    };
    const ligne = (g, estTotal = false) => `<tr class="${estTotal ? 'total' : ''}"><th>${echapper(g.libelle)}</th>
        ${colonnes.map((c) => cellule(g, c, estTotal)).join('')}</tr>`;
    const parent = this.portee === null ? null : tranches.find((t) => t.ligne.lig_id === this.portee)?.parent ?? null;
    const parentEstTranche = parent !== null && tranches.some((t) => t.ligne.lig_id === parent);

    this.conteneur.innerHTML = `
      <div class="analyse-gauche" style="--part-tranches:${this.partageGauche}%">${this.arbre(tranches, pm)}
        <div class="analyse-separateur" data-separateur="gauche" role="separator" aria-orientation="horizontal" title="Glisser pour déplacer la limite · double-clic : partage par défaut"></div>
        ${this.arbreNatures(pm)}</div>
      <div class="analyse-principal">
      <div class="analyse-barre">
        <span class="analyse-portee">Portée : <strong>${echapper(this.portee === null ? 'Document entier' : this.libelleTranche(tranches.find((t) => t.ligne.lig_id === this.portee).ligne))}</strong>
          ${this.filtreNature !== null ? ` · <strong>${echapper(this.libelleFiltreNature())}</strong> <button type="button" data-nature-filtre="" title="Toutes les natures">✕</button>` : ''}</span>
        ${this.portee !== null ? `<button type="button" data-portee-id="${parentEstTranche ? parent : ''}" title="Remonter d'un niveau">↑</button>` : ''}
        <label class="coche" title="Options, variantes et lignes pour mémoire comprises dans l'analyse (et dans les saisies)">
          <input type="checkbox" data-hors-total ${this.horsTotal ? 'checked' : ''}> Options et pour mémoire</label>
        <span class="analyse-colonnes">
          <button type="button" data-choix-colonnes aria-expanded="false">Colonnes ▾</button>
          <div class="menu-colonnes" hidden>
            ${COLONNES_ANALYSE.map((c) => `<label title="${echapper(c.aide)}"><input type="checkbox" data-colonne="${c.cle}" ${this.colonnes.has(c.cle) ? 'checked' : ''}> ${echapper(c.titre)}</label>`).join('')}
            <button type="button" data-colonnes-defaut>Colonnes par défaut</button>
          </div>
        </span>
        <span class="analyse-fa">Coef. frais annexes : <strong>${formatLibre(this.coefFa)}</strong></span>
      </div>
      <div class="analyse-parties">
      <section class="analyse-partie" data-partie="coefs">
        <header class="partie-entete">
          <button type="button" class="partie-bascule" data-masquer-partie="coefs"></button>
          <h3>Coefficients par nature</h3>
          <span class="aide">Coefficient ou montant saisi écrit sur les lignes (Ctrl+Z pour annuler) ; les montants restent les vraies valeurs, l'arrondi est
            absorbé par les plus fortes lignes, en dernier recours par une ligne d'écart d'arrondi dans la nature. Moyennes pondérées.</span>
        </header>
        <div class="partie-corps"><table class="table-analyse">
        <thead><tr><th>Nature</th>${colonnes.map((c) => `<th title="${echapper(c.aide)}">${echapper(c.titre)}</th>`).join('')}</tr></thead>
        <tbody>${liste.map((g) => ligne(g)).join('')}</tbody>
        <tfoot>${ligne(total, true)}</tfoot>
        </table>
        ${liste.length ? '' : '<p class="aide">Aucune ligne chiffrée dans cette portée.</p>'}</div>
      </section>
      <div class="analyse-separateur" data-separateur="parties" role="separator" aria-orientation="horizontal" title="Glisser pour déplacer la limite · double-clic : partage par défaut"></div>
      <section class="analyse-partie analyse-elements" data-partie="elements">
        <header class="partie-entete">
          <button type="button" class="partie-bascule" data-masquer-partie="elements"></button>
          <h3>Éléments <small data-nb-elements></small></h3>
          <input type="search" data-recherche placeholder="Rechercher un code ou un libellé" value="${echapper(this.recherche)}">
          <span class="aide">Regroupés par code et libellé (hors tranches et ouvrages) ; valeur saisie écrite sur toutes les lignes du groupe dans la portée
            et la nature filtrées. Fond coloré : les lignes diffèrent (minimum – maximum).</span>
        </header>
        <div class="partie-corps"><table class="table-analyse table-elements">
          <thead><tr>${Object.entries(TRIS_ELEMENTS).map(([k, t]) => `<th data-tri="${k}" class="triable" aria-sort="none"
            title="${echapper(t.aide ?? t.titre)} : cliquer pour trier (croissant, décroissant, ordre par défaut)">${echapper(t.titre)}<span class="sens-tri"></span></th>`).join('')}</tr></thead>
          <tbody></tbody>
        </table></div>
      </section>
      </div>
      </div>`;
    this.dernier = { liste, total };
    this.appliquerPartage();
    this.#separateur(this.conteneur.querySelector('[data-separateur="parties"]'), {
      zone: () => this.conteneur.querySelector('.analyse-parties'),
      fixer: (v) => { this.partage = v; this.masquee = null; this.appliquerPartage(); },
      defaut: 45,
    });
    this.#separateur(this.conteneur.querySelector('[data-separateur="gauche"]'), {
      zone: () => this.conteneur.querySelector('.analyse-gauche'),
      fixer: (v) => { this.partageGauche = v; this.conteneur.querySelector('.analyse-gauche').style.setProperty('--part-tranches', `${v}%`); },
      defaut: 60,
    });
    this.rendreElements();
  }

  /** Partie Éléments : groupes par code et libellé des feuilles filtrées (portée, nature, recherche). */
  rendreElements() {
    const corps = this.conteneur.querySelector('.table-elements tbody');
    if (!corps) return;
    const pm = this.editeur.saisie.document.ent_precision_montant ?? 2;
    const lectureSeule = this.editeur.magasin?.lectureSeule;
    const r = this.recherche.trim().toLowerCase();
    const groupes = elementsAnalyse(this.feuilles ?? []).filter((g) => !r || `${g.code} ${g.libelle}`.toLowerCase().includes(r));
    // Tri choisi (sinon : montant décroissant) ; valeurs absentes en fin de liste.
    if (this.tri) {
      const t = TRIS_ELEMENTS[this.tri.cle];
      const sens = this.tri.sens;
      groupes.sort((a, b) => {
        const va = t.valeur(a, this.natures), vb = t.valeur(b, this.natures);
        if (va === null || va === '') return vb === null || vb === '' ? 0 : 1;
        if (vb === null || vb === '') return -1;
        return (t.texte ? String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' }) : va - vb) * sens;
      });
    }
    for (const th of this.conteneur.querySelectorAll('.table-elements th[data-tri]')) {
      const actif = this.tri?.cle === th.dataset.tri;
      th.setAttribute('aria-sort', actif ? (this.tri.sens === 1 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.sens-tri').textContent = actif ? (this.tri.sens === 1 ? ' ▲' : ' ▼') : '';
    }
    this.elements = new Map(groupes.map((g) => [g.cle, g]));
    const nombre = (v, d) => formatLibre(Math.round(v * 10 ** d) / 10 ** d, d);
    const valeur = (g, k) => {
      const s = g.valeurs[k];
      const def = VALEURS_ELEMENT[k];
      if (!s) return '<td></td>';
      const txt = s.divergent ? `${nombre(s.min, def.decimales)} – ${nombre(s.max, def.decimales)}` : nombre(s.min, def.decimales);
      if (lectureSeule) return `<td class="nombre ${s.divergent ? 'divergent' : ''}">${txt}</td>`;
      return `<td class="nombre ${s.divergent ? 'divergent' : ''}" title="${s.divergent ? `Valeurs différentes : de ${txt.replace(' – ', ' à ')}` : ''}">
        <input data-saisie="element" data-element="${echapper(g.cle)}" data-cle="${k}" value="${s.divergent ? '' : echapper(txt)}"
          placeholder="${echapper(txt)}" title="Saisir le ${echapper(def.titre)} de toutes les lignes du groupe (${g.feuilles.length})"></td>`;
    };
    const natures = (g) => [...g.natures].map((n) => this.natures.get(n)?.code ?? (n ? String(n) : '—')).join(', ');
    corps.innerHTML = groupes.map((g) => `<tr>
      <td>${echapper(g.code)}</td><th title="${echapper(g.libelle)}">${echapper(g.libelle)}</th>
      <td class="${g.unites.size > 1 ? 'divergent' : ''}">${echapper([...g.unites].join(' / '))}</td>
      <td class="nombre">${g.feuilles.length}</td><td class="nombre">${nombre(g.qt, 3)}</td>
      ${Object.keys(VALEURS_ELEMENT).map((k) => valeur(g, k)).join('')}
      <td class="nombre">${formatNombre(g.montant, pm)}</td><td class="${g.natures.size > 1 ? 'divergent' : ''}">${echapper(natures(g))}</td></tr>`).join('')
      || '<tr><td colspan="12" class="aide">Aucun élément.</td></tr>';
    this.conteneur.querySelector('[data-nb-elements]').textContent = `(${groupes.length} groupe(s), ${groupes.reduce((n, g) => n + g.feuilles.length, 0)} ligne(s))`;
  }

  /** Valeur saisie dans la partie Éléments : écrite sur toutes les lignes du groupe (une étape d'annulation). */
  appliquerElement(cleGroupe, cle, valeur) {
    const g = this.elements?.get(cleGroupe);
    if (!g) return;
    if (Number(valeur) < 0 || (cle !== 'pa' && cle !== 'pv' && Number(valeur) <= 0)) { this.message('Valeur invalide'); this.rendre(); return; }
    const { modifs, erreur } = modificationsElement(g, cle, valeur);
    if (erreur) { this.message(erreur, 'erreur'); this.rendre(); return; }
    const titre = VALEURS_ELEMENT[cle].titre;
    this.editeur.magasin.modifier((d) => {
      for (const l of d.lignes) if (modifs.has(l.lig_id)) Object.assign(l, modifs.get(l.lig_id));
    }, `Analyse : ${titre} de « ${g.libelle || g.code} »`);
    this.message(`${titre} ${formatLibre(valeur)} écrit sur ${modifs.size} ligne(s) « ${g.libelle || g.code} »${cle === 'pv' ? ' (prix fixe)' : ''}`);
  }

  /** Arbre des natures des lignes de la portée : regroupements puis natures, avec le nombre de lignes ; filtre. */
  arbreNatures() {
    const comptes = new Map();
    for (const f of this.feuillesPortee ?? []) comptes.set(f.nature ?? null, (comptes.get(f.nature ?? null) ?? 0) + 1);
    const regroupements = new Map();
    for (const [id, n] of comptes) {
      if (id === null) continue;
      const nat = this.natures.get(id);
      const reg = nat?.regroupement ?? 'AUTRE';
      if (!regroupements.has(reg)) regroupements.set(reg, []);
      regroupements.get(reg).push({ id, libelle: nat ? `${nat.code} · ${nat.libelle}` : `Nature ${id}`, n });
    }
    const total = [...comptes.values()].reduce((a, b) => a + b, 0);
    const noeud = (cle, libelle, n, profondeur, { pli = null, classe = '' } = {}) => `
      <li class="${classe} ${this.filtreNature === cle ? 'courant' : ''}" style="padding-left:${0.3 + profondeur * 0.9}rem">
        <span class="pli" ${pli ? `data-nature-pli="${echapper(pli)}"` : ''}>${pli ? (this.naturesReplies.has(pli) ? '▸' : '▾') : ''}</span>
        <button type="button" class="lien" data-nature-filtre="${echapper(cle ?? '')}" title="${echapper(libelle)}">${echapper(libelle)}</button>
        <span class="mt">${n}</span></li>`;
    const items = [noeud(null, 'Toutes les natures', total, 0, { classe: 'global' })];
    for (const [reg, natures] of [...regroupements].sort((a, b) => a[0].localeCompare(b[0]))) {
      items.push(noeud(`r:${reg}`, reg, natures.reduce((a, x) => a + x.n, 0), 1, { pli: reg }));
      if (this.naturesReplies.has(reg)) continue;
      for (const x of natures.sort((a, b) => a.libelle.localeCompare(b.libelle))) items.push(noeud(`n:${x.id}`, x.libelle, x.n, 2));
    }
    if (comptes.has(null)) items.push(noeud('n:', 'Sans nature', comptes.get(null), 1));
    return `<aside class="analyse-arbre analyse-natures" aria-label="Filtre par nature"><div class="analyse-arbre-titre">Natures</div><ul>${items.join('')}</ul></aside>`;
  }

  /**
   * Arbre hiérarchique des portées : le document entier (global), puis les sections, titres et sous-titres, avec
   * leur montant HT ; clic sur un nœud pour l'analyser, repli des nœuds.
   */
  arbre(tranches, pm) {
    const ids = new Set(tranches.map((t) => t.ligne.lig_id));
    const avecEnfants = new Set(tranches.map((t) => t.parent).filter((x) => ids.has(x)));
    const masques = new Set();
    const noeud = (id, libelle, montant, profondeur, aEnfants, classe = '') => `
      <li class="${classe} ${id === this.portee ? 'courant' : ''}" style="padding-left:${0.3 + profondeur * 0.9}rem">
        <span class="pli" ${aEnfants && id !== null ? `data-arbre-pli="${id}"` : ''}>${aEnfants && id !== null ? (this.arbreReplies.has(id) ? '▸' : '▾') : ''}</span>
        <button type="button" class="lien" data-portee-id="${id ?? ''}" title="${echapper(libelle)}">${echapper(libelle)}</button>
        <span class="mt">${formatNombre(montant, pm)}</span></li>`;
    // Document entier : total HT du corps (avant postes de pied), comme le tableau.
    const totalCorps = (this.resultat.pied ?? []).find((e) => e.cle === 'TOTAL_HT')?.montant ?? this.resultat.document.ent_total_ht;
    const items = [noeud(null, 'Document entier', totalCorps, 0, false, 'global')];
    for (const t of tranches) {
      const id = t.ligne.lig_id;
      if (masques.has(t.parent) || this.arbreReplies.has(t.parent)) { masques.add(id); continue; }
      items.push(noeud(id, this.libelleTranche(t.ligne), t.ligne.lig_montant_ht, t.profondeur + 1, avecEnfants.has(id), t.ligne.lig_tyl_id === TL.SECTION ? 'section' : ''));
    }
    return `<aside class="analyse-arbre" aria-label="Portée de l'analyse"><div class="analyse-arbre-titre">Tranches</div><ul>${items.join('')}</ul></aside>`;
  }

  #clic(e) {
    const tri = e.target.closest('th[data-tri]');
    if (tri) {
      // Croissant, décroissant, puis ordre par défaut (montant décroissant).
      const cle = tri.dataset.tri;
      this.tri = this.tri?.cle !== cle ? { cle, sens: 1 } : this.tri.sens === 1 ? { cle, sens: -1 } : null;
      this.memoriser();
      this.rendreElements();
      return;
    }
    const bascule = e.target.closest('[data-masquer-partie]');
    if (bascule) {
      const partie = bascule.dataset.masquerPartie;
      this.masquee = this.masquee === partie ? null : partie;
      this.appliquerPartage();
      this.memoriser();
      return;
    }
    const naturePli = e.target.closest('[data-nature-pli]');
    if (naturePli) {
      const k = naturePli.dataset.naturePli;
      if (this.naturesReplies.has(k)) this.naturesReplies.delete(k); else this.naturesReplies.add(k);
      this.rendre();
      return;
    }
    const nature = e.target.closest('[data-nature-filtre]');
    if (nature) { this.filtreNature = nature.dataset.natureFiltre || null; this.rendre(); return; }
    const arbrePli = e.target.closest('[data-arbre-pli]');
    if (arbrePli) {
      const id = Number(arbrePli.dataset.arbrePli);
      if (this.arbreReplies.has(id)) this.arbreReplies.delete(id); else this.arbreReplies.add(id);
      this.rendre();
      return;
    }
    const portee = e.target.closest('[data-portee-id]');
    if (portee) { this.portee = portee.dataset.porteeId === '' ? null : Number(portee.dataset.porteeId); this.rendre(); return; }
    if (e.target.closest('[data-choix-colonnes]')) {
      const menu = this.conteneur.querySelector('.menu-colonnes');
      menu.hidden = !menu.hidden;
      e.target.closest('[data-choix-colonnes]').setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    if (e.target.closest('[data-colonnes-defaut]')) {
      this.colonnes = new Set(COLONNES_ANALYSE.filter((c) => c.defaut).map((c) => c.cle));
      this.memoriser();
      this.rendre();
    }
  }

  #changement(e) {
    const t = e.target;
    if (t.matches('[data-hors-total]')) { this.horsTotal = t.checked; this.memoriser(); this.rendre(); return; }
    if (t.matches('[data-colonne]')) {
      if (t.checked) this.colonnes.add(t.dataset.colonne); else this.colonnes.delete(t.dataset.colonne);
      this.memoriser();
      this.rendre();
      this.conteneur.querySelector('.menu-colonnes').hidden = false;
      return;
    }
    if (t.matches('input[data-saisie="element"]')) {
      const v = lireNombre(t.value);
      t.blur();
      if (v === undefined || v === null) { if (v === undefined) this.message('Nombre attendu'); this.rendre(); return; }
      this.appliquerElement(t.dataset.element, t.dataset.cle, Number(v));
      return;
    }
    if (!t.matches('input[data-saisie]')) return;
    const g = [...(this.dernier?.liste ?? []), this.dernier?.total].find((x) => x?.cle === t.dataset.groupe);
    const v = lireNombre(t.value);
    t.blur();
    if (!g || v === undefined || v === null) { this.message('Nombre attendu'); this.rendre(); return; }
    if (t.dataset.saisie === 'montant') this.forcer(g, t.dataset.cle, Number(v));
    else if (Number(v) <= 0) { this.message('Coefficient invalide (nombre positif attendu)'); this.rendre(); }
    else this.appliquerCoef(g, t.dataset.cle, Number(v));
  }

  /** Coefficient écrit sur les feuilles du groupe (prorata : lignes vendues seulement). */
  appliquerCoef(groupe, cle, valeur) {
    const ed = this.editeur;
    const champ = COLONNES_ANALYSE.find((c) => c.cle === cle).champ;
    let ids;
    if (cle === 'prorata') ids = new Set(groupe.feuilles.map((f) => f.prix.lig_id));
    else {
      ids = new Set(groupe.feuilles.filter((f) => !f.ligne.lig_is_ecart_arrondi).map((f) => f.ligne.lig_id));
      // Mode déboursé : le coefficient d'un ouvrage s'applique à l'ouvrage lui-même.
      if (ed.saisie.document.ent_mode_calcul_ouvrage === 'D') for (const f of groupe.feuilles) ids.add(f.prix.lig_id);
    }
    if (!ids.size) return;
    ed.magasin.modifier((d) => { for (const l of d.lignes) if (ids.has(l.lig_id)) l[champ] = valeur; }, `Analyse : ${LIBELLES_COEF[cle]} ${formatLibre(valeur)}`);
    this.message(`Coefficient de ${LIBELLES_COEF[cle]} ${formatLibre(valeur)} écrit sur ${ids.size} ligne(s) (${groupe.libelle})`);
  }

  /**
   * Montant forcé : coefficients recalculés sur les feuilles du groupe (plus fortes lignes pour l'arrondi) et, en dernier
   * recours, ligne d'écart d'arrondi dans la tranche de la portée (ou la section), avec la nature du groupe.
   */
  forcer(groupe, cle, cible) {
    const ed = this.editeur;
    const res = forcerMontant(groupe.feuilles, cle, cible, { coefFa: this.coefFa, modeDebourse: ed.saisie.document.ent_mode_calcul_ouvrage === 'D' });
    if (res.erreur) { this.message(res.erreur, 'erreur'); this.rendre(); return; }
    const champ = MONTANTS_FORCABLES[cle].champ;
    const nature = groupe.nature !== undefined ? groupe.nature : res.nature;
    const idEcart = res.ecart !== null ? ed.magasin.prochainId() : null;
    const conteneur = this.portee ?? ed.saisie.lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.SECTION)?.lig_id ?? null;
    const libelle = MONTANTS_FORCABLES[cle].libelle;
    ed.magasin.modifier((d) => {
      for (const l of d.lignes) if (res.coefs.has(l.lig_id)) l[champ] = Number(res.coefs.get(l.lig_id));
      if (idEcart === null) return;
      const freres = d.lignes.filter((l) => l.lig_parent_id === conteneur && !(conteneur === null && estPied(l)));
      const ordre = Math.max(0, ...freres.map((l) => Number(l.lig_ordre))) + 1;
      // À la racine, l'écart se place avant le pied.
      if (conteneur === null) for (const l of d.lignes) if (l.lig_parent_id === null && Number(l.lig_ordre) >= ordre) l.lig_ordre = Number(l.lig_ordre) + 1;
      const n = this.natures.get(nature);
      d.lignes.push({
        ...ed.nouvelleLigne(idEcart, TL.ELEMENT, d.document.ent_id), lig_parent_id: conteneur, lig_ordre: ordre,
        lig_libelle_html: `Écart d'arrondi (analyse${n ? ` – ${n.libelle}` : ''})`, lig_qte: 1, lig_unt_code: 'u',
        lig_pa: Number(paEcart(cle, res.ecart, this.coefFa)), lig_coef_fg: 1, lig_coef_benef: 1, lig_nat_id: nature ?? null,
      });
      ed.regles.appliquerContexte(d, idEcart, ed.definition.taux_tva);
    }, `Analyse : ${libelle} forcé à ${formatNombre(cible, 2)}`);
    this.message(`${libelle[0].toUpperCase()}${libelle.slice(1)} forcé à ${formatNombre(cible, 2)} (${groupe.libelle}) : ${res.coefs.size} coefficient(s) recalculé(s)`
      + `${res.ecart !== null ? `, ligne d'écart d'arrondi de ${formatNombre(Number(res.ecart), 2)} ajoutée` : ''}`);
  }
}
