// Jeu de données de démonstration des modules Exécution, Planning, Pointage, CRM et Notifications, créé par l'API (règles,
// calculs, numérotation et contrôles réels) sur la base de démonstration : ordres d'exécution depuis les marchés, ordres
// de pose et demande d'approvisionnement, parcours ; planning (théorique depuis le parcours, ordres planifiés, équipes
// sur plusieurs semaines, absences, réunion répétitive, habilitation exigée, jalons) ; pointages des équipes sur les
// trois semaines passées et la semaine en cours (non-conformité, heures supplémentaires, formation, jour manquant),
// zones, synthèse validée, correction, demande de correction, export de paie, valorisation, borne et PIN ; tâches et
// action du CRM ; contrôles du centre de notifications. Dates relatives à aujourd'hui.
// L'API doit tourner (port 5080) avec les documents de démonstration (generer-documents-demo.mjs) déjà créés.
// Usage : node client/scripts/generer-modules-demo.mjs [host] [--force]   (host par défaut : demo.localhost)
// Session : LOGIBTP_COMPTE (administrateur, défaut gerant) et LOGIBTP_MDP ; sans mot de passe, connexion de test.
import http from 'node:http';

const hote = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'demo.localhost';
const force = process.argv.includes('--force');
const ENTETES = { 'Content-Type': 'application/json' };

function appel(methode, chemin, corps, entetes = {}) {
  return new Promise((ok, ko) => {
    const donnees = corps === undefined ? null : JSON.stringify(corps);
    const req = http.request({ host: '127.0.0.1', port: 5080, path: `/api${chemin}`, method: methode,
      headers: { ...ENTETES, ...entetes, Host: `${hote}:5080`, ...(donnees ? { 'Content-Length': Buffer.byteLength(donnees) } : {}) } }, (r) => {
      let t = '';
      r.on('data', (c) => { t += c; });
      r.on('end', () => {
        const cookie = (r.headers['set-cookie'] ?? []).find((c) => c.startsWith('logibtp_session='));
        if (cookie) ENTETES.Cookie = cookie.split(';')[0];
        let j = null;
        try { j = t ? JSON.parse(t) : null; } catch { j = t; }
        if (r.statusCode >= 400) ko(new Error(`${methode} ${chemin} → ${r.statusCode} ${j?.code ?? ''} ${j?.title ?? String(t).slice(0, 200)}`));
        else ok(j);
      });
    });
    req.on('error', ko);
    if (donnees) req.write(donnees);
    req.end();
  });
}

const compte = process.env.LOGIBTP_COMPTE ?? 'gerant';
await (process.env.LOGIBTP_MDP
  ? appel('POST', '/auth/connexion', { identifiant: compte, mot_de_passe: process.env.LOGIBTP_MDP })
  : appel('POST', '/auth/test/connexion', { identifiant: compte }));

