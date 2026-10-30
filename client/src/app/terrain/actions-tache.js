import { echapper, ouvrirDialogue, formatDate } from '@logibtp/socle/ui';
import { aujourdhui } from '@logibtp/socle';
import { api } from '../api.js';
import { preparerPhoto } from './terrain.js';

// Application de terrain, lot 3 (ANALYSE-TERRAIN.md, T12, T17) : actions sur une tâche depuis sa carte — avancement
// réel du jour, photos (prise de vue ou lot de la galerie, réduites sauf « qualité d'origine »), non-conformité
// (motif proposé ou libre, photos jointes). Serveur : TerrainOrdresBtp.cs (tâche de la personne seulement).

/** Sélecteur de photos (prise de vue, galerie en lot), case « qualité d'origine » ; `photos()` : fichiers choisis. */
function selecteurPhotos(racine) {
  let fichiers = [];
  racine.innerHTML = `<div class="terrain-actions">
      <label class="terrain-bouton">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-prise></label>
      <label class="terrain-bouton">🖼 Galerie<input type="file" accept="image/*" multiple hidden data-galerie></label></div>
    <p class="aide" data-choisies>Aucune photo choisie.</p>
    <label class="coche"><input type="checkbox" data-origine> Qualité d'origine (sans réduction : détails à conserver)</label>`;
  const afficher = () => {
    racine.querySelector('[data-choisies]').textContent = fichiers.length
      ? `${fichiers.length} photo${fichiers.length > 1 ? 's' : ''} : ${fichiers.map((f) => f.name).join(', ')}` : 'Aucune photo choisie.';
  };
  racine.querySelectorAll('input[type="file"]').forEach((i) => i.addEventListener('change', () => { fichiers = [...fichiers, ...i.files]; i.value = ''; afficher(); }));
  return {
    get nombre() { return fichiers.length; },
    async formulaire(commentaire) {
      const f = new FormData();
      const origine = racine.querySelector('[data-origine]').checked;
      for (const p of fichiers) f.append('fichiers', await preparerPhoto(p, { origine }));
      if (commentaire) f.append('commentaire', commentaire);
      return f;
    },
  };
}

/** Avancement réel du jour de la tâche (relevés précédents affichés) ; vrai si enregistré. */
export async function saisirAvancement(app, tache) {
  let releves = [];
  try { releves = await api.terrain.avancements(tache.id); } catch (e) { app.erreur(e); return false; }
  const dernier = releves[0];
  return ouvrirDialogue({
    titre: `📈 Avancement · ${tache.libelle}`,
    html: `<p class="ligne"><label>Avancement réel aujourd'hui <input type="number" data-pourcent min="0" max="100" step="5" inputmode="numeric" size="4" value="${dernier?.pourcent ?? ''}"> %</label></p>
      <input type="range" data-curseur min="0" max="100" step="5" value="${dernier?.pourcent ?? 0}" style="width: 100%">
      <p><label>Commentaire<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      ${releves.length ? `<p class="aide">${releves.slice(0, 5).map((r) => `${formatDate(r.le)} : ${r.pourcent} % (${echapper(r.par)})`).join(' · ')}</p>` : ''}`,
    boutons: [{ libelle: 'Annuler', valeur: false }],
    construire: (dlg, fermer) => {
      const champ = dlg.querySelector('[data-pourcent]');
      const curseur = dlg.querySelector('[data-curseur]');
      curseur.addEventListener('input', () => { champ.value = curseur.value; });
      champ.addEventListener('input', () => { curseur.value = champ.value; });
      boutonPrincipal(dlg, 'Enregistrer', async () => {
        const pourcent = Number(champ.value);
        if (champ.value === '' || !(pourcent >= 0 && pourcent <= 100)) { champ.focus(); return; }
        try {
          await api.terrain.enregistrerAvancement(tache.id, { date: aujourdhui(), pourcent, commentaire: dlg.querySelector('[data-commentaire]').value.trim() || null });
          app.message(`Avancement enregistré : ${pourcent} %`, 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Photos de la tâche, déposées dans la GED de son ordre (sinon de son chantier) ; vrai si envoyées. */
export async function envoyerPhotos(app, tache) {
  return ouvrirDialogue({
    titre: `📷 Photos · ${tache.libelle}`,
    html: '<div data-photos></div><p><label>Commentaire<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>',
    boutons: [{ libelle: 'Annuler', valeur: false }],
    construire: (dlg, fermer) => {
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      boutonPrincipal(dlg, 'Envoyer', async () => {
        if (!s.nombre) { app.message('Choisissez au moins une photo', 'avertissement'); return; }
        try {
          const r = await api.terrain.photos(tache.id, await s.formulaire(dlg.querySelector('[data-commentaire]').value.trim()));
          app.message(`${r.deposees.length} photo${r.deposees.length > 1 ? 's envoyées' : ' envoyée'}`, 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Non-conformité signalée sur la tâche (tâche du CRM au service du motif), photos jointes facultatives. */
export async function signalerNonConformite(app, tache, motifs = []) {
  return ouvrirDialogue({
    titre: `⚠ Non-conformité · ${tache.libelle}`,
    html: `<p><label>Motif<br><input data-motif list="terrain-motifs-nc" size="34" placeholder="Matériaux, plan, commande…"></label></p>
      <datalist id="terrain-motifs-nc">${motifs.map((m) => `<option value="${echapper(m)}">`).join('')}</datalist>
      <p><label>Précisions<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      <details><summary>📷 Joindre des photos</summary><div data-photos></div></details>`,
    boutons: [{ libelle: 'Annuler', valeur: false }],
    construire: (dlg, fermer) => {
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      boutonPrincipal(dlg, 'Signaler', async () => {
        const motif = dlg.querySelector('[data-motif]').value.trim();
        if (!motif) { dlg.querySelector('[data-motif]').focus(); return; }
        const commentaire = dlg.querySelector('[data-commentaire]').value.trim() || null;
        try {
          const r = await api.terrain.nonConformite(tache.id, { motif, commentaire });
          if (s.nombre) await api.terrain.photos(tache.id, await s.formulaire(`Non-conformité : ${motif}${commentaire ? ` — ${commentaire}` : ''}`));
          app.message(r.crm ? 'Non-conformité signalée au service concerné' : 'Non-conformité enregistrée (suivi CRM inactif : aucune tâche créée)', r.crm ? 'succes' : 'avertissement');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Bouton principal ajouté à côté des boutons de la fenêtre. */
function boutonPrincipal(dlg, libelle, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'principal';
  b.textContent = libelle;
  b.addEventListener('click', async () => { b.disabled = true; try { await action(); } finally { b.disabled = false; } });
  const annuler = [...dlg.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Annuler');
  (annuler?.parentElement ?? dlg).append(b);
}
