import { echapper, formatNombre } from '@logibtp/socle/ui';
import { unitesOptionnelles } from '@logibtp/document';
import { api } from '../api.js';
import { confirmerAvertissements } from './avertissements.js';

// Transformation d'un document (devis → commande, commande → livraison, situation, facture…) : fenêtre de choix du
// type cible, regroupée par étape (commande, livraison, situation, facturation, retour et avoir) puis ventes / achats,
// chaque choix décrit en une ligne ; un clic (ou flèches et Entrée) choisit. Tout le reliquat est transformé.
// Options et variantes du document : chacune est retenue (prix vendu) ou non (non reprise), la ligne de base d'une
// variante peut aussi être écartée (choisirOptions). Utilisée par la page document et par les listes de documents.

const ETAPES = [
  { code: 'COMMANDE', titre: 'Commande', aide: 'Engagement du client ou commande au fournisseur' },
  { code: 'RECEPTION', titre: 'Livraison', aide: 'Bon de livraison ou de réception des quantités' },
  { code: 'SITUATION', titre: 'Situation de travaux', aide: 'État d\'avancement cumulé, avant la facture d\'avancement' },
  { code: 'FACTURATION', titre: 'Facturation', aide: 'Facture, facture d\'avancement' },
  { code: 'RETOUR', titre: 'Retour', aide: 'Retour de marchandises' },
  { code: 'AVOIR', titre: 'Avoir', aide: 'Annulation totale ou partielle d\'une facture' },
];
const ICONES = {
  V_COMMANDE: '🤝', V_RECEPTION: '🚚', V_RETOUR: '↩️', V_SITUATION: '📈', V_FACTURE: '💶', V_FACTURE_AVT: '📊', V_AVOIR: '🧾',
  A_COMMANDE: '📦', A_RECEPTION: '🚛', A_RETOUR: '↩️', A_FACTURE: '🧾', A_FACTURE_AVT: '📊', A_AVOIR: '🧾', S_RESERVATION: '📌', S_SORTIE: '📤',
};
const DESCRIPTIONS = {
  V_COMMANDE: 'Le client accepte : commande reprenant le reliquat du document',
  V_RECEPTION: 'Livraison des quantités restant à livrer',
  V_RETOUR: 'Retour client des quantités livrées',
  V_SITUATION: 'Situation de travaux (avancement cumulé), à transformer ensuite en facture d\'avancement',
  V_FACTURE: 'Facture du reliquat à facturer',
  V_FACTURE_AVT: 'Facture d\'avancement (situation)',
  V_AVOIR: 'Avoir sur la facture',
  A_COMMANDE: 'Commande au fournisseur des éléments du document',
  A_RECEPTION: 'Réception des quantités commandées',
  A_RETOUR: 'Retour au fournisseur',
  A_FACTURE: 'Facture du fournisseur',
  A_FACTURE_AVT: 'Situation du fournisseur ou du sous-traitant',
  A_AVOIR: 'Avoir du fournisseur',
};

/**
 * Cibles possibles d'un type de document, dans un ordre logique : [{ tyd_id, code, libelle, famille, etape, vaut }].
 * definition : définition du type source (transformations) ; types : types de documents.
 */
export function ciblesTransformation(definition, types) {
  const rang = (e) => { const i = ETAPES.findIndex((x) => x.code === e); return i < 0 ? 99 : i; };
  return (definition.transformations ?? []).map((t) => {
    const ty = types.find((x) => x.tyd_id === t.tra_cible_tyd_id);
    const inter = t.tra_intermediaire_tyd_id ? types.find((x) => x.tyd_id === t.tra_intermediaire_tyd_id) : null;
    return ty ? {
      tyd_id: ty.tyd_id, code: ty.tyd_code, libelle: ty.tyd_libelle, famille: ty.tyd_famille, etape: t.tra_etape, vaut: t.tra_vaut_etapes ?? [],
      intermediaire: inter?.tyd_libelle ?? null,
    } : null;
  }).filter(Boolean).sort((a, b) => rang(a.etape) - rang(b.etape) || (a.famille === b.famille ? 0 : a.famille === 'V' ? -1 : 1) || a.libelle.localeCompare(b.libelle, 'fr'));
}