const journal = [];
/** Étape tolérante : une erreur est notée et le jeu continue (données partielles plutôt qu'aucune). */
async function etape(libelle, f) {
  try {
    const r = await f();
    journal.push(`✔ ${libelle}${r !== undefined ? ` → ${r}` : ''}`);
    return r;
  } catch (e) {
    journal.push(`✘ ${libelle} : ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------- dates (relatives à aujourd'hui)
const iso = (d) => d.toISOString().slice(0, 10);
const aujourdhui = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const plus = (d, n) => new Date(d.getTime() + n * 86400000);
const lundi = plus(aujourdhui, -((aujourdhui.getUTCDay() + 6) % 7));
const semaine = (k) => plus(lundi, 7 * k);
const jour = (k, j) => iso(plus(semaine(k), j));

// ---------------------------------------------------------------- référentiels
const types = await appel('GET', '/types-document');
const tyd = (code) => types.find((t) => t.tyd_code === code)?.tyd_id;
const id = (rep) => rep?.document?.document?.ent_id ?? rep?.document?.ent_id ?? rep?.ent_id;
const services = await appel('GET', '/services');
const srv = (code) => services.find((s) => s.code === code)?.id;
const equipes = (await appel('GET', `/ressources/equipes?date=${iso(aujourdhui)}`)).filter((e) => e.actif && e.membres.length);
const refPointage = await appel('GET', '/pointage/referentiels');
const typeMo = (code) => refPointage.types_mo.find((t) => t.code === code)?.id ?? refPointage.types_mo[0]?.id;
const chantiers = { a: 2, b: 3, c: 5, formation: null };
const internes = await appel('GET', '/pointage/chantiers');
chantiers.formation = internes.find((c) => c.code === 'INT-FORMATION')?.id;
chantiers.atelier = internes.find((c) => c.code === 'INT-ATELIER')?.id;

const membres = [...new Map(equipes.slice(0, 4).flatMap((e, i) => e.membres.map((m) => [m.sal_id, { ...m, equipe: e, rang: i }]))).values()];
if (!membres.length) throw new Error('Aucune équipe avec des membres : données des ressources manquantes');

if (!force) {
  const deja = await appel('GET', `/pointage/semaine/${membres[0].sal_id}/${jour(-3, 0)}`);
  if (deja.pointages.length) {
    console.log('Données déjà générées (pointages présents) : relancer avec --force pour en ajouter.');
    process.exit(0);
  }
}

// ---------------------------------------------------------------- organisation : responsable du service, comptes
const chef = equipes[0].membres.find((m) => m.chef) ?? equipes[0].membres[0];
await etape('Responsable du service Chantier et compte du chef d\'équipe', async () => {
  const personnes = await appel('GET', `/auth/personnes?recherche=${encodeURIComponent(chef.nom)}`);
  const p = personnes.find((x) => !x.compte) ?? personnes[0];
  if (!p) return 'personne introuvable';
  const indId = p.personne?.id ?? p.id;
  const liste = services.map((s) => ({ id: s.id, code: s.code, libelle: s.libelle, parent_code: s.parent_code, nature: s.nature,
    responsable_id: s.code === 'CHANTIER' ? Number(indId) : s.responsable_id, ordre: s.ordre, actif: s.actif }));
  await appel('PUT', '/services', liste);
  if (!p.compte) await appel('POST', '/auth/comptes', { code: 'chef.chantier', type_element: 'individu', id_element: String(indId), profil: 'SAISIE' }).catch(() => null);
  return `${chef.nom} (compte chef.chantier : connexion de test en développement)`;
});

// ---------------------------------------------------------------- Exécution : ordres depuis les marchés, parcours
const motifs = await appel('GET', '/ressources/motifs?domaine=BLOCAGE').catch(() => []);
const ordres = {};
for (const [marche, cha, debut, fin] of [[1, chantiers.a, jour(0, 0), jour(6, 4)], [2, chantiers.b, jour(-2, 0), jour(4, 4)], [4, chantiers.c, jour(1, 0), jour(3, 4)]]) {
  const oe = await etape(`Ordre d'exécution du marché ${marche}`, async () => {
    const e = id(await appel('POST', `/structure/marches/${marche}/documents`, { type: 'E_OE' }));
    await appel('PUT', `/execution/documents/${e}`, { etat: 'EN_COURS', motif_id: null, commentaire: 'Démarrage selon le planning de démonstration',
      srv_id: srv('CHANTIER'), responsable_id: null, debut_prevu: debut, fin_prevue: fin });
    const c = await appel('GET', `/documents/${e}`);
    await appel('POST', `/documents/${e}/valider`, { ent_version: c.document.ent_version });
    return e;
  });
  ordres[marche] = { oe, cha };
  if (!oe) continue;
  ordres[marche].po = await etape(`Ordre de pose du marché ${marche}`, async () => {
    const po = id(await appel('POST', `/documents/${oe}/transformer`, { cible_tyd_id: tyd('E_PO'), lignes: [] }));
    const bloque = marche === 2;
    await appel('PUT', `/execution/documents/${po}`, { etat: bloque ? 'BLOQUE' : 'A_FAIRE', motif_id: bloque ? motifs[0]?.id ?? null : null,
      commentaire: bloque ? 'Plans d\'exécution non visés par le maître d\'œuvre' : null, srv_id: srv('POSE') ?? srv('CHANTIER'), responsable_id: null,
      debut_prevu: plus(new Date(`${debut}T00:00:00Z`), 7).toISOString().slice(0, 10), fin_prevue: fin });
    return po;
  });
}
if (ordres[4]?.po) {
  await etape('Ordre de pose validé et demande d\'approvisionnement (marché 4)', async () => {
    const c = await appel('GET', `/documents/${ordres[4].po}`);
    await appel('POST', `/documents/${ordres[4].po}/valider`, { ent_version: c.document.ent_version });
    return id(await appel('POST', `/documents/${ordres[4].po}/transformer`, { cible_tyd_id: tyd('E_DAP'), lignes: [] }));
  });
}
const modeles = await appel('GET', '/execution/parcours-modeles');
const modele = (code) => modeles.find((m) => m.code === code)?.id;
for (const [cha, code] of [[chantiers.a, 'MENUISERIE'], [chantiers.b, 'GROS_OEUVRE'], [chantiers.c, 'POSE']]) {
  await etape(`Parcours ${code} du chantier ${cha}`, () => appel('PUT', `/execution/elements/chantier/${cha}/parcours`, { pam_id: modele(code) }).then(() => 'ok'));
}
// Étapes des ordres (lot 2c) : lancement des ordres d'exécution validé (contrôlé pour le marché 1), une date imposée.
for (const [marche, { oe, po }] of Object.entries(ordres)) {
  if (!oe) continue;
  await etape(`Étapes de l'ordre d'exécution du marché ${marche}`, async () => {
    await appel('GET', `/execution/ordres/${oe}/etapes`);
    await appel('PUT', `/execution/ordres/${oe}/etapes/LANCEMENT`, { action: 'VALIDER', date: jour(0, 0) });
    if (marche === '1') await appel('PUT', `/execution/ordres/${oe}/etapes/LANCEMENT`, { action: 'CONTROLER', commentaire: 'Budget vérifié' });
    if (po) await appel('PUT', `/execution/ordres/${po}/etapes/POSE`, { action: 'PREVOIR', date: jour(1, 3) });
    return 'ok';
  });
}
await etape('État imposé : bureau d\'études en cours sur le chantier A', () =>
  appel('PUT', `/execution/elements/chantier/${chantiers.a}/services/${srv('BE')}/etat`, { etat: 'EN_COURS', motif: 'Plans en cours de reprise' }).then(() => 'ok'));

