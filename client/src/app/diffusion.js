// Diffusion en temps réel du serveur (socle : GET /api/diffusion?sujets=, flux text/event-stream) : une connexion
// EventSource par ensemble de sujets, rouverte automatiquement par le navigateur ; `ecouter` renvoie la fonction de
// désabonnement (la connexion se ferme avec son dernier abonné).

const connexions = new Map();

/** Écoute un sujet (planning, crm…) : rappel({ sujet, donnees, le }) à chaque événement de la société. */
export function ecouter(sujet, rappel) {
  let c = connexions.get(sujet);
  if (!c) {
    c = { source: new EventSource(`/api/diffusion?sujets=${encodeURIComponent(sujet)}`), rappels: new Set() };
    c.source.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      for (const r of c.rappels) r(m);
    };
    connexions.set(sujet, c);
  }
  c.rappels.add(rappel);
  return () => {
    c.rappels.delete(rappel);
    if (!c.rappels.size) { c.source.close(); connexions.delete(sujet); }
  };
}
