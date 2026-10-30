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

const SANS_RESEAU = 'Hors ligne : à ouvrir une première fois avec le réseau';

/** Réception d'une livraison sur le chantier de la tâche ; vrai si envoyée. */
export async function recevoirLivraison(app, tache) {
  let d;
  try { d = await api.terrain.livraisons(tache.chantier.id); } catch (e) { if (estHorsLigne(e)) app.message(SANS_RESEAU, 'avertissement'); else app.erreur(e); return false; }
  if (!d.commandes.length) { app.message('Aucune commande à recevoir sur ce chantier', 'avertissement'); return false; }
  let commande = d.commandes[0];
  return ouvrirDialogue({
    titre: `🚚 Livraison · ${tache.chantier.code}`,
    html: `<p><label>Commande <span data-commande></span></label></p>
      <div data-lignes></div>
      <p><label>N° du bon de livraison<br><input data-bl size="24"></label></p>
      <p><label>Commentaire (manquants, casse…)<br><textarea data-commentaire rows="2" cols="34"></textarea></label></p>
      <details><summary>📷 Photo du bon ou de la casse</summary><div data-photos></div></details>`,
    boutons: [{ libelle: 'Annuler', valeur: false }],
    construire: (dlg, fermer) => {
      const lignes = () => {
        dlg.querySelector('[data-lignes]').innerHTML = commande.lignes.map((l) => `<p class="terrain-ligne"><span>${echapper(l.libelle)}</span>
          <input type="number" min="0" step="any" inputmode="decimal" size="6" data-ligne="${l.lig_id}" value="${l.reste}" aria-label="Quantité reçue"></p>`).join('');
      };
      const cb = creerCombo({ options: d.commandes.map((c) => ({ valeur: c.ent_id, libelle: c.numero ?? String(c.ent_id), detail: c.fournisseur ?? '' })), valeur: commande.ent_id, vide: false });
      cb.addEventListener('change', () => { commande = d.commandes.find((c) => c.ent_id === Number(cb.valeurCombo)) ?? commande; lignes(); });
      dlg.querySelector('[data-commande]').append(cb);
      lignes();
      const s = selecteurPhotos(dlg.querySelector('[data-photos]'));
      boutonPrincipal(dlg, 'Enregistrer', async () => {
        const livraison = {
          lignes: [...dlg.querySelectorAll('[data-ligne]')].map((i) => ({ lig_id: Number(i.dataset.ligne), qte: Number(i.value) || 0 })).filter((l) => l.qte > 0),
          numero_bl: dlg.querySelector('[data-bl]').value.trim() || null,
          commentaire: dlg.querySelector('[data-commentaire]').value.trim() || null,
        };
        if (!livraison.lignes.length) { app.message('Saisissez au moins une quantité reçue', 'avertissement'); return; }
        try {
          const photos = s.nombre ? await s.photos(`Livraison ${commande.numero ?? ''}`.trim()) : null;
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.LIVRAISON, id: Date.now(), corps: { commande: commande.ent_id, livraison, tache: tache.id, photos },
            libelle: `Livraison ${commande.numero ?? ''}`.trim() }, async () => {
            const rep = await api.terrain.enregistrerLivraison(commande.ent_id, livraison);
            if (photos) await api.terrain.photos(tache.id, formulairePhotos(photos));
            return rep;
          });
          if (r.reponse) app.message(`Bon ${r.reponse.numero ?? ''} créé : à valider au bureau`, 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}

/** Pointage d'un matériel sur la tâche : heures d'utilisation, compteurs, plein ; vrai si envoyé. */
export async function pointerMateriel(app, tache) {
  let materiels;
  try { materiels = await api.terrain.materiels(tache.id); } catch (e) { if (estHorsLigne(e)) app.message(SANS_RESEAU, 'avertissement'); else app.erreur(e); return false; }
  if (!materiels.length) { app.message('Aucun matériel sur cette tâche ni affecté à vous', 'avertissement'); return false; }
  let mat = materiels[0];
  return ouvrirDialogue({
    titre: `🚜 Matériel · ${tache.libelle}`,
    html: `<p><label>Matériel <span data-materiel></span></label></p>
      <p><label>Durée d'utilisation <input data-duree inputmode="decimal" size="6" placeholder="3:30"></label></p>
      <p data-bloc-h><label>Compteur (h) <input type="number" min="0" step="any" inputmode="decimal" size="8" data-heures></label> <small class="aide" data-dernier-h></small></p>
      <p data-bloc-km><label>Compteur (km) <input type="number" min="0" step="any" inputmode="decimal" size="8" data-km></label> <small class="aide" data-dernier-km></small></p>
      <details><summary>⛽ Plein de carburant</summary><p><label>Litres <input type="number" min="0" step="any" inputmode="decimal" size="6" data-litres></label>
        <label>Coût (€) <input type="number" min="0" step="any" inputmode="decimal" size="6" data-cout></label></p></details>
      <p><label>Commentaire<br><input data-commentaire size="34"></label></p>`,
    boutons: [{ libelle: 'Annuler', valeur: false }],
    construire: (dlg, fermer) => {
      const $ = (x) => dlg.querySelector(x);
      const compteurs = () => {
        $('[data-bloc-h]').hidden = !['H', 'H_KM'].includes(mat.compteurs);
        $('[data-bloc-km]').hidden = !['KM', 'H_KM'].includes(mat.compteurs);
        $('[data-dernier-h]').textContent = mat.heures != null ? `dernier : ${formatNombre(mat.heures, 0)}` : '';
        $('[data-dernier-km]').textContent = mat.kilometres != null ? `dernier : ${formatNombre(mat.kilometres, 0)}` : '';
      };
      const cb = creerCombo({ options: materiels.map((m) => ({ valeur: m.id, libelle: m.libelle })), valeur: mat.id, vide: false });
      cb.addEventListener('change', () => { mat = materiels.find((m) => m.id === Number(cb.valeurCombo)) ?? mat; compteurs(); });
      $('[data-materiel]').append(cb);
      compteurs();
      const nombre = (x) => { const v = $(x).closest('[hidden]') ? '' : $(x).value; return v === '' ? null : Number(v); };
      boutonPrincipal(dlg, 'Enregistrer', async () => {
        const saisie = { mat_id: mat.id, date: aujourdhui(), minutes: $('[data-duree]').value.trim() ? lireDuree($('[data-duree]').value) : null, heures: nombre('[data-heures]'), kilometres: nombre('[data-km]'),
          litres: nombre('[data-litres]'), cout: nombre('[data-cout]'), commentaire: $('[data-commentaire]').value.trim() || null };
        if (!(saisie.minutes > 0) && saisie.heures == null && saisie.kilometres == null && saisie.litres == null) { app.message('Rien à enregistrer', 'avertissement'); return; }
        try {
          const r = await envoyerOuGarder(app, { type: OPERATION_TERRAIN.MATERIEL, id: Date.now(), corps: { tache: tache.id, saisie }, libelle: `Matériel · ${mat.libelle}` },
            () => api.terrain.pointerMateriel(tache.id, saisie));
          if (r.reponse) app.message('Matériel pointé', 'succes');
          fermer(true);
        } catch (e) { app.erreur(e); }
      });
    },
  });
}