// ---------------------------------------------------------------- Planning
const T = (s) => appel('POST', '/planning/taches', s);
const base = (cha, srvId, libelle) => ({ nb_ressources: 1, srv_id: srvId, type_element: 'chantier', id_element: String(cha), libelle, affectations: [] });
await etape('Planning théorique du chantier A depuis son parcours', async () =>
  (await appel('POST', `/liaisons/chantiers/${chantiers.a}/planning-theorique`, { debut: `${jour(1, 0)}T08:00` })).taches.length + ' tâches');
for (const m of [2, 4]) if (ordres[m]?.oe) await etape(`Ordre du marché ${m} planifié`, async () => (await appel('POST', `/liaisons/ordres/${ordres[m].oe}/planifier`)).libelle);
// Équipes sur les chantiers, de la semaine -3 à +3 (rotation des chantiers).
const rotation = [chantiers.a, chantiers.b, chantiers.c];
const tachesEquipe = new Map();
for (let k = -3; k <= 3; k++) {
  for (const [i, e] of equipes.slice(0, 4).entries()) {
    const cha = rotation[(i + k + 6) % 3];
    const t = await etape(`Tâche de ${e.libelle}, semaine ${k}`, async () =>
      (await T({ ...base(cha, srv('POSE') ?? srv('CHANTIER'), `${e.libelle.replace('Équipe ', '')} — travaux`), calcul: 2, debut: `${jour(k, 0)}T08:00`, fin: `${jour(k, 4)}T17:00`,
        etat: k < 0 ? 'TERMINEE' : k === 0 ? 'EN_COURS' : 'CONFIRMEE', affectations: [{ type: 'EQUIPE', id: String(e.id) }] })).id);
    tachesEquipe.set(`${e.id}:${k}`, { tache: t, cha });
  }
}
// Absences, réunion répétitive, sur-occupation, habilitation exigée, dépendance, jalons.
const absent = membres[1];
await etape('Congés d\'un salarié (semaine +1)', async () => (await T({ ...base(null, null, 'Congés payés'), type_element: 'absence', id_element: null, calcul: 2,
  debut: `${jour(1, 0)}T00:00`, fin: `${jour(1, 5)}T00:00`, affectations: [{ type: 'SALARIE', id: String(absent.sal_id) }] })).id);
await etape('Réunion de chantier hebdomadaire (répétée 5 fois)', async () => {
  const r = await T({ ...base(chantiers.a, srv('CHANTIER'), 'Réunion de chantier'), calcul: 2, debut: `${jour(0, 1)}T09:00`, fin: `${jour(0, 1)}T10:00`,
    affectations: [{ type: 'SALARIE', id: String(chef.sal_id) }] });
  await appel('POST', `/planning/taches/${r.id}/repeter`, { frequence: 'SEMAINE', nombre: 5 });
  return r.id;
});
await etape('Intervention qui chevauche (sur-occupation signalée)', async () => (await T({ ...base(chantiers.c, srv('CHANTIER'), 'Dépannage urgent'), calcul: 2,
  debut: `${jour(0, 2)}T13:00`, fin: `${jour(0, 2)}T17:00`, affectations: [{ type: 'SALARIE', id: String(membres[0].sal_id) }] })).id);
