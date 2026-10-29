import { echapper, creerCombo, confirmer, formatDateHeure, formatDate, ouvrirModale } from '@logibtp/socle/ui';
import { controlerConge, MESSAGES_CONGES, ETATS_CONGE, ETAT_CONGE } from '@logibtp/pointage';
import { api } from '../api.js';

// Congés et absences (module Pointage) : fenêtre commune de demande et de traitement, utilisée par la page des congés,
// la saisie des pointages et le clic droit du planning. La demande n'a pas de nature (commentaire libre) ; le service
// RH la valide en affectant la nature (liste modifiable : /parametres/pointage) ou la refuse.


/** Période lisible d'un congé (demi-journées aux bornes). */
export const periodeConge = (c) => (c.du === c.au
  ? `${formatDate(c.du)}${c.debut_midi ? ' après-midi' : c.fin_midi ? ' matin' : ''}`
  : `du ${formatDate(c.du)}${c.debut_midi ? ' après-midi' : ''} au ${formatDate(c.au)}${c.fin_midi ? ' midi' : ''}`);

/**
 * Pastille d'un congé : couleur de la nature (validé), contour pointillé tant qu'il est demandé ; libellé en bulle.
 * `natures` : liste ou dictionnaire par code.
 */
export function pastilleConge(c, natures = []) {
  const n = (Array.isArray(natures) ? natures.find((x) => x.code === c.nature) : natures[c.nature]) ?? null;
  const titre = `${n ? n.libelle : 'Congé'} — ${ETATS_CONGE[c.etat] ?? c.etat}${c.part === 0.5 ? ' (demi-journée)' : ''}`;
  return `<span class="pastille-conge etat-${String(c.etat).toLowerCase()}${c.part === 0.5 ? ' demi' : ''}" style="${n?.couleur ? `--couleur-conge: ${n.couleur}` : ''}" title="${echapper(titre)}">${echapper(n?.code ?? '?')}</span>`;
}

/**
 * Fenêtre de demande ou de traitement d'un congé. Options : conge (existant) ou valeurs initiales { salarie, du, au,
 * debut_midi, fin_midi, commentaire } ; salarieLibelle (salarié imposé) ou salaries ([{ id, libelle, detail }] : combo) ;
 * rh (validation, refus, nature) ; natures ; demandeur (affiché pour une nouvelle demande). Résout le congé enregistré,
 * ou null si rien n'a changé.
 */
