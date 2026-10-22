// États d'exécution, règle répliquée dans ReglesEtats.cs (jeu modules/execution/tests/cas/01_etats.json) : état d'un
// ordre (statut documentaire + état d'exécution propre), état de chaque service d'un élément (chantier) d'après son
// parcours, ses ordres et les états imposés à la main (ANALYSE-MODULE-EXECUTION.md § 4).

/** États d'un service sur un élément, du moins au plus avancé. */
export const ETATS_SERVICE = {
  SANS_OBJET: { libelle: 'Sans objet', icone: '—' },
  A_VENIR: { libelle: 'À venir', icone: '⏳' },
  EN_ATTENTE: { libelle: 'En attente', icone: '🟡' },
  EN_COURS: { libelle: 'En cours', icone: '🔵' },
  BLOQUE: { libelle: 'Bloqué', icone: '⛔' },
  TERMINE: { libelle: 'Terminé', icone: '✅' },
};

/** États d'exécution propres à un ordre (ent_exe_etat). */
export const ETATS_ORDRE = ['A_FAIRE', 'EN_ATTENTE', 'EN_COURS', 'BLOQUE', 'TERMINE'];

/**
 * État d'un ordre : null s'il est annulé ou remplacé (ignoré) ; bloqué ; terminé (soldé ou terminé) ; en cours ;
 * à faire (brouillon) ; en attente ; un ordre transmis ou pris en charge sans état propre est en cours.
 */
export function etatOrdre(o) {
  if (['ANNULE', 'REMPLACE'].includes(o.statut)) return null;
  if (o.etat === 'BLOQUE') return 'BLOQUE';
  if (o.statut === 'SOLDE' || o.etat === 'TERMINE') return 'TERMINE';
  if (o.etat === 'EN_COURS') return 'EN_COURS';
  if (o.statut === 'BROUILLON') return 'A_FAIRE';
  if (o.etat === 'EN_ATTENTE') return 'EN_ATTENTE';
  return 'EN_COURS';
}

/** État automatique d'un service d'après ses ordres (non annulés) : null s'il n'en a aucun. */
function etatDesOrdres(etats) {
  if (!etats.length) return null;
  if (etats.includes('BLOQUE')) return 'BLOQUE';
  if (etats.every((e) => e === 'TERMINE')) return 'TERMINE';
  if (etats.some((e) => e === 'EN_COURS' || e === 'TERMINE')) return 'EN_COURS';
  return 'EN_ATTENTE';
}

/**
 * États des services d'un élément. Entrée : { etapes: [{ code, srv_id, amonts: [codes] }], ordres: [{ srv_id, statut, etat }],
 * manuels: [{ srv_id, etat }] }. Sortie : [{ srv_id, etat, automatique, manuel, ecart }] triée par service.
 * Règles : état manuel prioritaire (écart signalé) ; un service sans ordre et absent du parcours est sans objet ; ordres :
 * bloqué, sinon tous terminés, sinon en cours (un ordre en cours ou terminé), sinon en attente ; un service du parcours
 * sans ordre est à venir tant qu'un service amont (étapes amont de ses étapes, plusieurs pour une jonction) n'est pas
 * terminé (état retenu, manuel compris), en attente sinon. Une boucle d'amont est coupée.
 */
export function etatsServices({ etapes = [], ordres = [], manuels = [] }) {
  const services = new Set([...etapes.map((e) => e.srv_id), ...ordres.map((o) => o.srv_id), ...manuels.map((m) => m.srv_id)].filter((s) => s !== null && s !== undefined));
  const parCode = new Map(etapes.map((e) => [e.code, e]));
  const amont = (s) => new Set(etapes.filter((e) => e.srv_id === s).flatMap((e) => e.amonts ?? [])
    .filter((c) => parCode.has(c)).map((c) => parCode.get(c).srv_id).filter((x) => x !== s));
  const resultats = new Map();
  const enCours = new Set();
  const calculer = (s) => {
    if (resultats.has(s)) return resultats.get(s);
    if (enCours.has(s)) return null; // boucle
    enCours.add(s);
    const etatsOrdres = ordres.filter((o) => o.srv_id === s).map(etatOrdre).filter(Boolean);
    let automatique = etatDesOrdres(etatsOrdres);
    if (automatique === null) {
      if (!etapes.some((e) => e.srv_id === s)) automatique = 'SANS_OBJET';
      else {
        const amonts = [...amont(s)].map(calculer).filter(Boolean);
        automatique = amonts.every((a) => a.etat === 'TERMINE') ? 'EN_ATTENTE' : 'A_VENIR';
      }
    }
    const manuel = manuels.find((m) => m.srv_id === s)?.etat ?? null;
    const r = { srv_id: s, etat: manuel ?? automatique, automatique, manuel, ecart: manuel !== null && manuel !== automatique };
    enCours.delete(s);
    resultats.set(s, r);
    return r;
  };
  return [...services].sort((a, b) => a - b).map(calculer);
}

/** Contrôle d'un parcours : codes d'étape uniques et non vides, service obligatoire, amont connu, pas de boucle. */
export function controlerParcours(etapes) {
  const e = new Set();
  const codes = etapes.map((x) => x.code);
  if (codes.some((c) => !c)) e.add('PAR_CODE');
  if (new Set(codes).size !== codes.length) e.add('PAR_DOUBLON');
  if (etapes.some((x) => x.srv_id === null || x.srv_id === undefined)) e.add('PAR_SERVICE');
  if (etapes.some((x) => (x.amonts ?? []).some((a) => !codes.includes(a)))) e.add('PAR_AMONT');
  // Boucle : parcours en profondeur des amonts depuis chaque étape.
  const amonts = new Map(etapes.map((x) => [x.code, x.amonts ?? []]));
  const boucle = (c, chemin) => {
    if (chemin.has(c)) return true;
    chemin.add(c);
    const r = (amonts.get(c) ?? []).some((a) => boucle(a, chemin));
    chemin.delete(c);
    return r;
  };
  if (etapes.some((x) => boucle(x.code, new Set()))) e.add('PAR_BOUCLE');
  return [...e].sort();
}

export const MESSAGES_EXECUTION = {
  PAR_CODE: "Code d'étape obligatoire",
  PAR_DOUBLON: "Codes d'étape en double",
  PAR_SERVICE: 'Service obligatoire pour chaque étape',
  PAR_AMONT: 'Étape amont inconnue',
  PAR_BOUCLE: 'Parcours en boucle',
};
