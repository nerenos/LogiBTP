import { echapper, creerCombo } from '@logibtp/socle/ui';
import { versMinutes, depuisMinutes } from '@logibtp/planning';
import { ecrireDuree } from '@logibtp/pointage';
import { api } from '../api.js';

// Planning (cœur) : ressources d'une tâche — affectations regroupées par équipe (copie de la composition appliquée :
// un membre retiré de la tâche ne quitte pas l'équipe ; changement de composition pendant la tâche proposé à
// l'utilisateur), ajout par une combo unique ou par la fenêtre de choix (disponibilités sur la période de la tâche,
// information seulement), onglet « Ressources » du panneau (ressources glissées sur une tâche).

export const TYPE_GLISSER_RESSOURCE = 'application/x-logibtp-planning-ressource';
export const TYPES_RESSOURCE = { SALARIE: 'Salarié', INTERIM: 'Intérimaire', MATERIEL: 'Matériel', SOUS_TRAITANT: 'Sous-traitant' };
const ETATS_DISPO = {
  LIBRE: { libelle: 'Libre', couleur: '#16a34a' }, PARTIEL: { libelle: 'Partiellement occupée', couleur: '#d97706' },
  OCCUPE: { libelle: 'Occupée', couleur: '#dc2626' }, ABSENT: { libelle: 'Absente', couleur: '#9333ea' },
  HORS: { libelle: 'Hors calendrier', couleur: '#98a2b3' }, SANS: { libelle: 'Sans capacité', couleur: '#98a2b3' },
};

const cleDe = (r) => `${r.type}:${r.id}`;
const jour = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const quand = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;

/** Bouton d'action d'une ligne (affiché au survol de la ligne). */
const action = (attr, icone, titre) => `<button type="button" class="bouton-icone" ${attr} title="${titre}" aria-label="${titre}">${icone}</button>`;

/** Combo unique de recherche et de choix d'une ressource (toutes les ressources, filtrées à la saisie). */
export function comboRessources(ressources, titre = 'Ajouter une ressource (saisir pour chercher)') {
  const c = creerCombo({
    options: ressources.map((r) => ({ valeur: cleDe(r), libelle: r.libelle, detail: r.service ?? TYPES_RESSOURCE[r.type] ?? r.type })),
    valeur: '', vide: true, titre,
  });
  c.placeholder = 'Ajouter une ressource…';
  return c;
}

/**
 * Ressources d'une tâche dans le détail : affectations (membres d'équipe sous leur équipe, ressources ajoutées à part),
 * membres retirés de la tâche (rajoutables), changement de composition à appliquer, ajout par combo, par équipe
 * (aperçu de la composition à la date de début) ou par la fenêtre de choix. `saisie()` : { affectations, equipes }.
 */
