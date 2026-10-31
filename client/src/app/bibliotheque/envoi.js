import { TYPE_FICHE } from '../codes.js';
import { codeAppel } from '@logibtp/bibliotheque';
import { texteBrut, D, arrondir } from '@logibtp/socle';
import { echapper, formatNombre, ouvrirModale } from '@logibtp/socle/ui';
import { TL, estTranche } from '../../calcul/index.js';

// Depuis un document : mettre à jour les éléments de la bibliothèque ou en créer de nouveaux.
//   - ligne d'élément → article ; ouvrage (et ses composantes) → ouvrage ; titre ou section (et son contenu) → ensemble ;
//   - lien : l'ID de l'élément (lig_art_id, lig_proprietes.element.id) ; une ligne liée met à jour son élément ;
//   - ligne non liée : recherche d'éléments de même code ou de même libellé (doublons) ; l'utilisateur choisit de la
//     rattacher à l'un d'eux (mise à jour) ou de créer un nouvel élément (code et bibliothèque à choisir) ;
//   - prix : les PA sont envoyés ; les frais annexes ventilés ne vont jamais dans la bibliothèque. Les coefficients FG
//     et bénéfice de l'élément sont ceux par défaut (nature ou globaux) à la création, inchangés à la mise à jour
//     (l'utilisateur les force dans la bibliothèque) ; seule une ligne à PV fixe (avant frais annexes) envoie son PV
//     et impose ses coefficients ; un ouvrage ne l'envoie que si l'option de la société le prévoit (paramètre
//     pv_fixe_ouvrages_envoyes de la bibliothèque, non par défaut : prix de sa composition, PV fixe inchangé à la mise
//     à jour). La ligne reçoit ensuite le lien, le code d'appel et le type de l'élément.
// Les écritures passent par les fiches « element » (contrôles, unicité du code, historique des prix).

/** Type d'élément pour une ligne de document (null : ligne non transférable). */
export function typeElementDeLigne(l) {
  if (l.lig_tyl_id === TL.ELEMENT) return 'ARTICLE';
  if (l.lig_tyl_id === TL.OUVRAGE) return 'OUVRAGE';
  if (estTranche(l)) return 'ENSEMBLE';
  return null;
}

/** ID de l'élément lié à une ligne. */
export const elementLie = (l) => l.lig_art_id ?? l.lig_proprietes?.element?.id ?? null;

/** Code de la ligne sans le préfixe de bibliothèque (BIB:CODE → CODE). */
export const codeSansBib = (code) => (code ? String(code).split(':').pop().trim() : '');

/**
 * Composition (ouvrage, ensemble) depuis un sous-arbre du document : lignes, métrés et variables renumérotés à partir
 * de 1, racine à la racine, sans lien de document. `contenu` : format du presse-papiers (extraire). Une quantité
 * absolue (pour la quantité du parent dans le devis) devient relative (par unité du parent) : `qtesVendues` donne la
 * quantité vendue des lignes du devis (résultat du calcul).
 */
