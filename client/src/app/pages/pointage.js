import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, actionDe, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import {
  controlerSemaine, MESSAGES_POINTAGE, lundiDe, joursSemaine, lireDuree, ecrireDuree,
  ETATS_VALIDATION, MESSAGES_VALIDATION, estBloque, UNITES_RUBRIQUE, SAISIES_RUBRIQUE, TYPES_REGLE, controlerProfil, MESSAGES_PAIE, ETATS_CONGE,
} from '@logibtp/pointage';
import { api } from '../api.js';
import { ouvrirConge, pastilleConge, periodeConge, dateCourte } from '../pointage/conges.js';

// Module Pointage : saisie au bureau (lot 1 : grille hebdomadaire d'un salarié, une ligne par chantier, ordre, type et
// sous-type de main-d'œuvre, une colonne par jour), synthèse et validation (lot 2 : couche validée, simple ou double
// validation, dévalidation avec motif, demandes de correction) et paramètres. Contrôles répliqués (controles.js ↔
// ReglesPointage.cs, validation.js ↔ ReglesValidation.cs) : erreurs refusées par le serveur, avertissements signalés.

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const decaler = (date, jours) => new Date(new Date(`${date}T00:00:00Z`).getTime() + jours * 86400000).toISOString().slice(0, 10);
const jourCourt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const horodatage = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const nomSalarie = (s, ordre) => (ordre === 'PN' ? `${s.prenom} ${s.nom}` : `${s.nom} ${s.prenom}`);
const cleLigne = (p) => [p.cha_id, p.ent_id ?? '', p.type_mo, p.sous_type ?? '', p.motif ?? ''].join('|');
/** État de validation d'un jour : pastille ronde de taille fixe, couleur par état (CSS `.pastille-etat`), libellé en bulle. */
const pastilleEtat = (e) => (ETATS_VALIDATION[e] ? `<span class="pastille-etat etat-${e.toLowerCase()}" title="${ETATS_VALIDATION[e].libelle}"></span>` : '');

/**
 * Lignes de la grille depuis les pointages : regroupement par chantier, ordre, type, sous-type et motif ; une case =
 * un pointage (plusieurs pointages le même jour sur la même ligne : case en lecture seule, valeurs gardées).
 */
function lignesDepuis(pointages, jours) {
  const lignes = new Map();
  for (const p of pointages) {
    const k = cleLigne(p);
    if (!lignes.has(k)) lignes.set(k, { cha_id: p.cha_id, ent_id: p.ent_id, type_mo: p.type_mo, sous_type: p.sous_type, motif: p.motif, cases: jours.map(() => []) });
    lignes.get(k).cases[jours.indexOf(p.date)].push({ ...p, minutes_origine: p.minutes });
  }
  return [...lignes.values()];
}

/** Pointages à envoyer depuis les lignes : une case modifiée remplace son pointage (plage effacée si la durée change). */
function pointagesDepuis(lignes, jours) {
  const r = [];
  for (const l of lignes) {
    l.cases.forEach((c, i) => {
      for (const p of c) {
        if (!p.minutes) continue;
        const plage = p.debut != null && p.minutes === p.minutes_origine;
        r.push({
          id: p.id ?? null, origine_id: p.origine_id ?? null, date: jours[i], cha_id: l.cha_id ?? null, ent_id: l.ent_id ?? null, type_mo: l.type_mo ?? null,
          sous_type: l.sous_type || null, minutes: p.minutes, debut: plage ? p.debut : null, fin: plage ? p.fin : null, motif: l.motif || null,
          commentaire: p.commentaire ?? null,
        });
      }
    });
  }
  return r;
}

