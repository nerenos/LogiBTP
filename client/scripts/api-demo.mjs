// Client HTTP des scripts de démonstration : API sur 127.0.0.1:5080, société choisie par l'en-tête Host, cookies de
// la session (jeton d'accès, jeton de rafraîchissement rotatif) tous gardés et renvoyés.
import http from 'node:http';

/** Client de l'API pour cette société (`hote` : localhost, demo.localhost…) ; `entetes` : en-têtes de chaque appel. */
export function clientDemo(hote, entetes = {}) {
  const ENTETES = { 'Content-Type': 'application/json', ...entetes };
  const COOKIES = new Map();
  return function appel(methode, chemin, corps, extra = {}) {
    return new Promise((ok, ko) => {
      const donnees = corps === undefined ? null : JSON.stringify(corps);
      const req = http.request({ host: '127.0.0.1', port: 5080, path: `/api${chemin}`, method: methode,
        headers: { ...ENTETES, ...extra, Host: `${hote}:5080`, ...(donnees ? { 'Content-Length': Buffer.byteLength(donnees) } : {}) } }, (r) => {
        let t = '';
        r.on('data', (c) => { t += c; });
        r.on('end', () => {
          for (const c of r.headers['set-cookie'] ?? []) {
            const [nom, valeur] = c.split(';')[0].split('=');
            if (valeur) COOKIES.set(nom, valeur); else COOKIES.delete(nom);
          }
          if (COOKIES.size) ENTETES.Cookie = [...COOKIES].map(([k, v]) => `${k}=${v}`).join('; ');
          let j = null;
          try { j = t ? JSON.parse(t) : null; } catch { j = t; }
          if (r.statusCode >= 400) {
            ko(new Error(`${methode} ${chemin} → ${r.statusCode} ${j?.code ?? ''} ${j?.title ?? String(t).slice(0, 200)} ${JSON.stringify(j?.details ?? '').slice(0, 300)}`));
          } else ok(j);
        });
      });
      req.on('error', ko);
      if (donnees) req.write(donnees);
      req.end();
    });
  };
}