const typesHab = (await appel('GET', '/planning/referentiels')).habilitations ?? [];
await etape('Travaux en hauteur (habilitation exigée)', async () => (await T({ ...base(chantiers.b, srv('CHANTIER'), 'Pose en façade — nacelle'), calcul: 2,
  debut: `${jour(2, 1)}T08:00`, fin: `${jour(2, 3)}T17:00`, habilitations: typesHab.slice(0, 1).map((h) => h.code),
  affectations: [{ type: 'EQUIPE', id: String(equipes[1].id) }] })).id);
await etape('Séchage puis peinture (dépendance de 2 jours ouvrés)', async () => {
  const chape = await T({ ...base(chantiers.b, srv('CHANTIER'), 'Coulage de la chape'), calcul: 2, debut: `${jour(1, 0)}T08:00`, fin: `${jour(1, 0)}T17:00`,
    affectations: [{ type: 'EQUIPE', id: String(equipes[0].id) }] });
  const peinture = await T({ ...base(chantiers.b, srv('CHANTIER'), 'Peinture des sols'), calcul: 2, debut: `${jour(1, 1)}T08:00`, fin: `${jour(1, 1)}T17:00`,
    affectations: [{ type: 'EQUIPE', id: String(equipes[3 % equipes.length].id) }] });
  await appel('PUT', `/planning/taches/${peinture.id}/dependances`, [{ de: chape.id, type: 'FD', decalage: 2, unite: 'OUV', mode: 'FIXE' }]);
  return `${chape.id} → ${peinture.id}`;
});
for (const [cha, quand, type, libelle] of [[chantiers.a, `${jour(2, 2)}T10:00`, 'LIVRAISON', 'Livraison des menuiseries'], [chantiers.b, `${jour(3, 4)}T15:00`, 'FIN_CHANTIER', 'Réception partielle du bâtiment']]) {
  await etape(`Jalon : ${libelle}`, async () => (await appel('POST', '/planning/jalons', { quand, type, libelle, type_element: 'chantier', id_element: String(cha) })).id);
}

// ---------------------------------------------------------------- Pointage
for (const [cha, zones] of [[chantiers.a, [['Lyon', 2], ['Grenoble', 4], ['Saint-Étienne', 3], ['Bourg-en-Bresse', 3]]], [chantiers.b, [['Lyon', 1], ['Grenoble', 5], ['Saint-Étienne', 4], ['Bourg-en-Bresse', 2]]],
  [chantiers.c, [['Lyon', 3], ['Grenoble', 3], ['Saint-Étienne', 2]]]]) {
  await etape(`Zones de déplacement du chantier ${cha}`, () => appel('PUT', `/pointage/zones/${cha}`, zones.map(([agence, zone]) => ({ agence, zone }))).then(() => 'ok'));
}
const nc = refPointage.sous_types.find((s) => s.non_conformite)?.code;
const passe = (k, j) => jour(k, j) < iso(aujourdhui);
for (const [n, m] of membres.entries()) {
  for (let k = -3; k <= 0; k++) {
    const pointages = [];
    for (let j = 0; j < 5; j++) {
      if (!passe(k, j)) continue;
      if (n === 2 && k === -1 && j === 3) continue; // jour sans pointage : exception de la synthèse
      const cha = tachesEquipe.get(`${m.equipe.id}:${k}`)?.cha ?? chantiers.a;
      const date = jour(k, j);
      if (n === 3 && k === -2 && j === 2) { pointages.push({ date, cha_id: chantiers.formation, type_mo: typeMo('MO_POSE'), sous_type: 'PREPARATION', minutes: 420, commentaire: 'Formation SST' }); continue; }
      const minutes = n === 0 && k === -2 ? 570 : j === 4 ? 360 : 420; // heures supplémentaires pour le premier, vendredi court
      pointages.push({ date, cha_id: cha, type_mo: typeMo('MO_POSE'), sous_type: 'PRODUCTION', minutes });
      if (j === 0) pointages.push({ date, cha_id: cha, type_mo: typeMo('MO_POSE'), sous_type: 'TRAJET', minutes: 30 });
      if (n === 1 && j === 1) pointages.push({ date, cha_id: cha, type_mo: typeMo('MO_POSE'), sous_type: nc, minutes: 60, motif: 'Problème de matériaux' });
    }
    if (pointages.length) await etape(`Pointages de ${m.nom}, semaine ${k}`, () => appel('PUT', `/pointage/semaine/${m.sal_id}/${jour(k, 0)}`, { pointages }).then(() => pointages.length));
  }
}
const ids = membres.map((m) => m.sal_id);
for (const k of [-3, -2]) await etape(`Validation RH de la semaine ${k}`, async () => (await appel('POST', '/pointage/synthese/valider', { salaries: ids, lundi: jour(k, 0) })).resultats.filter((r) => !r.codes.length).length + ' salariés');
await etape('Correction RH de la semaine -1 (couche validée)', async () => {
  const d = await appel('GET', `/pointage/synthese/semaine/${membres[0].sal_id}/${jour(-1, 0)}`);
  const pts = d.saisie.map((p) => ({ ...p, origine_id: p.id, id: null }));
  if (pts[0]) pts[0].minutes = 450;
  await appel('PUT', `/pointage/synthese/semaine/${membres[0].sal_id}/${jour(-1, 0)}`, { pointages: pts });
  return 'ok';
});
await etape('Demande de correction sur une semaine validée', async () => {
  const s = await appel('GET', `/pointage/semaine/${membres[1].sal_id}/${jour(-3, 0)}`);
  const pts = s.pointages.map((p) => ({ ...p }));
  if (pts[0]) pts[0].minutes += 60;
  return (await appel('POST', '/pointage/corrections', { salarie: membres[1].sal_id, lundi: jour(-3, 0), pointages: pts, motif: 'Heure oubliée le lundi (déchargement)' })).id;
});
await etape('Rubrique saisie : grand déplacement', () => appel('PUT', `/pointage/variables/${membres[4 % membres.length].sal_id}/${jour(-1, 0)}`,
  { valeurs: [{ date: jour(-1, 1), rubrique: 'GD', valeur: 1 }] }).then(() => 'ok').catch((e) => `profil sans GD (${e.message.slice(0, 40)})`));
