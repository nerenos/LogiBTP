// Module MCP, recettes (lot 13 ; ANALYSE-MODULE-MCP.md § 10.2 et 10.4) : gestion des recettes de l'entreprise par
// l'administrateur (prompt paramétré, paramètres typés, outils permis, sortie attendue, active) et fenêtre « Demander à
// l'agent » (choix d'une recette, prompt prérempli avec la référence de l'élément, copié dans le presse-papiers ; jamais
// d'action directe). Composants sans métier : l'application fournit les appels, les recettes et la référence de l'élément.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatDateHeure, creerCombo, confirmer, ouvrirDialogue, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { TYPE_PARAMETRE_RECETTE, SORTIE_RECETTE } from '../src/codes.js';
import { controlerRecette, parametresPrompt, remplirPrompt } from '../src/recettes.js';
import { corpsRecette, parametresDepuisPrompt, recettesPourType, valeursInitiales } from './modeles.js';

export const GROUPE_RACCOURCIS_RECETTES = 'mcp_recettes';
declarerRaccourcis(GROUPE_RACCOURCIS_RECETTES, {
  libelle: texte('mcp.raccourcis.groupe_recettes'),
  actions: { nouvelle: { libelle: texte('mcp.raccourcis.nouvelle_recette'), defaut: 'Alt+N' } },
});

const libelleType = (t) => texte(`mcp.recettes.types.${t}`);

/**
 * Fenêtre gardée ouverte tant que la saisie est invalide : un clic sur un bouton autre que le premier (Annuler) est
 * arrêté avant le bouton (phase de capture) quand `valide()` est faux.
 */
function retenirSiInvalide(dialogue, valide) {
  dialogue.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bouton]');
    if (b && b.dataset.bouton !== '0' && !valide()) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

/** Tableau des recettes (HTML) : état, libellé et code, sortie, paramètres typés, outils, origine ; modifier, supprimer (sauf fournie). */
export function recettesHtml(liste) {
  const lignes = (liste ?? []).map((r) => `<tr class="${r.active ? '' : 'mcp-inactive'}">
      <td>${iconeHtml(r.active ? 'mcp_active' : 'mcp_echue')}</td>
      <td>${echapper(r.libelle)}<br><code>${echapper(r.code)}</code></td>
      <td>${texteHtml(`mcp.recettes.sorties.${r.sortie}`)}</td>
      <td>${(r.parametres ?? []).map((p) => `<span class="mcp-pastille">${echapper(p.nom)} : ${echapper(libelleType(p.type))}${p.requis ? ' *' : ''}</span>`).join(' ')}</td>
      <td>${(r.outils ?? []).map((o) => `<code>${echapper(o)}</code>`).join(' ')}</td>
      <td class="aide">${r.fournie ? texteHtml('mcp.recettes.fournie') : ''}${r.modifie_le ? ` ${texteHtml('mcp.recettes.modifie', { date: formatDateHeure(r.modifie_le), par: r.modifie_par ?? '' })}` : ''}</td>
      <td class="cellule-boutons"><button type="button" class="bouton-icone" data-modifier="${echapper(r.code)}" title="${echapper(texte('mcp.recettes.modifier'))}">${iconeHtml('mcp_corriger')}</button>
        ${r.fournie ? '' : `<button type="button" class="bouton-icone danger" data-supprimer="${echapper(r.code)}" title="${echapper(texte('mcp.recettes.supprimer'))}">${iconeHtml('mcp_revoquer')}</button>`}</td></tr>`).join('');
  return `<table class="tableau-compact mcp-table"><thead><tr><th></th><th>${texteHtml('mcp.recettes.libelle')}</th><th>${texteHtml('mcp.recettes.sortie')}</th>
      <th>${texteHtml('mcp.recettes.parametres')}</th><th>${texteHtml('mcp.recettes.outils')}</th><th></th><th></th></tr></thead>
    <tbody>${lignes || `<tr><td colspan="7" class="aide">${texteHtml('mcp.recettes.aucune')}</td></tr>`}</tbody></table>`;
}

