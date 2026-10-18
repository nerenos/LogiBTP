// Pagination (§ 3.2) : fragments du corps → pages. Règles :
// - saut avant / après, saut de page explicite ;
// - unités gardées ensemble (garderAvecSuivant, lieAuPrecedent) : une unité qui tient sur une page n'est jamais coupée ;
// - fragment plus haut que la place restante : découpé s'il est sécable (lignes de texte), sinon page suivante ;
// - tableaux : entête répétée à chaque page, « À reporter » / « Report » des colonnes cumulées, trait de fermeture,
//   remplissage de la page par un cadre étiré (colonnes prolongées jusqu'au bas de la zone) ;
// - fragments « bas de page » empilés au bas de la page (dernière page pour un bloc de totaux) ;
// - fragments « chaque page » répétés en haut des pages suivantes.
import { Dec } from '@logibtp/socle';
import { r2 } from './unites.js';

const EPS = 0.01;

/**
 * @param fragments [{ boite, sautAvant, sautApres, garderAvecSuivant, lieAuPrecedent, basDePage, chaquePage, tableau, cumuls }]
 * @param page { largeur, hauteur, marges: { haut, bas, gauche, droite } }
 * @param zones (numero, derniere) → { entete, pied } : hauteurs des bandes de page (mm)
 * @returns { pages: [{ numero, largeur, hauteur, elements, zone: { haut, bas } }], alertes }
 */