/** Champs d'une ligne de la grille, dans l'ordre de la saisie au clavier. */
const CHAMPS_LIGNE = ['cha', 'ordre', 'type', 'st', 'motif', 'j0', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6'];

/**
 * Grille hebdomadaire d'un salarié (saisie ou couche validée) : combos chantier, ordre, type et sous-type, motif d'une
 * non-conformité, durées par jour, totaux, contrôles en direct. Jours verrouillés (validés) en lecture seule.
 * Mode tableau : Entrée passe à la case suivante (fin de ligne : ligne suivante ; fin du tableau : nouvelle ligne),
 * ↑ ↓ changent de ligne sur un jour, raccourcis du groupe `pointage` (raccourcis.js). Saisie en cascade : un choix
 * passe au champ suivant (chantier → ses ordres, lus au besoin → type de MO, proposé par le service de l'ordre →
 * sous-type → jours) ; une nouvelle ligne reprend chantier, ordre, type et sous-type de la ligne courante.
 * Options : ref (référentiels), chantiers (proposés), donnees { salarie, pointages, chantiers, ordres, recents },
 * lundi, lecture, verrouilles (index des jours), change() ; heuresDefaut() → Promise des minutes par défaut de chaque
 * jour (bouton « Compléter la ligne ») ; tableau (présentation `.tableau-compact`) ; regrouper
 * (lignes triées par chantier et ordre ; un groupe de plusieurs lignes a sa ligne de titre avec ses sous-totaux).
 */
class GrillePointage {
  #o;
  modifiee = false;

  constructor(zone, options) {
    this.zone = zone;
    this.#o = options;
    this.jours = joursSemaine(options.lundi);
    this.lignes = lignesDepuis(options.donnees.pointages, this.jours);
    if (options.regrouper) {
      // Tri stable par chantier puis ordre, dans l'ordre de première apparition.
      const rang = new Map();
      this.lignes.forEach((l) => { const k = `${l.cha_id}|${l.ent_id ?? ''}`; if (!rang.has(k)) rang.set(k, rang.size); });
      this.lignes = this.lignes.map((l, i) => ({ l, i })).sort((a, b) => rang.get(`${a.l.cha_id}|${a.l.ent_id ?? ''}`) - rang.get(`${b.l.cha_id}|${b.l.ent_id ?? ''}`) || a.i - b.i).map((x) => x.l);
    }
    this.#rendre();
  }

  pointages() { return pointagesDepuis(this.lignes, this.jours); }

  #options() {
    const d = this.#o.donnees;
    const chantiers = new Map([...this.#o.chantiers, ...(d.chantiers ?? [])].map((c) => [c.id, c]));
    const recents = new Set(d.recents ?? []);
    const ref = this.#o.ref;
    return {
      chantiers: [...chantiers.values()].sort((a, b) => Number(recents.has(b.id)) - Number(recents.has(a.id)))
        .map((c) => ({ valeur: c.id, libelle: `${c.code} ${c.libelle}`, detail: c.interne ? 'interne' : recents.has(c.id) ? 'récent' : c.clos ? 'clos' : '' })),
      clos: new Set([...chantiers.values()].filter((c) => c.clos).map((c) => c.id)),
      types: ref.types_mo.map((t) => ({ valeur: t.id, libelle: t.libelle, detail: t.code })),
      sousTypes: ref.sous_types.map((s) => ({ valeur: s.code, libelle: s.libelle })),
      nc: new Set(ref.sous_types.filter((s) => s.non_conformite).map((s) => s.code)),
    };
  }

  #controles(o) {
    const pointages = [];
    this.lignes.forEach((l, i) => l.cases.forEach((c, j) => c.forEach((p, k) => {
      if (p.minutes) {
        const plage = p.debut != null && p.minutes === p.minutes_origine;
        pointages.push({ cle: `${i}:${j}:${k}`, date: this.jours[j], cha_id: l.cha_id ?? null, type_mo: l.type_mo ?? null, minutes: p.minutes,
          debut: plage ? p.debut : null, fin: plage ? p.fin : null, non_conformite: o.nc.has(l.sous_type), motif: l.motif, chantier_clos: o.clos.has(l.cha_id) });
      }
    })));
    return controlerSemaine({ parametres: this.#o.ref.parametres, pointages });
  }

  #rendre() {
    const { zone, jours } = this;
    const o = this.#options();
    const lecture = Boolean(this.#o.lecture);
    const verrou = new Set(this.#o.verrouilles ?? []);
    const d = this.#o.donnees;
    // Tableau : chantier et ordre, type et sous-type sur deux lignes dans une même colonne (largeur réduite).
    const tableau = Boolean(this.#o.tableau);
    const nbDescr = tableau ? 2 : 5;
    zone.innerHTML = `<table class="grille-pointage${tableau ? ' tableau-compact' : ''}"><thead><tr>${tableau
      ? '<th>Chantier<br><small>ordre</small></th><th>Type de MO<br><small>sous-type (motif)</small></th>'
      : '<th>Chantier</th><th>Ordre</th><th>Type de MO</th><th>Sous-type</th><th>Motif</th>'}
        ${jours.map((x, i) => `<th class="nombre" data-jh="${i}"${verrou.has(i) ? ' title="Jour validé"' : ''}>${verrou.has(i) ? '🔒 ' : ''}${JOURS[i]}${tableau ? `<br><small>${jourCourt(x)}</small>` : ` ${jourCourt(x)}`}</th>`).join('')}<th class="nombre">Total</th><th></th></tr></thead><tbody></tbody>
        <tfoot><tr><th colspan="${nbDescr}">Total</th>${jours.map((_, i) => `<th class="nombre" data-total="${i}"></th>`).join('')}<th class="nombre" data-total="s"></th><th></th></tr></tfoot></table>
      ${lecture ? '' : `<p><button type="button" data-ajouter>＋ Ligne</button>${this.#o.heuresDefaut ? ` <button type="button" data-completer title="Compléter la ligne en cours (Ctrl+Maj+Entrée) : sur chaque jour travaillé non validé et vide, les heures par défaut du salarié (calendrier) moins les heures déjà saisies ce jour sur les autres lignes">⇥ Compléter la ligne</button>` : ''} <span class="aide">Durées au pas de ${this.#o.ref.parametres.pas_minutes} min : « 7:30 », « 7h30 » ou « 7,5 ».
        Entrée : case suivante · ↑ ↓ : ligne · Ctrl+Entrée : nouvelle ligne · Alt+Entrée : recopier jusqu'au vendredi · Ctrl+D : dupliquer (raccourcis personnalisables).</span></p>`}
      <div data-controles></div>`;
    const corps = zone.querySelector('tbody');
    const majTotaux = () => {
      const tot = jours.map((_, i) => this.lignes.reduce((a, l) => a + l.cases[i].reduce((b, p) => b + (p.minutes || 0), 0), 0));
      tot.forEach((t, i) => { zone.querySelector(`[data-total="${i}"]`).textContent = ecrireDuree(t); });
      zone.querySelector('[data-total="s"]').textContent = ecrireDuree(tot.reduce((a, b) => a + b, 0));
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        tr.querySelector('[data-total-ligne]').textContent = ecrireDuree(this.lignes[Number(tr.dataset.i)].cases.flat().reduce((a, p) => a + (p.minutes || 0), 0));
      });
      // Sous-totaux des groupes (chantier et ordre) : par jour et sur la semaine.
      corps.querySelectorAll('tr[data-groupe]').forEach((tr) => {
        const [de, a] = tr.dataset.groupe.split('-').map(Number);
        const membres = this.lignes.slice(de, a + 1);
        const parJour = jours.map((_, j) => membres.reduce((s, l) => s + l.cases[j].reduce((b, p) => b + (p.minutes || 0), 0), 0));
        tr.querySelectorAll('[data-sous-total]').forEach((td) => { td.textContent = ecrireDuree(parJour[Number(td.dataset.sousTotal)]) || ''; });
        tr.querySelector('[data-sous-total-semaine]').textContent = ecrireDuree(parJour.reduce((s, m) => s + m, 0));
      });
      const c = this.#controles(o);
      corps.querySelectorAll('td.erreur, td.avertissement').forEach((td) => td.classList.remove('erreur', 'avertissement'));
      for (const x of c.filter((y) => y.cle)) {
        const [i, j] = x.cle.split(':').map(Number);
        corps.querySelector(`tr[data-i="${i}"] td[data-j="${j}"]`)?.classList.add(x.niveau === 'ERREUR' ? 'erreur' : 'avertissement');
      }
      zone.querySelector('[data-controles]').innerHTML = c.length ? `<ul class="controles">${c.map((x) => `<li class="${x.niveau === 'ERREUR' ? 'erreur' : 'avertissement'}">${x.niveau === 'ERREUR' ? '⛔' : '⚠'} ${echapper(MESSAGES_POINTAGE[x.code] ?? x.code)}${x.date ? ` (${jourCourt(x.date)})` : ''}${x.cle ? ` — ${JOURS[Number(x.cle.split(':')[1])]}, ligne ${Number(x.cle.split(':')[0]) + 1}` : ''}</li>`).join('')}</ul>` : '';
    };
    const signaler = () => { this.modifiee = true; this.#o.change?.(); };
    const changer = () => { signaler(); majTotaux(); };
    const figee = (l) => lecture || l.cases.some((c, j) => verrou.has(j) && c.length);
    const ordresDe = (cha) => (d.ordres ?? []).filter((x) => x.cha_id === cha);
    const typeDuService = (srv) => this.#o.ref.types_mo.find((t) => t.srv_id === srv)?.id ?? null;
    /** Champ saisissable d'une ligne (null si absent, en lecture, sans option ou désactivé). */
    const champ = (i, c) => {
      const tr = corps.querySelector(`tr[data-i="${i}"]`);
      const el = tr?.querySelector(c.startsWith('j') ? `td[data-j="${c.slice(1)}"] input` : c === 'motif' ? '[data-motif]' : `[data-c="${c}"] input`);
      if (!el || el.disabled || el.readOnly) return null;
      if (c === 'ordre' && !ordresDe(this.lignes[i].cha_id).length) return null;
      return el;
    };
    const focaliser = (el) => { if (!el) return false; el.focus(); if (el.select && !el.classList.contains('combo')) el.select(); return true; };
    const premierChamp = (i, depuis = 0) => CHAMPS_LIGNE.slice(depuis).map((c) => champ(i, c)).find(Boolean) ?? null;
    /** Champ suivant (ou précédent) de la saisie ; au-delà de la dernière ligne : nouvelle ligne en cascade. */
    const suivant = (i, c, sens = 1) => {
      const k = CHAMPS_LIGNE.indexOf(c);
      if (sens > 0) {
        if (focaliser(premierChamp(i, k + 1))) return;
        if (i + 1 < this.lignes.length) { focaliser(premierChamp(i + 1)); return; }
        nouvelleLigne(i);
        return;
      }
      for (let x = k - 1; x >= 0; x--) if (focaliser(champ(i, CHAMPS_LIGNE[x]))) return;
      for (let y = i - 1; y >= 0; y--) for (let x = CHAMPS_LIGNE.length - 1; x >= 0; x--) if (focaliser(champ(y, CHAMPS_LIGNE[x]))) return;
    };
    /** Nouvelle ligne après la ligne i : chantier, ordre, type et sous-type repris (saisie en cascade), focus au chantier. */
    const nouvelleLigne = (i = this.lignes.length - 1, avecDurees = false) => {
      const prec = this.lignes[i];
      const typeService = typeDuService(d.salarie.srv_id);
      const l = { cha_id: prec?.cha_id ?? d.recents?.[0] ?? null, ent_id: prec?.ent_id ?? null, type_mo: prec?.type_mo ?? typeService ?? null,
        sous_type: prec?.sous_type ?? 'PRODUCTION', motif: avecDurees ? prec?.motif ?? null : null,
        cases: jours.map((_, j) => (avecDurees && !verrou.has(j) ? (prec?.cases[j] ?? []).filter((p) => p.minutes).slice(0, 1).map((p) => ({ minutes: p.minutes })) : [])) };
      this.lignes.splice(i + 1, 0, l);
      signaler();
      rendreLignes();
      focaliser(avecDurees ? premierChamp(i + 1, CHAMPS_LIGNE.indexOf('j0')) : premierChamp(i + 1));
    };
    /** Ordres d'un chantier lus au besoin (cascade : chantier choisi hors des ordres connus). */
    const chargerOrdres = async (cha) => {
      if (!cha || (d.ordres ?? []).some((x) => x.cha_id === cha) || this.ordresLus?.has(cha)) return false;
      (this.ordresLus ??= new Set()).add(cha);
      try { d.ordres = [...(d.ordres ?? []), ...(await api.pointage.ordresChantier(cha))]; } catch { return false; }
      return ordresDe(cha).length > 0;
    };
    const rendreLignes = () => {
      // Le champ actif est quitté avant d'être remplacé (sa liste de choix se ferme), sans effet sur les lignes.
      const actif = document.activeElement;
      if (actif && corps.contains(actif)) { this.enRendu = true; actif.blur(); this.enRendu = false; }
      // Groupes : suites de lignes du même chantier et du même ordre ; titre seulement pour plusieurs lignes.
      const cleGroupe = (l) => `${l.cha_id}|${l.ent_id ?? ''}`;
      const finGroupe = (i) => { let j = i; while (j + 1 < this.lignes.length && cleGroupe(this.lignes[j + 1]) === cleGroupe(this.lignes[i])) j++; return j; };
      const libelleGroupe = (l) => [o.chantiers.find((c) => String(c.valeur) === String(l.cha_id))?.libelle ?? 'Sans chantier',
        (d.ordres ?? []).find((x) => x.id === l.ent_id)?.numero].filter(Boolean).join(' · ');
      corps.innerHTML = this.lignes.map((l, i) => {
        const fige = figee(l);
        const debutGroupe = this.#o.regrouper && (i === 0 || cleGroupe(this.lignes[i - 1]) !== cleGroupe(l));
        const fin = debutGroupe ? finGroupe(i) : i;
        const dansGroupe = this.#o.regrouper && (fin > i || (i > 0 && cleGroupe(this.lignes[i - 1]) === cleGroupe(l)));
        const titre = debutGroupe && fin > i
          ? `<tr class="groupe-pointage" data-groupe="${i}-${fin}"><td colspan="${nbDescr}">▾ ${echapper(libelleGroupe(l))} <small>${fin - i + 1} lignes</small></td>
            ${jours.map((_, j) => `<td class="nombre" data-sous-total="${j}"></td>`).join('')}<td class="nombre" data-sous-total-semaine></td><td></td></tr>` : '';
        return `${titre}<tr data-i="${i}"${dansGroupe ? ' class="dans-groupe"' : ''}>${tableau
          ? `<td class="cellule-double"><div data-c="cha"></div><div data-c="ordre"></div></td><td class="cellule-double"><div data-c="type"></div><div data-c="st"></div>
            <div class="motif-pointage"><input data-motif placeholder="Motif de la non-conformité" value="${echapper(l.motif ?? '')}" ${!fige && o.nc.has(l.sous_type) ? '' : 'disabled'}></div></td>`
          : '<td data-c="cha"></td><td data-c="ordre"></td><td data-c="type"></td><td data-c="st"></td>'}
        ${tableau ? '' : `<td><input data-motif size="10" value="${echapper(l.motif ?? '')}" ${!fige && o.nc.has(l.sous_type) ? '' : 'disabled'}></td>`}
        ${l.cases.map((c, j) => `<td data-j="${j}"><input class="duree" size="5" value="${ecrireDuree(c.reduce((a, p) => a + (p.minutes || 0), 0))}" ${lecture || verrou.has(j) || c.length > 1 ? 'readonly' : ''} ${c.length > 1 ? 'title="Plusieurs pointages ce jour"' : c[0]?.debut != null ? `title="${ecrireDuree(c[0].debut)} – ${ecrireDuree(c[0].fin)}"` : ''}></td>`).join('')}
        <td class="nombre" data-total-ligne></td><td>${fige ? '' : '<button type="button" data-retirer title="Retirer la ligne (Ctrl+Suppr)" tabindex="-1">✕</button>'}</td></tr>`;
      }).join('');
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const i = Number(tr.dataset.i);
        const l = this.lignes[i];
        const fige = figee(l);
        const ordres = ordresDe(l.cha_id).map((x) => ({ valeur: x.id, libelle: x.numero ?? `#${x.id}`, detail: x.objet ?? x.type }));
        const combos = {
          cha: creerCombo({ options: o.chantiers, valeur: l.cha_id ?? '', vide: false, titre: 'Chantier' }),
          ordre: creerCombo({ options: ordres, valeur: l.ent_id ?? '', vide: true, titre: ordres.length ? 'Ordre (facultatif)' : 'Aucun ordre en cours sur ce chantier' }),
          type: creerCombo({ options: o.types, valeur: l.type_mo ?? '', vide: false, titre: 'Type de main-d\'œuvre' }),
          st: creerCombo({ options: o.sousTypes, valeur: l.sous_type ?? '', vide: true, titre: 'Sous-type' }),
        };
        // Tableau en lecture : libellés au lieu des combos (chantier et ordre portés par la ligne du groupe).
        if (lecture && this.#o.tableau) {
          const groupe = tr.classList.contains('dans-groupe');
          for (const [k, c] of Object.entries(combos)) tr.querySelector(`[data-c="${k}"]`).textContent = groupe && (k === 'cha' || k === 'ordre') ? '' : c.value;
          tr.querySelectorAll('input.duree').forEach((inp) => { inp.closest('td').textContent = inp.value; });
          const motif = tr.querySelector('[data-motif]');
          motif.parentElement.textContent = motif.value;
          return;
        }
        for (const [k, c] of Object.entries(combos)) { c.readOnly = fige || (k === 'ordre' && !ordres.length); tr.querySelector(`[data-c="${k}"]`).append(c); }
        if (fige) return;
        // Cascade : un choix passe au champ suivant (au clavier, Entrée s'en charge).
        const apres = (c) => { if (!this.parClavier) suivant(i, c); };
        // Chantier : ses ordres (lus au besoin), lignes refaites, puis champ suivant (même au clavier : enCascade).
        combos.cha.addEventListener('change', async () => {
          if (this.enRendu) return;
          this.enCascade = true;
          l.cha_id = combos.cha.valeurCombo ? Number(combos.cha.valeurCombo) : null;
          l.ent_id = null;
          signaler();
          try { await chargerOrdres(l.cha_id); } finally { this.enCascade = false; }
          rendreLignes();
          suivant(i, 'cha');
        });
        combos.ordre.addEventListener('change', () => {
          if (this.enRendu) return;
          l.ent_id = combos.ordre.valeurCombo ? Number(combos.ordre.valeurCombo) : null;
          const t = typeDuService((d.ordres ?? []).find((x) => x.id === l.ent_id)?.srv_id);
          if (t) { l.type_mo = t; combos.type.definirValeur(t); }
          changer();
          apres('ordre');
        });
        combos.type.addEventListener('change', () => { if (this.enRendu) return; l.type_mo = combos.type.valeurCombo ? Number(combos.type.valeurCombo) : null; changer(); apres('type'); });
        combos.st.addEventListener('change', () => {
          if (this.enRendu) return;
          l.sous_type = combos.st.valeurCombo || null;
          tr.querySelector('[data-motif]').disabled = !o.nc.has(l.sous_type);
          changer();
          apres('st');
        });
        tr.querySelector('[data-motif]').addEventListener('change', (e) => { if (this.enRendu) return; l.motif = e.target.value.trim() || null; changer(); });
        tr.querySelectorAll('td[data-j] input:not([readonly])').forEach((inp) => inp.addEventListener('change', () => {
          if (this.enRendu) return;
          const j = Number(inp.closest('td').dataset.j);
          const m = lireDuree(inp.value);
          if (m === null) { inp.classList.add('invalide'); return; }
          inp.classList.remove('invalide');
          const c = l.cases[j];
          if (m === c.reduce((a, x) => a + (x.minutes || 0), 0)) { inp.value = ecrireDuree(m); return; }
          if (c.length === 0 && m) c.push({ minutes: m });
          else if (c.length === 1) c[0].minutes = m;
          inp.value = ecrireDuree(m);
          changer();
        }));
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.lignes.splice(this.lignes.indexOf(l), 1); signaler(); rendreLignes(); });
      });
      majTotaux();
      // Tableau en lecture : samedi et dimanche masqués s'ils n'ont aucun pointage.
      if (lecture && this.#o.tableau) {
        for (const j of [5, 6].filter((x) => !this.lignes.some((l) => l.cases[x].some((p) => p.minutes)))) {
          zone.querySelectorAll(`[data-jh="${j}"], td[data-j="${j}"], [data-total="${j}"], [data-sous-total="${j}"]`).forEach((e) => { e.hidden = true; });
        }
      }
    };
    if (!lecture) {
      // Mode tableau : la touche est lue avant les combos (capture) pour que leur choix au clavier ne déplace pas deux fois.
      // Tab (déplacement natif) compte aussi : la cascade ne déplace pas le focus avant lui.
      corps.addEventListener('keydown', (e) => { this.parClavier = Boolean(actionDe(e, 'pointage')) || e.key === 'Tab'; }, true);
      corps.addEventListener('keydown', (e) => {
        const action = actionDe(e, 'pointage');
        this.parClavier = false;
        const el = e.target;
        const tr = el.closest?.('tr[data-i]');
        if (action === 'completerLigne' && tr) { e.preventDefault(); completer(Number(tr.dataset.i)); return; }
        if (!action || !tr || e.defaultPrevented) return;
        if (this.enCascade) { e.preventDefault(); return; }
        const i = Number(tr.dataset.i);
        const td = el.closest('td');
        const c = td?.dataset.j !== undefined ? `j${td.dataset.j}` : el.matches('[data-motif]') ? 'motif' : el.closest('[data-c]')?.dataset.c;
        if (!c) return;
        const l = this.lignes[i];
        const jour = c.startsWith('j') ? Number(c.slice(1)) : null;
        if (jour !== null && (action === 'caseSuivante' || action === 'casePrecedente' || action === 'recopierSemaine')) el.dispatchEvent(new Event('change'));
        if (action === 'caseSuivante') suivant(i, c, 1);
        else if (action === 'casePrecedente') suivant(i, c, -1);
        else if ((action === 'ligneDessus' || action === 'ligneDessous') && jour !== null) {
          el.dispatchEvent(new Event('change'));
          const autre = i + (action === 'ligneDessus' ? -1 : 1);
          if (!focaliser(champ(autre, c)) && action === 'ligneDessous' && autre >= this.lignes.length) nouvelleLigne(i);
        } else if (action === 'nouvelleLigne') nouvelleLigne(i);
        else if (action === 'dupliquer') nouvelleLigne(i, true);
        else if (action === 'recopierSemaine' && jour !== null && jour < 4) {
          const m = l.cases[jour].reduce((a, p) => a + (p.minutes || 0), 0);
          for (let j = jour + 1; j <= 4; j++) {
            const cj = l.cases[j];
            if (verrou.has(j) || cj.length > 1) continue;
            if (cj.length === 0 && m) cj.push({ minutes: m }); else if (cj.length === 1) cj[0].minutes = m;
          }
          changer();
          rendreLignes();
          focaliser(champ(i, 'j4'));
        } else if (action === 'supprimerLigne' && !figee(l)) {
          this.lignes.splice(i, 1);
          signaler();
          rendreLignes();
          focaliser(premierChamp(Math.min(i, this.lignes.length - 1), CHAMPS_LIGNE.indexOf(c)) ?? premierChamp(Math.min(i, this.lignes.length - 1)));
        } else return;
        e.preventDefault();
      });
    }
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => nouvelleLigne());
    /**
     * Compléter la ligne i (la ligne en cours, sinon la dernière ; une nouvelle s'il n'y en a pas) : chaque jour travaillé
     * (heures par défaut du salarié), non validé, dont la case est vide reçoit le reste du jour = heures par défaut − heures
     * déjà saisies ce jour sur les autres lignes (rien si le reste est nul ou négatif).
     */
    const completer = async (i = this.ligneCourante ?? this.lignes.length - 1) => {
      if (!this.#o.heuresDefaut) return;
      if (!this.lignes.length) { nouvelleLigne(-1); i = 0; }
      const l = this.lignes[Math.min(Math.max(i, 0), this.lignes.length - 1)];
      if (figee(l)) return;
      let defaut;
      try { defaut = await this.#o.heuresDefaut(); } catch { return; }
      let premier = null;
      jours.forEach((date, j) => {
        const c = l.cases[j];
        if (verrou.has(j) || c.length > 1 || c.some((p) => p.minutes)) return;
        const autres = this.lignes.filter((x) => x !== l).reduce((a, x) => a + x.cases[j].reduce((b, p) => b + (p.minutes || 0), 0), 0);
        const reste = (defaut[date] ?? 0) - autres;
        if (reste <= 0) return;
        if (c.length === 1) c[0].minutes = reste; else c.push({ minutes: reste });
        premier ??= j;
      });
      if (premier === null) { this.#o.message?.('Rien à compléter : jours non travaillés, validés, déjà saisis ou complets', 'info'); return; }
      changer();
      rendreLignes();
      focaliser(champ(this.lignes.indexOf(l), `j${premier}`));
    };
    zone.querySelector('[data-completer]')?.addEventListener('click', () => completer());
    // Ligne en cours : la dernière ligne où le focus est passé (bouton « Compléter la ligne »).
    corps.addEventListener('focusin', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) this.ligneCourante = Number(tr.dataset.i); });
    rendreLignes();
    /** Focus de départ : premier jour saisissable de la première ligne, sinon une nouvelle ligne (cascade). */
    this.commencer = () => {
      if (lecture) return;
      if (!this.lignes.length) { nouvelleLigne(-1); this.modifiee = false; this.#o.change?.(); return; }
      focaliser(premierChamp(0, CHAMPS_LIGNE.indexOf('j0')) ?? premierChamp(0));
    };
  }
}

/**
 * Présentation de référence du module (synthèse) : corps à panneau latéral. Panneau à gauche (barre : titre, filtres,
 * actions à droite et « pour réduire ; liste ; légende fixée en bas), séparateur à glisser (largeur), bouton 👥 quand il
 * est réduit, détail à droite. Préférences `<cle>Reduite` et `<cle>Largeur` (navigateur).
 */
function gabaritPanneau(cle, { titre, objet, filtres = '', actions = '' }) {
  const prefs = lirePreferences();
  const reduit = prefs[`${cle}Reduite`] ?? window.matchMedia('(max-width: 900px)').matches;
  return `<div class="corps-panneau${reduit ? ' panneau-reduit' : ''}" data-panneau="${cle}">
      <aside class="panneau-lateral" style="width: ${Number(prefs[`${cle}Largeur`]) || 560}px">
        <div class="panneau-lateral-barre"><b>${titre}</b> ${filtres}
          <span class="panneau-actions">${actions}<button type="button" class="bouton-icone" data-replier title="Réduire le panneau des ${objet}" aria-label="Réduire le panneau des ${objet}">«</button></span></div>
        <div data-corrections></div><div data-liste class="panneau-lateral-liste"></div><div class="panneau-legende" data-legende></div></aside>
      <div class="panneau-separateur" data-separateur title="Glisser pour élargir le panneau"></div>
      <button type="button" class="bouton-icone panneau-deplier" data-deplier title="Afficher le panneau des ${objet}" aria-label="Afficher le panneau des ${objet}">👥</button>
      <div data-detail class="panneau-detail"></div></div>`;
}

/** Comportement du panneau latéral : réduire / déplier, largeur au glisser du séparateur (préférences du navigateur). */
function brancherPanneau(conteneur) {
  const corps = conteneur.querySelector('[data-panneau]');
  const cle = corps.dataset.panneau;
  const panneau = corps.querySelector('.panneau-lateral');
  const reduire = (r) => { corps.classList.toggle('panneau-reduit', r); ecrirePreferences({ [`${cle}Reduite`]: r }); };
  corps.querySelector('[data-replier]').addEventListener('click', () => reduire(true));
  corps.querySelector('[data-deplier]').addEventListener('click', () => reduire(false));
  corps.querySelector('[data-separateur]').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const depart = e.clientX;
    const largeur = panneau.getBoundingClientRect().width;
    const bouger = (m) => { panneau.style.width = `${Math.max(280, Math.min(window.innerWidth - 320, largeur + m.clientX - depart))}px`; };
    const finir = () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', finir);
      ecrirePreferences({ [`${cle}Largeur`]: Math.round(panneau.getBoundingClientRect().width) });
    };
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', finir);
  });
}

