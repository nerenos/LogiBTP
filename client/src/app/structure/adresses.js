import { echapper, ouvrirModale } from '@logibtp/socle/ui';

// Adresse des travaux (ventes) ou de livraison (achats) d'un document, figée dans ent_adresse_livraison
// (CONCEPTION-DOCUMENTS-EVOLUTIONS.md, lot F) : { origine CHANTIER | DEPOT | COMPTOIR | LIBRE, source_id, libelle,
// adresse { ligne1, ligne2, ligne3, code_postal, ville, pays }, contact { ind_id, nom }, telephone, instructions,
// mention, releve_le }. Comparaison avec le client répliquée par AdressesDocument.cs (ventes : payeur et adresse des
// travaux identiques au client restent vides).

export const ORIGINES_ADRESSE = { CHANTIER: 'Chantier', DEPOT: 'Dépôt de l\'entreprise', COMPTOIR: 'Retrait au comptoir', LIBRE: 'Saisie libre' };

/** Texte comparé : espaces réduits, sans casse ; vide = ''. */
export const normaliser = (t) => String(t ?? '').split(/\s+/).filter(Boolean).join(' ').toUpperCase();

const CHAMPS_ADRESSE = ['ligne1', 'ligne2', 'ligne3', 'code_postal', 'ville'];

/** Même adresse postale (lignes, code postal, ville, pays FR par défaut). */
export function memeAdresse(a, b) {
  a ??= {};
  b ??= {};
  return CHAMPS_ADRESSE.every((c) => normaliser(a[c]) === normaliser(b[c])) && normaliser(a.pays ?? 'FR') === normaliser(b.pays ?? 'FR');
}

/** Adresse identique au client : même adresse, sans instructions ni mention, contact et téléphone absents ou du client. */
export function adresseIdentiqueAuClient(adresse, client) {
  if (!adresse || !client) return false;
  if (!memeAdresse(adresse.adresse, client.adresse)) return false;
  if (normaliser(adresse.instructions) || normaliser(adresse.mention)) return false;
  const contact = adresse.contact?.ind_id ?? null;
  if (contact !== null && contact !== (client.contact?.ind_id ?? null)) return false;
  const tel = normaliser(adresse.telephone);
  return tel === '' || tel === normaliser(client.telephone);
}

/** Payeur identique au client : même personne et même contact. */
export function payeurIdentiqueAuClient(payeur, client) {
  if (!payeur || !client) return false;
  return (payeur.per_id ?? null) === (client.per_id ?? null) && (payeur.contact?.ind_id ?? null) === (client.contact?.ind_id ?? null);
}

/** Lignes d'affichage d'une adresse (HTML). */
export function lignesAdresse(x) {
  const a = x.adresse ?? {};
  return [
    x.mention ? `<strong>${echapper(x.mention)}</strong>` : '',
    x.libelle ? `<strong>${echapper(x.libelle)}</strong>` : '',
    ...[a.ligne1, a.ligne2, a.ligne3].filter(Boolean).map(echapper),
    [a.code_postal, a.ville].filter(Boolean).map(echapper).join(' ') + (a.pays && a.pays !== 'FR' ? ` (${echapper(a.pays)})` : ''),
    x.contact?.nom ? `Contact sur place : ${echapper(x.contact.nom)}` : '',
    x.telephone ? `☎ ${echapper(x.telephone)}` : '',
    x.instructions ? `<em>${echapper(x.instructions)}</em>` : '',
  ].filter((l) => l && l.trim());
}

