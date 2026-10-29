// Séparateur redimensionnable (poignée glissée à la souris, ou flèches du clavier) entre deux zones d'un écran.
// La taille s'applique à `cible` (largeur pour l'axe x, hauteur pour l'axe y) ; sens -1 : la cible est après la poignée
// (glisser vers la gauche ou le haut l'agrandit). `min` et `max` : nombres ou fonctions (relues à chaque mouvement) ;
// `appliquer(cible, taille)` : écriture de la taille (défaut : largeur ou hauteur et base flex) ; surFin(taille) : taille
// retenue (préférences du navigateur) ; surDoubleClic : retour à la taille par défaut.

const valeur = (v) => (typeof v === 'function' ? v() : v);

export function separateur(poignee, { cible, axe = 'x', sens = 1, min = 120, max = Infinity, appliquer, surFin = () => {}, surDoubleClic }) {
  const prop = axe === 'x' ? 'width' : 'height';
  const borner = (v) => Math.round(Math.min(Math.max(v, valeur(min)), valeur(max)));
  const ecrire = (v) => {
    if (appliquer) appliquer(cible, borner(v));
    else { cible.style[prop] = `${borner(v)}px`; cible.style.flexBasis = `${borner(v)}px`; }
  };
  const taille = () => Math.round(cible.getBoundingClientRect()[prop]);
  poignee.setAttribute('role', 'separator');
  poignee.setAttribute('aria-orientation', axe === 'x' ? 'vertical' : 'horizontal');
  poignee.tabIndex = 0;
  poignee.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const depart = axe === 'x' ? e.clientX : e.clientY;
    const initiale = cible.getBoundingClientRect()[prop];
    poignee.setPointerCapture(e.pointerId);
    poignee.classList.add('actif');
    document.body.classList.add(axe === 'x' ? 'redim-x' : 'redim-y');
    const deplacer = (m) => ecrire(initiale + sens * ((axe === 'x' ? m.clientX : m.clientY) - depart));
    const finir = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.classList.remove('actif');
      document.body.classList.remove('redim-x', 'redim-y');
      surFin(taille());
    };
    poignee.addEventListener('pointermove', deplacer);
    poignee.addEventListener('pointerup', finir, { once: true });
    poignee.addEventListener('pointercancel', finir, { once: true });
  });
  poignee.addEventListener('keydown', (e) => {
    const pas = e.shiftKey ? 60 : 20;
    const delta = { ArrowLeft: -pas, ArrowUp: -pas, ArrowRight: pas, ArrowDown: pas }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    ecrire(cible.getBoundingClientRect()[prop] + sens * delta);
    surFin(taille());
  });
  if (surDoubleClic) poignee.addEventListener('dblclick', surDoubleClic);
  return { appliquer: ecrire };
}
