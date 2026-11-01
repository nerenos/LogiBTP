// Étiquettes (§ 3.7) : mode de rapport « planche ». Chaque élément de la collection est composé dans une cellule de
// la planche (colonnes × rangées, pas horizontal et vertical, marges de la planche) ; une planche entamée se reprend
// à l'étiquette de départ (paramètre `premiere_etiquette`, 1 = en haut à gauche).
import { texte } from '@logibtp/socle/dictionnaire';
import { composer, enfant, evaluerExpression, alerter } from './composition.js';

/**
 * @param m modèle normalisé (mode ETIQUETTES) : planche { colonnes, rangees, largeur, hauteur, pas_x, pas_y,
 *          marge_gauche, marge_haut, marge_interieure }, collection (expression), bandes CORPS (contenu de l'étiquette)
 */
export function paginerEtiquettes(m, ctx, page) {
  const p = m.planche ?? {};
  const colonnes = p.colonnes ?? 3;
  const rangees = p.rangees ?? 8;
  const largeur = p.largeur ?? 70;
  const hauteur = p.hauteur ?? 36;
  const pasX = p.pas_x ?? largeur;
  const pasY = p.pas_y ?? hauteur;
  const mg = p.marge_gauche ?? Math.max(0, (page.largeur - (colonnes - 1) * pasX - largeur) / 2);
  const mh = p.marge_haut ?? Math.max(0, (page.hauteur - (rangees - 1) * pasY - hauteur) / 2);
  const interieur = p.marge_interieure ?? 2;
  const parPlanche = colonnes * rangees;
  const depart = Math.min(parPlanche, Math.max(1, Number(ctx.parametres.premiere_etiquette ?? 1))) - 1;

  const liste = evaluerExpression(ctx, m.collection ?? 'elements', texte('edition.lieux.etiquettes'));
  const elements = Array.isArray(liste) ? liste : liste ? [liste] : [];
  const copies = Math.max(1, Number(ctx.parametres.copies ?? 1));
  const bandes = m.bandes.filter((b) => b.type === 'CORPS');
  const pages = [];
  let rang = depart;
  for (const el of elements) {
    for (let c = 0; c < copies; c++) {
      const planche = Math.floor(rang / parPlanche);
      while (pages.length <= planche) pages.push({ numero: pages.length + 1, largeur: page.largeur, hauteur: page.hauteur, elements: [] });
      const pos = rang % parPlanche;
      const x = mg + (pos % colonnes) * pasX + interieur;
      let y = mh + Math.floor(pos / colonnes) * pasY + interieur;
      const ctxE = enfant(ctx, { element: el });
      const sortie = [];
      for (const b of bandes) {
        const boite = composer(b.contenu, ctxE, largeur - 2 * interieur);
        if (!boite || boite.flux) continue;
        boite.dessiner(sortie, x, y);
        y += boite.hauteur;
      }
      const bas = mh + Math.floor(pos / colonnes) * pasY + hauteur - interieur + 0.01;
      if (y > bas) alerter(ctx, 'ETIQUETTE_DEBORDE', texte('edition.alertes.etiquette_deborde'));
      // Contenu limité à l'étiquette (éléments entièrement dehors retirés).
      pages[planche].elements.push(...sortie.filter((e) => (e.y ?? e.y1 ?? 0) <= bas));
      if (m.page?.cadres_etiquettes) pages[planche].elements.push({ t: 'rect', x: x - interieur, y: mh + Math.floor(pos / colonnes) * pasY, l: largeur, h: hauteur, trait: { epaisseur: 0.1, couleur: '#c0c4cc', pointille: true } });
      rang++;
    }
  }
  if (!pages.length) pages.push({ numero: 1, largeur: page.largeur, hauteur: page.hauteur, elements: [] });
  return { pages, alertes: [] };
}
