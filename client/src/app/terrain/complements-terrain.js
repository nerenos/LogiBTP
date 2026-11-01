import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirDialogue, creerCombo, formatNombre } from '@logibtp/socle/ui';
import { aujourdhui } from '@logibtp/socle';
import { lireDuree } from '@logibtp/pointage';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';
import { envoyerOuGarder, OPERATION_TERRAIN, formulairePhotos } from './operations-terrain.js';
import { selecteurPhotos, boutonPrincipal } from './actions-tache.js';

// Application de terrain, lot 7 (ANALYSE-TERRAIN.md T18, T19) : depuis une carte de tâche, réception de livraison
// simplifiée (commandes du chantier, quantités reçues ; bon de livraison brouillon validé au bureau) et pointage d'un
// matériel (heures, compteurs, plein). Serveur : TerrainComplementsBtp.cs. Hors ligne : saisie gardée sur l'appareil si
// les commandes ou les matériels ont déjà été lus.

const SANS_RESEAU = () => texte('terrain_btp.complements.sans_reseau');

/** Réception d'une livraison sur le chantier de la tâche ; vrai si envoyée. */
export async function recevoirLivraison(app, tache) {
  let d;
  try { d = await api.terrain.livraisons(tache.chantier.id); } catch (e) { if (estHorsLigne(e)) app.message(SANS_RESEAU(), 'avertissement'); else app.erreur(e); return false; }
  if (!d.commandes.length) { app.message(texte('terrain_btp.livraison.aucune'), 'avertissement'); return false; }
  let commande = d.commandes[0];
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_livraison')} ${texte('terrain_btp.livraison.titre', { chantier: tache.chantier.code })}`,
    html: `<p><label>${texteHtml('terrain_btp.livraison.commande')} <span data-commande></span></label></p>
      <div data-lignes></div>
      <p><label>${texteHtml('terrain_btp.livraison.bl')}<br><input data-bl size="24"></label></p>
      <p><label>${texteHtml('terrain_btp.livraison.commentaire')}<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      <details><summary>${iconeHtml('terrain_btp_photo')} ${texteHtml('terrain_btp.livraison.photo')}</summary><div data-photos></div></details>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
    construire: (dlg, fermer) => {
      const lignes = () => {
        dlg.querySelector('[data-lignes]').innerHTML = commande.lignes.map((l) => `<p class="terrain-ligne"><span>${echapper(l.libelle)}</span>
          <input type="number" min="0" step="any" inputmode="decimal" size="6" data-ligne="${l.lig_id}" value="${l.reste}" aria-label="${texteHtml('terrain_btp.livraison.quantite')}"></p>`).join('');
      };
      const cb = creerCombo({ options: d.commandes.map((c) => ({ valeur: c.ent_id, libelle: c.numero ?? String(c.ent_id), detail: c.fournisseur ?? '' })), valeur: commande.ent_id, vide: false });
      cb.addEventListener('change', () => { commande = d.commandes.find((c) => c.ent_id === Number(cb.valeurCombo)) ?? commande; lignes(); });
      dlg.querySelector('[data-commande]').append(cb);
      lignes();
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      boutonPrincipal(dlg, texte('commun.enregistrer'), async () => {
        const livraison = {
          lignes: [...dlg.querySelectorAll('[data-ligne]')].map((i) => ({ lig_id: Number(i.dataset.ligne), qte: Number(i.value) || 0 })).filter((l) => l.qte > 0),
          numero_bl: dlg.querySelector('[data-bl]').value.trim() || null,
          commentaire: dlg.querySelector('[data-commentaire]').value.trim() || null,
        };
        if (!livraison.lignes.length) { app.message(texte('terrain_btp.livraison.vide'), 'avertissement'); return; }
        try {
          const photos = s.nombre ? await s.photos(texte('terrain_btp.livraison.libelle', { numero: commande.numero ?? '' }).trim()) : null;
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.LIVRAISON, id: Date.now(), corps: { commande: commande.ent_id, livraison, tache: tache.id, photos },
            libelle: texte('terrain_btp.livraison.libelle', { numero: commande.numero ?? '' }).trim() }, async () => {
            const rep = await api.terrain.enregistrerLivraison(commande.ent_id, livraison);
            if (photos) await api.terrain.photos(tache.id, formulairePhotos(photos));
            return rep;
          });
          if (r.reponse) app.message(texte('terrain_btp.livraison.creee', { numero: r.reponse.numero ?? '' }), 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Pointage d'un matériel sur la tâche : heures d'utilisation, compteurs, plein ; vrai si envoyé. */
export async function pointerMateriel(app, tache) {
  let materiels;
  try { materiels = await api.terrain.materiels(tache.id); } catch (e) { if (estHorsLigne(e)) app.message(SANS_RESEAU(), 'avertissement'); else app.erreur(e); return false; }
  if (!materiels.length) { app.message(texte('terrain_btp.materiel.aucun'), 'avertissement'); return false; }
  let mat = materiels[0];
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_materiel')} ${texte('terrain_btp.materiel.titre', { tache: tache.libelle })}`,
    html: `<p><label>${texteHtml('terrain_btp.materiel.materiel')} <span data-materiel></span></label></p>
      <p><label>${texteHtml('terrain_btp.materiel.duree')} <input data-duree inputmode="decimal" size="6" placeholder="3:30"></label></p>
      <p data-bloc-h><label>${texteHtml('terrain_btp.materiel.compteur_h')} <input type="number" min="0" step="any" inputmode="decimal" size="8" data-heures></label> <small class="aide" data-dernier-h></small></p>
      <p data-bloc-km><label>${texteHtml('terrain_btp.materiel.compteur_km')} <input type="number" min="0" step="any" inputmode="decimal" size="8" data-km></label> <small class="aide" data-dernier-km></small></p>
      <details><summary>${iconeHtml('terrain_btp_plein')} ${texteHtml('terrain_btp.materiel.plein')}</summary><p><label>${texteHtml('terrain_btp.materiel.litres')} <input type="number" min="0" step="any" inputmode="decimal" size="6" data-litres></label>
        <label>${texteHtml('terrain_btp.materiel.cout')} <input type="number" min="0" step="any" inputmode="decimal" size="6" data-cout></label></p></details>
      <p><label>${texteHtml('terrain_btp.materiel.commentaire')}<br><input data-commentaire size="34"></label></p>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: false }],
    construire: (dlg, fermer) => {
      const $ = (x) => dlg.querySelector(x);
      const compteurs = () => {
        $('[data-bloc-h]').hidden = !['H', 'H_KM'].includes(mat.compteurs);
        $('[data-bloc-km]').hidden = !['KM', 'H_KM'].includes(mat.compteurs);
        $('[data-dernier-h]').textContent = mat.heures != null ? texte('terrain_btp.materiel.dernier', { valeur: formatNombre(mat.heures, 0) }) : '';
        $('[data-dernier-km]').textContent = mat.kilometres != null ? texte('terrain_btp.materiel.dernier', { valeur: formatNombre(mat.kilometres, 0) }) : '';
      };
      const cb = creerCombo({ options: materiels.map((m) => ({ valeur: m.id, libelle: m.libelle })), valeur: mat.id, vide: false });
      cb.addEventListener('change', () => { mat = materiels.find((m) => m.id === Number(cb.valeurCombo)) ?? mat; compteurs(); });
      $('[data-materiel]').append(cb);
      compteurs();
      const nombre = (x) => { const v = $(x).closest('[hidden]') ? '' : $(x).value; return v === '' ? null : Number(v); };
      boutonPrincipal(dlg, texte('commun.enregistrer'), async () => {
        const saisie = { mat_id: mat.id, date: aujourdhui(), minutes: $('[data-duree]').value.trim() ? lireDuree($('[data-duree]').value) : null, heures: nombre('[data-heures]'), kilometres: nombre('[data-km]'),
          litres: nombre('[data-litres]'), cout: nombre('[data-cout]'), commentaire: $('[data-commentaire]').value.trim() || null };
        if (!(saisie.minutes > 0) && saisie.heures == null && saisie.kilometres == null && saisie.litres == null) { app.message(texte('terrain_btp.materiel.rien'), 'avertissement'); return; }
        try {
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.MATERIEL, id: Date.now(), corps: { tache: tache.id, saisie }, libelle: texte('terrain_btp.materiel.libelle', { materiel: mat.libelle }) },
            () => api.terrain.pointerMateriel(tache.id, saisie));
          if (r.reponse) app.message(texte('terrain_btp.materiel.pointe'), 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}