export function ouvrirConge(app, { conge = null, initial = {}, salarieLibelle = null, salaries = null, rh = false, natures = [], demandeur = null }) {
  return new Promise((resoudre) => {
    const c = conge ?? { etat: 'DEMANDE', ...initial };
    const nouveau = !conge;
    const traitable = nouveau || c.etat === ETAT_CONGE.DEMANDE || (rh && c.etat === ETAT_CONGE.VALIDE);
    const actives = natures.filter((n) => n.actif || n.code === c.nature);
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogue-structure dialogue-conge';
    dlg.innerHTML = `<h3>🏖 ${nouveau ? 'Demande de congé' : `Congé — ${echapper(ETATS_CONGE[c.etat] ?? c.etat)}`}</h3>
      <div class="grille-champs">
        <label class="large"><span>Salarié</span>${salaries && nouveau ? '<span data-salarie></span>' : `<b>${echapper(salarieLibelle ?? (c.nom ? `${c.nom} ${c.prenom}` : `Salarié ${c.salarie}`))}</b>`}</label>
        <label><span>Du</span><input type="date" data-du value="${c.du ?? ''}" ${traitable ? '' : 'disabled'}></label>
        <label><span>Au</span><input type="date" data-au value="${c.au ?? c.du ?? ''}" ${traitable ? '' : 'disabled'}></label>
        <label><input type="checkbox" data-debut-midi ${c.debut_midi ? 'checked' : ''} ${traitable ? '' : 'disabled'}> Commence l'après-midi</label>
        <label><input type="checkbox" data-fin-midi ${c.fin_midi ? 'checked' : ''} ${traitable ? '' : 'disabled'}> Finit à midi</label>
        <label class="large"><span>Commentaire du demandeur (motif, précisions)</span><textarea data-commentaire rows="2" ${traitable ? '' : 'disabled'}>${echapper(c.commentaire ?? '')}</textarea></label>
      </div>
      ${rh ? `<fieldset><legend>Service RH</legend><div class="grille-champs">
        <label class="large"><span>Nature de l'absence (obligatoire pour valider)</span><span data-nature></span></label>
        <label class="large"><span>Réponse au demandeur</span><input type="text" data-reponse value="${echapper(c.reponse ?? '')}"></label></div></fieldset>`
        : c.nature ? `<p>Nature : ${pastilleConge(c, natures)} ${echapper(natures.find((n) => n.code === c.nature)?.libelle ?? c.nature)}</p>` : ''}
      <p class="aide">${nouveau ? `Demandé par ${echapper(demandeur ?? app.utilisateur?.() ?? '')} ; la nature sera affectée par le service RH à la validation.`
        : `Demandé par ${echapper(c.demande_par)} le ${formatDateHeure(c.demande_le)}${c.traite_par ? ` · traité par ${echapper(c.traite_par)} le ${formatDateHeure(c.traite_le)}` : ''}${c.jours != null ? ` · ${String(c.jours).replace('.', ',')} jour(s) décompté(s)` : ''}`}
        ${!rh && c.reponse ? `<br>Réponse : ${echapper(c.reponse)}` : ''}</p>
      <p class="erreur" data-erreur></p>
      <p class="boutons">
        ${traitable ? `<button type="button" data-enregistrer title="${nouveau ? 'Envoyer la demande au service RH' : 'Enregistrer les modifications'}">${nouveau ? '✉ Demander' : '💾 Enregistrer'}</button>` : ''}
        ${rh && (nouveau || c.etat === 'DEMANDE') ? '<button type="button" data-valider title="Valider avec la nature choisie">✅ Valider</button>' : ''}
        ${rh && !nouveau && c.etat === 'DEMANDE' ? '<button type="button" data-refuser title="Refuser la demande (réponse conseillée)">⛔ Refuser</button>' : ''}
        ${!nouveau && (c.etat === ETAT_CONGE.DEMANDE || (rh && c.etat === ETAT_CONGE.VALIDE)) ? '<button type="button" data-annuler title="Annuler ce congé">🗑 Annuler le congé</button>' : ''}
        <button type="button" data-fermer>Fermer</button></p>`;
    document.body.append(dlg);
    const q = (s) => dlg.querySelector(s);
    let comboSalarie = null;
    if (salaries && nouveau) {
      comboSalarie = creerCombo({ options: salaries.map((s) => ({ valeur: s.id, libelle: s.libelle, detail: s.detail })), valeur: c.salarie ?? '', vide: true, titre: 'Salarié' });
      q('[data-salarie]').append(comboSalarie);
    }
    let comboNature = null;
    if (rh) {
      comboNature = creerCombo({ options: actives.map((n) => ({ valeur: n.code, libelle: n.libelle, detail: n.code, couleur: n.couleur })), valeur: c.nature ?? '', vide: true, titre: 'Nature' });
      q('[data-nature]').append(comboNature);
    }
    const saisie = () => ({
      salarie: Number(comboSalarie ? comboSalarie.valeurCombo : c.salarie), du: q('[data-du]').value, au: q('[data-au]').value,
      debut_midi: q('[data-debut-midi]').checked, fin_midi: q('[data-fin-midi]').checked, commentaire: q('[data-commentaire]').value.trim() || null,
      version: c.version ?? null, nature: comboNature?.valeurCombo || null,
    });
    const erreur = (t) => { q('[data-erreur]').textContent = t ?? ''; };
    const controler = (s) => {
      if (!s.salarie) { erreur('Choisissez le salarié'); return false; }
      const codes = controlerConge({ id: c.id ?? null, ...s, etat: 'DEMANDE' }, []);
      if (codes.length) { erreur(codes.map((k) => MESSAGES_CONGES[k]).join(' · ')); return false; }
      return true;
    };
    let fini = false;
    const finir = (v) => { if (fini) return; fini = true; if (dlg.open) dlg.close(); dlg.remove(); resoudre(v); };
    const agir = async (f) => {
      erreur();
      dlg.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try { finir(await f()); } catch (e) { erreur(e.message); } finally { dlg.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    };
    dlg.addEventListener('close', () => finir(null));
    q('[data-fermer]').addEventListener('click', () => finir(null));
    q('[data-enregistrer]')?.addEventListener('click', () => {
      const s = saisie();
      if (!controler(s)) return;
      agir(() => (nouveau ? api.pointage.demanderConge(s) : api.pointage.modifierConge(c.id, s)));
    });
    q('[data-valider]')?.addEventListener('click', () => {
      const s = saisie();
      if (!controler(s)) return;
      if (!s.nature) { erreur(MESSAGES_CONGES.CNG_NATURE); return; }
      const reponse = q('[data-reponse]')?.value.trim() || null;
      agir(async () => {
        if (nouveau) return api.pointage.demanderConge({ ...s, valider: true });
        const m = await api.pointage.modifierConge(c.id, s);
        return api.pointage.traiterConge(c.id, 'valider', { version: m.version, nature: s.nature, reponse });
      });
    });
    q('[data-refuser]')?.addEventListener('click', () => {
      const reponse = q('[data-reponse]')?.value.trim() || null;
      agir(() => api.pointage.traiterConge(c.id, 'refuser', { version: c.version, reponse }));
    });
    q('[data-annuler]')?.addEventListener('click', async () => {
      if (!await confirmer('Annuler ce congé ?')) return;
      agir(() => api.pointage.traiterConge(c.id, 'annuler', { version: c.version, reponse: q('[data-reponse]')?.value.trim() || null }));
    });
    ouvrirModale(dlg, () => dlg.close());
    (comboSalarie ?? q('[data-du]')).focus();
  });
}
