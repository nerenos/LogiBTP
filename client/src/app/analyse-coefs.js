import { texte, texteHtml, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, formatLibre, lireNombre, lirePreferences, ecrirePreferences, ouvrirModale } from '@logibtp/socle/ui';
import { correspond, filtreActif } from '@logibtp/liste';
import { ouvrirMenuFiltre, fermerMenuFiltre } from '@logibtp/liste/ui';
import { TL, estPied, estTranche } from '../calcul/index.js';
import {
  feuillesAnalyse, agreger, forcerMontant, paEcart, MONTANTS_FORCABLES, elementsAnalyse, modificationsElement, VALEURS_ELEMENT, repartirQuantite,
  rechargementPrix,
} from './analyse-calcul.js';
import { prixUnite, lien } from './bibliotheque/appel.js';
import { RapportFraisAnnexes } from './frais-annexes-ui.js';

// Onglet Analyse : ventilation par nature de la portée choisie dans l'arbre des tranches (document entier, section,
// titres), avec le total de la portée ; du déboursé au prix client, frais annexes ventilés, marges brute et nette.
// Un arbre des natures (regroupements, natures) filtre aussi les lignes. Partie Éléments : les éléments regroupés par
// code et libellé, avec leurs prix et coefficients (deux extrêmes sur fond coloré quand les lignes diffèrent) ; une
// valeur saisie est écrite sur toutes les lignes du groupe dans le filtre. Aide à la saisie : un
// coefficient ou un montant saisi est écrit sur les lignes (une étape d'annulation) ; les montants sont les vraies
// valeurs (voir analyse-calcul.js : absorption de l'arrondi, ligne d'écart en dernier recours).

/** Colonnes du tableau ; `saisie` : coef (coefficient écrit sur les feuilles), prorata (lignes vendues), montant (forcé). */
export const COLONNES_ANALYSE = [
  { cle: 'nb', get titre() { return texte('analyse_btp.colonnes.nb.titre'); }, type: 'entier', defaut: false, get aide() { return texte('analyse_btp.colonnes.nb.aide'); } },
  { cle: 'ds', get titre() { return texte('analyse_btp.colonnes.ds.titre'); }, type: 'montant', defaut: true, get aide() { return texte('analyse_btp.colonnes.ds.aide'); } },
  { cle: 'fg', get titre() { return texte('analyse_btp.colonnes.fg.titre'); }, type: 'coef', defaut: true, saisie: 'coef', champ: 'lig_coef_fg', get aide() { return texte('analyse_btp.colonnes.fg.aide'); } },
  { cle: 'rev', get titre() { return texte('analyse_btp.colonnes.rev.titre'); }, type: 'montant', defaut: true, saisie: 'montant', get aide() { return texte('analyse_btp.colonnes.rev.aide'); } },
  { cle: 'benef', get titre() { return texte('analyse_btp.colonnes.benef.titre'); }, type: 'coef', defaut: true, saisie: 'coef', champ: 'lig_coef_benef', get aide() { return texte('analyse_btp.colonnes.benef.aide'); } },
  { cle: 'pv', get titre() { return texte('analyse_btp.colonnes.pv.titre'); }, type: 'montant', defaut: true, saisie: 'montant', get aide() { return texte('analyse_btp.colonnes.pv.aide'); } },
  { cle: 'coefFa', get titre() { return texte('analyse_btp.colonnes.coefFa.titre'); }, type: 'coef', defaut: false, get aide() { return texte('analyse_btp.colonnes.coefFa.aide'); } },
  { cle: 'fa', get titre() { return texte('analyse_btp.colonnes.fa.titre'); }, type: 'montant', defaut: true, get aide() { return texte('analyse_btp.colonnes.fa.aide'); } },
  { cle: 'pvFa', get titre() { return texte('analyse_btp.colonnes.pvFa.titre'); }, type: 'montant', defaut: true, get aide() { return texte('analyse_btp.colonnes.pvFa.aide'); } },
  { cle: 'prorata', get titre() { return texte('analyse_btp.colonnes.prorata.titre'); }, type: 'coef', defaut: false, saisie: 'prorata', champ: 'lig_coef_prorata', get aide() { return texte('analyse_btp.colonnes.prorata.aide'); } },
  { cle: 'client', get titre() { return texte('analyse_btp.colonnes.client.titre'); }, type: 'montant', defaut: true, saisie: 'montant', get aide() { return texte('analyse_btp.colonnes.client.aide'); } },
  { cle: 'global', get titre() { return texte('analyse_btp.colonnes.global.titre'); }, type: 'coef', defaut: false, get aide() { return texte('analyse_btp.colonnes.global.aide'); } },
  { cle: 'margeBrute', get titre() { return texte('analyse_btp.colonnes.margeBrute.titre'); }, type: 'montant', defaut: true, get aide() { return texte('analyse_btp.colonnes.margeBrute.aide'); } },
  { cle: 'tauxBrute', get titre() { return texte('analyse_btp.colonnes.tauxBrute.titre'); }, type: 'pct', defaut: false, get aide() { return texte('analyse_btp.colonnes.tauxBrute.aide'); } },
  { cle: 'margeNette', get titre() { return texte('analyse_btp.colonnes.margeNette.titre'); }, type: 'montant', defaut: true, get aide() { return texte('analyse_btp.colonnes.margeNette.aide'); } },
  { cle: 'tauxNette', get titre() { return texte('analyse_btp.colonnes.tauxNette.titre'); }, type: 'pct', defaut: true, get aide() { return texte('analyse_btp.colonnes.tauxNette.aide'); } },
];

const LIBELLES_COEF = textesParCode('analyse_btp.coefs', ['fg', 'benef', 'prorata']);

