// Thème choisi (Paramètres) appliqué avant l'affichage : pas d'éclair de l'autre thème au chargement.
// Script externe (pas de script en ligne) : la politique de sécurité du contenu n'autorise que les scripts du domaine.
try {
  const t = JSON.parse(localStorage.getItem('logibtp.navigation'))?.theme;
  if (t === 'clair' || t === 'sombre') document.documentElement.dataset.theme = t === 'clair' ? 'light' : 'dark';
} catch { /* thème du système */ }