export function paginer(fragments, page, zones, alertes = []) {
  const pages = [];
  const x0 = page.marges.gauche;
  const limites = (numero, derniere) => {
    const z = zones(numero, derniere);
    return { haut: page.marges.haut + z.entete, bas: page.hauteur - page.marges.bas - z.pied };
  };

  let p = null; // page courante : { numero, elements, y (curseur absolu), zone, vide, segment, ferme }
  const repetes = [];
  const cumuls = new Map(); // tableau → { colonne: Dec }
  let derniereUnite = false;

  const nouvellePage = () => {
    if (p) fermerPage(false);
    const numero = pages.length + 1;
    const zone = limites(numero, false);
    p = { numero, elements: [], y: zone.haut, zone, vide: true, segment: null, etirer: null, ferme: false };
    pages.push(p);
    // Fragments répétés sur chaque page (titre de page, libellés des colonnes…).
    for (const f of repetes) placerBoite(f.boite);
    p.vide = true;
  };

  const limite = () => (derniereUnite ? limites(p.numero, true).bas : p.zone.bas);

  const placerBoite = (b) => {
    b.dessiner(p.elements, x0, p.y);
    p.y += b.hauteur;
    p.vide = false;
  };

  // Segment de tableau sur la page : entête, cumuls ; fermeture (trait, report, étirement).
  const ouvrirSegment = (t, suite) => {
    p.segment = { t, debut: p.y };
    if (t.entete) placerBoite(t.entete);
    if (suite && t.report) placerBoite(t.report(t.libelleReport, objetCumuls(t)));
  };
  const objetCumuls = (t) => Object.fromEntries(cumuls.get(t) ?? []);
  const hauteurReport = (t) => (t.report ? t.report(t.libelleAReporter, objetCumuls(t)).hauteur : 0);

  const fermerSegment = (coupe) => {
    const s = p.segment;
    if (!s) return;
    const t = s.t;
    const largeur = page.largeur - page.marges.gauche - page.marges.droite;
    if (coupe) {
      // Coupe dans le tableau : colonnes étirées jusqu'au report, report au bas de la zone.
      const r = t.report ? t.report(t.libelleAReporter, objetCumuls(t)) : null;
      const bas = limite() - (r ? r.hauteur : 0);
      if (t.remplir && bas > p.y + EPS) etirer(t, p.y, bas, largeur);
      if (r) { const y = t.remplir ? bas : p.y; r.dessiner(p.elements, x0, y); p.y = y + r.hauteur; }
      else trait(t, p.y, largeur);
      p.segment = null;
      return;
    }
    // Remplissage : trait de fermeture posé par l'étirement (ou, s'il est annulé, à la fin des lignes).
    if (t.remplir) p.etirer = { t, debut: p.y }; else trait(t, p.y, largeur);
    p.segment = null;
  };
  const trait = (t, y, largeur) => {
    if (t.traitFin) p.elements.push({ t: 'ligne', x1: r2(x0), y1: r2(y), x2: r2(x0 + largeur), y2: r2(y), trait: t.traitFin });
  };
  const etirer = (t, haut, bas, largeur) => {
    if (t.traitCadre) {
      p.elements.push({ t: 'ligne', x1: r2(x0), y1: r2(haut), x2: r2(x0), y2: r2(bas), trait: t.traitCadre });
      p.elements.push({ t: 'ligne', x1: r2(x0 + largeur), y1: r2(haut), x2: r2(x0 + largeur), y2: r2(bas), trait: t.traitCadre });
    }
    if (t.traitCol) for (const cx of t.colonnes) p.elements.push({ t: 'ligne', x1: r2(x0 + cx), y1: r2(haut), x2: r2(x0 + cx), y2: r2(bas), trait: t.traitCol });
    if (t.traitFin) p.elements.push({ t: 'ligne', x1: r2(x0), y1: r2(bas), x2: r2(x0 + largeur), y2: r2(bas), trait: t.traitFin });
  };
  // Étirement en attente (tableau terminé avec remplissage) : jusqu'au bloc de bas de page, ou annulé.
  const appliquerEtirement = (jusqua) => {
    const e = p.etirer;
    p.etirer = null;
    if (!e) return;
    const largeur = page.largeur - page.marges.gauche - page.marges.droite;
    if (jusqua === null || jusqua <= e.debut + EPS) { trait(e.t, e.debut, largeur); return; }
    etirer(e.t, e.debut, jusqua, largeur);
  };

  const fermerPage = () => {
    if (!p || p.ferme) return;
    if (p.segment) fermerSegment(true);
    appliquerEtirement(limite());
    p.ferme = true;
  };

  /** Place un fragment (découpé si besoin) ; `tableau` : continuité des segments. */
  const placerFragment = (f, reserve = 0) => {
    const t = f.tableau ?? null;
    if (p.segment && p.segment.t !== t) fermerSegment(false);
    if (!t && p.etirer) appliquerEtirement(f.basDePage ? p.y : null);
    if (t && !p.segment) ouvrirSegment(t, (cumuls.get(t)?.size ?? 0) > 0 && p.vide);
    let b = f.boite;
    let premier = true;
    for (let garde = 0; garde < 2000; garde++) {
      const place = limite() - p.y - (t ? reserve : 0);
      if (b.hauteur <= place + EPS) {
        placerBoite(b);
        if (premier) ajouterCumuls(f);
        return;
      }
      const parts = b.decouper && place > 3 ? b.decouper(place) : null;
      if (parts) {
        placerBoite(parts[0]);
        if (premier) { ajouterCumuls(f); premier = false; }
        b = parts[1];
      } else if (p.vide || p.y <= p.zone.haut + EPS) {
        // Ne tient pas sur une page vide et n'est pas sécable : posé quand même (débordement signalé).
        alertes.push({ code: 'DEBORDEMENT', message: `Page ${p.numero} : un élément de ${b.hauteur.toFixed(1)} mm dépasse la zone imprimable` });
        placerBoite(b);
        if (premier) ajouterCumuls(f);
        return;
      }
      nouvellePage();
      if (t) ouvrirSegment(t, true);
    }
  };
  const ajouterCumuls = (f) => {
    if (!f.tableau || !f.cumuls) return;
    let m = cumuls.get(f.tableau);
    if (!m) { m = new Map(); cumuls.set(f.tableau, m); }
    for (const [k, v] of Object.entries(f.cumuls)) m.set(k, (m.get(k) ?? new Dec(0)).plus(v));
  };

  // Unités : fragments enchaînés (garder avec le suivant, lié au précédent) ; blocs de bas de page regroupés.
  const unites = [];
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    const derniere = unites[unites.length - 1];
    const prec = fragments[i - 1];
    const chaine = derniere && !f.sautAvant && !f.basDePage === !prec.basDePage
      && (prec.garderAvecSuivant || f.lieAuPrecedent || (f.basDePage && prec.basDePage));
    if (chaine) derniere.push(f); else unites.push([f]);
  }

  nouvellePage();
  unites.forEach((u, iu) => {
    derniereUnite = iu === unites.length - 1 || unites.slice(iu + 1).every((x) => x[0].basDePage);
    const premier = u[0];
    // Tableau terminé : segment fermé avant tout changement de page (pas de « À reporter » après la dernière ligne).
    if (p.segment && p.segment.t !== premier.tableau) fermerSegment(false);
    if (premier.boite?.saut) { if (!p.vide) nouvellePage(); return; }
    if (premier.sautAvant && !p.vide) nouvellePage();
    if (premier.chaquePage) repetes.push(...u);

    if (premier.basDePage) {
      // Bloc de bas de page : posé au bas de la zone, après étirement des tableaux.
      if (p.segment) fermerSegment(false);
      const h = u.reduce((a, f) => a + f.boite.hauteur, 0);
      if (p.y + h > limite() + EPS && !p.vide) { appliquerEtirement(limite()); nouvellePage(); }
      const y = Math.max(p.y, limite() - h);
      appliquerEtirement(y);
      p.y = y;
      for (const f of u) placerBoite(f.boite);
      if (u[u.length - 1].sautApres) nouvellePage();
      return;
    }

    const h = u.reduce((a, f) => a + f.boite.hauteur, 0);
    const t = u[u.length - 1].tableau;
    const suivant = unites[iu + 1]?.[0];
    const finTableau = !t || suivant?.tableau !== t;
    const reserve = t && !finTableau ? hauteurReport(t) : 0;
    const entete = u[0].tableau && (!p.segment || p.segment.t !== u[0].tableau) ? (u[0].tableau.entete?.hauteur ?? 0) : 0;
    const capacite = limite() - p.zone.haut;
    if (!p.vide && p.y + entete + h + reserve > limite() + EPS && h + reserve <= capacite + EPS) nouvellePage();
    u.forEach((f, i) => placerFragment(f, i === u.length - 1 ? reserve : 0));
    if (u[u.length - 1].sautApres) nouvellePage();
  });
  if (p.segment) fermerSegment(false);
  fermerPage();

  // Dernière page : pied propre (plus haut) — si le contenu le recouvre, une page de plus porte le pied.
  const derniere = pages[pages.length - 1];
  const zoneDerniere = limites(derniere.numero, true);
  if (derniere.y > zoneDerniere.bas + EPS && pages.length) {
    pages.push({ numero: pages.length + 1, elements: [], y: 0, zone: limites(pages.length + 1, true), vide: true });
  }

  return {
    pages: pages.map((x) => ({ numero: x.numero, largeur: page.largeur, hauteur: page.hauteur, elements: x.elements })),
    alertes,
  };
}