/** Filtres communs des salariés : « Pointés » (masque les salariés sans pointage) et intérimaires (préférences `<cle>…`). */
const FILTRES_SALARIES = `<label title="Masquer les salariés sans pointage dans la semaine"><input type="checkbox" data-pointes> Pointés</label><span data-interim></span>`;

function brancherFiltresSalaries(conteneur, page, cle, rendre) {
  const prefs = lirePreferences();
  page.pointes = Boolean(prefs[`${cle}Pointes`]);
  const pointes = conteneur.querySelector('[data-pointes]');
  pointes.checked = page.pointes;
  pointes.addEventListener('change', () => { page.pointes = pointes.checked; ecrirePreferences({ [`${cle}Pointes`]: page.pointes }); rendre(); });
  page.interim = prefs[`${cle}Interim`] || 'TOUS';
  const filtre = creerCombo({ options: [{ valeur: 'TOUS', libelle: 'Tous' }, { valeur: 'SALARIES', libelle: 'Sans intérim' }, { valeur: 'INTERIM', libelle: 'Intérim seul' }],
    valeur: page.interim, vide: false, titre: 'Intérimaires' });
  filtre.addEventListener('change', () => { page.interim = filtre.valeurCombo; ecrirePreferences({ [`${cle}Interim`]: page.interim }); rendre(); });
  conteneur.querySelector('[data-interim]').append(filtre);
}

/** Salarié retenu par les filtres communs (intérimaires, pointés). */
const filtreSalarie = (page, salarie, jours) => (page.interim === 'INTERIM' ? salarie.interimaire : page.interim === 'SALARIES' ? !salarie.interimaire : true)
  && (!page.pointes || jours.some((m) => m > 0));

/** Jours affichés d'une liste de salariés : lundi à vendredi, samedi et dimanche s'ils ont des pointages. */
const joursAffiches = (lignes) => [0, 1, 2, 3, 4, 5, 6].filter((i) => i < 5 || lignes.some((l) => l.jours[i] > 0));

/** Barre de semaine commune (◀ date ▶, service, recherche) : appelle `changer` avec le nouveau lundi. */
function barreSemaine(conteneur, page, { changerSemaine, changerFiltre }) {
  const services = page.ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle, detail: s.code }));
  const srv = creerCombo({ options: services, valeur: page.service, vide: true, titre: 'Service' });
  conteneur.querySelector('[data-service]').append(srv);
  srv.addEventListener('change', () => { page.service = srv.valeurCombo; changerFiltre(); });
  const date = conteneur.querySelector('[data-date]');
  date.value = page.lundi;
  const aller = async (lundi) => { if (!(await changerSemaine(lundi))) date.value = page.lundi; };
  date.addEventListener('change', () => date.value && aller(lundiDe(date.value)));
  conteneur.querySelector('[data-prec]').addEventListener('click', () => { date.value = decaler(page.lundi, -7); aller(date.value); });
  conteneur.querySelector('[data-suiv]').addEventListener('click', () => { date.value = decaler(page.lundi, 7); aller(date.value); });
  conteneur.querySelector('[data-recherche]').addEventListener('change', (e) => { page.recherche = e.target.value; changerFiltre(); });
}

const BARRE = `<p class="ligne"><button type="button" data-prec title="Semaine précédente">◀</button> <input type="date" data-date>
  <button type="button" data-suiv title="Semaine suivante">▶</button> <span data-semaine class="aide"></span>
  · <span data-service></span> <input type="search" data-recherche placeholder="Salarié, matricule…"></p>`;

/** Saisie hebdomadaire au bureau : salariés du service avec leurs totaux, grille de la semaine du salarié choisi. */
export class PageSaisiePointage extends PageBase {
  icone = '⏱';

