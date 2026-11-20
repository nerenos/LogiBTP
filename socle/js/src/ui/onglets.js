// Titres courts des onglets : quand la ligne d'onglets déborde (retour à la ligne), tous passent au titre court.

/** Vrai si les boutons ne tiennent plus sur une seule ligne (retour à la ligne du conteneur). */
export function ongletsDebordent(nav) {
  const boutons = [...nav.querySelectorAll('button[data-court]')].filter((b) => b.offsetParent !== null || b.offsetWidth > 0);
  if (boutons.length < 2) return false;
  const haut = boutons[0].offsetTop;
  return boutons.some((b) => b.offsetTop !== haut);
}

// Le texte du titre est le premier nœud texte du bouton ; pastille de compteur et icône restent en place.
function noeudTitre(bouton) {
  return [...bouton.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() !== '');
}

/** Affiche le titre court (`court`) ou complet (`!court`) de tous les onglets ; infobulle = titre complet. */
export function afficherTitres(nav, court) {
  for (const b of nav.querySelectorAll('button[data-court]')) {
    const complet = b.dataset.titre;
    const abrege = b.dataset.court;
    if (!complet || !abrege) continue;
    const noeud = noeudTitre(b);
    if (noeud) {
      const marge = /^\s*/.exec(noeud.textContent)[0];
      const fin = /\s*$/.exec(noeud.textContent)[0];
      noeud.textContent = marge + (court ? abrege : complet) + fin;
    }
    // Infobulle d'aide facultative (`data-aide`) rendue au retour aux titres complets.
    if (court) b.setAttribute('title', complet);
    else if (b.dataset.aide) b.setAttribute('title', b.dataset.aide);
    else b.removeAttribute('title');
  }
  nav.classList.toggle('titres-courts', court);
}

/**
 * Active les titres courts d'une ligne d'onglets : chaque bouton porte `data-titre` et `data-court`.
 * Dès que la ligne déborde, tous passent au titre court (infobulle : titre complet) ; sinon titres complets.
 * Retourne une fonction d'arrêt de l'observation.
 */
export function activerTitresCourts(nav) {
  let enCours = false;
  const evaluer = () => {
    if (enCours) return;
    enCours = true;
    afficherTitres(nav, false);
    if (ongletsDebordent(nav)) afficherTitres(nav, true);
    enCours = false;
  };
  evaluer();
  if (typeof ResizeObserver === 'undefined') return () => {};
  let largeur = nav.clientWidth;
  const obs = new ResizeObserver(() => {
    if (nav.clientWidth === largeur) return;
    largeur = nav.clientWidth;
    evaluer();
  });
  obs.observe(nav);
  return () => obs.disconnect();
}
