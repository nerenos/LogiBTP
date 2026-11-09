import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirDialogue, formatDate, creerCombo } from '@logibtp/socle/ui';
import { aujourdhui } from '@logibtp/socle';
import { api } from '../api.js';
import { preparerPhoto, champsPhotosHtml } from './terrain.js';
import { envoyerOuGarder, OPERATION_TERRAIN, formulairePhotos, limitePhotos } from './operations-terrain.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { choisirArticle, unitesArticle, ligneDemande } from './bibliotheque-terrain.js';

// Application de terrain, lot 3 (ANALYSE-TERRAIN.md, T12, T17) : actions sur une tâche depuis sa carte — avancement
// réel du jour, photos (prise de vue ou lot de la galerie, réduites sauf « qualité d'origine »), non-conformité
// (motif proposé ou libre, photos jointes). Serveur : TerrainOrdresBtp.cs (tâche de la personne seulement).
// Lot 5 : demande d'approvisionnement (E_DAP) sur le chantier de la tâche.
// Lot 4 : serveur injoignable, la saisie est gardée sur l'appareil (photos déjà réduites) et envoyée au retour.

/** Sélecteur de photos (prise de vue, galerie en lot), case « qualité d'origine » ; `photos()` : fichiers choisis. */
export function selecteurPhotos(racine) {
  let fichiers = [];
  racine.innerHTML = champsPhotosHtml();
  const afficher = () => {
    racine.querySelector('[data-choisies]').textContent = fichiers.length
      ? texte('terrain_btp.actions.photos.choisies', { photos: pluriel('terrain_btp.actions.photos.nombre', fichiers.length), noms: fichiers.map((f) => f.name).join(', ') }) : texte('terrain_btp.actions.photos.aucune');
  };
  racine.querySelectorAll('input[type="file"]').forEach((i) => i.addEventListener('change', () => { fichiers = [...fichiers, ...i.files]; i.value = ''; afficher(); }));
  return {
    get nombre() { return fichiers.length; },
    /**
     * Photos prêtes à envoyer (réduites sauf « qualité d'origine ») et commentaire : { fichiers, commentaire }. Limite de
     * dépôt de la GED (terrain-suites lot 12) : photo trop lourde réduite de force, ou refusée (`PhotoTropLourde`)
     * avant d'être gardée ou envoyée.
     */
    async photos(commentaire) {
      const origine = racine.querySelector('[data-origine]').checked;
      const limite = limitePhotos();
      return { fichiers: await Promise.all(fichiers.map((p) => preparerPhoto(p, { origine, limite }))), commentaire: commentaire || null };
    },
  };
}