export function compositionDepuisContenu(contenu, mode = 'V', qtesVendues = new Map()) {
  const ids = new Map();
  let n = 0;
  for (const l of contenu.lignes) ids.set(l.lig_id, ++n);
  const mtr = new Map((contenu.metres ?? []).map((m) => [m.mtr_id, ++n]));
  const racine = contenu.racines[0];
  const dansContenu = new Set(contenu.lignes.map((l) => l.lig_id));
  const relative = (l) => {
    if (l.lig_id === racine || (l.lig_qte_type ?? 'R') !== 'A' || !dansContenu.has(l.lig_parent_id)) return {};
    const qv = Number(qtesVendues.get(l.lig_parent_id) ?? 0);
    if (!qv || l.lig_qte === null || l.lig_qte === undefined) return {};
    // Précision de quantité portée à 6 décimales : la quantité par unité ne doit pas être réarrondie.
    return { lig_qte: Number(arrondir(D(l.lig_qte).div(D(qv)), 6)), lig_qte_type: 'R', lig_precision_qte: 6 };
  };
  const lignes = contenu.lignes.map((l) => {
    const x = structuredClone(l);
    for (const k of Object.keys(x)) if (k.startsWith('_')) delete x[k];
    return {
      ...x, lig_id: ids.get(l.lig_id), lig_parent_id: l.lig_id === racine ? null : ids.get(l.lig_parent_id) ?? null, lig_ent_id: 0,
      lig_origine_id: null, lig_mtr_id: l.lig_mtr_id === null || l.lig_mtr_id === undefined ? null : mtr.get(l.lig_mtr_id) ?? null,
      lig_st_depuis_id: ids.get(l.lig_st_depuis_id) ?? null, lig_variante_de_id: ids.get(l.lig_variante_de_id) ?? null, lig_pied_base_id: null,
      ...(l.lig_id === racine ? { lig_ordre: 1 } : {}),
      ...relative(l),
    };
  });
  return {
    mode,
    lignes,
    metres: (contenu.metres ?? []).map((m) => ({ ...structuredClone(m), mtr_id: mtr.get(m.mtr_id), mtr_lig_id: ids.get(m.mtr_lig_id) ?? null })),
    variables: (contenu.variables ?? []).map((v, i) => {
      const { var_ent_id: _e, var_valeur: _v, ...reste } = structuredClone(v);
      return { ...reste, var_id: ++n + i, var_lig_id: ids.get(v.var_lig_id) ?? null, var_mtr_id: mtr.get(v.var_mtr_id) ?? null };
    }),
  };
}

/**
 * Valeurs de la fiche « element » écrites depuis une ligne : libellé, nature, remise ; coefficients imposés seulement
 * pour une ligne à PV fixe (sinon : ceux par défaut à la création, inchangés à la mise à jour) ; article : unité, PA
 * fixe (ramené à l'unité de stock par le ratio du lien) et PV fixe ; ouvrage : composition et, avec l'option
 * `pvFixeOuvrages`, PV fixe de la ligne (sinon prix de la composition : PV fixe à non à la création, inchangé à la mise
 * à jour) ; ensemble : composition (prix = totaux de sa tranche).
 */
export function valeursDepuisLigne(l, type, { composition = null, creation = false, pvFixeOuvrages = false } = {}) {
  const ratio = Number(l.lig_proprietes?.element?.ratio ?? 1) || 1;
  const v = {
    libelle_html: l.lig_libelle_html || texteBrut(l.lig_libelle_html ?? '') || 'Élément', nat_id: l.lig_nat_id ?? null,
    coef_remise: String(l.lig_coef_remise ?? 1),
  };
  const pvFixe = Boolean(l.lig_pv_fixe) && (type === 'ARTICLE' || (type === 'OUVRAGE' && pvFixeOuvrages));
  if (pvFixe) {
    Object.assign(v, { coef_fg: String(l.lig_coef_fg ?? 1), coef_benef: String(l.lig_coef_benef ?? 1), coef_fg_impose: true, coef_benef_impose: true });
  } else if (creation) Object.assign(v, { coef_fg_impose: false, coef_benef_impose: false });
  if (type === 'ARTICLE') {
    Object.assign(v, {
      pa_fixe: l.lig_pa === null || l.lig_pa === undefined ? null : String(Number(l.lig_pa) / ratio),
      pv_fixe: pvFixe, ...(pvFixe ? { pv: String(Number(l.lig_pv) / ratio) } : {}),
    });
    if (creation) Object.assign(v, { unite_stock: l.lig_unt_code || 'u', scenario_pa: 'FIXE', gestion: 'NON_GERE', unites: [] });
  } else {
    v.composition = composition;
    if (pvFixe) Object.assign(v, { pv_fixe: true, pv: String(l.lig_pv) });
    else if (creation || type === 'ENSEMBLE' || pvFixeOuvrages) v.pv_fixe = false;
    if (type === 'ENSEMBLE') Object.assign(v, { coef_fg: '1', coef_benef: '1' });
    if (creation) Object.assign(v, { unite_stock: type === 'OUVRAGE' ? l.lig_unt_code || 'u' : 'u', scenario_pa: 'FIXE', gestion: 'NON_GERE', unites: [] });
  }
  return v;
}