/** Saisie d'une adresse (libre, ou modification d'une adresse reprise) ; résout avec l'adresse, null (vider) ou undefined. */
export function saisirAdresse(x, { titre = 'Adresse' } = {}) {
  const v = x ?? { origine: 'LIBRE', adresse: {} };
  const a = v.adresse ?? {};
  return new Promise((resoudre) => {
    const fond = document.createElement('dialog');
    fond.className = 'fiche-dialogue-fond dialogue-plein';
    const champ = (cle, libelle, valeur, large = false) => `<label class="${large ? 'large' : ''}">${libelle}<input data-cle="${cle}" value="${echapper(valeur ?? '')}"></label>`;
    fond.innerHTML = `<section class="fiche-dialogue saisie-adresse" role="dialog" aria-label="${echapper(titre)}">
      <header><h2>${echapper(titre)}</h2><button type="button" data-fermer title="Fermer (Échap)">✕</button></header>
      <div class="formulaire">
        ${champ('libelle', 'Libellé (lieu, chantier, dépôt…)', v.libelle, true)}
        ${champ('ligne1', 'Adresse', a.ligne1, true)}${champ('ligne2', 'Complément', a.ligne2, true)}
        ${champ('code_postal', 'Code postal', a.code_postal)}${champ('ville', 'Ville', a.ville)}${champ('pays', 'Pays', a.pays ?? 'FR')}
        ${champ('contact', 'Contact sur place', v.contact?.nom)}${champ('telephone', 'Téléphone', v.telephone)}
        <label class="large">Instructions de livraison<textarea data-cle="instructions" rows="2">${echapper(v.instructions ?? '')}</textarea></label>
      </div>
      <footer><button type="button" data-vider>Vider</button><button type="button" data-fermer>Annuler</button><button type="button" class="principal" data-valider>Valider</button></footer></section>`;
    ouvrirModale(fond);
    const lire = (cle) => fond.querySelector(`[data-cle="${cle}"]`).value.trim() || null;
    const fermer = (r) => { fond.remove(); resoudre(r); };
    fond.querySelectorAll('[data-fermer]').forEach((b) => b.addEventListener('click', () => fermer(undefined)));
    fond.querySelector('[data-vider]').addEventListener('click', () => fermer(null));
    fond.querySelector('[data-valider]').addEventListener('click', () => {
      const nom = lire('contact');
      // Contact modifié à la main : il n'est plus celui de l'annuaire.
      const contact = nom ? (nom === v.contact?.nom ? v.contact : { ind_id: null, nom }) : null;
      fermer({
        ...v, origine: v.origine ?? 'LIBRE', libelle: lire('libelle'),
        adresse: { ligne1: lire('ligne1'), ligne2: lire('ligne2'), ligne3: a.ligne3 ?? null, code_postal: lire('code_postal'), ville: lire('ville'), pays: lire('pays') ?? 'FR' },
        contact, telephone: lire('telephone'), instructions: lire('instructions'), releve_le: v.releve_le ?? new Date().toISOString().slice(0, 10),
      });
    });
    fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(undefined); } });
    fond.querySelector('input')?.focus();
  });
}

/** Choix d'une adresse dans une liste (dépôts, comptoirs) ; résout avec l'adresse choisie ou null. */
export function choisirAdresse(liste, { titre }) {
  return new Promise((resoudre) => {
    const fond = document.createElement('dialog');
    fond.className = 'fiche-dialogue-fond dialogue-plein';
    fond.innerHTML = `<section class="fiche-dialogue saisie-adresse" role="dialog" aria-label="${echapper(titre)}">
      <header><h2>${echapper(titre)}</h2><button type="button" data-fermer title="Fermer (Échap)">✕</button></header>
      ${liste.length ? `<ul class="choix-adresses">${liste.map((x, i) => `<li><button type="button" data-i="${i}">${lignesAdresse(x).join('<br>')}</button></li>`).join('')}</ul>`
    : '<p class="aide">Aucune adresse dans l\'annuaire.</p>'}</section>`;
    ouvrirModale(fond);
    const fermer = (r) => { fond.remove(); resoudre(r ?? null); };
    fond.querySelector('[data-fermer]').addEventListener('click', () => fermer());
    fond.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => fermer(liste[Number(b.dataset.i)])));
    fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } });
    fond.querySelector('[data-i], [data-fermer]')?.focus();
  });
}