/** Lignes des paramètres (HTML) : nom (marque du prompt), type (combo monté ensuite), libellé, requis. */
function parametresHtml(parametres) {
  if (!parametres.length) return `<p class="aide">${texteHtml('mcp.recettes.sans_parametre')}</p>`;
  return `<table class="tableau-compact mcp-table"><thead><tr><th>${texteHtml('mcp.recettes.parametre_nom')}</th><th>${texteHtml('mcp.recettes.parametre_type')}</th>
      <th>${texteHtml('mcp.recettes.parametre_libelle')}</th><th>${texteHtml('mcp.recettes.parametre_requis')}</th></tr></thead><tbody>
    ${parametres.map((p, i) => `<tr data-parametre="${i}"><td><code>{${echapper(p.nom)}}</code></td><td data-type></td>
      <td><input type="text" data-libelle-parametre maxlength="100" value="${echapper(p.libelle ?? '')}"></td>
      <td><input type="checkbox" data-requis ${p.requis ? 'checked' : ''}></td></tr>`).join('')}</tbody></table>`;
}

/**
 * Formulaire d'une recette (HTML) : code (saisi à la création seulement), libellé, description, prompt (marques « {nom} »),
 * paramètres (suivent les marques), outils du catalogue cochables, sortie (combo), active.
 */
export function formulaireRecetteHtml(recette, { outils = [], nouvelle = false } = {}) {
  const r = recette ?? {};
  return `<label>${texteHtml('mcp.recettes.code')} <input type="text" data-code maxlength="60" pattern="[a-z][a-z0-9_]+" value="${echapper(r.code ?? '')}" ${nouvelle ? '' : 'readonly'}></label>
    <label>${texteHtml('mcp.recettes.libelle')} <input type="text" data-libelle maxlength="200" value="${echapper(r.libelle ?? '')}"></label>
    <label>${texteHtml('mcp.recettes.description')} <input type="text" data-description maxlength="500" value="${echapper(r.description ?? '')}"></label>
    <label>${texteHtml('mcp.recettes.prompt')} <textarea data-prompt rows="6" class="mcp-json">${echapper(r.prompt ?? '')}</textarea></label>
    <p class="aide">${texteHtml('mcp.recettes.prompt_aide')}</p>
    <fieldset><legend>${texteHtml('mcp.recettes.parametres')}</legend><div data-parametres></div></fieldset>
    <fieldset><legend>${texteHtml('mcp.recettes.outils')}</legend><p class="aide">${texteHtml('mcp.recettes.outils_aide')}</p>
      ${outils.map((o) => `<label class="ligne" title="${echapper(o.description ?? '')}"><input type="checkbox" data-outil="${echapper(o.nom)}" ${(r.outils ?? []).includes(o.nom) ? 'checked' : ''}>
        <code>${echapper(o.nom)}</code> <span class="aide">${texteHtml(`mcp.classes.${o.classe}`)}</span></label>`).join('')}</fieldset>
    <label>${texteHtml('mcp.recettes.sortie')} <span data-sortie></span></label>
    <label class="ligne"><input type="checkbox" data-active ${r.active === false ? '' : 'checked'}> ${texteHtml('mcp.recettes.active')}</label>
    <p class="mcp-erreur" data-erreurs></p>`;
}

/** Monte le formulaire : paramètres suivant le prompt (types par combo), sortie par combo ; rend `{ lire(), controler() }`. */
export function monterFormulaireRecette(racine, recette, { outils = [] } = {}) {
  let parametres = [...(recette?.parametres ?? [])];
  const types = Object.values(TYPE_PARAMETRE_RECETTE).map((t) => ({ valeur: t, libelle: libelleType(t) }));
  const prompt = racine.querySelector('[data-prompt]');
  const zone = racine.querySelector('[data-parametres]');
  const saisis = () => parametres.map((p, i) => {
    const tr = zone.querySelector(`[data-parametre="${i}"]`);
    return { ...p, type: tr?.querySelector('[data-type] input')?.valeurCombo ?? p.type,
      libelle: tr?.querySelector('[data-libelle-parametre]')?.value ?? p.libelle, requis: tr?.querySelector('[data-requis]')?.checked ?? p.requis };
  });
  const rendreParametres = () => {
    parametres = parametresDepuisPrompt(parametresPrompt(prompt.value), saisis());
    zone.innerHTML = parametresHtml(parametres);
    parametres.forEach((p, i) => zone.querySelector(`[data-parametre="${i}"] [data-type]`)
      ?.append(creerCombo({ options: types, valeur: p.type, vide: false })));
  };
  prompt.addEventListener('change', rendreParametres);
  rendreParametres();
  const sortie = creerCombo({ options: Object.values(SORTIE_RECETTE).map((s) => ({ valeur: s, libelle: texte(`mcp.recettes.sorties.${s}`) })),
    valeur: recette?.sortie ?? SORTIE_RECETTE.RAPPORT, vide: false });
  racine.querySelector('[data-sortie]').append(sortie);
  const lire = () => {
    parametres = parametresDepuisPrompt(parametresPrompt(prompt.value), saisis());
    return {
      code: racine.querySelector('[data-code]').value.trim(),
      ...corpsRecette({
        libelle: racine.querySelector('[data-libelle]').value, description: racine.querySelector('[data-description]').value, prompt: prompt.value,
        parametres, outils: [...racine.querySelectorAll('[data-outil]:checked')].map((c) => c.dataset.outil), sortie: sortie.valeurCombo,
        active: racine.querySelector('[data-active]').checked,
      }),
    };
  };
  /** Contrôle local identique au serveur (controlerRecette) : messages affichés, null si invalide. */
  const controler = () => {
    const r = lire();
    const erreurs = controlerRecette(r, outils.map((o) => o.nom));
    racine.querySelector('[data-erreurs]').textContent = erreurs.map((e) => texte(`mcp.recettes.erreurs.${e}`)).join(' ');
    return erreurs.length ? null : r;
  };
  return { lire, controler };
}