const normaliser = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Doublons possibles d'une ligne non liée : éléments de même code (dans la bibliothèque visée) ou de même libellé. */
export function doublons(l, resultats, { bib = null } = {}) {
  const code = normaliser(codeSansBib(l.lig_code));
  const libelle = normaliser(texteBrut(l.lig_libelle_html ?? ''));
  return resultats
    .map((e) => ({ e, code: Boolean(code) && normaliser(e.code) === code && (!bib || e.bib_code === bib), libelle: Boolean(libelle) && normaliser(e.libelle) === libelle }))
    .filter((x) => x.code || x.libelle)
    .sort((a, b) => Number(b.code) - Number(a.code));
}

/** Code proposé pour un nouvel élément : celui de la ligne, sinon les initiales du libellé. */
export function codePropose(l) {
  const code = codeSansBib(l.lig_code);
  if (code) return code;
  const mots = normaliser(texteBrut(l.lig_libelle_html ?? '')).replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean);
  return (mots.slice(0, 4).map((m) => m.slice(0, 3)).join('') || 'ELEMENT').toUpperCase().slice(0, 20);
}

export class EnvoiBibliotheque {
  /** fiche : fournisseur de fiches ; bibliotheque : fournisseur de la bibliothèque ; editeur() ; bibDocument() : code ; message(texte, niveau). */
  constructor({ fiche, bibliotheque, editeur, bibDocument, message = () => {} }) {
    this.fiche = fiche;
    this.bibliotheque = bibliotheque;
    this.editeur = editeur;
    this.bibDocument = bibDocument;
    this.message = message;
  }

  /** Lignes transférables de la sélection : racines de la sélection (une ligne et son contenu). */
  lignes(ids) {
    const ed = this.editeur();
    const sel = new Set(ids);
    const parId = new Map(ed.saisie.lignes.map((l) => [l.lig_id, l]));
    return ed.saisie.lignes.filter((l) => sel.has(l.lig_id) && typeElementDeLigne(l) && !l.lig_is_ecart_arrondi)
      .filter((l) => { for (let p = parId.get(l.lig_parent_id); p; p = parId.get(p.lig_parent_id)) if (sel.has(p.lig_id)) return false; return true; });
  }

  /** Analyse des lignes : lien existant ou doublons possibles. */
  async preparer(ids) {
    const bibs = await this.bibliotheque.bibliotheques();
    const bib = (await this.bibDocument()) ?? bibs.find((b) => b.defaut)?.code ?? bibs[0]?.code;
    const res = [];
    for (const l of this.lignes(ids)) {
      const type = typeElementDeLigne(l);
      const lie = elementLie(l);
      let element = null;
      if (lie) element = await this.bibliotheque.element(lie).catch(() => null);
      let candidats = [];
      if (!element) {
        const recherches = [codeSansBib(l.lig_code), texteBrut(l.lig_libelle_html ?? '')].filter(Boolean);
        const trouves = new Map();
        for (const r of recherches) for (const e of await this.bibliotheque.rechercher({ recherche: r.slice(0, 60) }).catch(() => [])) trouves.set(e.id, e);
        candidats = doublons(l, [...trouves.values()], { bib });
      }
      res.push({ ligne: l, type, element, candidats, code: codePropose(l), bib });
    }
    return { lignes: res, bibs };
  }