export class RessourcesTache {
  constructor(zone, { tache, ressources, equipes, debut, periode, appliquerEquipe, message }) {
    this.zone = zone;
    this.tache = tache;
    this.ressources = ressources;
    this.listeEquipes = equipes;
    this.debut = debut;
    this.periode = periode;
    this.appliquerEquipe = appliquerEquipe;
    this.message = message;
    this.affs = tache.affectations.map((a) => ({ ...a }));
    this.equipes = new Map((tache.equipes ?? []).map((e) => [e.id, { ...e, membres: e.membres.map((m) => m.cle), libelles: new Map(e.membres.map((m) => [m.cle, m.libelle])) }]));
    this.libelles = new Map(ressources.map((r) => [cleDe(r), r.libelle]));
    zone.innerHTML = `<ul class="liste-ressources-tache" data-affectations></ul>
      <div class="ligne ajout-ressource"><span data-ajout></span>${action('data-choisir', '☰', 'Choisir dans la liste des ressources (disponibilités sur la période de la tâche)')}</div>
      <div class="ligne ajout-ressource"><span data-equipe></span></div><div data-apercu-equipe></div>`;
    const ajout = comboRessources(ressources);
    zone.querySelector('[data-ajout]').append(ajout);
    ajout.addEventListener('change', () => {
      const v = ajout.valeurCombo;
      ajout.definirValeur('');
      if (v) this.ajouter(v);
    });
    this.comboEquipe = creerCombo({ options: equipes.map((e) => ({ valeur: e.id, libelle: e.libelle, detail: e.code })), valeur: '', vide: true, titre: 'Ajouter une équipe : composition à la date de début' });
    this.comboEquipe.placeholder = 'Ajouter une équipe…';
    zone.querySelector('[data-equipe]').append(this.comboEquipe);
    this.comboEquipe.addEventListener('change', () => this.#apercuEquipe(Number(this.comboEquipe.valeurCombo) || null));
    zone.querySelector('[data-choisir]').addEventListener('click', () => this.#choisir());
    this.rendre();
  }

  /** Ajoute une ressource à la main (sans équipe) ; jamais de doublon. */
  ajouter(cle, libelle) {
    if (this.affs.some((a) => cleDe(a) === cle)) { this.message?.('Ressource déjà affectée à la tâche'); return; }
    const i = cle.indexOf(':');
    this.affs.push({ type: cle.slice(0, i), id: cle.slice(i + 1), libelle: libelle ?? this.libelles.get(cle) ?? cle });
    this.rendre();
  }

  saisie() {
    return {
      affectations: this.affs.map((a) => ({ type: a.type, id: a.id, equipe_id: a.equipe_id ?? null, quantite: a.quantite ?? null })),
      equipes: Object.fromEntries([...this.equipes].map(([id, e]) => [id, { date: e.date, membres: e.membres }])),
    };
  }

  /** Première ressource à capacité (premier créneau libre). */
  premiere() { return this.affs.find((a) => a.type !== 'EQUIPE' && a.capacite !== false); }

  rendre() {
    const ul = this.zone.querySelector('[data-affectations]');
    const ligne = (a, i) => `<li class="ligne-ressource"><span class="lr-libelle">${echapper(a.libelle ?? this.libelles.get(cleDe(a)) ?? cleDe(a))}</span>
      ${a.heures ? `<span class="lr-info">${ecrireDuree(a.heures)} h</span>` : ''}<span class="lr-actions">${action(`data-retirer="${i}"`, '✕', 'Retirer de la tâche (l\'équipe n\'est pas modifiée)')}</span></li>`;
    const blocs = [];
    for (const [id, e] of this.equipes) {
      const membres = this.affs.map((a, i) => [a, i]).filter(([a]) => a.equipe_id === id);
      const presents = new Set(membres.map(([a]) => cleDe(a)));
      const retires = e.membres.filter((m) => !presents.has(m));
      const ch = e.changement;
      blocs.push(`<li class="ligne-equipe"><span class="lr-libelle">👥 <b>${echapper(e.libelle)}</b> <small class="aide">composition du ${jour(e.date)}</small></span>
          <span class="lr-actions">${action(`data-retirer-equipe="${id}"`, '✕', 'Retirer l\'équipe de la tâche')}</span></li>
        ${ch ? `<li class="changement-equipe">La composition change le ${jour(ch.date)} : ${ch.entrees.map((m) => `＋ ${echapper(m.libelle)}`).concat(ch.sorties.map((m) => `− ${echapper(m.libelle)}`)).join(', ')}
          ${this.tache.id ? `<button type="button" data-appliquer-equipe="${id}" data-date="${ch.date}">Mettre à jour la tâche</button>` : ''}</li>` : ''}
        ${membres.map(([a, i]) => ligne(a, i).replace('class="ligne-ressource"', 'class="ligne-ressource membre"')).join('')}
        ${retires.map((m) => `<li class="ligne-ressource membre retire"><span class="lr-libelle">${echapper(e.libelles?.get(m) ?? this.libelles.get(m) ?? m)}</span><span class="lr-info">retiré de la tâche</span>
          <span class="lr-actions">${action(`data-remettre="${id}|${m}"`, '↺', 'Remettre dans la tâche')}</span></li>`).join('')}`);
    }
    const seules = this.affs.map((a, i) => [a, i]).filter(([a]) => !a.equipe_id || !this.equipes.has(a.equipe_id));
    ul.innerHTML = blocs.join('') + seules.map(([a, i]) => ligne(a, i)).join('')
      || '<li class="aide">Aucune : tâche théorique (charge du service)</li>';
    ul.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { this.affs.splice(Number(b.dataset.retirer), 1); this.rendre(); }));
    ul.querySelectorAll('[data-retirer-equipe]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.retirerEquipe);
      this.affs = this.affs.filter((a) => a.equipe_id !== id);
      this.equipes.delete(id);
      this.rendre();
    }));
    ul.querySelectorAll('[data-remettre]').forEach((b) => b.addEventListener('click', () => {
      const [id, cle] = b.dataset.remettre.split('|');
      if (this.affs.some((a) => cleDe(a) === cle)) return;
      const i = cle.indexOf(':');
      this.affs.push({ type: cle.slice(0, i), id: cle.slice(i + 1), equipe_id: Number(id), libelle: this.equipes.get(Number(id))?.libelles?.get(cle) ?? this.libelles.get(cle) });
      this.rendre();
    }));
    ul.querySelectorAll('[data-appliquer-equipe]').forEach((b) => b.addEventListener('click', () => this.appliquerEquipe?.(Number(b.dataset.appliquerEquipe), b.dataset.date)));
  }

  /** Aperçu de la composition d'une équipe à la date de début : membres cochés à ajouter (les décochés restent dans l'équipe). */
  async #apercuEquipe(id) {
    const zone = this.zone.querySelector('[data-apercu-equipe]');
    if (!id) { zone.innerHTML = ''; return; }
    if (this.equipes.has(id)) { zone.innerHTML = '<p class="aide">Équipe déjà dans la tâche : retirer ou remettre ses membres ci-dessus.</p>'; return; }
    const date = (this.debut() || depuisMinutes(versMinutes(new Date().toISOString().slice(0, 10)))).slice(0, 10);
    let membres;
    try { membres = await api.planning.membresEquipe(id, date); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const equipe = this.listeEquipes.find((e) => e.id === id);
    zone.innerHTML = `<div class="apercu-equipe"><p><b>${echapper(equipe?.libelle ?? '')}</b> — composition au ${jour(date)}</p>
      ${membres.length ? `<ul>${membres.map((m) => {
        const deja = this.affs.some((a) => cleDe(a) === m.cle);
        return `<li><label><input type="checkbox" data-membre="${echapper(m.cle)}" ${deja ? 'disabled' : 'checked'}> ${echapper(m.libelle)}${deja ? ' <small class="aide">déjà affecté</small>' : ''}</label></li>`;
      }).join('')}</ul>` : '<p class="aide">Aucun membre à cette date.</p>'}
      <p class="ligne"><button type="button" data-ajouter-membres ${membres.length ? '' : 'disabled'}>＋ Ajouter à la tâche</button> <button type="button" data-annuler-equipe>Annuler</button></p></div>`;
    zone.querySelector('[data-annuler-equipe]').addEventListener('click', () => { zone.innerHTML = ''; this.comboEquipe.definirValeur(''); });
    zone.querySelector('[data-ajouter-membres]').addEventListener('click', () => {
      const coches = new Set([...zone.querySelectorAll('[data-membre]:checked')].map((x) => x.dataset.membre));
      this.equipes.set(id, { id, libelle: equipe?.libelle ?? `Équipe ${id}`, date, membres: membres.map((m) => m.cle), libelles: new Map(membres.map((m) => [m.cle, m.libelle])), changement: null });
      for (const m of membres) if (coches.has(m.cle) && !this.affs.some((a) => cleDe(a) === m.cle)) this.affs.push({ type: m.type, id: m.id, equipe_id: id, libelle: m.libelle });
      zone.innerHTML = '';
      this.comboEquipe.definirValeur('');
      this.rendre();
    });
  }

  /** Fenêtre de choix : sélection de départ = affectations ; décocher retire de la tâche, cocher ajoute (sans équipe). */
  async #choisir() {
    const p = await this.periode();
    const avant = new Set(this.affs.map(cleDe));
    const choix = await choisirRessources({ ...p, exclure: this.tache.id, selection: avant });
    if (!choix) return;
    this.affs = this.affs.filter((a) => choix.cles.has(cleDe(a)));
    for (const cle of choix.cles) if (!avant.has(cle)) this.ajouter(cle, choix.libelles.get(cle));
    this.rendre();
  }
}