/** Texte comparé sans casse ni accents (recherche dans la liste des éléments). */
const normaliser = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Tri de la liste des éléments : valeur comparée par colonne (valeurs divergentes : le minimum). */
const TRIS_ELEMENTS = {
  code: { get titre() { return texte('analyse_btp.elements.code'); }, texte: true, valeur: (g) => g.code },
  libelle: { get titre() { return texte('analyse_btp.elements.libelle'); }, texte: true, valeur: (g) => g.libelle },
  unite: { get titre() { return texte('analyse_btp.elements.unite'); }, texte: true, valeur: (g) => [...g.unites].join(' / ') },
  nb: { get titre() { return texte('analyse_btp.elements.nb'); }, valeur: (g) => g.feuilles.length, get aide() { return texte('analyse_btp.elements.nb_aide'); } },
  qt: { get titre() { return texte('analyse_btp.elements.qt'); }, valeur: (g) => g.qt },
  pa: { get titre() { return VALEURS_ELEMENT.pa.titre; }, valeur: (g) => g.valeurs.pa?.min ?? null },
  fg: { get titre() { return VALEURS_ELEMENT.fg.titre; }, valeur: (g) => g.valeurs.fg?.min ?? null },
  pr: { get titre() { return VALEURS_ELEMENT.pr.titre; }, valeur: (g) => g.valeurs.pr?.min ?? null },
  benef: { get titre() { return VALEURS_ELEMENT.benef.titre; }, valeur: (g) => g.valeurs.benef?.min ?? null },
  pv: { get titre() { return VALEURS_ELEMENT.pv.titre; }, valeur: (g) => g.valeurs.pv?.min ?? null },
  montant: { get titre() { return texte('analyse_btp.elements.montant'); }, valeur: (g) => g.montant },
  nature: { get titre() { return texte('analyse_btp.elements.nature'); }, texte: true, filtrable: false, valeur: (g, natures) => [...g.natures].map((n) => natures.get(n)?.code ?? '').join(', ') },
};

/** Colonnes de la liste des éléments (toutes affichées par défaut). */
const COLONNES_ELEMENTS = Object.keys(TRIS_ELEMENTS);

/** Colonne au format du module Liste (menu de filtre) : nombres et textes ; tri local seulement. */
const colonneFiltre = (cle) => ({ code: cle, titre: TRIS_ELEMENTS[cle].titre, format: TRIS_ELEMENTS[cle].texte ? 'texte' : 'nombre', calcul: true });

