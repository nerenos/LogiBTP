// Séparateur redimensionnable (poignée glissée à la souris, ou flèches du clavier) entre deux zones de l'explorateur.
// La taille s'applique à `cible` (largeur pour l'axe x, hauteur pour l'axe y) ; sens -1 : la cible est après la poignée
// (glisser vers la gauche ou le haut l'agrandit). surFin(taille) : taille retenue (préférences du navigateur).

export function separateur(poignee, { cible, axe = 'x', sens = 1, min = 120, max = () => Infinity, surFin = () => {} }) {
  const prop = axe === 'x' ? 'width' : 'height';
  const borner = (v) => Math.round(Math.min(Math.max(v, min), typeof max === 'function' ? max() : max));
  const appliquer = (v) => { cible.style[prop] = `${borner(v)}px`; cible.style.flexBasis = `${borner(v)}px`; };
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
    document.body.classList.add(axe === 'x' ? 'ged-redim-x' : 'ged-redim-y');
    const deplacer = (m) => appliquer(initiale + sens * ((axe === 'x' ? m.clientX : m.clientY) - depart));
    const finir = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.classList.remove('actif');
      document.body.classList.remove('ged-redim-x', 'ged-redim-y');
      surFin(Math.round(cible.getBoundingClientRect()[prop]));
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
    appliquer(cible.getBoundingClientRect()[prop] + sens * delta);
    surFin(Math.round(cible.getBoundingClientRect()[prop]));
  });
  return { appliquer };
}
