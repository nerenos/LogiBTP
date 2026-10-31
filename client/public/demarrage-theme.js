// Thème et densité choisis (Paramètres) appliqués avant l'affichage : pas d'éclair de l'autre thème au chargement.
// Script externe (pas de script en ligne) : la politique de sécurité du contenu n'autorise que les scripts du domaine.
try {
  const p = JSON.parse(localStorage.getItem('logibtp.navigation'));
  const t = p?.theme;
  if (t === 'clair' || t === 'sombre') document.documentElement.dataset.theme = t === 'clair' ? 'light' : 'dark';
  if (p?.densite === 'compacte') document.documentElement.dataset.densite = 'compacte';
} catch { /* thème du système */ }