/** Fenêtre de choix ; résout la cible choisie ou null. source : { numero, libelle_type, objet }. */
export function choisirTransformation({ source, cibles }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-transformation';
  const groupes = ETAPES.map((e) => ({ ...e, cibles: cibles.filter((c) => c.etape === e.code) }))
    .concat([{ code: 'AUTRE', titre: 'Autres', aide: '', cibles: cibles.filter((c) => !ETAPES.some((e) => e.code === c.etape)) }])
    .filter((g) => g.cibles.length);
  let i = 0;
  dlg.innerHTML = `<form method="dialog">
    <h3>Transformer ${echapper(source.libelle_type ?? 'le document')} ${echapper(source.numero ?? '')}</h3>
    ${source.objet ? `<p class="aide">${echapper(source.objet)}</p>` : ''}
    <div class="transformation-choix">${groupes.map((g) => `<section><h4>${echapper(g.titre)}${g.aide ? ` <small>${echapper(g.aide)}</small>` : ''}</h4>
      ${g.cibles.map((c) => `<button type="button" class="transformation-cible" data-i="${i++}">
        <span class="transformation-icone">${ICONES[c.code] ?? '📄'}</span>
        <span><b>${echapper(c.libelle)}</b>${c.famille === 'A' ? ' <span class="pastille">Achat</span>' : c.famille === 'T' ? ' <span class="pastille">Sous-traitance</span>' : ''}<small>${echapper(DESCRIPTIONS[c.code] ?? '')}${c.intermediaire ? ` (par une ${echapper(c.intermediaire.toLowerCase())} validée automatiquement)` : c.vaut.length ? ` (vaut aussi ${c.vaut.map((v) => ETAPES.find((e) => e.code === v)?.titre.toLowerCase() ?? v).join(', ')})` : ''}</small></span>
      </button>`).join('')}</section>`).join('')}</div>
    <p class="aide">Tout le reliquat du document est repris (quantités restant à transformer pour cette étape).</p>
    <div class="boutons"><button value="annuler">Annuler</button></div></form>`;
  document.body.append(dlg);
  const ordre = groupes.flatMap((g) => g.cibles);
  const boutons = [...dlg.querySelectorAll('[data-i]')];
  return new Promise((resoudre) => {
    let fini = false;
    const finir = (c) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(c);
    };
    dlg.addEventListener('close', () => finir(null));
    boutons.forEach((b) => b.addEventListener('click', () => finir(ordre[Number(b.dataset.i)])));
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const k = boutons.indexOf(document.activeElement);
      boutons[(k + (e.key === 'ArrowDown' ? 1 : -1) + boutons.length) % boutons.length]?.focus();
    });
    dlg.showModal();
    boutons[0]?.focus();
  });
}

/**
 * Choix des options et variantes à la transformation : chaque unité (option ou variante, ligne ou tranche) est retenue
 * (passe en prix vendu) ou non retenue (non reprise) ; la ligne de base d'une variante est gardée par défaut et peut
 * être écartée. Résout [{ lig_id, retenue }] ou null (abandon). lignes : lignes enregistrées du document.
 */
