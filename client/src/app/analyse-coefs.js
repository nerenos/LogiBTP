import { echapper, formatNombre, formatLibre, lireNombre, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { TL, estPied, estTranche } from '../calcul/index.js';
import { feuillesAnalyse, agreger, forcerMontant, paEcart, MONTANTS_FORCABLES } from './analyse-calcul.js';

// Onglet Analyse : ventilation du devis par nature ou par tranche (plan des tranches repliable, clic pour en faire la
// portée), du déboursé au prix client, avec frais annexes ventilés, marges brute et nette. Aide à la saisie : un
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

export class AnalyseCoefficients {
  constructor(conteneur, { editeur, natures = [], message = () => {} }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.natures = new Map(natures.map((n) => [n.id, n]));
    this.message = message;
    const p = lirePreferences().analyse ?? {};
    this.axe = p.axe === 'tranche' ? 'tranche' : 'nature';
    this.horsTotal = Boolean(p.horsTotal);
    this.colonnes = new Set(Array.isArray(p.colonnes) ? p.colonnes : COLONNES_ANALYSE.filter((c) => c.defaut).map((c) => c.cle));
    this.portee = null; // null : document entier ; sinon identifiant d'une tranche
    this.replies = new Set();
    this.arbreReplies = new Set(); // nœuds repliés de l'arbre des tranches (portée)
    conteneur.classList.add('analyse-coefs');
    conteneur.addEventListener('change', (e) => this.#changement(e));
    conteneur.addEventListener('click', (e) => this.#clic(e));
  }

  get resultat() { return this.editeur.resultat; }
  get coefFa() { return Number(this.resultat.document.ent_coef_fa ?? 1); }

  memoriser() { ecrirePreferences({ analyse: { axe: this.axe, horsTotal: this.horsTotal, colonnes: [...this.colonnes] } }); }

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

  #descendDe(l, ancetreId) {
    const parId = new Map(this.resultat.lignes.map((x) => [x.lig_id, x]));
    for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) if (x.lig_id === ancetreId) return true;
    return false;
  }

  /** Groupes du tableau selon l'axe : [{ cle, libelle, feuilles, agregat, profondeur?, tranche?, aEnfants? }], et le total. */
  groupes() {
    const feuilles = feuillesAnalyse(this.resultat, this.editeur.saisie, { portee: this.portee, horsTotal: this.horsTotal });
    const total = { cle: 'total', libelle: this.portee === null ? 'Total du document' : 'Total de la portée', feuilles, agregat: agreger(feuilles, this.coefFa) };
    if (this.axe === 'nature') {
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
    // Par tranche : le plan des tranches sous la portée (repliable), puis les lignes hors tranche.
    const toutes = this.tranches();
    const base = this.portee === null ? -1 : toutes.find((t) => t.ligne.lig_id === this.portee)?.profondeur ?? -1;
    const dansPortee = toutes.filter((t) => t.ligne.lig_id !== this.portee && (this.portee === null || this.#descendDe(t.ligne, this.portee)));
    const ids = new Set(dansPortee.map((t) => t.ligne.lig_id));
    const avecEnfants = new Set(dansPortee.map((t) => t.parent).filter((p) => ids.has(p)));
    const liste = [];
    const masques = new Set();
    for (const t of dansPortee) {
      const id = t.ligne.lig_id;
      if (masques.has(t.parent) || this.replies.has(t.parent)) { masques.add(id); continue; }
      const fs = feuilles.filter((f) => f.tranches.includes(id));
      liste.push({ cle: `t:${id}`, libelle: this.libelleTranche(t.ligne), feuilles: fs, tranche: id, profondeur: t.profondeur - base - 1, aEnfants: avecEnfants.has(id) });
    }
    const hors = feuilles.filter((f) => !f.tranches.some((x) => ids.has(x)));
    if (hors.length) liste.push({ cle: 't:', libelle: 'Hors tranche', feuilles: hors, tranche: this.portee, horsTranche: true, profondeur: 0, aEnfants: false });
    return { liste: liste.map((g) => ({ ...g, agregat: agreger(g.feuilles, this.coefFa) })), total };
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
      // Prorata : saisi sur les lignes vendues, donc par tranche ou sur le total (pas par nature).
      const saisissable = c.saisie && !lectureSeule && g.feuilles.length && (c.saisie !== 'prorata' || estTotal || this.axe === 'tranche');
      if (!saisissable) return `<td class="nombre ${classe}">${txt}</td>`;
      const valeur = c.type === 'montant' ? formatNombre(arr(v, pm), pm) : txt;
      const aide = c.saisie === 'montant'
        ? `Saisir le ${MONTANTS_FORCABLES[c.cle].libelle} : les coefficients des lignes sont recalculés, l'arrondi est absorbé par les plus fortes lignes`
        : `Saisir un coefficient de ${LIBELLES_COEF[c.cle]} : il est écrit sur les lignes ${c.saisie === 'prorata' ? 'vendues' : 'chiffrées sans composante'} du groupe`;
      return `<td class="nombre"><input class="${classe} ${c.type === 'montant' ? 'montant' : ''}" data-saisie="${c.saisie}" data-groupe="${echapper(g.cle)}" data-cle="${c.cle}"
        value="${echapper(valeur)}" title="${echapper(aide)}"></td>`;
    };
    const ligne = (g, estTotal = false) => {
      const nom = g.tranche !== undefined && g.tranche !== null && !g.horsTranche
        ? `<span class="pli" ${g.aEnfants ? `data-pli="${g.tranche}"` : ''}>${g.aEnfants ? (this.replies.has(g.tranche) ? '▸' : '▾') : ''}</span>`
          + `<button type="button" class="lien" data-portee-id="${g.tranche}" title="Analyser cette tranche (portée)">${echapper(g.libelle)}</button>`
        : echapper(g.libelle);
      return `<tr class="${estTotal ? 'total' : ''}"><th style="padding-left:${0.55 + (g.profondeur ?? 0) * 1.1}rem">${nom}</th>
        ${colonnes.map((c) => cellule(g, c, estTotal)).join('')}</tr>`;
    };
    const parent = this.portee === null ? null : tranches.find((t) => t.ligne.lig_id === this.portee)?.parent ?? null;
    const parentEstTranche = parent !== null && tranches.some((t) => t.ligne.lig_id === parent);

    this.conteneur.innerHTML = `
      ${this.arbre(tranches, pm)}
      <div class="analyse-principal">
      <div class="analyse-barre">
        <span class="analyse-portee">Portée : <strong>${echapper(this.portee === null ? 'Document entier' : this.libelleTranche(tranches.find((t) => t.ligne.lig_id === this.portee).ligne))}</strong></span>
        ${this.portee !== null ? `<button type="button" data-portee-id="${parentEstTranche ? parent : ''}" title="Remonter d'un niveau">↑</button>` : ''}
        <span class="analyse-axe" role="group" aria-label="Ventilation">
          <button type="button" data-axe="nature" class="${this.axe === 'nature' ? 'actif' : ''}">Par nature</button>
          <button type="button" data-axe="tranche" class="${this.axe === 'tranche' ? 'actif' : ''}">Par tranche</button>
        </span>
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
      <div class="analyse-tableau"><table class="table-analyse">
        <thead><tr><th>${this.axe === 'nature' ? 'Nature' : 'Tranche'}</th>${colonnes.map((c) => `<th title="${echapper(c.aide)}">${echapper(c.titre)}</th>`).join('')}</tr></thead>
        <tbody>${liste.map((g) => ligne(g)).join('')}</tbody>
        <tfoot>${ligne(total, true)}</tfoot>
      </table></div>
      ${liste.length ? '' : '<p class="aide">Aucune ligne chiffrée dans cette portée.</p>'}
      <p class="aide">Aide à la saisie : un coefficient ou un montant saisi est écrit sur les lignes (Ctrl+Z pour annuler) ; les montants restent les vraies
        valeurs, l'arrondi est absorbé par les plus fortes lignes, et en dernier recours par une ligne d'écart d'arrondi dans la nature. Moyennes pondérées ;
        les montants peuvent différer de quelques centimes des montants arrondis ligne à ligne.</p>
      </div>`;
    this.dernier = { liste, total };
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
    const axe = e.target.closest('[data-axe]');
    if (axe) { this.axe = axe.dataset.axe; this.memoriser(); this.rendre(); return; }
    const arbrePli = e.target.closest('[data-arbre-pli]');
    if (arbrePli) {
      const id = Number(arbrePli.dataset.arbrePli);
      if (this.arbreReplies.has(id)) this.arbreReplies.delete(id); else this.arbreReplies.add(id);
      this.rendre();
      return;
    }
    const pli = e.target.closest('[data-pli]');
    if (pli) {
      const id = Number(pli.dataset.pli);
      if (this.replies.has(id)) this.replies.delete(id); else this.replies.add(id);
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
   * recours, ligne d'écart d'arrondi dans la tranche du groupe (ou la portée), avec la nature du groupe.
   */
  forcer(groupe, cle, cible) {
    const ed = this.editeur;
    const res = forcerMontant(groupe.feuilles, cle, cible, { coefFa: this.coefFa, modeDebourse: ed.saisie.document.ent_mode_calcul_ouvrage === 'D' });
    if (res.erreur) { this.message(res.erreur, 'erreur'); this.rendre(); return; }
    const champ = MONTANTS_FORCABLES[cle].champ;
    const nature = groupe.nature !== undefined ? groupe.nature : res.nature;
    const idEcart = res.ecart !== null ? ed.magasin.prochainId() : null;
    const conteneur = groupe.tranche ?? this.portee ?? ed.saisie.lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.SECTION)?.lig_id ?? null;
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