  /** Dialogue : action par ligne (mettre à jour l'élément lié, rattacher à un doublon, créer), puis écriture. */
  async ouvrir(ids) {
    if (this.editeur().magasin.lectureSeule) { this.message('Document en lecture seule', 'avertissement'); return; }
    const { lignes, bibs } = await this.preparer(ids);
    if (!lignes.length) { this.message('Sélectionnez des lignes d\'élément, d\'ouvrage ou de tranche (titre)', 'avertissement'); return; }
    const libelleType = { ARTICLE: 'Article', OUVRAGE: 'Ouvrage', ENSEMBLE: 'Ensemble' };
    const ed = this.editeur();
    const montant = (l) => ed.resultat.lignes.find((x) => x.lig_id === l.lig_id)?.lig_montant_ht;
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogue-envoi-bibliotheque';
    dlg.innerHTML = `<form method="dialog">
      <h3>Enregistrer dans la bibliothèque</h3>
      <p class="aide">Une ligne liée met à jour son élément. Pour une ligne non liée, les éléments de même code ou de même libellé sont proposés :
        rattachez-la à l'un d'eux (mise à jour) ou créez un nouvel élément. Les PA sont envoyés sans les frais annexes ; les coefficients restent ceux de la bibliothèque (imposés seulement pour une ligne à PV fixe).</p>
      <table class="table-analyse"><thead><tr><th>Ligne</th><th>Type</th><th>Action</th></tr></thead><tbody>
      ${lignes.map((x, i) => `<tr data-i="${i}"><td><b>${echapper(x.ligne.lig_code ?? '')}</b> ${echapper(texteBrut(x.ligne.lig_libelle_html ?? '').slice(0, 70))}
          <br><small>${montant(x.ligne) !== undefined ? `${formatNombre(montant(x.ligne), 2)} € HT` : ''}</small></td>
        <td>${libelleType[x.type]}</td>
        <td><select data-action>
          ${x.element ? `<option value="maj:${x.element.id}">Mettre à jour ${echapper(`${x.element.bib_code}:${x.element.code}`)} (élément lié)</option>` : ''}
          ${x.candidats.map((c) => `<option value="maj:${c.e.id}">Rattacher à ${echapper(`${c.e.bib_code}:${c.e.code}`)} – ${echapper((c.e.libelle ?? '').slice(0, 40))} (${c.code ? 'même code' : 'même libellé'})</option>`).join('')}
          <option value="creer" ${!x.element && !x.candidats.length ? 'selected' : ''}>Créer un nouvel élément</option>
          <option value="ignorer">Ne pas enregistrer</option>
        </select>
        <span class="creation" ${x.element || x.candidats.length ? 'hidden' : ''}>
          <select data-bib>${bibs.filter((b) => b.actif !== false).map((b) => `<option value="${b.id}" ${b.code === x.bib ? 'selected' : ''}>${echapper(b.code)}</option>`).join('')}</select>
          <input data-code value="${echapper(x.code)}" size="14" title="Code de l'élément (unique dans la bibliothèque)">
        </span></td></tr>`).join('')}
      </tbody></table>
      <div class="boutons"><button value="annuler">Annuler</button><button type="button" class="principal" data-valider>Enregistrer</button></div></form>`;
    document.body.append(dlg);
    const fermer = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-action]').forEach((s) => s.addEventListener('change', () => {
      s.closest('td').querySelector('.creation').hidden = s.value !== 'creer';
    }));
    dlg.querySelector('[data-valider]').addEventListener('click', async () => {
      const choix = lignes.map((x, i) => {
        const tr = dlg.querySelector(`tr[data-i="${i}"]`);
        return { ...x, action: tr.querySelector('[data-action]').value, bibId: Number(tr.querySelector('[data-bib]').value), codeSaisi: tr.querySelector('[data-code]').value.trim() };
      });
      fermer();
      await this.executer(choix);
    });
    ouvrirModale(dlg, () => dlg.close());
  }

  /** Écritures (fiches « element »), puis lien des lignes du document vers les éléments (une étape d'annulation). */
  async executer(choix) {
    const ed = this.editeur();
    const bibDoc = await this.bibDocument();
    const liens = new Map();
    const erreurs = [];
    let crees = 0, majs = 0;
    const params = await this.bibliotheque.parametres?.().catch(() => null);
    const pvFixeOuvrages = Boolean(params?.pv_fixe_ouvrages_envoyes);
    for (const c of choix) {
      if (c.action === 'ignorer') continue;
      const l = c.ligne;
      try {
        let composition = null;
        if (c.type !== 'ARTICLE') {
          const contenu = ed.pressePapiers.extraire(ed.saisie, [l.lig_id], { entId: ed.saisie.document.ent_id, coupe: false });
          const qtes = new Map(ed.resultat.lignes.map((x) => [x.lig_id, x.lig_qte_vendue]));
          // Bibliothèque : déboursé (D) ou somme des PV (V) ; un document en bordereau (B) envoie sa composition en V.
          composition = compositionDepuisContenu(contenu, ed.saisie.document.ent_mode_calcul_ouvrage === 'D' ? 'D' : 'V', qtes);
        }
        let id;
        if (c.action === 'creer') {
          if (!c.codeSaisi) throw new Error('code obligatoire');
          const valeurs = { ...valeursDepuisLigne(l, c.type, { composition, creation: true, pvFixeOuvrages }), bib_id: c.bibId, code: c.codeSaisi, type: c.type, actif: true };
          id = (await this.fiche.creer(TYPE_FICHE.ELEMENT, { valeurs })).id;
          crees++;
        } else {
          id = Number(c.action.split(':')[1]);
          const actuel = await this.fiche.charger(TYPE_FICHE.ELEMENT, id);
          if (actuel.valeurs.type !== c.type) throw new Error(`l'élément ${actuel.valeurs.code} est un ${actuel.valeurs.type.toLowerCase()}, la ligne un ${c.type.toLowerCase()}`);
          const valeurs = valeursDepuisLigne(l, c.type, { composition, pvFixeOuvrages });
          // PA : repris seulement pour un article à prix fixe (sinon tarifs ou dernier prix d'achat).
          if (c.type === 'ARTICLE' && actuel.valeurs.scenario_pa !== 'FIXE') delete valeurs.pa_fixe;
          const jeton = crypto.randomUUID();
          const v = await this.fiche.verrouiller(TYPE_FICHE.ELEMENT, id, { jeton });
          if (v.ok === false) throw new Error(`fiche en cours de modification par ${v.verrou?.utilisateur ?? 'un autre utilisateur'}`);
          try {
            await this.fiche.enregistrer(TYPE_FICHE.ELEMENT, id, { jeton, h: actuel.h, valeurs: { ...valeurs, commentaire_prix: `Depuis le document ${ed.saisie.document.ent_numero ?? ''}`.trim() } });
          } finally {
            await this.fiche.deverrouiller(TYPE_FICHE.ELEMENT, id, jeton).catch(() => {});
          }
          majs++;
        }
        liens.set(l.lig_id, await this.bibliotheque.element(id));
      } catch (x) {
        erreurs.push(`${l.lig_code || texteBrut(l.lig_libelle_html ?? '').slice(0, 30)} : ${x.message ?? x}`);
      }
    }
    if (liens.size) {
      ed.magasin.modifier((d) => {
        for (const l of d.lignes) {
          const e = liens.get(l.lig_id);
          if (!e) continue;
          l.lig_art_id = e.id;
          l.lig_code = codeAppel(e, bibDoc);
          l.lig_proprietes = { ...(l.lig_proprietes ?? {}), element: { ...(l.lig_proprietes?.element ?? {}), id: e.id, bib: e.bib_code, code: e.code, type: e.type } };
        }
      }, 'Lien vers la bibliothèque');
    }
    const bilan = [crees ? `${crees} élément(s) créé(s)` : '', majs ? `${majs} mis à jour` : ''].filter(Boolean).join(', ');
    if (erreurs.length) this.message(`${bilan ? `${bilan} ; ` : ''}erreurs : ${erreurs.join(' · ')}`, 'erreur');
    else if (bilan) this.message(`Bibliothèque : ${bilan}`);
  }
}
