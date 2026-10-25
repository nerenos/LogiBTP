import { echapper } from '@logibtp/socle/ui';

// Photo d'un individu ou logo d'une personne (lot 4 des demandes du 25/10/2026, db/229 : ind_image_ged,
// per_image_ged) : une image de la GED de la fiche, choisie dans l'onglet « Photo » (ou « Logo ») ; reprise par la
// fiche salarié (individu du salarié) et par Mon compte (individu du compte).

/** Adresse du contenu d'une image de la GED (document), null si absente ou retirée. */
export async function urlImage(ged, id) {
  if (!id || !ged) return null;
  try {
    const d = await ged.document(id);
    return d?.version ? ged.urlContenu(d.version.id) : null;
  } catch { return null; }
}

/** Adresse de la photo d'un individu (lue dans sa fiche par le fournisseur des fiches), null sans photo. */
export async function urlPhotoIndividu(fiches, ged, indId) {
  if (!indId || !fiches) return null;
  const f = await fiches.charger('individu', indId).catch(() => null);
  return urlImage(ged, f?.valeurs?.image_ged ?? null);
}

/** Vignette de l'encart d'une fiche. */
export const vignette = (url) => (url ? `<img class="element-vignette" src="${echapper(url)}" alt="">` : '');

/**
 * Onglet Photo / Logo : images de la GED de la fiche (cliquer = choisir), ajout d'une image (catégorie photo),
 * retrait. `definir(id | null)` pose le champ image_ged de la fiche (enregistré avec elle).
 */
export async function rendrePhoto(corps, { ged, typeElement, id, valeur, definir, modifiable, utilisateur, message, titre = 'Photo' }) {
  if (id === null) { corps.innerHTML = `<p class="aide">Enregistrez la fiche pour lui associer ${titre === 'Logo' ? 'un logo' : 'une photo'}.</p>`; return; }
  if (!ged) { corps.innerHTML = '<p class="aide">GED indisponible.</p>'; return; }
  const docs = await ged.lister({ type_element: typeElement, id_element: String(id) });
  const images = docs.filter((d) => d.version?.type_mime?.startsWith('image/'));
  const choisie = Number(valeur()) || null;
  corps.innerHTML = `<div class="element-medias"><fieldset class="fiche-groupe"><legend>${echapper(titre)}</legend>
      <div class="element-images">${images.map((d) => `<label class="element-image ${d.id === choisie ? 'choisie' : ''}">
        <img src="${echapper(ged.urlContenu(d.version.id))}" alt="${echapper(d.titre)}"><span><input type="radio" name="photo" value="${d.id}" ${d.id === choisie ? 'checked' : ''} ${modifiable ? '' : 'disabled'}> ${echapper(d.titre)}</span></label>`).join('')
        || '<p class="aide">Aucune image : ajoutez-en une.</p>'}</div>
      <p><button type="button" data-ajout>＋ Ajouter une image</button>${choisie && modifiable ? ' <button type="button" data-retirer>Retirer</button>' : ''}
        ${modifiable ? '' : '<span class="aide"> Passez en modification pour choisir l\'image.</span>'}</p>
    </fieldset><input type="file" accept="image/*" hidden data-fichier></div>`;
  const recharger = () => rendrePhoto(corps, { ged, typeElement, id, valeur, definir, modifiable, utilisateur, message, titre });
  corps.querySelectorAll('input[name="photo"]').forEach((r) => r.addEventListener('change', () => {
    definir(Number(r.value));
    corps.querySelectorAll('.element-image').forEach((l) => l.classList.toggle('choisie', l.contains(r)));
  }));
  corps.querySelector('[data-retirer]')?.addEventListener('click', () => { definir(null); recharger(); });
  const entree = corps.querySelector('[data-fichier]');
  corps.querySelector('[data-ajout]').addEventListener('click', () => entree.click());
  entree.addEventListener('change', async () => {
    const fichier = entree.files[0];
    entree.value = '';
    if (!fichier) return;
    try {
      const d = await ged.deposer({
        fichier, meta: {
          titre: fichier.name.replace(/\.[^.]+$/, ''), categorie: 'photo', type_element: typeElement, id_element: String(id),
          date_document: new Date().toISOString().slice(0, 10), auteur: utilisateur,
        },
      });
      message('Image ajoutée à la GED de la fiche', 'succes');
      if (modifiable && d?.id && !valeur()) definir(Number(d.id));
      await recharger();
    } catch (e) { message(e.message, 'erreur'); }
  });
}