/**
 * Fenêtre de choix des ressources sur une période : disponibilités (libre, partielle, occupée — tâches en cause —,
 * absente, hors calendrier ; information, jamais bloquant), filtres d'affichage (texte, service, type, disponibles,
 * sélectionnées : une ressource masquée garde son choix). Résout { cles, libelles } ou null (abandon).
 */
export async function choisirRessources({ du, au, exclure, selection }) {
  let liste;
  try { liste = await api.planning.disponibilites({ du, au, exclure: exclure ?? '' }); } catch (e) { alert(e.message); return null; }
  const choisies = new Set(selection);
  return new Promise((resoudre) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogue-structure dialogue-ressources';
    const services = [...new Map(liste.filter((r) => r.srv_id).map((r) => [r.srv_id, r.service])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const types = [...new Set(liste.map((r) => r.type))];
    dlg.innerHTML = `<h3>Ressources — du ${quand(du)} au ${quand(au)}</h3>
      <div class="ligne filtres-ressources"><input type="search" data-texte placeholder="Rechercher…"><span data-service></span><span data-type></span>
        <label><input type="checkbox" data-libres> Disponibles</label><label><input type="checkbox" data-choisies> Sélectionnées</label></div>
      <div class="tableau-defilant"><table class="tableau-compact pleine-largeur"><thead><tr><th><input type="checkbox" data-tout title="Cocher ou décocher les ressources affichées"></th><th>Ressource</th><th>Type</th><th>Service</th><th>Disponibilité sur la période</th></tr></thead><tbody></tbody></table></div>
      <p class="ligne"><span class="aide" data-compte></span><span class="espace"></span><button type="button" data-valider>Valider</button> <button type="button" data-abandon>Annuler</button></p>`;
    document.body.append(dlg);
    const service = creerCombo({ options: services.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: '', vide: true, titre: 'Service' });
    service.placeholder = 'Service';
    dlg.querySelector('[data-service]').append(service);
    const type = creerCombo({ options: types.map((t) => ({ valeur: t, libelle: TYPES_RESSOURCE[t] ?? t })), valeur: '', vide: true, titre: 'Type' });
    type.placeholder = 'Type';
    dlg.querySelector('[data-type]').append(type);
    const corps = dlg.querySelector('tbody');
    const visibles = () => {
      const t = dlg.querySelector('[data-texte]').value.trim().toLowerCase();
      return liste.filter((r) => (!t || `${r.libelle} ${r.service ?? ''}`.toLowerCase().includes(t))
        && (!service.valeurCombo || String(r.srv_id) === String(service.valeurCombo)) && (!type.valeurCombo || r.type === type.valeurCombo)
        && (!dlg.querySelector('[data-libres]').checked || r.etat === 'LIBRE' || r.etat === 'SANS')
        && (!dlg.querySelector('[data-choisies]').checked || choisies.has(r.cle)));
    };
    const compter = (v) => {
      const masquees = [...choisies].filter((c) => !v.some((r) => r.cle === c)).length;
      dlg.querySelector('[data-compte]').textContent = `${choisies.size} sélectionnée${choisies.size > 1 ? 's' : ''}${masquees ? ` (dont ${masquees} masquée${masquees > 1 ? 's' : ''} par les filtres)` : ''}`;
      const tout = dlg.querySelector('[data-tout]');
      tout.checked = v.length > 0 && v.every((r) => choisies.has(r.cle));
      tout.indeterminate = !tout.checked && v.some((r) => choisies.has(r.cle));
    };
    const dispo = (r) => {
      const e = ETATS_DISPO[r.etat] ?? ETATS_DISPO.HORS;
      const h = (m) => ecrireDuree(m) || '0:00';
      const texte = r.etat === 'PARTIEL' || r.etat === 'OCCUPE' ? `${e.libelle} ${h(r.occupe)} / ${h(r.travail)} h` : r.etat === 'LIBRE' ? `${e.libelle} (${h(r.travail)} h)` : e.libelle;
      const occ = r.occupations.map((o) => `${o.absence ? 'Absence' : echapper(o.libelle)} (${quand(o.debut)} → ${quand(o.fin)})`);
      return `<span class="pastille-dispo" style="background:${e.couleur}"></span> ${texte}${occ.length ? `<br><small class="aide">${occ.slice(0, 3).join(' · ')}${occ.length > 3 ? ` · +${occ.length - 3}` : ''}</small>` : ''}`;
    };
    const rendre = () => {
      const v = visibles();
      corps.innerHTML = v.slice(0, 500).map((r) => `<tr data-cle="${echapper(r.cle)}" class="cliquable${choisies.has(r.cle) ? ' selection' : ''}">
        <td><input type="checkbox" ${choisies.has(r.cle) ? 'checked' : ''}></td><td>${echapper(r.libelle)}</td><td>${echapper(TYPES_RESSOURCE[r.type] ?? r.type)}</td>
        <td>${echapper(r.service ?? '')}</td><td>${dispo(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="aide">Aucune ressource ne correspond aux filtres.</td></tr>';
      corps.querySelectorAll('tr[data-cle]').forEach((tr) => tr.addEventListener('click', (e) => {
        const c = tr.dataset.cle;
        if (choisies.has(c)) choisies.delete(c); else choisies.add(c);
        if (e.target.type !== 'checkbox') tr.querySelector('input').checked = choisies.has(c);
        tr.classList.toggle('selection', choisies.has(c));
        compter(v);
      }));
      compter(v);
    };
    dlg.querySelector('[data-tout]').addEventListener('change', (e) => { for (const r of visibles()) { if (e.target.checked) choisies.add(r.cle); else choisies.delete(r.cle); } rendre(); });
    dlg.querySelector('[data-texte]').addEventListener('input', rendre);
    for (const x of [service, type, dlg.querySelector('[data-libres]'), dlg.querySelector('[data-choisies]')]) x.addEventListener('change', rendre);
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(r);
    };
    dlg.addEventListener('close', () => finir(null));
    dlg.querySelector('[data-abandon]').addEventListener('click', () => finir(null));
    dlg.querySelector('[data-valider]').addEventListener('click', () => finir({ cles: new Set(choisies), libelles: new Map(liste.map((r) => [r.cle, r.libelle])) }));
    rendre();
    dlg.showModal();
    dlg.querySelector('[data-texte]').focus();
  });
}

/**
 * Onglet « Ressources » du panneau : recherche, service, type ; chaque ligne se glisse sur une tâche du planning
 * (ajout de la ressource et recalcul de la tâche).
 */
export function rendreOngletRessources(zone, ressources, services) {
  zone.innerHTML = `<div class="barre-aplanifier ligne"><input type="search" data-filtre placeholder="Rechercher une ressource…"><span data-service></span><span data-type></span></div>
    <p class="aide">Glisser une ressource sur une tâche : elle y est ajoutée et la tâche est recalculée.</p><div data-liste></div>`;
  const service = creerCombo({ options: services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), valeur: '', vide: true, titre: 'Service' });
  service.placeholder = 'Service';
  service.size = 10;
  zone.querySelector('[data-service]').append(service);
  const type = creerCombo({ options: Object.entries(TYPES_RESSOURCE).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: '', vide: true, titre: 'Type' });
  type.placeholder = 'Type';
  type.size = 9;
  zone.querySelector('[data-type]').append(type);
  const rendre = () => {
    const t = zone.querySelector('[data-filtre]').value.trim().toLowerCase();
    const l = ressources.filter((r) => (!t || `${r.libelle} ${r.service ?? ''}`.toLowerCase().includes(t))
      && (!service.valeurCombo || String(r.srv_id) === String(service.valeurCombo)) && (!type.valeurCombo || r.type === type.valeurCombo));
    const liste = zone.querySelector('[data-liste]');
    liste.innerHTML = l.length ? `<table class="tableau-compact pleine-largeur"><thead><tr><th>Ressource</th><th>Type</th><th>Service</th></tr></thead><tbody>
      ${l.slice(0, 500).map((r) => `<tr draggable="true" class="glissable" data-cle="${echapper(cleDe(r))}"><td>${echapper(r.libelle)}</td><td>${echapper(TYPES_RESSOURCE[r.type] ?? r.type)}</td><td>${echapper(r.service ?? '')}</td></tr>`).join('')}</tbody></table>
      ${l.length > 500 ? `<p class="aide">${l.length - 500} ressources de plus : préciser la recherche.</p>` : ''}` : '<p class="aide">Aucune ressource ne correspond.</p>';
    liste.querySelectorAll('tr[data-cle]').forEach((tr) => tr.addEventListener('dragstart', (e) => {
      const r = ressources.find((x) => cleDe(x) === tr.dataset.cle);
      e.dataTransfer.setData(TYPE_GLISSER_RESSOURCE, JSON.stringify({ type: r.type, id: r.id, libelle: r.libelle }));
      e.dataTransfer.effectAllowed = 'copy';
    }));
  };
  zone.querySelector('[data-filtre]').addEventListener('input', rendre);
  service.addEventListener('change', rendre);
  type.addEventListener('change', rendre);
  rendre();
}