  get modifiee() { return Boolean(this.grille?.modifiee); }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ lundi: this.lundi, service: this.service, salarie: this.salarie }).filter(([, v]) => v));
    return `/pointage/saisie?${p}`;
  }

  async ouvrir() {
    this.titre = 'Saisie des pointages';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage page-avec-panneau"><div class="entete-page"><h1 class="page-titre">⏱ Saisie des pointages</h1>${BARRE}</div>
      ${gabaritPanneau('saisie', { titre: 'Salariés', objet: 'salariés', filtres: FILTRES_SALARIES })}</div>`;
    brancherPanneau(this.conteneur);
    brancherFiltresSalaries(this.conteneur, this, 'saisie', () => this.#rendreSalaries());
    this.conteneur.querySelector('[data-legende]').innerHTML = '<span class="aide">Heures saisies de la semaine · clic : grille du salarié · 🔒 jour validé (correction par demande au service RH)</span>';
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    if (this.requete.pointage) {
      const pos = await api.pointage.position(this.requete.pointage).catch(() => null);
      if (pos) Object.assign(this.requete, { salarie: String(pos.salarie), lundi: pos.lundi });
    }
    this.ref = await api.pointage.referentiels();
    this.chantiers = await api.pointage.chantiers();
    this.lundi = lundiDe(this.requete.lundi ?? aujourdhui());
    this.service = this.requete.service ?? '';
    this.salarie = this.requete.salarie ?? '';
    barreSemaine(this.conteneur, this, {
      changerSemaine: async (lundi) => {
        if (this.modifiee && !confirm('Abandonner les modifications de la semaine ?')) return false;
        this.lundi = lundi; this.#url(); await this.#chargerSalaries(); if (this.salarie) await this.#chargerSemaine();
        return true;
      },
      changerFiltre: () => { this.#url(); this.#chargerSalaries(); },
    });
    await this.#chargerSalaries();
    if (this.salarie) await this.#chargerSemaine();
  }

  #url() { this.app.routeur.remplacerUrl(this.urlCourante()); }

  async #chargerSalaries() {
    const jours = joursSemaine(this.lundi);
    this.conteneur.querySelector('[data-semaine]').textContent = `du ${jourCourt(jours[0])} au ${jourCourt(jours[6])}`;
    const zone = this.conteneur.querySelector('[data-liste]');
    if (!this.service && !this.recherche) { this.salaries = null; zone.innerHTML = '<p class="aide">Choisissez un service ou cherchez un salarié.</p>'; return; }
    try { this.salaries = await api.pointage.salaries({ service: this.service, recherche: this.recherche, lundi: this.lundi }); } catch (e) { this.app.erreur(e); return; }
    this.#rendreSalaries();
  }

  /** Salariés du panneau : tableau compact (nom et matricule, jour et date sur deux lignes), filtres communs. */
  #rendreSalaries() {
    const zone = this.conteneur.querySelector('[data-liste]');
    if (!this.salaries) return;
    const jours = joursSemaine(this.lundi);
    const ordre = this.ref.parametres.ordre_nom;
    const l = this.salaries.filter((x) => filtreSalarie(this, x.salarie, x.jours));
    const visibles = joursAffiches(this.salaries);
    const masques = this.salaries.length - l.length;
    zone.innerHTML = `${l.length ? `<table class="tableau-compact synthese-pointage"><thead><tr><th>Salarié<br><small>matricule</small></th>
      ${visibles.map((i) => `<th class="nombre">${JOURS[i]}<br><small>${jourCourt(jours[i])}</small></th>`).join('')}<th class="nombre">Total<br><small>semaine</small></th></tr></thead><tbody>
      ${l.map((x) => `<tr data-id="${x.salarie.id}" class="cliquable${String(x.salarie.id) === String(this.salarie) ? ' selection' : ''}">
        <td class="synthese-nom">${echapper(nomSalarie(x.salarie, ordre))}<br><small class="aide">${echapper(x.salarie.matricule)}${x.salarie.code ? ` · ${echapper(x.salarie.code)}` : ''}${x.salarie.interimaire ? ' · intérim' : ''}</small></td>
        ${visibles.map((i) => `<td class="nombre">${ecrireDuree(x.jours[i]) || '·'}</td>`).join('')}<td class="nombre"><b>${ecrireDuree(x.jours.reduce((a, b) => a + b, 0))}</b></td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucun salarié.</p>'}${masques ? `<p class="aide">${masques} salarié(s) masqué(s) par les filtres.</p>` : ''}`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
      if (this.modifiee && !confirm('Abandonner les modifications de la semaine ?')) return;
      this.salarie = tr.dataset.id; this.#url();
      zone.querySelectorAll('tr.selection').forEach((x) => x.classList.remove('selection'));
      tr.classList.add('selection');
      await this.#chargerSemaine();
    }));
  }

  async #chargerSemaine() {
    try { this.semaine = await api.pointage.semaine(this.salarie, this.lundi); } catch (e) { this.app.erreur(e); return; }
    this.#rendre();
  }

  /** Congés du salarié touchant la semaine et les huit suivantes (clic : ouvrir la demande). */
  async #rendreConges(zone) {
    try { this.conges = await api.pointage.conges({ salarie: this.salarie, du: this.lundi, au: decaler(this.lundi, 62) }); } catch (e) { zone.innerHTML = `<p class="aide">${echapper(e.message)}</p>`; return; }
    const l = this.conges.conges.filter((c) => c.etat === 'DEMANDE' || c.etat === 'VALIDE');
    zone.innerHTML = l.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Période</th><th class="nombre">Jours</th><th>Nature<br><small>état</small></th><th>Commentaire</th></tr></thead><tbody>
      ${l.map((c) => `<tr class="cliquable" data-id="${c.id}"><td>${periodeConge(c)}</td><td class="nombre">${String(c.jours).replace('.', ',')}</td>
        <td>${pastilleConge(c, this.conges.natures)} ${echapper(c.etat === 'VALIDE' ? (this.conges.natures.find((n) => n.code === c.nature)?.libelle ?? c.nature) : 'à valider')}</td><td>${echapper(c.commentaire ?? '')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="aide">Aucun congé demandé ou validé sur la semaine et les huit suivantes.</p>';
    zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
      const r = await ouvrirConge(this.app, { conge: l.find((c) => String(c.id) === tr.dataset.id), rh: this.conges.rh, natures: this.conges.natures });
      if (r) this.#rendreConges(zone);
    }));
  }

  #rendre() {
    const s = this.semaine;
    const zone = this.conteneur.querySelector('[data-detail]');
    const verrouilles = s.etats.map((e, i) => (estBloque(e) ? i : -1)).filter((i) => i >= 0);
    zone.innerHTML = `<h2>${echapper(nomSalarie(s.salarie, this.ref.parametres.ordre_nom))} <small class="aide">${echapper(s.salarie.matricule)}${s.salarie.service ? ` · ${echapper(s.salarie.service)}` : ''}</small>
        <span class="pastilles-etats">${(s.etats ?? []).map(pastilleEtat).join('')}</span></h2>
      ${verrouilles.length ? '<p class="avertissement">🔒 Jours validés : non modifiables ici ; une correction s\'envoie au service RH.</p>' : ''}
      ${s.corrigee ? '<p class="avertissement">Cette semaine a été corrigée dans la synthèse : les corrections du service RH priment.</p>' : ''}
      <div class="titre-actions"><h3>Pointages de la semaine</h3>
        <span class="titre-actions-boutons"><button type="button" data-enregistrer title="Enregistrer la semaine">💾 Enregistrer</button>${verrouilles.length ? ' <button type="button" data-correction title="Envoyer la semaine au service RH comme demande de correction">✉ Demander une correction…</button>' : ''}</span></div>
      <div data-grille></div>
      <div class="titre-actions"><h3>🏖 Congés</h3><span class="titre-actions-boutons"><button type="button" data-conge title="Demander un congé pour ce salarié (validé ensuite par le service RH)">＋ Demander un congé…</button></span></div>
      <div data-conges><p class="aide">…</p></div>
      ${[...new Set(s.pointages.filter((x) => x.groupe).map((x) => x.groupe))].map((g) => `<p class="aide">👥 Saisie d'équipe : <a href="/pointage/groupe?id=${g}">voir et modifier le groupe</a></p>`).join('')}
      ${s.corrections.length ? `<h3>Demandes de correction</h3><table class="tableau-compact largeur-contenu"><thead><tr><th>Le</th><th>État</th><th>Motif</th><th>Réponse</th></tr></thead><tbody>
        ${s.corrections.map((c) => `<tr><td>${horodatage(c.le)}</td><td>${echapper({ EN_ATTENTE: 'en attente', APPLIQUEE: 'appliquée', REJETEE: 'rejetée' }[c.etat])}</td><td>${echapper(c.motif ?? '')}</td><td>${echapper(c.reponse ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
    // Heures par défaut du salarié : journées de son calendrier de travail (fériés et fermetures compris), lues une fois par semaine.
    const heuresDefaut = () => {
      const jours = joursSemaine(this.lundi);
      this.journees ??= api.calendriers.journeesRessource('salarie', s.salarie.id, jours[0], jours[6])
        .then((l) => Object.fromEntries(l.map((x) => [String(x.date).slice(0, 10), x.fermee?.length ? 0 : x.minutes])))
        .catch((e) => { this.journees = null; throw e; });
      return this.journees;
    };
    this.journees = null;
    this.grille = new GrillePointage(zone.querySelector('[data-grille]'), { ref: this.ref, chantiers: this.chantiers, donnees: s, lundi: this.lundi, verrouilles, tableau: true, regrouper: true,
      heuresDefaut, message: (t, n) => this.app.message(t, n) });
    this.grille.commencer?.();
    const correction = async () => {
      const motif = prompt('Motif de la demande de correction (envoyée au service RH) :');
      if (motif === null) return;
      try {
        await api.pointage.demanderCorrection({ salarie: Number(this.salarie), lundi: this.lundi, pointages: this.grille.pointages(), motif });
        this.app.message('Demande de correction envoyée au service RH', 'succes');
        await this.#chargerSemaine();
      } catch (e) { this.app.erreur(e); }
    };
    zone.querySelector('[data-correction]')?.addEventListener('click', correction);
    this.#rendreConges(zone.querySelector('[data-conges]'));
    zone.querySelector('[data-conge]').addEventListener('click', async () => {
      const r = await ouvrirConge(this.app, { initial: { salarie: s.salarie.id, du: this.lundi, au: this.lundi }, salarieLibelle: nomSalarie(s.salarie, this.ref.parametres.ordre_nom),
        rh: this.conges?.rh, natures: this.conges?.natures ?? [] });
      if (r) { this.app.message('Congé enregistré', 'succes'); this.#rendreConges(zone.querySelector('[data-conges]')); }
    });
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      try {
        this.semaine = await api.pointage.enregistrerSemaine(this.salarie, this.lundi, { pointages: this.grille.pointages() });
        this.#rendre();
        this.app.message('Semaine enregistrée', 'succes');
        this.#chargerSalaries();
      } catch (e) {
        if (e.code === 'POI_VALIDE' && confirm(`${e.message}\n\nEnvoyer la semaine au service RH comme demande de correction ?`)) await correction();
        else this.app.erreur(e);
      }
    });
  }
}

/**
 * Synthèse MO (lot 2) : salariés d'un service avec heures retenues, état de chaque jour et exceptions (par défaut seuls
 * les salariés à examiner, « Tout voir » ; filtre des intérimaires), validation de la sélection ou de tout ce qui est
 * sans exception, dévalidation avec motif, demandes de correction, détail d'une semaine (saisie et couche validée
 * modifiable). Les salariés sont dans un panneau à gauche, réductible et redimensionnable (préférences
 * `syntheseReduite`, `syntheseLargeur`, `syntheseInterim`) : tableau compact (titres et cases sur deux lignes, en-têtes
 * figés au défilement) ; samedi et dimanche affichés seulement s'ils ont des pointages (liste et variables de paie).
 */
export class PageSynthesePointage extends PageBase {
  icone = '✅';

  get modifiee() { return Boolean(this.grille?.modifiee); }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ lundi: this.lundi, service: this.service, salarie: this.salarie, tout: this.tout ? '1' : '' }).filter(([, v]) => v));
    return `/pointage/synthese?${p}`;
  }

  async ouvrir() {
    this.titre = 'Synthèse des pointages';
    // Actions de validation : icônes (libellé dans la bulle) avec le nombre de salariés concernés en pastille.
    const action = (cle, icone, titre) => `<button type="button" class="bouton-icone bouton-compteur" data-${cle} title="${titre}" aria-label="${titre}">${icone}<span class="pastille-compteur" data-compteur="${cle}"></span></button>`;
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage page-avec-panneau"><div class="entete-page"><h1 class="page-titre">✅ Synthèse des pointages</h1>${BARRE}</div>
      ${gabaritPanneau('synthese', {
    titre: 'Salariés', objet: 'salariés',
    filtres: `<label title="Aussi les salariés sans exception"><input type="checkbox" data-tout> Tout voir</label>${FILTRES_SALARIES}`,
    actions: `${action('valider', '☑', 'Valider la sélection')}${action('tout-valider', '✅', 'Tout valider sans exception')}${action('devalider', '↩', 'Dévalider la sélection… (motif demandé)')}`,
  })}</div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-liste]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    brancherPanneau(this.conteneur);
    brancherFiltresSalaries(this.conteneur, this, 'synthese', () => this.#rendreListe());
    this.ref = await api.pointage.referentiels();
    this.chantiers = await api.pointage.chantiers();
    this.lundi = lundiDe(this.requete.lundi ?? decaler(aujourdhui(), -7));
    this.service = this.requete.service ?? '';
    this.salarie = this.requete.salarie ?? '';
    this.tout = this.requete.tout === '1';
    this.selection = new Set();
    const c = this.conteneur;
    c.querySelector('[data-tout]').checked = this.tout;
    c.querySelector('[data-tout]').addEventListener('change', (e) => { this.tout = e.target.checked; this.#url(); this.#rendreListe(); });
    // Blocage à la journée : période de validation sur la ligne de la semaine.
    if (this.ref.parametres.blocage === 'JOUR') {
      c.querySelector('.entete-page > p.ligne').insertAdjacentHTML('beforeend', ' · <span class="aide">Période validée :</span> <input type="date" data-du> au <input type="date" data-au>');
    }
    barreSemaine(c, this, {
      changerSemaine: async (lundi) => {
        if (this.modifiee && !confirm('Abandonner les corrections en cours ?')) return false;
        this.lundi = lundi; this.salarie = ''; this.#url(); await this.#charger();
        return true;
      },
      changerFiltre: () => { this.#url(); this.#charger(); },
    });
    c.querySelector('[data-valider]').addEventListener('click', () => this.#agir('valider', [...this.selection]));
    c.querySelector('[data-devalider]').addEventListener('click', () => this.#agir('devalider', [...this.selection]));
    c.querySelector('[data-tout-valider]').addEventListener('click', () => this.#agir('valider', this.#sansException().map((l) => l.salarie.id)));
    await this.#charger();
  }

  #url() { this.app.routeur.remplacerUrl(this.urlCourante()); }

  /** Pastilles des actions : salariés sélectionnés (valider, dévalider), sans exception (tout valider) ; boutons désactivés à zéro. */
  #compteurs() {
    const n = { valider: this.selection.size, devalider: this.selection.size, 'tout-valider': this.#sansException().length };
    for (const [cle, v] of Object.entries(n)) {
      const b = this.conteneur.querySelector(`[data-${cle}]`);
      b.disabled = !v;
      b.querySelector('[data-compteur]').textContent = v ? String(v) : '';
    }
  }

  /** Jours affichés : lundi à vendredi, samedi et dimanche s'ils ont des pointages (un salarié au moins). */
  #joursVisibles() { return joursAffiches(this.donnees?.lignes ?? []); }

  #periode() {
    const du = this.conteneur.querySelector('[data-du]')?.value || null;
    const au = this.conteneur.querySelector('[data-au]')?.value || null;
    return { du, au };
  }

  #sansException() {
    return (this.donnees?.lignes ?? []).filter((l) => !l.exceptions.length && l.etats.some((e) => e !== 'VALIDE') && (this.donnees.rh || l.chef));
  }

  async #agir(action, salaries) {
    if (!salaries.length) { this.app.message('Aucun salarié sélectionné', 'avertissement'); return; }
    let motif = null;
    if (action === 'devalider') {
      motif = prompt('Motif de la dévalidation (tracé) :');
      if (motif === null) return;
    }
    try {
      const r = await api.pointage[action]({ salaries, lundi: this.lundi, ...this.#periode(), motif });
      const refus = r.resultats.filter((x) => x.codes.length);
      const faits = r.resultats.length - refus.length;
      this.app.message(`${faits} salarié(s) ${action === 'valider' ? 'validé(s)' : 'dévalidé(s)'} (niveau ${r.role})${refus.length ? ` · ${refus.length} refus : ${[...new Set(refus.flatMap((x) => x.codes))].map((x) => MESSAGES_VALIDATION[x] ?? x).join(', ')}` : ''}`,
        refus.length ? 'avertissement' : 'succes');
      if (r.resultats.some((x) => x.apres_export)) this.app.message('Dévalidation après un export de paie : un export correctif sera à faire (tracé au journal).', 'avertissement');
      this.selection.clear();
      await this.#charger();
    } catch (e) { this.app.erreur(e); }
  }

  async #charger() {
    const jours = joursSemaine(this.lundi);
    this.conteneur.querySelector('[data-semaine]').textContent = `du ${jourCourt(jours[0])} au ${jourCourt(jours[6])}`;
    try { this.donnees = await api.pointage.synthese({ service: this.service, recherche: this.recherche, lundi: this.lundi }); } catch (e) { this.app.erreur(e); return; }
    this.#rendreCorrections();
    this.#rendreListe();
    if (this.salarie) await this.#chargerDetail();
    else this.conteneur.querySelector('[data-detail]').innerHTML = '';
  }

  #nom(id) {
    const l = this.donnees.lignes.find((x) => x.salarie.id === id);
    return l ? nomSalarie(l.salarie, this.ref.parametres.ordre_nom) : `Salarié ${id}`;
  }

  #rendreCorrections() {
    const zone = this.conteneur.querySelector('[data-corrections]');
    const l = this.donnees.corrections;
    zone.innerHTML = l.length ? `<h2>Demandes de correction (${l.length})</h2><ul>${l.map((c) => `<li>${echapper(this.#nom(c.salarie))} — ${horodatage(c.le)} par ${echapper(c.par)}${c.motif ? ` : ${echapper(c.motif)}` : ''}
      <button type="button" data-voir="${c.salarie}">Voir</button></li>`).join('')}</ul>` : '';
    zone.querySelectorAll('[data-voir]').forEach((b) => b.addEventListener('click', () => this.#ouvrir(b.dataset.voir)));
  }

  #rendreListe() {
    const zone = this.conteneur.querySelector('[data-liste]');
    const d = this.donnees;
    const interim = (l) => filtreSalarie(this, l.salarie, l.jours);
    const lignes = d.lignes.filter((l) => interim(l) && (this.tout || l.exceptions.length || String(l.salarie.id) === String(this.salarie)));
    const sans = this.#sansException();
    this.#compteurs();
    const masques = d.lignes.filter(interim).length - lignes.length;
    const jours = joursSemaine(this.lundi);
    const visibles = this.#joursVisibles();
    zone.innerHTML = `${d.lignes.length ? '' : '<p class="aide">Aucun salarié (choisissez un service ; un chef de service ne voit que ses salariés).</p>'}
      ${lignes.length ? `<table class="tableau-compact synthese-pointage"><thead><tr><th><input type="checkbox" data-tous title="Tout sélectionner"></th><th>Salarié<br><small>matricule</small></th>
        ${visibles.map((i) => `<th class="nombre">${JOURS[i]}<br><small>${jourCourt(jours[i])}</small></th>`).join('')}<th class="nombre">Total<br><small>semaine</small></th><th class="synthese-exceptions">À examiner</th></tr></thead><tbody>
        ${lignes.map((l) => `<tr data-id="${l.salarie.id}" class="cliquable${String(l.salarie.id) === String(this.salarie) ? ' selection' : ''}">
          <td><input type="checkbox" data-choix ${this.selection.has(l.salarie.id) ? 'checked' : ''} ${d.rh || l.chef ? '' : 'disabled'}></td>
          <td class="synthese-nom">${echapper(nomSalarie(l.salarie, this.ref.parametres.ordre_nom))}${l.corrigee ? ' <span title="Corrigé dans la synthèse">✎</span>' : ''}
            <br><small class="aide">${echapper(l.salarie.matricule)}${l.salarie.code ? ` · ${echapper(l.salarie.code)}` : ''}${l.salarie.interimaire ? ' · intérim' : ''}</small></td>
          ${visibles.map((i) => `<td class="nombre etat-${l.etats[i].toLowerCase()}" title="${echapper(ETATS_VALIDATION[l.etats[i]].libelle)}">${(l.absences?.[i] ?? []).map((a) => pastilleConge(a, d.natures)).join('')}${ecrireDuree(l.jours[i]) || '·'}<br>${pastilleEtat(l.etats[i])}</td>`).join('')}
          <td class="nombre"><b>${ecrireDuree(l.jours.reduce((a, b) => a + b, 0))}</b></td>
          <td class="synthese-exceptions">${l.exceptions.map((x) => `<span class="badge-exception" title="${echapper(MESSAGES_VALIDATION[x])}">${echapper(MESSAGES_VALIDATION[x])}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${masques ? `<p class="aide">${masques} salarié(s) sans exception masqué(s) (« Tout voir »).</p>` : ''}`;
    // Légende, fixée en bas du panneau : couleur de chaque état, mode de validation et niveau de l'utilisateur.
    this.conteneur.querySelector('[data-legende]').innerHTML = `${Object.keys(ETATS_VALIDATION).map((e) => `<span>${pastilleEtat(e)} ${echapper(ETATS_VALIDATION[e].libelle)}</span>`).join('')}
      <span class="aide">Validation ${this.ref.parametres.validation === 'DOUBLE' ? 'double (chef puis RH)' : 'simple (RH)'} · vous validez au niveau ${d.rh ? 'RH' : 'chef de service'}
        · 🏖 congé : pastille de la nature, en pointillés tant qu'il est demandé (<a href="/pointage/conges">congés</a>)</span>`;
    zone.querySelector('[data-tous]')?.addEventListener('change', (e) => {
      for (const l of lignes) if (d.rh || l.chef) { if (e.target.checked) this.selection.add(l.salarie.id); else this.selection.delete(l.salarie.id); }
      this.#rendreListe();
    });
    zone.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.querySelector('[data-choix]').addEventListener('click', (e) => { e.stopPropagation(); if (e.target.checked) this.selection.add(id); else this.selection.delete(id); this.#compteurs(); });
      tr.addEventListener('click', () => this.#ouvrir(id));
    });
  }

  async #ouvrir(id) {
    if (this.modifiee && !confirm('Abandonner les corrections en cours ?')) return;
    this.salarie = String(id);
    this.#url();
    this.conteneur.querySelectorAll('.synthese-pointage tr.selection').forEach((x) => x.classList.remove('selection'));
    this.conteneur.querySelector(`.synthese-pointage tr[data-id="${id}"]`)?.classList.add('selection');
    await this.#chargerDetail();
  }

  async #chargerDetail() {
    try { this.detail = await api.pointage.detailSynthese(this.salarie, this.lundi); } catch (e) { this.app.erreur(e); return; }
    this.#rendreDetail();
  }

  #rendreDetail() {
    const d = this.detail;
    const zone = this.conteneur.querySelector('[data-detail]');
    const valideRh = d.etats.includes('VALIDE');
    const modifiable = !valideRh && (d.rh || !d.etats.includes('VALIDE_CHEF'));
    const base = d.valide ?? d.saisie.map((p) => ({ ...p, origine_id: p.id, id: null }));
    // Un seul bouton : semaine validée à mon niveau (RH : validation RH ; chef : la sienne ou celle du RH) → dévalider, sinon valider.
    const validee = d.etats.some((e) => e === 'VALIDE' || (!d.rh && e === 'VALIDE_CHEF'));
    zone.innerHTML = `<h2>${echapper(nomSalarie(d.salarie, this.ref.parametres.ordre_nom))} <small class="aide">${echapper(d.salarie.matricule)} · <span class="pastilles-etats">${d.etats.map(pastilleEtat).join('')}</span></small></h2>
      ${d.corrections.filter((c) => c.etat === 'EN_ATTENTE').map((c) => `<div class="correction-attente"><b>Demande de correction</b> de ${echapper(c.par)} le ${horodatage(c.le)}${c.motif ? ` : ${echapper(c.motif)}` : ''}
        ${d.rh ? `<button type="button" data-appliquer="${c.id}">Appliquer</button> <button type="button" data-rejeter="${c.id}">Rejeter…</button>` : ''}
        <div data-correction="${c.id}"></div></div>`).join('')}
      <div class="titre-actions"><h3>${d.corrigee ? 'Couche validée (corrigée)' : 'Pointages retenus (saisie)'}${modifiable ? '' : ' <small class="aide">— semaine validée : dévalider pour corriger</small>'}</h3>
        <span class="titre-actions-boutons">${modifiable ? `<button type="button" data-enregistrer title="Enregistrer les corrections de la semaine (couche validée)">💾 Enregistrer</button>${d.corrigee ? ' <button type="button" data-retablir title="Abandonner la couche validée et revenir aux pointages saisis">⟲ Revenir à la saisie</button>' : ''}` : ''}
        ${validee ? '<button type="button" data-devalider-un title="Dévalider la semaine de ce salarié (motif demandé)">↩ Dévalider…</button>'
          : '<button type="button" data-valider-un title="Valider la semaine de ce salarié">☑ Valider</button>'}</span></div>
      <div data-grille-valide></div>
      ${d.corrigee ? '<details><summary>Saisie d\'origine</summary><div data-grille-saisie></div></details>' : ''}
      <div data-paie></div>
      ${d.validations.length ? `<h3>Validations</h3><ul>${d.validations.map((v) => `<li>${v.niveau === 'RH' ? 'RH' : 'Chef'} du ${jourCourt(v.du)} au ${jourCourt(v.au)} par ${echapper(v.par)} le ${horodatage(v.le)}${v.annule_le ? ` — <s>annulée</s> par ${echapper(v.annule_par)} le ${horodatage(v.annule_le)} : ${echapper(v.annule_motif ?? '')}` : ''}</li>`).join('')}</ul>` : ''}
      ${d.journal.length ? `<details><summary>Journal (${d.journal.length})</summary><ul>${d.journal.map((j) => `<li>${horodatage(j.le)} ${echapper(j.action)} par ${echapper(j.par)}</li>`).join('')}</ul></details>` : ''}`;
    const donnees = (pointages) => ({ salarie: d.salarie, pointages, chantiers: d.chantiers, ordres: d.ordres, recents: [] });
    this.grille = new GrillePointage(zone.querySelector('[data-grille-valide]'), { ref: this.ref, chantiers: this.chantiers, donnees: donnees(base), lundi: this.lundi, lecture: !modifiable, tableau: true, regrouper: true });
    if (d.corrigee) new GrillePointage(zone.querySelector('[data-grille-saisie]'), { ref: this.ref, chantiers: this.chantiers, donnees: donnees(d.saisie), lundi: this.lundi, lecture: true, tableau: true, regrouper: true });
    for (const c of d.corrections.filter((x) => x.etat === 'EN_ATTENTE')) {
      new GrillePointage(zone.querySelector(`[data-correction="${c.id}"]`), { ref: this.ref, chantiers: this.chantiers, donnees: donnees(c.pointages), lundi: this.lundi, lecture: true });
    }
    const apres = async (promesse, message) => {
      try { this.detail = await promesse; this.grille = null; this.app.message(message, 'succes'); await this.#charger(); } catch (e) { this.app.erreur(e); }
    };
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', () => apres(api.pointage.enregistrerSynthese(this.salarie, this.lundi, { pointages: this.grille.pointages() }), 'Corrections enregistrées'));
    zone.querySelector('[data-retablir]')?.addEventListener('click', () => confirm('Abandonner la couche validée et revenir aux pointages saisis ?')
      && apres(api.pointage.retablirSynthese(this.salarie, this.lundi), 'Retour à la saisie'));
    zone.querySelector('[data-valider-un]')?.addEventListener('click', () => this.#agir('valider', [Number(this.salarie)]));
    zone.querySelector('[data-devalider-un]')?.addEventListener('click', () => this.#agir('devalider', [Number(this.salarie)]));
    zone.querySelectorAll('[data-appliquer]').forEach((b) => b.addEventListener('click', () => apres(api.pointage.appliquerCorrection(b.dataset.appliquer, {}), 'Correction appliquée')));
    zone.querySelectorAll('[data-rejeter]').forEach((b) => b.addEventListener('click', () => {
      const reponse = prompt('Réponse au demandeur :');
      if (reponse !== null) apres(api.pointage.rejeterCorrection(b.dataset.rejeter, { reponse }), 'Correction rejetée');
    }));
    this.#rendrePaie(zone.querySelector('[data-paie]'), modifiable);
  }

  /**
   * Variables de paie de la semaine (profil du salarié) : une ligne par rubrique, valeur par jour, semaine (heures
   * supplémentaires) et total ; rubriques saisies (S) ou modifiables (SC) en cases éditables ; zones des chantiers.
   */
  async #rendrePaie(zone, modifiable) {
    let v;
    try { v = await api.pointage.variables(this.salarie, this.lundi); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!v.profil) { zone.innerHTML = '<p class="aide">Aucun profil de paie : variables non calculées.</p>'; return; }
    const jours = joursSemaine(this.lundi);
    const visibles = this.#joursVisibles();
    const saisies = new Map(v.saisies.map((s) => [`${s.date}|${s.rubrique}`, s.valeur]));
    const valeurJour = (code, i) => v.variables?.jours[i]?.valeurs[code];
    const affiche = (r, x) => (x == null || x === 0 ? '' : r.unite === 'H' ? ecrireDuree(x) : String(x));
    const total = (r) => (r.unite === 'ZONE'
      ? Object.entries(v.variables?.totaux ?? {}).filter(([k]) => k.startsWith(`${r.code}_`)).map(([k, n]) => `Z${k.slice(r.code.length + 1)} × ${n}`).join(', ')
      : affiche(r, v.variables?.totaux[r.code]));
    zone.innerHTML = `<h3>Variables de paie <small class="aide">${echapper(v.profil.libelle)}${v.profil.export ? '' : ' (non exportées)'}</small></h3>
      <table class="tableau-compact variables-paie"><thead><tr><th>Rubrique</th>${visibles.map((i) => `<th class="nombre">${JOURS[i]}<br><small>${jourCourt(jours[i])}</small></th>`).join('')}<th class="nombre">Semaine</th><th class="nombre">Total</th></tr></thead><tbody>
      ${v.rubriques.map((r) => `<tr><td title="${echapper(SAISIES_RUBRIQUE[r.saisie])}${r.code_paie ? ` · paie ${echapper(r.code_paie)}` : ''}">${echapper(r.libelle)} <small class="aide">${echapper(r.code)}</small></td>
        ${visibles.map((i) => [jours[i], i]).map(([x, i]) => (r.saisie !== 'C' && modifiable
          ? `<td><input class="duree" data-rub="${echapper(r.code)}" data-jour="${x}" data-unite="${r.unite}" size="4" value="${saisies.has(`${x}|${r.code}`) ? affiche(r, saisies.get(`${x}|${r.code}`)) || '0' : ''}" placeholder="${affiche(r, valeurJour(r.code, i))}"></td>`
          : `<td class="nombre">${affiche(r, valeurJour(r.code, i))}</td>`)).join('')}
        <td class="nombre">${affiche(r, v.variables?.semaine[r.code])}</td><td class="nombre"><b>${total(r)}</b></td></tr>`).join('')}</tbody></table>
      ${modifiable && v.rubriques.some((r) => r.saisie !== 'C') ? '<p><button type="button" data-rubriques>Enregistrer les rubriques saisies</button> <span class="aide">Case vide : valeur calculée ; 0 : annule le calcul (rubrique modifiable).</span></p>' : ''}
      ${v.zones.length ? `<h4>Zones de déplacement${v.agence ? ` (agence ${echapper(v.agence)})` : ''}</h4><table class="tableau-compact largeur-contenu"><thead><tr><th>Chantier</th><th>Zone</th>${this.donnees.rh && v.agence ? '<th>Nouvelle zone</th><th></th>' : ''}</tr></thead><tbody>
        ${v.zones.map((z) => `<tr><td>${echapper(z.code)} ${echapper(z.libelle)}</td><td>${z.zone == null ? '<span class="badge-exception">à valider</span>' : `zone ${z.zone}`}</td>
        ${this.donnees.rh && v.agence ? `<td><input type="number" min="0" max="9" size="2" data-zone="${z.cha_id}" value="${z.zone ?? ''}"></td>
          <td><button type="button" class="bouton-icone" data-zone-ok="${z.cha_id}" title="Valider la zone de ce chantier pour l'agence" aria-label="Valider la zone">✔</button></td>` : ''}</tr>`).join('')}</tbody></table>` : ''}`;
    zone.querySelector('[data-rubriques]')?.addEventListener('click', async () => {
      const valeurs = [];
      for (const inp of zone.querySelectorAll('input[data-rub]')) {
        if (inp.value.trim() === '') continue;
        const n = inp.dataset.unite === 'H' ? lireDuree(inp.value) : Number(inp.value);
        if (n === null || Number.isNaN(n)) { inp.classList.add('invalide'); return; }
        valeurs.push({ date: inp.dataset.jour, rubrique: inp.dataset.rub, valeur: n });
      }
      try { await api.pointage.enregistrerVariables(this.salarie, this.lundi, { valeurs }); this.app.message('Rubriques enregistrées', 'succes'); this.#rendrePaie(zone, modifiable); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelectorAll('[data-zone-ok]').forEach((b) => b.addEventListener('click', async () => {
      const n = zone.querySelector(`[data-zone="${b.dataset.zoneOk}"]`).value;
      try {
        await api.pointage.enregistrerZones(b.dataset.zoneOk, [{ agence: v.agence, zone: n === '' ? null : Number(n) }]);
        this.app.message('Zone validée', 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    }));
  }
}

/**
 * Export des variables de paie (semaines entières, jours validés par le RH, profils exportés : aperçu, fichier CSV
 * tracé, historique) et valorisation des heures (taux des fiches ou coûts réels importés après la paie).
 */
export class PageExportPointage extends PageBase {
  icone = '📤';

  async ouvrir() {
    this.titre = 'Export de paie et valorisation';
    const lundi = lundiDe(decaler(aujourdhui(), -28));
    const dimanche = decaler(lundiDe(aujourdhui()), -1);
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">📤 Export de paie et valorisation</h1>
      <p class="ligne">Du <input type="date" data-du value="${lundi}"> au <input type="date" data-au value="${dimanche}"> · <span data-service></span>
        <button type="button" class="bouton-icone" data-apercu title="Aperçu de l'export (rien n'est enregistré)" aria-label="Aperçu de l'export">👁</button>
        <button type="button" class="bouton-icone" data-exporter title="Exporter : enregistrer l'export et télécharger le fichier CSV" aria-label="Exporter (CSV)">📤</button></p></div>
      <p class="aide">Semaines entières (du lundi au dimanche). Seuls les salariés dont tous les jours sont validés par le service RH sont exportés ; un salarié dévalidé après un export est signalé.
        Congés validés : une ligne par nature d'absence (rubrique ABS_&lt;code&gt;, code de paie de la nature, quantité en jours travaillés décomptés).</p>
      <div data-resultat></div>
      <div class="titre-actions"><h2>Valorisation des heures</h2><span class="titre-actions-boutons"><button type="button" data-valoriser title="Valoriser les pointages de la période choisie en haut">💶 Valoriser</button></span></div>
      <p class="ligne"><label><input type="radio" name="mode" value="SALARIE" checked> Coût horaire des fiches (intérim : taux de la mission)</label>
        <label><input type="radio" name="mode" value="IMPORT"> Coûts réels importés après la paie</label> <span data-valorisation class="aide"></span></p>
      <p data-import hidden><textarea data-taux rows="4" cols="50" placeholder="matricule (ou matricule de paie);coût horaire (une ligne par salarié)"></textarea></p>
      <h2>Exports précédents</h2><div data-historique class="tableau-defilant"></div></div>`;
    const c = this.conteneur;
    if (!this.app.enLigne) { c.querySelector('[data-resultat]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const ref = await api.pointage.referentiels();
    const srv = creerCombo({ options: ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle })), valeur: '', vide: true, titre: 'Service (vide : tous)' });
    c.querySelector('[data-service]').append(srv);
    const demande = () => ({ du: c.querySelector('[data-du]').value, au: c.querySelector('[data-au]').value, service: srv.valeurCombo ? Number(srv.valeurCombo) : null });
    const afficher = (r) => {
      c.querySelector('[data-resultat]').innerHTML = `<p>${r.salaries} salarié(s) exporté(s), ${r.lignes.length} ligne(s)${r.id ? ` · export n° ${r.id} enregistré` : ''}.</p>
        ${r.conges_en_attente?.length ? `<details class="avertissement"><summary>⚠ ${r.conges_en_attente.length} congé(s) encore à valider sur la période (non exportés) — <a href="/pointage/conges?etat=DEMANDE">congés à traiter</a></summary>
          <div class="tableau-defilant largeur-contenu"><table class="tableau-compact"><thead><tr><th>Salarié<br><small>matricule</small></th><th>Période</th><th class="nombre">Jours</th></tr></thead><tbody>
          ${r.conges_en_attente.map((x) => `<tr><td class="synthese-nom">${echapper(x.salarie.nom)} ${echapper(x.salarie.prenom)}<br><small class="aide">${echapper(x.salarie.matricule ?? '')}</small></td><td>${jourCourt(x.du)} – ${jourCourt(x.au)}</td><td class="nombre">${String(x.jours).replace('.', ',')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        ${r.non_valides.length ? `<details class="avertissement"><summary>⚠ ${r.non_valides.length} salarié(s) avec des jours non validés (non exportés)</summary>
          <div class="tableau-defilant largeur-contenu"><table class="tableau-compact"><thead><tr><th>Salarié<br><small>matricule</small></th><th>Jours non validés</th></tr></thead><tbody>
          ${r.non_valides.map((x) => `<tr><td class="synthese-nom">${echapper(x.salarie.nom)} ${echapper(x.salarie.prenom)}<br><small class="aide">${echapper(x.salarie.matricule ?? '')}</small></td><td>${x.jours.map(jourCourt).join(', ')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        ${r.lignes.length ? `<div class="tableau-defilant"><table class="tableau-compact"><thead><tr><th>Salarié<br><small>matricule de paie</small></th><th>Rubrique<br><small>code paie</small></th><th>Libellé</th><th class="nombre">Quantité</th></tr></thead><tbody>
          ${r.lignes.slice(0, 300).map((l) => `<tr><td class="synthese-nom">${echapper(l.nom)} ${echapper(l.prenom)}<br><small class="aide">${echapper(l.matricule)}</small></td><td>${echapper(l.rubrique)}<br><small class="aide">${echapper(l.code_paie ?? '')}</small></td><td>${echapper(l.libelle)}</td><td class="nombre">${l.quantite}</td></tr>`).join('')}</tbody></table></div>
          ${r.lignes.length > 300 ? '<p class="aide">Aperçu limité à 300 lignes (le fichier contient tout).</p>' : ''}` : ''}`;
    };
    const telecharger = (csv, nom) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
      a.download = nom;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const historique = async () => {
      const l = await api.pointage.exports().catch(() => []);
      c.querySelector('[data-historique]').innerHTML = l.length ? `<table class="tableau-compact"><thead><tr><th>N°</th><th>Période</th><th class="nombre">Salariés<br><small>lignes</small></th><th>Par<br><small>le</small></th><th></th></tr></thead><tbody>
        ${l.map((e) => `<tr><td>${e.id}</td><td>${jourCourt(e.du)} – ${jourCourt(e.au)}</td><td class="nombre">${e.salaries}<br><small>${e.lignes}</small></td><td>${echapper(e.par)}<br><small>${horodatage(e.le)}</small></td>
          <td><a class="bouton-lien" href="/api/pointage/exports/${e.id}/fichier" download title="Télécharger le fichier CSV de l'export n° ${e.id}" aria-label="Télécharger">📥</a></td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun export.</p>';
    };
    c.querySelector('[data-apercu]').addEventListener('click', async () => { try { afficher(await api.pointage.apercuExport(demande())); } catch (e) { this.app.erreur(e); } });
    c.querySelector('[data-exporter]').addEventListener('click', async () => {
      if (!confirm('Enregistrer l\'export et télécharger le fichier ?')) return;
      try {
        const r = await api.pointage.exporter(demande());
        afficher(r);
        telecharger(r.csv, `variables-paie-${r.du}-${r.au}.csv`);
        await historique();
      } catch (e) { this.app.erreur(e); }
    });
    c.querySelectorAll('[name="mode"]').forEach((r) => r.addEventListener('change', () => { c.querySelector('[data-import]').hidden = c.querySelector('[name="mode"]:checked').value !== 'IMPORT'; }));
    c.querySelector('[data-valoriser]').addEventListener('click', async () => {
      const mode = c.querySelector('[name="mode"]:checked').value;
      const taux = mode === 'IMPORT' ? c.querySelector('[data-taux]').value.split(/\r?\n/).map((l) => l.split(/[;\t]/)).filter((x) => x.length >= 2 && x[0].trim())
        .map(([m, t]) => ({ matricule: m.trim(), taux: Number(t.trim().replace(',', '.')) })) : null;
      if (taux?.some((t) => Number.isNaN(t.taux))) { this.app.message('Taux illisible dans l\'import', 'erreur'); return; }
      try {
        const r = await api.pointage.valoriser({ ...demande(), mode, taux });
        c.querySelector('[data-valorisation]').textContent = `${r.pointages} pointage(s) valorisé(s) pour ${r.salaries} salarié(s) · ${r.sans_taux} sans taux · coût ${Number(r.cout).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`;
      } catch (e) { this.app.erreur(e); }
    });
    await historique();
  }
}

/** Paramètres du pointage (administrateur) : libellés, pas, amplitudes, validation, sous-types de main-d'œuvre. */
export class PageParametresPointage extends PageBase {
  icone = '⏱';

  async ouvrir() {
    this.titre = 'Paramètres du pointage';
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">⏱ Paramètres du pointage</h1></div><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.app.enLigne) { corps.innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const admin = this.app.estAdmin();
    const ro = admin ? '' : 'disabled';
    let p = await api.pointage.parametres();
    let st = (await api.pointage.sousTypes()).map((x) => ({ ...x, existant: true }));
    const rendre = () => {
      corps.innerHTML = `<div class="titre-actions"><h2>Société et sous-types</h2>${admin ? '<span class="titre-actions-boutons"><button type="button" data-enregistrer title="Enregistrer les paramètres et les sous-types">💾 Enregistrer</button></span>' : ''}</div>
        <table class="tableau-compact largeur-contenu"><tbody>
        <tr><td>Libellé des salariés</td><td><label><input type="radio" name="ordre" value="NP" ${p.ordre_nom === 'NP' ? 'checked' : ''} ${ro}> Nom Prénom</label>
          <label><input type="radio" name="ordre" value="PN" ${p.ordre_nom === 'PN' ? 'checked' : ''} ${ro}> Prénom Nom</label></td></tr>
        <tr><td>Pas de saisie (minutes, 0 = libre)</td><td><input type="number" data-pas min="0" max="60" value="${p.pas_minutes}" ${ro}></td></tr>
        <tr><td>Amplitude maximale du jour (heures)</td><td><input type="number" data-jour min="0" max="24" step="0.25" value="${p.amplitude_jour / 60}" ${ro}></td></tr>
        <tr><td>Amplitude maximale de la semaine (heures)</td><td><input type="number" data-semaine min="0" max="168" step="0.25" value="${p.amplitude_semaine / 60}" ${ro}></td></tr>
        <tr><td>Seuil des heures supplémentaires (heures par semaine)</td><td><input type="number" data-seuil min="0" max="168" step="0.25" value="${p.seuil_semaine / 60}" ${ro}></td></tr>
        <tr><td>Validation</td><td><label><input type="radio" name="validation" value="SIMPLE" ${p.validation === 'SIMPLE' ? 'checked' : ''} ${ro}> Simple (RH)</label>
          <label><input type="radio" name="validation" value="DOUBLE" ${p.validation === 'DOUBLE' ? 'checked' : ''} ${ro}> Double (chef de service puis RH)</label></td></tr>
        <tr><td>Blocage à la validation</td><td><label><input type="radio" name="blocage" value="JOUR" ${p.blocage === 'JOUR' ? 'checked' : ''} ${ro}> À la journée</label>
          <label><input type="radio" name="blocage" value="SEMAINE" ${p.blocage === 'SEMAINE' ? 'checked' : ''} ${ro}> À la semaine</label></td></tr>
        <tr><td>Intérimaires</td><td><label><input type="checkbox" data-interim ${p.interim_imputes ? 'checked' : ''} ${ro}> Heures imputées aux chantiers avec un coût</label></td></tr>
        </tbody></table>
        <h2>Sous-types de main-d'œuvre</h2><p class="aide">Le type de main-d'œuvre est une nature du regroupement Main-d'œuvre (bibliothèque) ; le sous-type précise l'activité.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Productif</th><th>Non-conformité<br><small>motif exigé</small></th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
        ${st.map((x, i) => `<tr data-i="${i}"><td><input data-code size="14" value="${echapper(x.code)}" ${admin && !x.existant ? '' : 'readonly'}></td><td><input data-libelle size="28" value="${echapper(x.libelle)}" ${ro}></td>
          <td><input type="checkbox" data-productif ${x.productif ? 'checked' : ''} ${ro}></td><td><input type="checkbox" data-nc ${x.non_conformite ? 'checked' : ''} ${ro}></td>
          <td><input type="number" data-ordre size="4" value="${x.ordre}" ${ro}></td><td><input type="checkbox" data-actif ${x.actif ? 'checked' : ''} ${ro}></td>
          <td>${admin ? '<button type="button" class="bouton-icone" data-retirer title="Retirer le sous-type" aria-label="Retirer le sous-type">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
        ${admin ? '<p><button type="button" class="bouton-icone" data-ajouter title="Ajouter un sous-type" aria-label="Ajouter un sous-type">＋</button></p>' : ''}
        <h2>Profils de paie</h2><div data-profils></div>
        <h2>Natures d'absence (congés)</h2><div data-natures></div>`;
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const x = st[Number(tr.dataset.i)];
        tr.querySelector('[data-code]').addEventListener('change', (e) => { x.code = e.target.value.trim().toUpperCase(); });
        tr.querySelector('[data-libelle]').addEventListener('change', (e) => { x.libelle = e.target.value; });
        tr.querySelector('[data-productif]').addEventListener('change', (e) => { x.productif = e.target.checked; });
        tr.querySelector('[data-nc]').addEventListener('change', (e) => { x.non_conformite = e.target.checked; });
        tr.querySelector('[data-ordre]').addEventListener('change', (e) => { x.ordre = Number(e.target.value) || 0; });
        tr.querySelector('[data-actif]').addEventListener('change', (e) => { x.actif = e.target.checked; });
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { st.splice(st.indexOf(x), 1); rendre(); });
      });
      corps.querySelector('[data-ajouter]')?.addEventListener('click', () => { st.push({ code: '', libelle: '', productif: true, non_conformite: false, ordre: (st.length + 1) * 10, actif: true }); rendre(); });
      corps.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const v = (sel) => corps.querySelector(sel);
        const heures = (sel) => Math.round(Number(v(sel).value) * 60);
        const saisie = {
          ordre_nom: v('[name="ordre"]:checked').value, pas_minutes: Number(v('[data-pas]').value), amplitude_jour: heures('[data-jour]'),
          amplitude_semaine: heures('[data-semaine]'), seuil_semaine: heures('[data-seuil]'), validation: v('[name="validation"]:checked').value,
          blocage: v('[name="blocage"]:checked').value, interim_imputes: v('[data-interim]').checked,
        };
        try {
          p = await api.pointage.enregistrerParametres(saisie);
          st = (await api.pointage.enregistrerSousTypes(st)).map((x) => ({ ...x, existant: true }));
          rendre();
          this.app.message('Paramètres enregistrés', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
    this.#profils(admin);
    this.#natures();
  }

  /**
   * Natures d'absence affectées par le service RH à la validation d'un congé (CP, RTT, AR, AT…) : code, libellé, code
   * de paie exporté, couleur (pastilles, planning), ordre, active ; modifiables par le service RH ou un administrateur
   * (le serveur contrôle le droit) ; une nature retirée déjà utilisée devient inactive.
   */
  async #natures() {
    const zone = this.conteneur.querySelector('[data-natures]');
    let natures = (await api.pointage.naturesAbsence()).map((x) => ({ ...x, existant: true }));
    const rendre = () => {
      zone.innerHTML = `<div class="titre-actions"><p class="aide">Affectée par le service RH à la validation d'un congé ; le code de paie (sinon le code) est exporté avec les jours décomptés.</p>
        <span class="titre-actions-boutons"><button type="button" data-enregistrer-n title="Enregistrer les natures d'absence">💾 Enregistrer</button></span></div>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Code paie</th><th>Couleur</th><th>Ordre</th><th>Active</th><th></th></tr></thead><tbody>
        ${natures.map((n, i) => `<tr data-n="${i}"><td><input data-f="code" size="8" value="${echapper(n.code)}" ${n.existant ? 'readonly' : ''}></td><td><input data-f="libelle" size="30" value="${echapper(n.libelle)}"></td>
          <td><input data-f="code_paie" size="8" value="${echapper(n.code_paie ?? '')}"></td><td><input type="color" data-f="couleur" value="${echapper(n.couleur || '#94a3b8')}"></td>
          <td><input type="number" data-f="ordre" size="4" value="${n.ordre}"></td><td><input type="checkbox" data-f="actif" ${n.actif ? 'checked' : ''}></td>
          <td><button type="button" class="bouton-icone" data-retirer-n title="Retirer la nature (inactive si elle est déjà utilisée)" aria-label="Retirer la nature">✕</button></td></tr>`).join('')}</tbody></table>
        <p><button type="button" class="bouton-icone" data-ajouter-n title="Ajouter une nature d'absence" aria-label="Ajouter une nature d'absence">＋</button></p>`;
      zone.querySelectorAll('tr[data-n]').forEach((tr) => {
        const n = natures[Number(tr.dataset.n)];
        tr.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => {
          const f = el.dataset.f;
          if (f === 'actif') n.actif = el.checked;
          else if (f === 'ordre') n.ordre = Number(el.value) || 0;
          else if (f === 'code') n.code = el.value.trim().toUpperCase();
          else n[f] = el.value.trim() || null;
        }));
        tr.querySelector('[data-retirer-n]').addEventListener('click', () => { natures.splice(natures.indexOf(n), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter-n]').addEventListener('click', () => { natures.push({ code: '', libelle: '', code_paie: null, couleur: '#94a3b8', ordre: (natures.length + 1) * 10, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer-n]').addEventListener('click', async () => {
        try {
          natures = (await api.pointage.enregistrerNaturesAbsence(natures)).map((x) => ({ ...x, existant: true }));
          rendre();
          this.app.message('Natures d\'absence enregistrées', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  /**
   * Profils de paie : rubriques (code, libellé, unité, saisie, code de paie) et règles typées (paramètres en JSON :
   * voir TYPES_REGLE de paie.js) ; contrôle `controlerProfil` avant l'envoi.
   */
  async #profils(admin) {
    const zone = this.conteneur.querySelector('[data-profils]');
    let profils = await api.pointage.profils();
    let courant = profils[0] ?? null;
    const ro = admin ? '' : 'disabled';
    const options = (o) => Object.entries(o).map(([valeur, libelle]) => ({ valeur, libelle, detail: valeur }));
    /** Combos des colonnes à liste fermée (unité, saisie, type de règle). */
    const combos = (tr, objet, colonnes) => {
      for (const [cle, liste] of colonnes) {
        const c = creerCombo({ options: options(liste), valeur: objet[cle], vide: false });
        c.readOnly = !admin;
        c.addEventListener('change', () => { objet[cle] = c.valeurCombo; });
        tr.querySelector(`[data-c="${cle}"]`).append(c);
      }
    };
    const rendre = () => {
      zone.innerHTML = `<div class="titre-actions"><nav class="onglets crm-vues">${profils.map((x, i) => `<button type="button" data-p="${i}" class="${x === courant ? 'actif' : ''}">${echapper(x.libelle || x.code || '(nouveau)')}${x.actif ? '' : ' (inactif)'}</button>`).join('')}</nav>
        <span class="titre-actions-boutons">${admin ? '<button type="button" class="bouton-icone" data-nouveau title="Nouveau profil de paie" aria-label="Nouveau profil de paie">＋</button>' : ''}${admin && courant ? ' <button type="button" data-enregistrer-p title="Enregistrer les profils de paie">💾 Enregistrer</button>' : ''}</span></div>
        ${courant ? `<p class="ligne"><label>Code <input data-code size="10" value="${echapper(courant.code)}" ${admin && !courant.id ? '' : 'readonly'}></label>
          <label>Libellé <input data-libelle size="36" value="${echapper(courant.libelle)}" ${ro}></label>
          <label><input type="checkbox" data-export ${courant.export ? 'checked' : ''} ${ro}> Exporté vers la paie</label>
          <label><input type="checkbox" data-actif ${courant.actif ? 'checked' : ''} ${ro}> Actif</label></p>
          <h3>Rubriques</h3><table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Unité</th><th>Saisie</th><th>Code paie</th><th>Ordre</th><th></th></tr></thead><tbody>
          ${courant.rubriques.map((r, i) => `<tr data-r="${i}"><td><input data-f="code" size="8" value="${echapper(r.code)}" ${ro}></td><td><input data-f="libelle" size="28" value="${echapper(r.libelle)}" ${ro}></td>
            <td data-c="unite"></td><td data-c="saisie"></td>
            <td><input data-f="code_paie" size="8" value="${echapper(r.code_paie ?? '')}" ${ro}></td><td><input data-f="ordre" type="number" size="3" value="${r.ordre}" ${ro}></td>
            <td>${admin ? '<button type="button" class="bouton-icone" data-retirer-r title="Retirer la rubrique" aria-label="Retirer la rubrique">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
          ${admin ? '<p><button type="button" class="bouton-icone" data-ajouter-r title="Ajouter une rubrique" aria-label="Ajouter une rubrique">＋</button></p>' : ''}
          <h3>Règles (dans l'ordre)</h3><table class="tableau-compact largeur-contenu"><thead><tr><th>Type</th><th>Rubrique</th><th>Paramètres (JSON)</th><th>Ordre</th><th>Active</th><th></th></tr></thead><tbody>
          ${courant.regles.map((r, i) => `<tr data-g="${i}"><td data-c="type"></td><td><input data-f="rubrique" size="8" value="${echapper(r.rubrique ?? '')}" ${ro}></td>
            <td><input data-f="parametres" size="60" value="${echapper(JSON.stringify(r.parametres ?? {}))}" ${ro}></td><td><input data-f="ordre" type="number" size="3" value="${r.ordre}" ${ro}></td>
            <td><input type="checkbox" data-f="actif" ${r.actif ? 'checked' : ''} ${ro}></td><td>${admin ? '<button type="button" class="bouton-icone" data-retirer-g title="Retirer la règle" aria-label="Retirer la règle">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
          ${admin ? '<p><button type="button" class="bouton-icone" data-ajouter-g title="Ajouter une règle" aria-label="Ajouter une règle">＋</button></p>' : ''}
          <p class="aide">Paramètres : CUMUL_HEURES { sous_types, exclure } · SEUIL_JOUR { base, seuil (minutes), valeur, exclu_si } · TRANCHES_SEMAINE { base, seuil, deduire, tranches [{ rubrique, jusqu_a }] } · ZONE { exclu_si } · PLAFOND { max, max_semaine }.</p>` : ''}`;
      zone.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { courant = profils[Number(b.dataset.p)]; rendre(); }));
      zone.querySelector('[data-nouveau]')?.addEventListener('click', () => {
        profils.push(courant = { id: null, code: '', libelle: '', export: true, ordre: (profils.length + 1) * 10, actif: true, rubriques: [], regles: [] }); rendre();
      });
      zone.querySelectorAll('tr[data-r]').forEach((tr) => combos(tr, courant.rubriques[Number(tr.dataset.r)], [['unite', UNITES_RUBRIQUE], ['saisie', SAISIES_RUBRIQUE]]));
      zone.querySelectorAll('tr[data-g]').forEach((tr) => combos(tr, courant.regles[Number(tr.dataset.g)], [['type', TYPES_REGLE]]));
      if (!courant || !admin) return;
      zone.querySelector('[data-code]').addEventListener('change', (e) => { courant.code = e.target.value.trim().toUpperCase(); });
      zone.querySelector('[data-libelle]').addEventListener('change', (e) => { courant.libelle = e.target.value; });
      zone.querySelector('[data-export]').addEventListener('change', (e) => { courant.export = e.target.checked; });
      zone.querySelector('[data-actif]').addEventListener('change', (e) => { courant.actif = e.target.checked; });
      const lier = (tr, objet) => tr.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => {
        const f = el.dataset.f;
        if (f === 'actif') objet[f] = el.checked;
        else if (f === 'ordre') objet[f] = Number(el.value) || 0;
        else if (f === 'parametres') {
          try { objet[f] = JSON.parse(el.value || '{}'); el.classList.remove('invalide'); } catch { el.classList.add('invalide'); }
        } else if (f === 'code' || f === 'rubrique') objet[f] = el.value.trim().toUpperCase() || null;
        else objet[f] = el.value;
      }));
      zone.querySelectorAll('tr[data-r]').forEach((tr) => {
        const r = courant.rubriques[Number(tr.dataset.r)];
        lier(tr, r);
        tr.querySelector('[data-retirer-r]').addEventListener('click', () => { courant.rubriques.splice(courant.rubriques.indexOf(r), 1); rendre(); });
      });
      zone.querySelectorAll('tr[data-g]').forEach((tr) => {
        const g = courant.regles[Number(tr.dataset.g)];
        lier(tr, g);
        tr.querySelector('[data-retirer-g]').addEventListener('click', () => { courant.regles.splice(courant.regles.indexOf(g), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter-r]').addEventListener('click', () => { courant.rubriques.push({ code: '', libelle: '', unite: 'H', saisie: 'C', code_paie: null, ordre: (courant.rubriques.length + 1) * 10 }); rendre(); });
      zone.querySelector('[data-ajouter-g]').addEventListener('click', () => { courant.regles.push({ type: 'CUMUL_HEURES', rubrique: null, parametres: {}, ordre: (courant.regles.length + 1) * 10, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer-p]').addEventListener('click', async () => {
        if (zone.querySelector('.invalide')) { this.app.message('Paramètres JSON illisibles', 'erreur'); return; }
        for (const x of profils) {
          const e = controlerProfil(x);
          if (e.length) { this.app.message(`Profil ${x.code} : ${e.map((c) => MESSAGES_PAIE[c]).join(', ')}`, 'erreur'); return; }
        }
        try {
          profils = await api.pointage.enregistrerProfils(profils);
          courant = profils.find((x) => x.code === courant.code) ?? profils[0] ?? null;
          rendre();
          this.app.message('Profils enregistrés', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }
}

/**
 * Congés et absences (`/pointage/conges?etat=&service=&du=&au=&recherche=`) : demandes et congés des salariés visibles
 * (service RH : tous ; responsable de service : ses équipiers ; sinon les siens), filtres état, service, période et
 * recherche ; « ＋ Demande » pour soi ou un équipier ; une ligne ouvre la demande (service RH : nature, valider, refuser).
 */
export class PageCongesPointage extends PageBase {
  icone = '🏖';

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ etat: this.etat, service: this.service, du: this.du, au: this.au, recherche: this.recherche }).filter(([, v]) => v));
    return `/pointage/conges?${p}`;
  }

  async ouvrir() {
    this.titre = 'Congés et absences';
    this.etat = this.requete.etat ?? '';
    this.service = this.requete.service ?? '';
    this.du = this.requete.du ?? decaler(aujourdhui(), -31);
    this.au = this.requete.au ?? decaler(aujourdhui(), 120);
    this.recherche = this.requete.recherche ?? '';
    this.conteneur.innerHTML = `<div class="page-parametres page-pointage"><div class="entete-page"><h1 class="page-titre">🏖 Congés et absences</h1>
      <p class="ligne">Du <input type="date" data-du value="${this.du}"> au <input type="date" data-au value="${this.au}"> · <span data-etat></span> <span data-service></span>
        <input type="search" data-recherche placeholder="Salarié, matricule…" value="${echapper(this.recherche)}">
        <button type="button" class="bouton-icone" data-nouveau title="Nouvelle demande de congé (pour vous ou un équipier)" aria-label="Nouvelle demande de congé">＋</button></p></div>
      <div data-resultat></div></div>`;
    const c = this.conteneur;
    if (!this.app.enLigne) { c.querySelector('[data-resultat]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    this.ref = await api.pointage.referentiels();
    const etat = creerCombo({ options: [{ valeur: 'DEMANDE', libelle: 'À valider' }, { valeur: 'VALIDE', libelle: 'Validés' }, { valeur: 'REFUSE', libelle: 'Refusés' }, { valeur: 'ANNULE', libelle: 'Annulés' }],
      valeur: this.etat, vide: true, titre: 'État (vide : tous)' });
    c.querySelector('[data-etat]').append(etat);
    const srv = creerCombo({ options: this.ref.services.map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle, detail: s.code })), valeur: this.service, vide: true, titre: 'Service (vide : tous)' });
    c.querySelector('[data-service]').append(srv);
    const changer = () => {
      Object.assign(this, { etat: etat.valeurCombo, service: srv.valeurCombo, du: c.querySelector('[data-du]').value, au: c.querySelector('[data-au]').value, recherche: c.querySelector('[data-recherche]').value.trim() });
      this.app.routeur.remplacerUrl(this.urlCourante());
      this.#charger();
    };
    etat.addEventListener('change', changer);
    srv.addEventListener('change', changer);
    c.querySelectorAll('[data-du], [data-au], [data-recherche]').forEach((el) => el.addEventListener('change', changer));
    c.querySelector('[data-nouveau]').addEventListener('click', async () => {
      if (!this.donnees) return;
      const ordre = this.ref.parametres.ordre_nom;
      const salaries = this.donnees.salaries.map((x) => ({ id: x.id, libelle: nomSalarie(x, ordre), detail: [x.matricule, x.service].filter(Boolean).join(' · ') }));
      const r = await ouvrirConge(this.app, { initial: { salarie: this.donnees.moi ?? '', du: aujourdhui(), au: aujourdhui() }, salaries, rh: this.donnees.rh, natures: this.donnees.natures });
      if (r) { this.app.message('Congé enregistré', 'succes'); this.#charger(); }
    });
    await this.#charger();
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-resultat]');
    try { this.donnees = await api.pointage.conges({ du: this.du, au: this.au, service: this.service, etat: this.etat, recherche: this.recherche }); } catch (e) { this.app.erreur(e); return; }
    const d = this.donnees;
    const ordre = this.ref.parametres.ordre_nom;
    const nature = (code) => d.natures.find((n) => n.code === code)?.libelle ?? code ?? '';
    const aTraiter = d.conges.filter((x) => x.etat === 'DEMANDE').length;
    zone.innerHTML = `<p class="aide">${d.conges.length} congé(s)${aTraiter ? ` · <b>${aTraiter} à valider</b>` : ''} · ${d.rh ? 'service RH : vous validez en affectant la nature' : 'demandes validées par le service RH'}.</p>
      ${d.conges.length ? `<div class="tableau-defilant"><table class="tableau-compact"><thead><tr><th>Salarié<br><small>matricule · service</small></th><th>Période</th><th class="nombre">Jours</th>
        <th>Nature<br><small>état</small></th><th>Commentaire<br><small>réponse</small></th><th>Demandé par<br><small>le</small></th><th>Traité par<br><small>le</small></th></tr></thead><tbody>
        ${d.conges.map((x) => `<tr class="cliquable etat-conge-${x.etat.toLowerCase()}" data-id="${x.id}"><td class="synthese-nom">${echapper(nomSalarie(x, ordre))}<br><small class="aide">${echapper([x.matricule, x.service].filter(Boolean).join(' · '))}</small></td>
          <td>${periodeConge(x)}</td><td class="nombre">${String(x.jours).replace('.', ',')}</td>
          <td>${pastilleConge(x, d.natures)} ${echapper(x.etat === 'VALIDE' ? nature(x.nature) : ETATS_CONGE[x.etat])}</td>
          <td>${echapper(x.commentaire ?? '')}${x.reponse ? `<br><small class="aide">${echapper(x.reponse)}</small>` : ''}</td>
          <td>${echapper(x.demande_par)}<br><small>${dateCourte(x.demande_le)}</small></td><td>${echapper(x.traite_par ?? '')}<br><small>${x.traite_le ? dateCourte(x.traite_le) : ''}</small></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="aide">Aucun congé sur la période.</p>'}`;
    zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
      const r = await ouvrirConge(this.app, { conge: d.conges.find((x) => String(x.id) === tr.dataset.id), rh: d.rh, natures: d.natures });
      if (r) this.#charger();
    }));
  }
}
