// Historique d'entretiens réalisés de la démonstration (plan materiel-suites, lot 5, MO3) : fonction pure, sans écriture.
// Pour chaque plan d'entretien à périodicité en mois d'un matériel, le dernier entretien est placé de façon que les états
// se répartissent (à jour, à échéance proche, en retard) ; les entretiens antérieurs, à la périodicité du plan, sont
// ajoutés tant qu'ils tombent dans les 12 derniers mois. Dates ISO, relatives à `aujourdhui`.
import { ajouterJours, ajouterMois } from '@logibtp/socle';

export const MOIS_HISTORIQUE = 12;
export const ETATS_VISES = ['OK', 'A_PREVOIR', 'EN_RETARD'];

/**
 * `echeances` : lignes de GET /ressources/entretiens/echeances (materiel_id, plan_id, code, nature, mois…).
 * Renvoie les entretiens à enregistrer { materiel_id, plan_id, code, nature, date, vise }, par matériel puis date croissante.
 */
export function planifierEntretiensDemo(echeances, aujourdhui) {
  const plans = echeances.filter((e) => Number(e.mois) > 0)
    .sort((a, b) => a.materiel_id - b.materiel_id || a.plan_id - b.plan_id);
  const debut = ajouterMois(aujourdhui, -MOIS_HISTORIQUE);
  const r = [];
  plans.forEach((p, i) => {
    const mois = Number(p.mois);
    const vise = ETATS_VISES[i % ETATS_VISES.length];
    const echeance0 = ajouterMois(aujourdhui, -mois);
    // Dernier entretien : OK = échéance dans 70 % de la période ; A_PREVOIR = échéance dans 15 jours ; EN_RETARD = dépassée de 20 jours.
    let date = vise === 'OK' ? ajouterJours(aujourdhui, -Math.round(mois * 30 * 0.3))
      : vise === 'A_PREVOIR' ? ajouterJours(echeance0, 15) : ajouterJours(echeance0, -20);
    const faits = [];
    for (let k = 0; k < 24; k++) {
      // Le plus ancien manquant de la fenêtre reste utile pour un retard : le dernier est toujours gardé.
      if (k > 0 && date < debut) break;
      faits.push(date);
      date = ajouterMois(date, -mois);
    }
    for (const d of faits.reverse()) r.push({ materiel_id: p.materiel_id, plan_id: p.plan_id, code: p.code, nature: p.nature, date: d, vise });
  });
  return r;
}