export class AnalyseCoefficients {
  /**
   * appel : AppelBibliotheque de la page (prix rechargés depuis la bibliothèque) ; absent, le bouton n'est pas proposé.
   * imprimerFrais : impression du rapport de ventilation des frais annexes (module Édition) ; absent, pas de bouton.
   */
  constructor(conteneur, { editeur, natures = [], message = () => {}, appel = null, imprimerFrais = null }) {
    this.appel = appel;
    this.imprimerFrais = imprimerFrais;
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
    // Vue de l'onglet : coefficients et éléments, ou rapport de ventilation des frais annexes.
    this.vue = p.vue === 'frais' ? 'frais' : 'coefs';
    // Part de l'arbre des tranches dans la colonne de gauche (en %), tri de la liste des éléments.
    this.partageGauche = Number.isFinite(p.partageGauche) ? Math.min(85, Math.max(15, p.partageGauche)) : 60;
    this.tri = p.tri && TRIS_ELEMENTS[p.tri.cle] ? { cle: p.tri.cle, sens: p.tri.sens === -1 ? -1 : 1 } : null;
    this.filtresElements = new Map(); // filtre par colonne de la liste des éléments (module Liste), le temps de la page
    // Après une saisie dans la liste des éléments : ordre et lignes affichés figés (la ligne modifiée ne bouge pas avec
    // le tri ni ne disparaît d'un filtre) jusqu'au prochain changement de tri, de filtre, de recherche ou de portée.
    this.ordreFige = null;
    this.saisieElement = null; // { cle, colonne } : cellule à reprendre après le recalcul
    this.colonnesElements = new Set(Array.isArray(p.colonnesElements) ? p.colonnesElements.filter((k) => TRIS_ELEMENTS[k]) : COLONNES_ELEMENTS);
    this.colonnesElements.add('libelle');
    this.portee = null; // null : document entier ; sinon identifiant d'une tranche
    this.arbreReplies = new Set(); // nœuds repliés de l'arbre des tranches (portée)
    this.filtreNature = null; // null : toutes ; 'r:<regroupement>', 'n:<id>' ou 'n:' (sans nature)
    this.naturesReplies = new Set();
    this.recherche = ''; // recherche sans filtre dans la liste des éléments
    this.resultatRecherche = -1; // index du groupe trouvé courant
    conteneur.classList.add('analyse-coefs');
    conteneur.addEventListener('change', (e) => this.#changement(e));
    conteneur.addEventListener('click', (e) => this.#clic(e));
    conteneur.addEventListener('input', (e) => {
      if (!e.target.matches('[data-recherche]')) return;
      this.recherche = e.target.value;
      this.resultatRecherche = 0;
      this.rendreElements({ allerAuResultat: true });
    });
    conteneur.addEventListener('keydown', (e) => {
      if (!e.target.matches('[data-recherche]')) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.resultatSuivant(e.shiftKey || e.key === 'ArrowUp' ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.value = '';
        this.recherche = '';
        this.rendreElements();
      }
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
    if (n === 'n:') return texte('analyse_btp.filtre.sans_nature');
    if (n.startsWith('n:')) { const x = this.natures.get(Number(n.slice(2))); return x ? x.libelle : texte('analyse_btp.filtre.nature', { id: n.slice(2) }); }
    return texte('analyse_btp.filtre.regroupement', { code: n.slice(2) });
  }

  get resultat() { return this.editeur.resultat; }
  get coefFa() { return Number(this.resultat.document.ent_coef_fa ?? 1); }

  memoriser() {
    ecrirePreferences({ analyse: {
      horsTotal: this.horsTotal, colonnes: [...this.colonnes], partage: this.partage, masquee: this.masquee, partageGauche: this.partageGauche, tri: this.tri,
      colonnesElements: [...this.colonnesElements], vue: this.vue,
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
      b.textContent = icone(masquee ? 'analyse_btp_ferme' : 'analyse_btp_ouvert');
      b.title = texte(masquee ? 'analyse_btp.parties.afficher' : 'analyse_btp.parties.masquer');
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
    return `${l.lig_numerotation ?? ''} ${l.lig_libelle_brut || texte(l.lig_tyl_id === TL.SECTION ? 'analyse_btp.tranches.section' : 'analyse_btp.tranches.titre')}`.trim();
  }

  /** Groupes du tableau : les natures de la portée [{ cle, libelle, feuilles, agregat, nature }], et le total de la portée. */
  groupes() {
    const portee = feuillesAnalyse(this.resultat, this.editeur.saisie, { portee: this.portee, horsTotal: this.horsTotal });
    this.feuillesPortee = portee;
    const feuilles = portee.filter((f) => this.correspondNature(f));
    this.feuilles = feuilles;
    const libelleTotal = this.filtreNature !== null ? texte('analyse_btp.total.filtre', { filtre: this.libelleFiltreNature() }) : texte(this.portee === null ? 'analyse_btp.total.document' : 'analyse_btp.total.portee');
    const total = { cle: 'total', libelle: libelleTotal, feuilles, agregat: agreger(feuilles, this.coefFa) };
    const groupes = new Map();
    for (const f of feuilles) {
      const cle = `n:${f.nature ?? ''}`;
      if (!groupes.has(cle)) {
        const n = this.natures.get(f.nature);
        groupes.set(cle, { cle, libelle: n ? `${n.code} · ${n.libelle}` : f.nature ? texte('analyse_btp.natures.nature', { id: f.nature }) : texte('analyse_btp.natures.sans'), feuilles: [], nature: f.nature });
      }
      groupes.get(cle).feuilles.push(f);
    }
    const liste = [...groupes.values()].map((g) => ({ ...g, agregat: agreger(g.feuilles, this.coefFa) })).sort((a, b) => b.agregat.ds - a.agregat.ds);
    return { liste, total };
  }

  rendre() {
    if (this.conteneur.contains(document.activeElement) && document.activeElement.matches('input[data-saisie]')) return;
    if (this.vue === 'frais') { this.rendreFrais(); return; }
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
        ? texte('analyse_btp.saisie.montant', { montant: MONTANTS_FORCABLES[c.cle].libelle })
        : texte(c.saisie === 'prorata' ? 'analyse_btp.saisie.prorata' : 'analyse_btp.saisie.coef', { coef: LIBELLES_COEF[c.cle] });
      return `<td class="nombre"><input class="${classe} ${c.type === 'montant' ? 'montant' : ''}" data-saisie="${c.saisie}" data-groupe="${echapper(g.cle)}" data-cle="${c.cle}"
        value="${echapper(valeur)}" title="${echapper(aide)}"></td>`;
    };
    const ligne = (g, estTotal = false) => `<tr class="${estTotal ? 'total' : ''}"><th>${echapper(g.libelle)}</th>
        ${colonnes.map((c) => cellule(g, c, estTotal)).join('')}</tr>`;
    const parent = this.portee === null ? null : tranches.find((t) => t.ligne.lig_id === this.portee)?.parent ?? null;
    const parentEstTranche = parent !== null && tranches.some((t) => t.ligne.lig_id === parent);

    this.conteneur.innerHTML = `
      <div class="analyse-gauche" style="--part-tranches:${this.partageGauche}%">${this.arbre(tranches, pm)}
        <div class="analyse-separateur" data-separateur="gauche" role="separator" aria-orientation="horizontal" title="${texteHtml('analyse_btp.separateur')}"></div>
        ${this.arbreNatures(pm)}</div>
      <div class="analyse-principal">
      <div class="analyse-barre">
        <span class="analyse-portee">${texteHtml('analyse_btp.barre.portee')} <strong>${echapper(this.portee === null ? texte('analyse_btp.barre.document') : this.libelleTranche(tranches.find((t) => t.ligne.lig_id === this.portee).ligne))}</strong>
          ${this.filtreNature !== null ? ` · <strong>${echapper(this.libelleFiltreNature())}</strong> <button type="button" data-nature-filtre="" title="${texteHtml('analyse_btp.natures.toutes')}">${iconeHtml('retirer')}</button>` : ''}</span>
        ${this.portee !== null ? `<button type="button" data-portee-id="${parentEstTranche ? parent : ''}" title="${texteHtml('analyse_btp.barre.remonter')}">${iconeHtml('analyse_btp_remonter')}</button>` : ''}
        <label class="coche" title="${texteHtml('analyse_btp.barre.hors_total_aide')}">
          <input type="checkbox" data-hors-total ${this.horsTotal ? 'checked' : ''}> ${texteHtml('analyse_btp.barre.hors_total')}</label>
        <span class="analyse-fa">${texteHtml('analyse_btp.barre.coef_fa')} <strong>${formatLibre(this.coefFa)}</strong></span>
        <button type="button" data-vue-analyse="frais" title="${texteHtml('analyse_btp.barre.frais_aide')}">${texteHtml('analyse_btp.barre.frais')}</button>
      </div>
      <div class="analyse-parties">
      <section class="analyse-partie" data-partie="coefs">
        <header class="partie-entete">
          <button type="button" class="partie-bascule" data-masquer-partie="coefs"></button>
          <h3>${texteHtml('analyse_btp.coefs_titre')}</h3>
          ${this.menuColonnes('coefs', COLONNES_ANALYSE.map((c) => ({ cle: c.cle, titre: c.titre, aide: c.aide })), this.colonnes)}
          <span class="aide">${texteHtml('analyse_btp.coefs_aide')}</span>
        </header>
        <div class="partie-corps"><table class="table-analyse">
        <thead><tr><th>${texteHtml('analyse_btp.elements.nature')}</th>${colonnes.map((c) => `<th title="${echapper(c.aide)}">${echapper(c.titre)}</th>`).join('')}</tr></thead>
        <tbody>${liste.map((g) => ligne(g)).join('')}</tbody>
        <tfoot>${ligne(total, true)}</tfoot>
        </table>
        ${liste.length ? '' : `<p class="aide">${texteHtml('analyse_btp.sans_ligne')}</p>`}</div>
      </section>
      <div class="analyse-separateur" data-separateur="parties" role="separator" aria-orientation="horizontal" title="${texteHtml('analyse_btp.separateur')}"></div>
      <section class="analyse-partie analyse-elements" data-partie="elements">
        <header class="partie-entete">
          <button type="button" class="partie-bascule" data-masquer-partie="elements"></button>
          <h3>${texteHtml('analyse_btp.elements_titre')} <small data-nb-elements></small></h3>
          ${this.menuColonnes('elements', COLONNES_ELEMENTS.filter((k) => k !== 'libelle').map((k) => ({ cle: k, titre: TRIS_ELEMENTS[k].titre, aide: TRIS_ELEMENTS[k].aide })), this.colonnesElements)}
          <span class="recherche-elements">
            <input type="search" data-recherche placeholder="${texteHtml('analyse_btp.recherche.placeholder')}" value="${echapper(this.recherche)}"
              title="${texteHtml('analyse_btp.recherche.aide')}">
            <span class="compteur" data-compteur-recherche aria-live="polite"></span>
            <button type="button" data-resultat="-1" title="${texteHtml('analyse_btp.recherche.precedent')}">${iconeHtml('analyse_btp_precedent')}</button>
            <button type="button" data-resultat="1" title="${texteHtml('analyse_btp.recherche.suivant')}">${iconeHtml('analyse_btp_suivant')}</button>
          </span>
          ${this.appel && !this.editeur.magasin?.lectureSeule ? `<button type="button" data-recharger-prix
            title="${texteHtml('analyse_btp.prix.bouton_aide')}">${iconeHtml('analyse_btp_recharger')} ${texteHtml('analyse_btp.prix.titre')}</button>` : ''}
          <span class="aide">${texteHtml('analyse_btp.elements_aide')}</span>
        </header>
        <div class="partie-corps"><table class="table-analyse table-elements">
          <thead><tr>${COLONNES_ELEMENTS.filter((k) => this.colonnesElements.has(k)).map((k) => [k, TRIS_ELEMENTS[k]]).map(([k, t]) => `<th data-tri="${k}" class="triable" aria-sort="none"
            title="${texteHtml('analyse_btp.tri', { colonne: t.aide ?? t.titre })}">${echapper(t.titre)}<span class="sens-tri"></span>
            ${t.filtrable === false ? '' : `<button type="button" class="filtre-colonne" data-filtre-colonne="${k}" title="${texteHtml('analyse_btp.filtrer')}">${iconeHtml('analyse_btp_filtre')}</button>`}</th>`).join('')}</tr></thead>
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

  /**
   * Prix du jour de la bibliothèque sur les lignes des éléments affichés (portée, nature, filtres de colonnes) : élément
   * lié, sinon de même code (rapprochement proposé, à cocher) ; aperçu des changements, puis écriture en une étape.
   */
  async rechargerPrix() {
    const ed = this.editeur;
    if (ed.magasin?.lectureSeule) return;
    const feuilles = [...(this.elements?.values() ?? [])].flatMap((g) => g.feuilles);
    if (!feuilles.length) { this.message(texte('analyse_btp.prix.aucun'), 'avertissement'); return; }
    const fournisseur = this.appel.fournisseur;
    const bib = await this.appel.bibDocument();
    const parId = new Map();
    const parCode = new Map();
    const lire = async (cache, cle, f) => { if (!cache.has(cle)) cache.set(cle, await f().catch(() => null)); return cache.get(cle); };
    const trouves = new Map();
    for (const f of feuilles) {
      const l = f.saisie ?? f.ligne;
      if (l.lig_art_id) trouves.set(l.lig_id, { element: await lire(parId, l.lig_art_id, () => fournisseur.element(l.lig_art_id)) });
      else if (String(l.lig_code ?? '').trim()) {
        const code = String(l.lig_code).trim();
        trouves.set(l.lig_id, { element: await lire(parCode, code, () => fournisseur.appelCode(code, bib)), rapprochement: true });
      }
    }
    const tout = rechargementPrix(feuilles, trouves, prixUnite);
    // Lignes sans lien dont le code n'existe pas dans la bibliothèque : comptées, pas listées.
    const lignes = tout.filter((x) => !x.sansCorrespondance);
    const sans = tout.length - lignes.length;
    if (!lignes.length) { this.message(sans ? texte('analyse_btp.prix.a_jour_sans', { nombre: sans }) : texte('analyse_btp.prix.a_jour'), 'succes'); return; }
    const retenues = await this.apercuPrix(lignes, sans);
    if (!retenues?.length) return;
    const parLigne = new Map(retenues.map((x) => [x.id, x]));
    ed.magasin.modifier((d) => {
      for (const x of d.lignes) {
        const r = parLigne.get(x.lig_id);
        if (!r) continue;
        const p = prixUnite(r.element, x.lig_unt_code);
        Object.assign(x, r.champs, { lig_proprietes: { ...(x.lig_proprietes ?? {}), element: lien(r.element, { unite: p.unite, ratio: p.ratio }) } });
      }
    }, texte('analyse_btp.prix.titre'));
    this.message(texte('analyse_btp.prix.fait', { nombre: retenues.length }), 'succes');
  }

  /** Aperçu des prix rechargés : lignes cochées (les rapprochements par le code sont à cocher) ; résout avec les retenues. */
  apercuPrix(lignes, sans = 0) {
    const nombre = (v) => (v === null || v === undefined || v === '' ? '—' : formatNombre(v, Math.abs(Number(v)) < 10 ? 4 : 2));
    const variation = (a, b) => (b === null || b === undefined ? '' : `${nombre(a)} → <b>${nombre(b)}</b>`);
    return new Promise((resoudre) => {
      const fond = document.createElement('dialog');
      fond.className = 'fiche-dialogue-fond dialogue-plein';
      const ecrites = lignes.filter((x) => x.champs).length;
      fond.innerHTML = `<section class="fiche-dialogue apercu-prix" role="dialog" aria-label="${texteHtml('analyse_btp.prix.titre')}">
        <header><h2>${iconeHtml('analyse_btp_recharger')} ${texteHtml('analyse_btp.prix.titre')}</h2><button type="button" data-fermer title="${texteHtml('commun.fermer_echap')}">${iconeHtml('retirer')}</button></header>
        <p class="aide">${texteHtml('analyse_btp.prix.aide')}</p>
        <div class="apercu-prix-table"><table class="bib-table"><thead><tr><th></th><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('bibliotheque_btp.appel.colonnes.unite')}</th><th>${texteHtml('analyse_btp.valeurs.pa')}</th><th>${texteHtml('analyse_btp.valeurs.pv')}</th><th>${texteHtml('analyse_btp.prix.remarque')}</th></tr></thead><tbody>
        ${lignes.map((x, i) => `<tr class="${x.champs ? '' : 'sans-ecriture'}">
          <td>${x.champs ? `<input type="checkbox" data-i="${i}" ${x.rapprochement ? '' : 'checked'}>` : ''}</td>
          <td>${echapper(x.code)}</td><td>${echapper(x.libelle)}</td><td>${echapper(x.unite)}</td>
          <td class="nombre">${x.champs ? variation(x.avant.pa, x.apres.pa) : ''}</td><td class="nombre">${x.champs ? variation(x.avant.pv, x.apres.pv) : ''}</td>
          <td>${x.rapprochement && x.element ? `${texteHtml('analyse_btp.prix.rapprocher', { element: `${x.element.bib_code}:${x.element.code}` })} – ${echapper(x.element.libelle ?? '')}` : ''}
            ${x.alerte ? `<span class="alerte">${iconeHtml('avertissement')} ${echapper(x.alerte)}</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <footer><span class="aide">${texteHtml('analyse_btp.prix.bilan', { ecrites, signalees: lignes.length - ecrites })}${sans ? `, ${texteHtml('analyse_btp.prix.sans', { nombre: sans })}` : ''}</span>
          <button type="button" data-fermer>${texteHtml('commun.annuler')}</button><button type="button" class="principal" data-appliquer ${ecrites ? '' : 'disabled'}>${texteHtml('analyse_btp.prix.appliquer')}</button></footer></section>`;
      ouvrirModale(fond);
      const fermer = (r) => { fond.remove(); resoudre(r ?? null); };
      fond.querySelectorAll('[data-fermer]').forEach((b) => b.addEventListener('click', () => fermer()));
      fond.querySelector('[data-appliquer]').addEventListener('click', () => fermer([...fond.querySelectorAll('input[data-i]:checked')].map((c) => lignes[Number(c.dataset.i)])));
      fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } });
      fond.querySelector('[data-appliquer]').focus();
    });
  }

  /** Vue « Frais annexes » : rapport de ventilation (frais-annexes-ui.js). */
  rendreFrais() {
    if (this.conteneur.contains(document.activeElement) && document.activeElement.closest('.analyse-frais input')) return;
    this.conteneur.innerHTML = `<div class="analyse-principal analyse-vue-frais">
        <div class="analyse-barre"><button type="button" data-vue-analyse="coefs">${iconeHtml('analyse_btp_retour')} ${texteHtml('analyse_btp.frais.retour')}</button>
          <strong>${texteHtml('analyse_btp.frais.titre')}</strong>
          <span class="aide">${texteHtml('analyse_btp.frais.aide')}</span></div>
        <div class="analyse-frais"></div></div>`;
    this.rapportFrais ??= new RapportFraisAnnexes(null, { editeur: this.editeur, natures: this.natures, message: this.message, imprimer: this.imprimerFrais });
    this.rapportFrais.conteneur = this.conteneur.querySelector('.analyse-frais');
    this.rapportFrais.rendre();
  }

  /** Partie Éléments : groupes par code et libellé des feuilles filtrées (portée, nature, filtres de colonnes). */
  rendreElements({ allerAuResultat = false } = {}) {
    const corps = this.conteneur.querySelector('.table-elements tbody');
    if (!corps) return;
    const pm = this.editeur.saisie.document.ent_precision_montant ?? 2;
    const lectureSeule = this.editeur.magasin?.lectureSeule;
    const tous = elementsAnalyse(this.feuilles ?? []);
    this.groupesElements = tous;
    const actifs = [...this.filtresElements].filter(([, f]) => filtreActif(f));
    let groupes = tous.filter((g) => actifs.every(([k, f]) => correspond(f, this.celluleElement(g, k), colonneFiltre(k))));
    // Tri choisi (sinon : montant décroissant) ; valeurs absentes en fin de liste.
    if (this.ordreFige) {
      const parCle = new Map(tous.map((g) => [g.cle, g]));
      groupes = this.ordreFige.map((k) => parCle.get(k)).filter(Boolean);
    } else if (this.tri) {
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
      th.querySelector('.sens-tri').textContent = actif ? ` ${icone(this.tri.sens === 1 ? 'analyse_btp_precedent' : 'analyse_btp_suivant')}` : '';
      const b = th.querySelector('[data-filtre-colonne]');
      if (!b) continue;
      const filtre = filtreActif(this.filtresElements.get(th.dataset.tri));
      b.classList.toggle('actif', filtre);
      b.textContent = icone(filtre ? 'analyse_btp_filtre_actif' : 'analyse_btp_filtre');
    }
    this.elements = new Map(groupes.map((g) => [g.cle, g]));
    const nombre = (v, d) => formatLibre(Math.round(v * 10 ** d) / 10 ** d, d);
    const valeur = (g, k) => {
      const s = g.valeurs[k];
      const def = VALEURS_ELEMENT[k];
      if (!s) return '<td></td>';
      const txt = s.divergent ? `${nombre(s.min, def.decimales)} – ${nombre(s.max, def.decimales)}` : nombre(s.min, def.decimales);
      if (lectureSeule) return `<td class="nombre ${s.divergent ? 'divergent' : ''}">${txt}</td>`;
      return `<td class="nombre ${s.divergent ? 'divergent' : ''}" title="${s.divergent ? texteHtml('analyse_btp.elements_saisie.divergent', { min: nombre(s.min, def.decimales), max: nombre(s.max, def.decimales) }) : ''}">
        <input data-saisie="element" data-element="${echapper(g.cle)}" data-cle="${k}" value="${s.divergent ? '' : echapper(txt)}"
          placeholder="${echapper(txt)}" title="${texteHtml('analyse_btp.elements_saisie.valeur', { valeur: def.titre, nombre: g.feuilles.length })}"></td>`;
    };
    const natures = (g) => [...g.natures].map((n) => this.natures.get(n)?.code ?? (n ? String(n) : '—')).join(', ');
    // Quantité totale (perte et quantité des ouvrages parents comprises) : modifiable, reventilée au prorata ;
    // 📐 si au moins une ligne a sa quantité issue d'un métré (la saisie la désactive).
    const quantite = (g) => {
      const metres = g.feuilles.filter((f) => (f.saisie?.lig_qte_source ?? 'S') === 'M').length;
      const marque = metres ? `<span class="metre" title="${texteHtml('analyse_btp.elements_saisie.metres', { nombre: metres })}">${iconeHtml('analyse_btp_metre')}</span>` : '';
      const txt = nombre(g.qt, 3);
      if (lectureSeule) return `<td class="nombre">${marque}${txt}</td>`;
      return `<td class="nombre">${marque}<input data-saisie="element" data-element="${echapper(g.cle)}" data-cle="qt" value="${echapper(txt)}"
        title="Nouvelle quantité totale (perte et ouvrages compris) : reventilée au prorata des ${g.feuilles.length} ligne(s), quantités saisies recalculées"></td>`;
    };
    const cellules = {
      code: (g) => `<td>${echapper(g.code)}</td>`,
      libelle: (g) => `<th title="${echapper(g.libelle)}">${echapper(g.libelle)}</th>`,
      unite: (g) => `<td class="${g.unites.size > 1 ? 'divergent' : ''}">${echapper([...g.unites].join(' / '))}</td>`,
      nb: (g) => `<td class="nombre">${g.feuilles.length}</td>`,
      qt: quantite,
      montant: (g) => `<td class="nombre">${formatNombre(g.montant, pm)}</td>`,
      nature: (g) => `<td class="${g.natures.size > 1 ? 'divergent' : ''}">${echapper(natures(g))}</td>`,
    };
    const visibles = COLONNES_ELEMENTS.filter((k) => this.colonnesElements.has(k));
    const edite = this.saisieElement?.cle;
    corps.innerHTML = groupes.map((g) => `<tr data-groupe="${echapper(g.cle)}" class="${g.cle === edite ? 'edite' : ''}">${visibles.map((k) => (cellules[k] ? cellules[k](g) : valeur(g, k))).join('')}</tr>`).join('')
      || `<tr><td colspan="${visibles.length}" class="aide">${texteHtml('bibliotheque_btp.appel.aucun')}</td></tr>`;
    this.affiches = groupes.map((g) => g.cle);
    this.marquerRecherche(groupes, { allerAuResultat });
    // Ligne modifiée : reste visible, sa cellule reprend le focus.
    if (this.saisieElement) {
      const tr = [...corps.querySelectorAll('tr[data-groupe]')].find((x) => x.dataset.groupe === this.saisieElement.cle);
      tr?.scrollIntoView({ block: 'nearest' });
      const input = tr?.querySelector(`input[data-cle="${this.saisieElement.colonne}"]`);
      if (input && this.conteneur.isConnected && !this.conteneur.closest('[hidden]')) { input.focus({ preventScroll: true }); input.select(); }
      this.saisieElement = null;
    }
    const filtres = actifs.length || this.ordreFige;
    this.conteneur.querySelector('[data-nb-elements]').innerHTML = `(${texteHtml(filtres ? 'analyse_btp.compte.filtre' : 'analyse_btp.compte.tous', { groupes: groupes.length, tous: tous.length, lignes: groupes.reduce((n, g) => n + g.feuilles.length, 0) })})`
      + `${actifs.length ? ` <button type="button" class="lien" data-effacer-filtres>${texteHtml('analyse_btp.compte.effacer')}</button>` : ''}`
      + `${this.ordreFige ? ` <button type="button" class="lien" data-liberer-ordre title="${texteHtml('analyse_btp.compte.liberer_aide')}">${texteHtml('analyse_btp.compte.liberer')}</button>` : ''}`;
  }

  /**
   * Recherche sans filtre : groupes dont le code et le libellé contiennent tous les mots (sans casse ni accents),
   * surlignés ; le résultat courant est amené dans la vue.
   */
  marquerRecherche(groupes, { allerAuResultat = false } = {}) {
    const mots = normaliser(this.recherche).split(/\s+/).filter(Boolean);
    const trouves = mots.length ? groupes.filter((g) => mots.every((m) => normaliser(`${g.code} ${g.libelle}`).includes(m))).map((g) => g.cle) : [];
    this.trouves = trouves;
    if (this.resultatRecherche >= trouves.length) this.resultatRecherche = trouves.length ? 0 : -1;
    if (trouves.length && this.resultatRecherche < 0) this.resultatRecherche = 0;
    const courant = trouves[this.resultatRecherche] ?? null;
    const ensemble = new Set(trouves);
    for (const tr of this.conteneur.querySelectorAll('.table-elements tbody tr[data-groupe]')) {
      tr.classList.toggle('trouvee', ensemble.has(tr.dataset.groupe));
      tr.classList.toggle('trouvee-courante', tr.dataset.groupe === courant);
    }
    const compteur = this.conteneur.querySelector('[data-compteur-recherche]');
    if (compteur) compteur.textContent = mots.length ? (trouves.length ? `${this.resultatRecherche + 1} / ${trouves.length}` : texte('analyse_btp.recherche.aucun')) : '';
    this.conteneur.querySelector('.recherche-elements')?.classList.toggle('sans-resultat', mots.length > 0 && !trouves.length);
    if (allerAuResultat && courant !== null) {
      [...this.conteneur.querySelectorAll('.table-elements tbody tr[data-groupe]')].find((tr) => tr.dataset.groupe === courant)?.scrollIntoView({ block: 'center' });
    }
  }

  /** Résultat suivant (1) ou précédent (-1) de la recherche, en boucle. */
  resultatSuivant(sens) {
    const n = this.trouves?.length ?? 0;
    if (!n) return;
    this.resultatRecherche = (this.resultatRecherche + sens + n) % n;
    this.marquerRecherche(this.affiches.map((k) => this.elements.get(k)).filter(Boolean), { allerAuResultat: true });
  }

  /** Ctrl+F dans l'onglet Analyse : curseur dans la recherche de la liste des éléments. */
  ouvrirRecherche() {
    if (this.masquee === 'elements') { this.masquee = null; this.appliquerPartage(); this.memoriser(); }
    const champ = this.conteneur.querySelector('[data-recherche]');
    champ?.focus();
    champ?.select();
  }

  /** Cellule d'un groupe pour le filtre (valeur : celle du tri, minimum si les lignes diffèrent ; texte affiché). */
  celluleElement(g, cle) {
    const t = TRIS_ELEMENTS[cle];
    const valeur = t.valeur(g, this.natures);
    return { valeur, texte: this.texteFiltre(valeur, cle), style: {} };
  }

  texteFiltre(v, cle) {
    if (v === null || v === undefined || v === '') return '';
    if (TRIS_ELEMENTS[cle].texte) return String(v);
    const d = cle === 'nb' ? 0 : cle === 'qt' ? 3 : cle === 'montant' ? 2 : 4;
    return formatLibre(Math.round(Number(v) * 10 ** d) / 10 ** d, d);
  }

  /** Menu de filtre d'une colonne (module Liste) : tri, valeurs à cocher, condition. */
  menuFiltreElement(cle, ancre) {
    const modele = {
      valeur: (g, k) => TRIS_ELEMENTS[k].valeur(g, this.natures),
      texte: (v, c) => this.texteFiltre(v, c.code),
      style: () => ({}),
    };
    ouvrirMenuFiltre({
      ancre, colonne: colonneFiltre(cle), modele, lignes: this.groupesElements ?? [], filtre: this.filtresElements.get(cle), triBase: false, miseEnForme: false,
      appliquer: (f) => {
        this.ordreFige = null;
        if (f) this.filtresElements.set(cle, f); else this.filtresElements.delete(cle);
        this.rendreElements();
      },
      trier: (sens) => {
        this.ordreFige = null;
        this.tri = { cle, sens: sens === 'desc' ? -1 : 1 };
        this.memoriser();
        this.rendreElements();
      },
    });
  }

  /** Menu de choix des colonnes d'une partie (coefs, elements). */
  menuColonnes(partie, colonnes, actives) {
    return `<span class="analyse-colonnes">
      <button type="button" data-choix-colonnes aria-expanded="false">${texteHtml('analyse_btp.colonnes_menu.titre')} ${iconeHtml('analyse_btp_filtre')}</button>
      <div class="menu-colonnes" hidden>
        ${colonnes.map((c) => `<label title="${echapper(c.aide ?? c.titre)}"><input type="checkbox" data-colonne-de="${partie}" data-colonne="${c.cle}" ${actives.has(c.cle) ? 'checked' : ''}> ${echapper(c.titre)}</label>`).join('')}
        <button type="button" data-colonnes-defaut="${partie}">${texteHtml('analyse_btp.colonnes_menu.defaut')}</button>
      </div>
    </span>`;
  }

  /** Nouvelle quantité totale d'un groupe : reventilée au prorata, quantités saisies recalculées (métrés désactivés). */
  appliquerQuantite(g, valeur) {
    const res = repartirQuantite(g, valeur, this.resultat);
    if (res.erreur) { this.message(res.erreur, 'erreur'); this.rendre(); return; }
    this.editeur.magasin.modifier((d) => {
      for (const l of d.lignes) if (res.qtes.has(l.lig_id)) { l.lig_qte = res.qtes.get(l.lig_id); l.lig_qte_source = 'S'; }
    }, texte('analyse_btp.etapes.quantite', { element: g.libelle || g.code }));
    this.message(texte('analyse_btp.messages.quantite', { valeur: formatLibre(valeur), nombre: res.qtes.size, element: g.libelle || g.code })
      + `${res.metres ? ` ; ${texte('analyse_btp.messages.metres', { nombre: res.metres })}` : ''}`);
  }

  /** Valeur saisie dans la partie Éléments : écrite sur toutes les lignes du groupe (une étape d'annulation). */
  appliquerElement(cleGroupe, cle, valeur) {
    const g = this.elements?.get(cleGroupe);
    if (!g) return;
    this.ordreFige ??= [...(this.affiches ?? [])];
    this.saisieElement = { cle: cleGroupe, colonne: cle };
    if (cle === 'qt') {
      if (Number(valeur) < 0) { this.message(texte('analyse_btp.messages.quantite_invalide')); this.rendre(); return; }
      this.appliquerQuantite(g, valeur);
      return;
    }
    if (Number(valeur) < 0 || (cle !== 'pa' && cle !== 'pv' && Number(valeur) <= 0)) { this.message(texte('analyse_btp.messages.valeur_invalide')); this.rendre(); return; }
    const { modifs, erreur } = modificationsElement(g, cle, valeur);
    if (erreur) { this.message(erreur, 'erreur'); this.rendre(); return; }
    const titre = VALEURS_ELEMENT[cle].titre;
    this.editeur.magasin.modifier((d) => {
      for (const l of d.lignes) if (modifs.has(l.lig_id)) Object.assign(l, modifs.get(l.lig_id));
    }, texte('analyse_btp.etapes.valeur', { valeur: titre, element: g.libelle || g.code }));
    this.message(texte(cle === 'pv' ? 'analyse_btp.messages.valeur_fixe' : 'analyse_btp.messages.valeur', { valeur: titre, montant: formatLibre(valeur), nombre: modifs.size, element: g.libelle || g.code }));
  }

  /** Arbre des natures des lignes de la portée : regroupements puis natures ; filtre. */
  arbreNatures() {
    const comptes = new Map();
    for (const f of this.feuillesPortee ?? []) comptes.set(f.nature ?? null, (comptes.get(f.nature ?? null) ?? 0) + 1);
    const regroupements = new Map();
    for (const [id, n] of comptes) {
      if (id === null) continue;
      const nat = this.natures.get(id);
      const reg = nat?.regroupement ?? 'AUTRE';
      if (!regroupements.has(reg)) regroupements.set(reg, []);
      regroupements.get(reg).push({ id, libelle: nat ? `${nat.code} · ${nat.libelle}` : texte('analyse_btp.natures.nature', { id }), n });
    }
    const total = [...comptes.values()].reduce((a, b) => a + b, 0);
    const noeud = (cle, libelle, n, profondeur, { pli = null, classe = '' } = {}) => `
      <li class="${classe} ${this.filtreNature === cle ? 'courant' : ''}" style="padding-left:${0.3 + profondeur * 0.9}rem">
        <span class="pli" ${pli ? `data-nature-pli="${echapper(pli)}"` : ''}>${pli ? iconeHtml(this.naturesReplies.has(pli) ? 'analyse_btp_ferme' : 'analyse_btp_ouvert') : ''}</span>
        <button type="button" class="lien" data-nature-filtre="${echapper(cle ?? '')}" title="${echapper(libelle)}">${echapper(libelle)}</button></li>`;
    const items = [noeud(null, texte('analyse_btp.natures.toutes'), total, 0, { classe: 'global' })];
    for (const [reg, natures] of [...regroupements].sort((a, b) => a[0].localeCompare(b[0]))) {
      items.push(noeud(`r:${reg}`, reg, natures.reduce((a, x) => a + x.n, 0), 1, { pli: reg }));
      if (this.naturesReplies.has(reg)) continue;
      for (const x of natures.sort((a, b) => a.libelle.localeCompare(b.libelle))) items.push(noeud(`n:${x.id}`, x.libelle, x.n, 2));
    }
    if (comptes.has(null)) items.push(noeud('n:', texte('analyse_btp.natures.sans'), comptes.get(null), 1));
    return `<aside class="analyse-arbre analyse-natures" aria-label="${texteHtml('analyse_btp.natures.filtre')}"><div class="analyse-arbre-titre">${texteHtml('analyse_btp.natures.titre')}</div><ul>${items.join('')}</ul></aside>`;
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
        <span class="pli" ${aEnfants && id !== null ? `data-arbre-pli="${id}"` : ''}>${aEnfants && id !== null ? iconeHtml(this.arbreReplies.has(id) ? 'analyse_btp_ferme' : 'analyse_btp_ouvert') : ''}</span>
        <button type="button" class="lien" data-portee-id="${id ?? ''}" title="${echapper(libelle)}">${echapper(libelle)}</button>
        <span class="mt">${formatNombre(montant, pm)}</span></li>`;
    // Document entier : total HT du corps (avant postes de pied), comme le tableau.
    const totalCorps = (this.resultat.pied ?? []).find((e) => e.cle === 'TOTAL_HT')?.montant ?? this.resultat.document.ent_total_ht;
    const items = [noeud(null, texte('analyse_btp.barre.document'), totalCorps, 0, false, 'global')];
    for (const t of tranches) {
      const id = t.ligne.lig_id;
      if (masques.has(t.parent) || this.arbreReplies.has(t.parent)) { masques.add(id); continue; }
      items.push(noeud(id, this.libelleTranche(t.ligne), t.ligne.lig_montant_ht, t.profondeur + 1, avecEnfants.has(id), t.ligne.lig_tyl_id === TL.SECTION ? 'section' : ''));
    }
    return `<aside class="analyse-arbre" aria-label="${texteHtml('analyse_btp.tranches.portee')}"><div class="analyse-arbre-titre">${texteHtml('analyse_btp.tranches.titre_arbre')}</div><ul>${items.join('')}</ul></aside>`;
  }

  #clic(e) {
    const vue = e.target.closest('[data-vue-analyse]');
    if (vue) { this.vue = vue.dataset.vueAnalyse; this.memoriser(); this.rendre(); return; }
    const resultat = e.target.closest('[data-resultat]');
    if (resultat) { this.resultatSuivant(Number(resultat.dataset.resultat)); return; }
    if (e.target.closest('[data-liberer-ordre]')) { this.ordreFige = null; this.rendreElements(); return; }
    if (e.target.closest('[data-recharger-prix]')) { this.rechargerPrix().catch((x) => this.message(x.message ?? String(x), 'erreur')); return; }
    // Tri, filtre, portée ou nature : l'ordre figé après une saisie est abandonné.
    if (e.target.closest('th[data-tri], [data-effacer-filtres], [data-portee-id], [data-nature-filtre]')) this.ordreFige = null;
    const filtre = e.target.closest('[data-filtre-colonne]');
    if (filtre) { e.stopPropagation(); this.menuFiltreElement(filtre.dataset.filtreColonne, filtre); return; }
    if (e.target.closest('[data-effacer-filtres]')) { this.filtresElements.clear(); fermerMenuFiltre(); this.rendreElements(); return; }
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
    const choix = e.target.closest('[data-choix-colonnes]');
    if (choix) {
      const menu = choix.closest('.analyse-colonnes').querySelector('.menu-colonnes');
      for (const m of this.conteneur.querySelectorAll('.menu-colonnes')) if (m !== menu) m.hidden = true;
      menu.hidden = !menu.hidden;
      choix.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    const defaut = e.target.closest('[data-colonnes-defaut]');
    if (defaut) {
      if (defaut.dataset.colonnesDefaut === 'elements') this.colonnesElements = new Set(COLONNES_ELEMENTS);
      else this.colonnes = new Set(COLONNES_ANALYSE.filter((c) => c.defaut).map((c) => c.cle));
      this.memoriser();
      this.rendre();
    }
  }

  #changement(e) {
    const t = e.target;
    if (t.matches('[data-hors-total]')) { this.ordreFige = null; this.horsTotal = t.checked; this.memoriser(); this.rendre(); return; }
    if (t.matches('[data-colonne]')) {
      const partie = t.dataset.colonneDe;
      const cible = partie === 'elements' ? this.colonnesElements : this.colonnes;
      if (t.checked) cible.add(t.dataset.colonne); else cible.delete(t.dataset.colonne);
      this.memoriser();
      this.rendre();
      // Le menu de la partie reste ouvert pour cocher d'autres colonnes.
      const menu = this.conteneur.querySelector(`[data-colonne-de="${partie}"]`)?.closest('.menu-colonnes');
      if (menu) menu.hidden = false;
      return;
    }
    if (t.matches('input[data-saisie="element"]')) {
      const v = lireNombre(t.value);
      t.blur();
      if (v === undefined || v === null) { if (v === undefined) this.message(texte('analyse_btp.messages.nombre')); this.rendre(); return; }
      this.appliquerElement(t.dataset.element, t.dataset.cle, Number(v));
      return;
    }
    if (!t.matches('input[data-saisie]')) return;
    const g = [...(this.dernier?.liste ?? []), this.dernier?.total].find((x) => x?.cle === t.dataset.groupe);
    const v = lireNombre(t.value);
    t.blur();
    if (!g || v === undefined || v === null) { this.message(texte('analyse_btp.messages.nombre')); this.rendre(); return; }
    if (t.dataset.saisie === 'montant') this.forcer(g, t.dataset.cle, Number(v));
    else if (Number(v) <= 0) { this.message(texte('analyse_btp.messages.coef_invalide')); this.rendre(); }
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
    ed.magasin.modifier((d) => { for (const l of d.lignes) if (ids.has(l.lig_id)) l[champ] = valeur; }, texte('analyse_btp.etapes.coef', { coef: LIBELLES_COEF[cle], valeur: formatLibre(valeur) }));
    this.message(texte('analyse_btp.messages.coef', { coef: LIBELLES_COEF[cle], valeur: formatLibre(valeur), nombre: ids.size, groupe: groupe.libelle }));
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
        lig_libelle_html: n ? texteHtml('analyse_btp.ecart.nature', { nature: n.libelle }) : texteHtml('analyse_btp.ecart.libelle'), lig_qte: 1, lig_unt_code: 'u',
        lig_pa: Number(paEcart(cle, res.ecart, this.coefFa)), lig_coef_fg: 1, lig_coef_benef: 1, lig_nat_id: nature ?? null,
      });
      ed.regles.appliquerContexte(d, idEcart, ed.definition.taux_tva);
    }, texte('analyse_btp.etapes.forcer', { montant: libelle, cible: formatNombre(cible, 2) }));
    this.message(texte('analyse_btp.messages.force', { montant: `${libelle[0].toUpperCase()}${libelle.slice(1)}`, cible: formatNombre(cible, 2), groupe: groupe.libelle, nombre: res.coefs.size })
      + `${res.ecart !== null ? `, ${texte('analyse_btp.messages.ecart', { montant: formatNombre(Number(res.ecart), 2) })}` : ''}`);
  }
}