/**
 * Gestion des recettes (administrateur). options : { api: { liste() → { recettes, outils }, enregistrer(code, corps),
 * supprimer(code) } (promesses), apresEcriture(), erreur(e) }.
 */
export class GestionRecettes {
  #zone;
  #o;
  #liste = [];
  #outils = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, apresEcriture: () => {}, erreur: () => {}, ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('keydown', (e) => {
      if (actionDe(e, GROUPE_RACCOURCIS_RECETTES) === 'nouvelle') { e.preventDefault(); this.editer(null); }
    });
  }

  async charger() {
    try {
      const r = (await this.#o.api.liste()) ?? {};
      this.#liste = r.recettes ?? [];
      this.#outils = r.outils ?? [];
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('mcp_recette')} ${texteHtml('mcp.recettes.titre')}
        <button type="button" data-nouvelle>${iconeHtml('mcp_ajouter')} ${texteHtml('mcp.recettes.nouvelle')}</button></h2>
      <p class="aide">${texteHtml('mcp.recettes.aide')}</p>${recettesHtml(this.#liste)}`;
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-nouvelle]')) this.editer(null);
    else if (b.dataset.modifier) this.editer(this.#liste.find((r) => r.code === b.dataset.modifier));
    else if (b.dataset.supprimer) this.#supprimer(this.#liste.find((r) => r.code === b.dataset.supprimer));
  }

  /** Saisie d'une recette (nouvelle si `recette` est nul) dans une fenêtre du socle, contrôlée avant l'envoi. */
  async editer(recette) {
    let formulaire;
    const corps = await ouvrirDialogue({
      titre: texte(recette ? 'mcp.recettes.titre_modifier' : 'mcp.recettes.titre_nouvelle'), classe: 'mcp-dialogue mcp-recette', valeurAnnulation: null,
      html: formulaireRecetteHtml(recette, { outils: this.#outils, nouvelle: !recette }),
      boutons: [{ libelle: texte('commun.annuler'), valeur: null }, { libelle: texte('mcp.recettes.enregistrer'), principal: true, valeur: () => formulaire.lire() }],
      construire: (d) => {
        formulaire = monterFormulaireRecette(d, recette, { outils: this.#outils });
        retenirSiInvalide(d, () => formulaire.controler() !== null);
      },
    });
    if (!corps) return;
    const { code, ...reste } = corps;
    try {
      await this.#o.api.enregistrer(code, reste);
      this.#o.apresEcriture();
    } catch (e) {
      this.#o.erreur(e);
    }
    await this.charger();
  }

  async #supprimer(r) {
    if (!r || !await confirmer(texte('mcp.recettes.confirmer_suppression', { libelle: r.libelle }), { ok: texte('mcp.recettes.supprimer'), danger: true })) return;
    try {
      await this.#o.api.supprimer(r.code);
      this.#o.apresEcriture();
    } catch (e) {
      this.#o.erreur(e);
    }
    await this.charger();
  }
}

/** Champs de la fenêtre « Demander à l'agent » (HTML) : recette (combo monté ensuite), paramètres, prompt obtenu. */
export function demandeHtml(element) {
  return `<p>${texteHtml('mcp.demande.element', { element: element ?? '' })}</p>
    <label>${texteHtml('mcp.demande.recette')} <span data-recette></span></label>
    <p class="aide" data-description></p>
    <div data-valeurs></div>
    <label>${texteHtml('mcp.demande.prompt')} <textarea data-texte rows="6" class="mcp-json" readonly></textarea></label>
    <p class="mcp-erreur" data-manquants></p>
    <p class="aide">${texteHtml('mcp.demande.aide')}</p>`;
}

/** Champs des paramètres d'une recette (HTML), préremplis par `valeurs`. */
export function valeursHtml(recette, valeurs) {
  return (recette?.parametres ?? []).map((p) => `<label>${echapper(p.libelle || p.nom)} <span class="aide">(${echapper(libelleType(p.type))}${p.requis ? ' *' : ''})</span>
      ${p.type === TYPE_PARAMETRE_RECETTE.TEXTE ? `<textarea data-valeur="${echapper(p.nom)}" rows="2">${echapper(valeurs?.[p.nom] ?? '')}</textarea>`
    : `<input type="text" data-valeur="${echapper(p.nom)}" value="${echapper(valeurs?.[p.nom] ?? '')}">`}</label>`).join('');
}

/**
 * Fenêtre « Demander à l'agent » : choix d'une recette parmi celles du type de l'élément, paramètres préremplis avec sa
 * référence, prompt rempli copié dans le presse-papiers ; lien d'ouverture du client seulement si `adresseClient(texte)`
 * rend une adresse (client dont l'adresse de conversation préremplie est documentée), sinon copie seule. Aucune action
 * directe sur l'application : l'agent agit ensuite sous sa délégation. options : { recettes, type, reference, element
 * (libellé affiché), copier(texte), adresseClient(texte) → adresse ou null, ouvrir(adresse), message(texte), erreur(e) }.
 * Rend le prompt copié (ou null).
 */
export async function demanderAgent(options = {}) {
  const o = {
    copier: (t) => globalThis.navigator?.clipboard?.writeText(t), adresseClient: () => null, ouvrir: () => {}, message: () => {}, erreur: () => {}, ...options,
  };
  const recettes = recettesPourType(o.recettes, o.type);
  if (!recettes.length) { o.message(texte('mcp.demande.aucune')); return null; }
  let lire;
  const choix = await ouvrirDialogue({
    titre: texte('mcp.demande.titre'), classe: 'mcp-dialogue mcp-demande', valeurAnnulation: null,
    html: demandeHtml(o.element ?? o.reference),
    boutons: [{ libelle: texte('commun.annuler'), valeur: null },
      ...(o.adresseClient('') !== null ? [{ libelle: texte('mcp.demande.ouvrir'), valeur: () => lire('ouvrir') }] : []),
      { libelle: texte('mcp.demande.copier'), principal: true, valeur: () => lire('copier') }],
    construire: (d) => {
      const combo = creerCombo({ options: recettes.map((r) => ({ valeur: r.code, libelle: r.libelle })), valeur: recettes[0].code, vide: false });
      d.querySelector('[data-recette]').append(combo);
      const recette = () => recettes.find((r) => r.code === combo.valeurCombo) ?? recettes[0];
      const valeurs = () => Object.fromEntries([...d.querySelectorAll('[data-valeur]')].map((c) => [c.dataset.valeur, c.value]));
      const actualiser = () => {
        const { texte: prompt, manquants } = remplirPrompt(recette(), valeurs());
        d.querySelector('[data-texte]').value = prompt;
        d.querySelector('[data-manquants]').textContent = manquants.length ? texte('mcp.demande.manquants', { noms: manquants.join(', ') }) : '';
        return { prompt, manquants };
      };
      const rendre = () => {
        d.querySelector('[data-description]').textContent = recette().description ?? '';
        d.querySelector('[data-valeurs]').innerHTML = valeursHtml(recette(), valeursInitiales(recette(), o.type, o.reference));
        actualiser();
      };
      combo.addEventListener('change', rendre);
      d.querySelector('[data-valeurs]').addEventListener('input', actualiser);
      rendre();
      lire = (mode) => ({ mode, prompt: actualiser().prompt });
      retenirSiInvalide(d, () => actualiser().manquants.length === 0);
    },
  });
  if (!choix) return null;
  try {
    await o.copier(choix.prompt);
    o.message(texte('mcp.demande.copie'));
    if (choix.mode === 'ouvrir') o.ouvrir(o.adresseClient(choix.prompt));
  } catch (e) {
    o.erreur(e);
  }
  return choix.prompt;
}
