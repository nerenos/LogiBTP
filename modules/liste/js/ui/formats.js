import { vraiDonnee } from '../src/modele.js';

// Rendu des cellules par format. Classe mère : une application peut ajouter ou remplacer un format
// en dérivant FormatsCellule (méthode du même nom que le format).

const estUrl = (s) => /^(https?:|data:image\/|\/)/.test(String(s ?? ''));

export class FormatsCellule {
  /** Contenu d'une cellule : nœud DOM ou texte. */
  contenu(valeur, colonne, modele) {
    const f = typeof this[colonne.format] === 'function' ? colonne.format : 'texte';
    return this[f](valeur, colonne, modele);
  }

  texte(valeur, colonne, modele) { return modele.texte(valeur, colonne); }
  nombre(valeur, colonne, modele) { return modele.texte(valeur, colonne); }
  date(valeur, colonne, modele) { return modele.texte(valeur, colonne); }
  combo(valeur, colonne, modele) { return modele.texte(valeur, colonne); }

  coche(valeur) {
    const s = document.createElement('span');
    s.className = `liste-coche${vraiDonnee(valeur) ? ' coche' : ''}`;
    s.textContent = vraiDonnee(valeur) ? '☑' : '☐';
    return s;
  }

  /** Petite image : picto de l'option (emoji ou URL d'image), sinon la valeur elle-même si c'est une image. */
  picto(valeur, colonne, modele) {
    if (valeur === null || valeur === undefined || valeur === '') return '';
    const o = modele.option(colonne, valeur);
    const picto = o?.picto || (estUrl(valeur) ? valeur : null);
    const libelle = o?.libelle ?? String(valeur);
    if (!picto) return libelle;
    const s = document.createElement('span');
    s.className = 'liste-picto';
    s.title = libelle;
    if (estUrl(picto)) {
      const img = document.createElement('img');
      img.src = picto;
      img.alt = libelle;
      s.append(img);
    } else s.textContent = picto;
    return s;
  }
}

/** Applique le style calculé d'une cellule ({ couleur, fond, gras, italique, souligne, barre }). */
export function appliquerStyle(el, s) {
  el.style.color = s.couleur ?? '';
  el.style.backgroundColor = s.fond ?? '';
  el.style.fontWeight = s.gras ? '700' : '';
  el.style.fontStyle = s.italique ? 'italic' : '';
  el.style.textDecoration = [s.souligne ? 'underline' : '', s.barre ? 'line-through' : ''].filter(Boolean).join(' ');
}

export function alignement(colonne) {
  if (colonne.alignement) return colonne.alignement;
  if (colonne.format === 'nombre') return 'droite';
  if (colonne.format === 'coche' || colonne.format === 'picto') return 'centre';
  return 'gauche';
}
