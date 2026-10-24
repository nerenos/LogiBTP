// Rechargement : copie de la page quittée affichée avant le chargement des modules (afficherApercu, module Navigation).
// Script externe (pas de script en ligne) : la politique de sécurité du contenu n'autorise que les scripts du domaine.
try {
  const a = JSON.parse(sessionStorage.getItem('logibtp.apercu'));
  if (a && a.url === location.pathname + location.search) {
    const el = document.createElement('div');
    el.className = 'page-apercu';
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = a.html;
    document.getElementById('pages').append(el);
  }
} catch { /* pas d'aperçu */ }