/** Avancement réel du jour de la tâche (relevés précédents affichés) ; vrai si enregistré. */
export async function saisirAvancement(app, tache) {
  let releves = [];
  // Hors ligne : relevés précédents indisponibles, la saisie reste possible (gardée sur l'appareil).
  try { releves = await api.terrain.avancements(tache.id); } catch (e) { if (!estHorsLigne(e)) { app.erreur(e); return false; } }
  const dernier = releves[0];
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_avancement')} ${texte('terrain_btp.actions.avancement.titre', { tache: tache.libelle })}`,
    html: `<p class="ligne"><label>${texteHtml('terrain_btp.actions.avancement.reel')} <input type="number" data-pourcent min="0" max="100" step="5" inputmode="numeric" size="4" value="${dernier?.pourcent ?? ''}"> %</label></p>
      <input type="range" data-curseur min="0" max="100" step="5" value="${dernier?.pourcent ?? 0}" style="width: 100%">
      <p><label>${texteHtml('terrain_btp.actions.commentaire')}<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      ${releves.length ? `<p class="aide">${releves.slice(0, 5).map((r) => `${formatDate(r.le)} : ${r.pourcent} % (${echapper(r.par)})`).join(' · ')}</p>` : ''}`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
    construire: (dlg, fermer) => {
      const champ = dlg.querySelector('[data-pourcent]');
      const curseur = dlg.querySelector('[data-curseur]');
      curseur.addEventListener('input', () => { champ.value = curseur.value; });
      champ.addEventListener('input', () => { curseur.value = champ.value; });
      boutonPrincipal(dlg, texte('commun.enregistrer'), async () => {
        const pourcent = Number(champ.value);
        if (champ.value === '' || !(pourcent >= 0 && pourcent <= 100)) { champ.focus(); return; }
        try {
          const avancement = { date: aujourdhui(), pourcent, commentaire: dlg.querySelector('[data-commentaire]').value.trim() || null };
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.AVANCEMENT, id: `${tache.id}:${avancement.date}`, corps: { tache: tache.id, avancement },
            libelle: texte('terrain_btp.actions.avancement.libelle', { pourcent, tache: tache.libelle }) }, () => api.terrain.enregistrerAvancement(tache.id, avancement));
          if (r.reponse) app.message(texte('terrain_btp.actions.avancement.enregistre', { pourcent }), 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Photos de la tâche, déposées dans la GED de son ordre (sinon de son chantier) ; vrai si envoyées. */
export async function envoyerPhotos(app, tache) {
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_photo')} ${texte('terrain_btp.actions.photos.titre', { tache: tache.libelle })}`,
    html: `<div data-photos></div><p><label>${texteHtml('terrain_btp.actions.commentaire')}<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
    construire: (dlg, fermer) => {
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      boutonPrincipal(dlg, texte('terrain_btp.actions.photos.envoyer'), async () => {
        if (!s.nombre) { app.message(texte('terrain_btp.actions.photos.vide'), 'avertissement'); return; }
        try {
          const photos = await s.photos(dlg.querySelector('[data-commentaire]').value.trim());
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.PHOTOS, id: Date.now(), corps: { tache: tache.id, photos },
            libelle: `${pluriel('terrain_btp.actions.photos.nombre', photos.fichiers.length)} · ${tache.libelle}` }, () => api.terrain.photos(tache.id, formulairePhotos(photos)));
          if (r.reponse) app.message(pluriel('terrain_btp.actions.photos.envoyees', r.reponse.deposees.length), 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Non-conformité signalée sur la tâche (tâche du CRM au service du motif), photos jointes facultatives. */
export async function signalerNonConformite(app, tache, motifs = []) {
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_nc')} ${texte('terrain_btp.actions.nc.titre', { tache: tache.libelle })}`,
    html: `<p><label>${texteHtml('terrain_btp.actions.nc.motif')}<br><input data-motif list="terrain-motifs-nc" size="34" placeholder="${texteHtml('terrain_btp.actions.nc.motif_exemple')}"></label></p>
      <datalist id="terrain-motifs-nc">${motifs.map((m) => `<option value="${echapper(m)}">`).join('')}</datalist>
      <p><label>${texteHtml('terrain_btp.actions.nc.precisions')}<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      <details><summary>${iconeHtml('terrain_btp_photo')} ${texteHtml('terrain_btp.actions.photos.joindre')}</summary><div data-photos></div></details>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
    construire: (dlg, fermer) => {
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      boutonPrincipal(dlg, texte('terrain_btp.actions.nc.signaler'), async () => {
        const motif = dlg.querySelector('[data-motif]').value.trim();
        if (!motif) { dlg.querySelector('[data-motif]').focus(); return; }
        const commentaire = dlg.querySelector('[data-commentaire]').value.trim() || null;
        try {
          const nc = { motif, commentaire };
          const photos = s.nombre ? await s.photos(`${texte('terrain_btp.actions.nc.photos', { motif })}${commentaire ? ` — ${commentaire}` : ''}`) : null;
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.NON_CONFORMITE, id: Date.now(), corps: { tache: tache.id, nc, photos },
            libelle: texte('terrain_btp.actions.nc.libelle', { motif, tache: tache.libelle }) }, async () => {
            const rep = await api.terrain.nonConformite(tache.id, nc);
            if (photos) await api.terrain.photos(tache.id, formulairePhotos(photos));
            return rep;
          });
          if (r.reponse) app.message(texte(r.reponse.crm ? 'terrain_btp.actions.nc.signalee' : 'terrain_btp.actions.nc.enregistree'), r.reponse.crm ? 'succes' : 'avertissement');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/**
 * Demande d'approvisionnement (E_DAP, lot 5) depuis une tâche : articles choisis dans la bibliothèque simplifiée
 * (quantité, unité de l'article ; terrain-suites lot 18), autres besoins en texte libre (un par ligne), commentaire,
 * photos jointes (GED de la tâche). Le serveur crée la demande sur le chantier de la tâche ; vrai si envoyée.
 */
export async function demanderApprovisionnement(app, tache) {
  /** Articles choisis : { article, quantite, unite } (champs de la fenêtre). */
  const choisis = [];
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_demande')} ${texte('terrain_btp.actions.demande.titre', { tache: tache.libelle })}`,
    html: `<div><b>${texteHtml('terrain_btp.actions.demande.choisis')}</b><ul class="terrain-liens" data-choisis></ul>
        <button type="button" data-bibliotheque>${iconeHtml('terrain_btp_bibliotheque')} ${texteHtml('terrain_btp.actions.demande.ajouter')}</button></div>
      <p><label>${texteHtml('terrain_btp.actions.demande.articles')}<br><textarea data-articles rows="4" cols="34" placeholder="${texteHtml('terrain_btp.actions.demande.exemple')}"></textarea></label></p>
      <p><label>${texteHtml('terrain_btp.actions.demande.commentaire')}<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      <details><summary>${iconeHtml('terrain_btp_photo')} ${texteHtml('terrain_btp.actions.photos.joindre')}</summary><div data-photos></div></details>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
    construire: (dlg, fermer) => {
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      const liste = dlg.querySelector('[data-choisis]');
      const ajouter = (article) => {
        const li = document.createElement('li');
        li.className = 'ligne';
        li.innerHTML = `<span><b>${echapper(article.code)}</b> ${echapper(article.libelle)}</span>
          <input type="number" data-quantite min="0" step="any" inputmode="decimal" size="5" value="1" title="${texteHtml('terrain_btp.actions.demande.quantite')}">
          <button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>`;
        const unites = unitesArticle(article);
        const unite = creerCombo({ options: unites.map((u) => ({ valeur: u, libelle: u })), valeur: unites[0] ?? '', vide: false, titre: texte('terrain_btp.actions.demande.unite') });
        li.querySelector('[data-retirer]').before(unite);
        const choix = { article, quantite: li.querySelector('[data-quantite]'), unite };
        choisis.push(choix);
        li.querySelector('[data-retirer]').addEventListener('click', () => { choisis.splice(choisis.indexOf(choix), 1); li.remove(); });
        liste.append(li);
      };
      dlg.querySelector('[data-bibliotheque]').addEventListener('click', async () => {
        const article = await choisirArticle(app, tache.chantier);
        if (article) ajouter(article);
      });
      boutonPrincipal(dlg, texte('terrain_btp.actions.demande.envoyer'), async () => {
        const articles = dlg.querySelector('[data-articles]').value.split('\n').map((x) => x.trim()).filter(Boolean);
        const lignes = choisis.map((c) => ligneDemande(c.article, c.quantite.value, c.unite.resoudre()));
        if (!articles.length && !lignes.length) { dlg.querySelector('[data-articles]').focus(); return; }
        const demande = { cha_id: tache.chantier.id, ent_id: tache.ordre?.id ?? null, articles, lignes, commentaire: dlg.querySelector('[data-commentaire]').value.trim() || null };
        const noms = [...choisis.map((c) => c.article.libelle), ...articles];
        try {
          const photos = s.nombre ? await s.photos(texte('terrain_btp.actions.demande.photos', { articles: noms.join(', ') })) : null;
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.DEMANDE, id: Date.now(), corps: { demande, tache: tache.id, photos },
            libelle: texte('terrain_btp.actions.demande.titre', { tache: tache.libelle }) }, async () => {
            const rep = await api.terrain.demande(demande);
            if (photos) await api.terrain.photos(tache.id, formulairePhotos(photos));
            return rep;
          });
          if (r.reponse) app.message(texte('terrain_btp.actions.demande.envoyee', { numero: r.reponse.numero ?? '' }).replace('  ', ' '), 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Bouton principal ajouté à côté des boutons de la fenêtre. */
export function boutonPrincipal(dlg, libelle, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'principal';
  b.textContent = libelle;
  b.addEventListener('click', async () => { b.disabled = true; try { await action(); } finally { b.disabled = false; } });
  const annuler = [...dlg.querySelectorAll('button')].find((x) => x.textContent.trim() === texte('commun.annuler'));
  (annuler?.parentElement ?? dlg).append(b);
}