export function choisirOptions({ lignes, unites, precision = 2 }) {
  const parId = new Map(lignes.map((l) => [l.lig_id, l]));
  const variantes = unites.filter((u) => u.base_id !== null);
  const options = unites.filter((u) => u.base_id === null);
  const bases = [...new Set(variantes.map((u) => u.base_id))];
  const ligne = (id, genre) => {
    const l = parId.get(id) ?? {};
    const libelle = String(l.lig_libelle_brut ?? l.lig_libelle_html ?? '').replace(/<[^>]*>/g, '').trim();
    const pastille = { O: 'Option', A: 'Variante', base: 'Base' }[genre];
    return `<tr data-id="${id}" data-genre="${genre}">
      <td><span class="pastille">${pastille}</span></td><td>${echapper(l.lig_numerotation ?? '')}</td>
      <td class="libelle">${echapper(libelle || '—')}</td><td class="nombre">${formatNombre(l.lig_montant_ht ?? 0, precision)}</td>
      <td><label><input type="radio" name="c-${id}" value="1" ${genre === 'base' ? 'checked' : ''}> ${genre === 'base' ? 'Gardée' : 'Retenue'}</label></td>
      <td><label><input type="radio" name="c-${id}" value="0"> ${genre === 'base' ? 'Écartée' : 'Non retenue'}</label></td></tr>`;
  };
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-options';
  dlg.innerHTML = `<form method="dialog">
    <h3>Options et variantes</h3>
    <p class="aide">Une option ou une variante retenue passe en prix vendu (à son prix du document) ; non retenue, elle n'est pas
      reprise. La ligne de base d'une variante est gardée sauf si vous l'écartez.</p>
    <div class="options-choix"><table>
      ${options.length ? `<tbody>${options.map((u) => ligne(u.lig_id, u.type_prix)).join('')}</tbody>` : ''}
      ${bases.map((b) => `<tbody class="groupe-variante">${ligne(b, 'base')}${variantes.filter((u) => u.base_id === b).map((u) => ligne(u.lig_id, 'A')).join('')}</tbody>`).join('')}
    </table></div>
    <p class="erreur" data-erreur></p>
    <div class="boutons"><button type="button" data-tout="1">Tout retenir</button><button type="button" data-tout="0">Rien retenir</button>
      <button value="annuler">Annuler</button><button type="button" class="principal" data-valider>Transformer</button></div></form>`;
  document.body.append(dlg);
  const choixDe = (id) => dlg.querySelector(`input[name="c-${id}"]:checked`)?.value ?? null;
  dlg.querySelectorAll('[data-tout]').forEach((b) => b.addEventListener('click', () => {
    for (const u of unites) dlg.querySelector(`input[name="c-${u.lig_id}"][value="${b.dataset.tout}"]`).checked = true;
  }));
  return new Promise((resoudre) => {
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(r);
    };
    dlg.addEventListener('close', () => finir(null));
    dlg.querySelector('[data-valider]').addEventListener('click', () => {
      const manquants = unites.filter((u) => choixDe(u.lig_id) === null);
      if (manquants.length) {
        dlg.querySelector('[data-erreur]').textContent = `${manquants.length} option(s) ou variante(s) sans choix`;
        dlg.querySelector(`tr[data-id="${manquants[0].lig_id}"] input`)?.focus();
        return;
      }
      finir([...unites.map((u) => u.lig_id), ...bases].map((id) => ({ lig_id: id, retenue: choixDe(id) === '1' })));
    });
    dlg.showModal();
  });
}

/**
 * Transformation complète d'un document : choix de la cible, des options et variantes, puis transformation du
 * reliquat. Renvoie le document créé ({ ent_id, ent_numero, libelle }) ou null (aucune cible, choix abandonné).
 */
export async function transformerDocument({ entId, typeCode, numero, objet, types = null, definition = null, message = () => {} }) {
  const lesTypes = types ?? await api.typesDocument();
  const def = definition ?? await api.definition(typeCode);
  const cibles = ciblesTransformation(def, lesTypes);
  if (!cibles.length) { message('Ce type de document ne se transforme pas', 'avertissement'); return null; }
  // Validité dépassée, document rejeté : avertissement, l'utilisateur choisit (R3, P25).
  if (!(await confirmerAvertissements(entId, 'TRANSFORMER', 'Transformer'))) return null;
  const cible = await choisirTransformation({ source: { numero, objet, libelle_type: def.type?.tyd_libelle }, cibles });
  if (!cible) return null;
  const complet = await api.document(entId);
  const unites = unitesOptionnelles(complet.lignes);
  let choix = [];
  if (unites.length) {
    choix = await choisirOptions({ lignes: complet.lignes, unites, precision: complet.document?.ent_precision_montant ?? 2 });
    if (!choix) return null;
  }
  const rep = await api.transformer(entId, { cible_tyd_id: cible.tyd_id, lignes: [], choix });
  return { ent_id: rep.document.ent_id, ent_numero: rep.document.ent_numero, libelle: cible.libelle };
}
