import { echapper, formatNombre, formatLibre, lireNombre, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { TL, estChiffree, estPied, estTranche } from '../calcul/index.js';

// Analyse des coefficients du devis (onglet Analyse) : ventilation par nature ou par tranche, sur le document entier
// ou sur une tranche, du déboursé au prix client (FG, bénéfice, frais annexes, prorata). C'est une aide à la saisie :
// un coefficient saisi ici est écrit sur les lignes concernées (une étape d'annulation), qui restent la référence.
//
// Calcul : sur les lignes « feuilles » (chiffrées sans composante) en total, quantité totale dans le document (qt) ;
// déboursé = Σ qt × PA, revient = Σ qt × PR, PV = Σ qt × PV (avant frais annexes), prix client = PV × coefficient de
// frais annexes × prorata × remise de la ligne de prix qui la porte. Les moyennes sont pondérées ; les montants
// peuvent différer de quelques centimes des montants arrondis ligne à ligne.

const CHAMPS = { fg: 'lig_coef_fg', benef: 'lig_coef_benef', prorata: 'lig_coef_prorata' };
const LIBELLES = { fg: 'frais généraux', benef: 'bénéfice', prorata: 'prorata' };

export class AnalyseCoefficients {
  constructor(conteneur, { editeur, natures = [], message = () => {} }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.natures = new Map(natures.map((n) => [n.id, n]));
    this.message = message;
    const p = lirePreferences().analyse ?? {};
    this.axe = p.axe === 'tranche' ? 'tranche' : 'nature';
    this.portee = null; // null : document entier ; sinon identifiant d'une tranche
    conteneur.classList.add('analyse-coefs');
    conteneur.addEventListener('change', (e) => this.#changement(e));
    conteneur.addEventListener('click', (e) => this.#clic(e));
  }

  get resultat() { return this.editeur.resultat; }

  /** Tranches (sections, titres) dans l'ordre du document, avec leur profondeur. */
  tranches() {
    const lignes = this.resultat.lignes;
    const parId = new Map(lignes.map((l) => [l.lig_id, l]));
    const profondeur = (l) => { let n = 0; for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) n += 1; return n; };
    return lignes.filter(estTranche).map((l) => ({ ligne: l, profondeur: profondeur(l) }));
  }

  /**
   * Feuilles en total dans la portée : { ligne (résultat), saisie, prix (ligne de prix porteuse), tranche (tranche de
   * premier niveau sous la portée ou null), nature }.
   */
  feuilles() {
    const r = this.resultat;
    const parId = new Map(r.lignes.map((l) => [l.lig_id, l]));
    const saisies = new Map(this.editeur.saisie.lignes.map((l) => [l.lig_id, l]));
    const avecComposantes = new Set(r.lignes.filter((l) => estChiffree(l) && l.lig_parent_id !== null).map((l) => l.lig_parent_id));
    const res = [];
    for (const l of r.lignes) {
      if (!estChiffree(l) || avecComposantes.has(l.lig_id) || estPied(l)) continue;
      const chaine = [];
      for (let x = l; x; x = parId.get(x.lig_parent_id)) chaine.push(x);
      if (chaine.some((x) => (x.lig_type_prix ?? 'V') !== 'V')) continue;
      if (this.portee !== null && !chaine.some((x) => x.lig_id === this.portee)) continue;
      // Ligne de prix : ancêtre chiffré le plus haut (ouvrage racine) ou la ligne elle-même.
      const prix = [...chaine].reverse().find(estChiffree) ?? l;
      // Tranche de premier niveau sous la portée.
      const i = this.portee === null ? chaine.length : chaine.findIndex((x) => x.lig_id === this.portee);
      const tranche = chaine.slice(0, i).reverse().find(estTranche) ?? null;
      res.push({ ligne: l, saisie: saisies.get(l.lig_id) ?? l, prix, tranche, nature: l.lig_nat_id ?? null });
    }
    return res;
  }

  /** Agrégat d'un groupe de feuilles. */
  agreger(feuilles) {
    const coefFa = Number(this.resultat.document.ent_coef_fa ?? 1);
    let ds = 0, pr = 0, pv = 0, client = 0, avantProrata = 0;
    const prix = new Set();
    for (const f of feuilles) {
      const qt = Number(f.ligne.lig_qte_totale ?? 0);
      const p = f.prix;
      const remise = Number(p.lig_coef_remise ?? 1);
      const prorata = Number(p.lig_coef_prorata ?? 1);
      ds += qt * Number(f.ligne.lig_pa ?? 0);
      pr += qt * Number(f.ligne.lig_pr ?? 0);
      const v = qt * Number(f.ligne.lig_pv ?? 0);
      pv += v;
      avantProrata += v * coefFa * remise;
      client += v * coefFa * prorata * remise;
      prix.add(p.lig_id);
    }
    const ratio = (a, b) => (b ? a / b : null);
    return {
      nb: feuilles.length, ds, pr, pv, client, fg: ratio(pr, ds), benef: ratio(pv, pr), prorata: ratio(client, avantProrata),
      global: ratio(client, ds), marge: client - pr, tauxMarge: ratio(client - pr, client), prix,
    };
  }

  /** Lignes du tableau : [{ cle, libelle, feuilles, agregat }] selon l'axe, puis le total de la portée. */
  groupes() {
    const feuilles = this.feuilles();
    const groupes = new Map();
    const ajouter = (cle, libelle, f) => {
      if (!groupes.has(cle)) groupes.set(cle, { cle, libelle, feuilles: [] });
      groupes.get(cle).feuilles.push(f);
    };
    for (const f of feuilles) {
      if (this.axe === 'nature') {
        const n = this.natures.get(f.nature);
        ajouter(`n:${f.nature ?? ''}`, n ? `${n.code} · ${n.libelle}` : f.nature ? `Nature ${f.nature}` : 'Sans nature', f);
      } else {
        const t = f.tranche;
        ajouter(`t:${t?.lig_id ?? ''}`, t ? `${t.lig_numerotation ?? ''} ${t.lig_libelle_brut ?? ''}`.trim() || 'Tranche' : 'Hors tranche', f);
      }
    }
    const liste = [...groupes.values()].map((g) => ({ ...g, agregat: this.agreger(g.feuilles) }));
    if (this.axe === 'nature') liste.sort((a, b) => b.agregat.ds - a.agregat.ds);
    return { liste, total: { cle: 'total', libelle: 'Total de la portée', feuilles, agregat: this.agreger(feuilles) } };
  }

  rendre() {
    if (this.conteneur.contains(document.activeElement) && document.activeElement.matches('input')) return;
    const r = this.resultat;
    const pm = this.editeur.saisie.document.ent_precision_montant ?? 2;
    const tranches = this.tranches();
    if (this.portee !== null && !tranches.some((t) => t.ligne.lig_id === this.portee)) this.portee = null;
    const { liste, total } = this.groupes();
    const lectureSeule = this.editeur.magasin?.lectureSeule;
    const defauts = this.editeur.coefsDefaut ?? {};
    const coef = (g, champ, editable) => {
      // Valeur arrondie à l'affichage (4 décimales) : la couleur suit la valeur lue.
      const v = g.agregat[champ] === null ? null : Math.round(g.agregat[champ] * 10000) / 10000;
      const txt = v === null ? '' : formatLibre(v, 4);
      const classe = v === null ? '' : v < 1 ? 'coef-bas' : v < Number(champ === 'prorata' ? 1 : defauts[champ] ?? 1) ? 'coef-moyen' : 'coef-ok';
      if (!editable || lectureSeule || !g.feuilles.length) return `<td class="nombre ${classe}">${txt}</td>`;
      return `<td class="nombre"><input class="${classe}" data-groupe="${echapper(g.cle)}" data-champ="${champ}" value="${echapper(txt)}" size="7"
        title="Saisir un coefficient : il est écrit sur les ${g.agregat.nb} ligne(s) concernée(s)${champ === 'prorata' ? ' (lignes de prix)' : ''}"></td>`;
    };
    // Prorata : saisi sur les lignes de prix, donc par tranche ou sur le total (pas par nature, une ligne de prix
    // mélangeant les natures de ses composantes).
    const ligne = (g, total = false) => {
      const a = g.agregat;
      return `<tr class="${total ? 'total' : ''}">
        <th>${echapper(g.libelle)}</th><td class="nombre">${a.nb}</td>
        <td class="nombre">${formatNombre(a.ds, pm)}</td>${coef(g, 'fg', true)}<td class="nombre">${formatNombre(a.pr, pm)}</td>
        ${coef(g, 'benef', true)}<td class="nombre">${formatNombre(a.pv, pm)}</td>
        ${coef(g, 'prorata', total || this.axe === 'tranche')}<td class="nombre">${formatNombre(a.client, pm)}</td>
        <td class="nombre">${a.global === null ? '' : formatLibre(Math.round(a.global * 10000) / 10000, 4)}</td>
        <td class="nombre">${formatNombre(a.marge, pm)}</td><td class="nombre">${a.tauxMarge === null ? '' : `${formatLibre(Math.round(a.tauxMarge * 1000) / 10, 1)} %`}</td></tr>`;
    };
    const option = (t) => `<option value="${t.ligne.lig_id}" ${t.ligne.lig_id === this.portee ? 'selected' : ''}>${'  '.repeat(t.profondeur)}${echapper(`${t.ligne.lig_numerotation ?? ''} ${t.ligne.lig_libelle_brut || (t.ligne.lig_tyl_id === TL.SECTION ? 'Section' : 'Titre')}`.trim())}</option>`;
    this.conteneur.innerHTML = `
      <div class="analyse-barre">
        <label>Portée <select data-portee><option value="">Document entier</option>${tranches.map(option).join('')}</select></label>
        <span class="analyse-axe" role="group" aria-label="Ventilation">
          <button type="button" data-axe="nature" class="${this.axe === 'nature' ? 'actif' : ''}">Par nature</button>
          <button type="button" data-axe="tranche" class="${this.axe === 'tranche' ? 'actif' : ''}">Par tranche</button>
        </span>
        <span class="analyse-fa">Coef. frais annexes du document : <strong>${formatLibre(r.document.ent_coef_fa ?? 1)}</strong></span>
      </div>
      <p class="aide">Aide à la saisie : un coefficient saisi est écrit sur les lignes de la ligne du tableau (FG et bénéfice sur les lignes chiffrées
        sans composante, prorata sur les lignes vendues, jamais sur leurs composantes) ; les lignes restent la référence et chaque saisie s'annule par Ctrl+Z.
        Moyennes pondérées ; options, variantes et lignes pour mémoire exclues.</p>
      <div class="analyse-tableau"><table class="table-analyse">
        <thead><tr><th>${this.axe === 'nature' ? 'Nature' : 'Tranche'}</th><th>Lignes</th><th>Déboursé</th><th>FG</th><th>Revient</th><th>Bénéf.</th>
          <th>PV avant FA</th><th>Prorata</th><th>Prix client</th><th>Coef. global</th><th>Marge</th><th>% marge</th></tr></thead>
        <tbody>${liste.map((g) => ligne(g)).join('')}</tbody>
        <tfoot>${ligne(total, true)}</tfoot>
      </table></div>
      ${liste.length ? '' : '<p class="aide">Aucune ligne chiffrée dans cette portée.</p>'}`;
    this.dernier = { liste, total };
  }

  #clic(e) {
    const b = e.target.closest('[data-axe]');
    if (!b) return;
    this.axe = b.dataset.axe;
    ecrirePreferences({ analyse: { axe: this.axe } });
    this.rendre();
  }

  #changement(e) {
    if (e.target.matches('[data-portee]')) {
      this.portee = e.target.value === '' ? null : Number(e.target.value);
      this.rendre();
      return;
    }
    const input = e.target.closest('input[data-champ]');
    if (!input) return;
    const v = lireNombre(input.value);
    if (v === undefined || v === null || Number(v) <= 0) { this.message('Coefficient invalide (nombre positif attendu)'); input.blur(); this.rendre(); return; }
    const g = [...(this.dernier?.liste ?? []), this.dernier?.total].find((x) => x?.cle === input.dataset.groupe);
    if (!g) return;
    input.blur();
    this.appliquer(g, input.dataset.champ, Number(v));
  }

  /** Écrit le coefficient sur les lignes du groupe (prorata : lignes vendues seulement). */
  appliquer(groupe, champ, valeur) {
    const ed = this.editeur;
    let ids;
    if (champ === 'prorata') {
      // Le prorata reste sur les lignes vendues (lignes de prix), jamais sur leurs composantes.
      ids = new Set(groupe.feuilles.map((f) => f.prix.lig_id));
    } else {
      ids = new Set(groupe.feuilles.map((f) => f.ligne.lig_id));
      // Mode déboursé : le coefficient d'un ouvrage s'applique à l'ouvrage lui-même.
      if (ed.saisie.document.ent_mode_calcul_ouvrage === 'D') for (const f of groupe.feuilles) ids.add(f.prix.lig_id);
    }
    const c = CHAMPS[champ];
    const n = ed.saisie.lignes.filter((l) => ids.has(l.lig_id) && !l.lig_is_ecart_arrondi).length;
    if (!n) return;
    ed.magasin.modifier((d) => {
      for (const l of d.lignes) if (ids.has(l.lig_id) && !l.lig_is_ecart_arrondi) l[c] = valeur;
    }, `Analyse : ${LIBELLES[champ]} ${formatLibre(valeur)}`);
    this.message(`Coefficient de ${LIBELLES[champ]} ${formatLibre(valeur)} écrit sur ${n} ligne(s) (${groupe.libelle})`);
  }
}