await etape('Export de paie des semaines -3 et -2', async () => {
  const r = await appel('POST', '/pointage/export', { du: jour(-3, 0), au: jour(-2, 6), service: null });
  return `${r.salaries} salariés, ${r.lignes.length} lignes`;
});
await etape('Valorisation des heures (coût des fiches)', async () => {
  const r = await appel('POST', '/pointage/valoriser', { du: jour(-3, 0), au: iso(aujourdhui), service: null, mode: 'SALARIE', taux: null });
  return `${r.pointages} pointages, ${r.cout} €`;
});
await etape('Borne de l\'atelier et PIN de trois salariés (1234)', async () => {
  const b = await appel('POST', '/pointage/appareils', { libelle: 'Borne démo — chantier', service: srv('CHANTIER'), pin_exige: false });
  for (const m of membres.slice(0, 3)) await appel('PUT', `/pointage/pins/${m.sal_id}`, { pin: '1234' });
  return `jeton : ${b.jeton} (ouvrir /borne?jeton=…)`;
});

// ---------------------------------------------------------------- CRM et notifications
for (const [cha, objet, delai] of [[chantiers.a, 'Vérifier les cotes des menuiseries avant fabrication', 3], [chantiers.b, 'Relancer le maître d\'œuvre pour le visa des plans', 1],
  [chantiers.c, 'Organiser la livraison des échafaudages', 6]]) {
  await etape(`Tâche du CRM : ${objet}`, async () => (await appel('POST', '/crm/notes', { nature: 'TACHE', etat: 'A_FAIRE', tno_id: null, srv_id: srv('CHANTIER'), objet,
    message_html: null, responsable_id: null, echeance: `${iso(plus(aujourdhui, delai))}T16:00:00Z`, parent_id: null, prive: false, rgpd: false,
    dans_fil: false, liens: [{ type_element: 'chantier', id_element: String(cha), principal: true }], destinataires: [] })).id ?? 'ok');
}
await etape('Action du CRM : compte rendu de réunion', async () => (await appel('POST', '/crm/notes', { nature: 'ACTION', etat: 'TERMINE', tno_id: null, srv_id: null,
  objet: 'Réunion de chantier : avancement conforme, livraison des menuiseries confirmée', message_html: '<p>Présents : conducteur, chef d\'équipe, maître d\'œuvre.</p>',
  responsable_id: null, echeance: null, parent_id: null, prive: false, rgpd: false, dans_fil: true, liens: [{ type_element: 'chantier', id_element: String(chantiers.a), principal: true }],
  destinataires: [] })).id ?? 'ok');
await etape('Contrôles du centre de notifications', () => appel('POST', '/notifications/executer').then(() => 'ok'));

console.log(journal.join('\n'));
console.log(`\n${journal.filter((l) => l.startsWith('✔')).length} étapes réussies, ${journal.filter((l) => l.startsWith('✘')).length} en erreur.`);
