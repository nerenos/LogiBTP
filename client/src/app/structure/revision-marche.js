import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, lireNombre, creerCombo, confirmer } from '@logibtp/socle/ui';
import { Dz } from '@logibtp/socle';
import { api } from '../api.js';
import { urlDocument, TYPE_PRIX, ARRONDI_REVISION } from '../codes.js';
import { controlerFormule, lireTermes, ecrireTermes, MESSAGES_REVISION } from './revision.js';

// Onglet Révision de la fiche d'un marché de vente ou de sous-traitance (CONCEPTION-REVISION-PRIX.md, lots G1 et G3 ; sous-traitance :
// formule du marché de vente lié proposée, pas de facture simple) : type de prix, mois zéro, formule
// (modèle à recopier, contrôle en direct), décalage, arrondi, actualisation (début des travaux, à la baisse), mois zéro
// propre des commandes ; périodes facturées avec la révision due (meilleurs index connus), déjà facturée et à facturer ;
// facture simple de régularisation. Le calcul est fait par le serveur (règle partagée : revision.js ↔ ReglesRevision.cs).

const TYPES = () => [TYPE_PRIX.FERME, TYPE_PRIX.ACTUALISABLE, TYPE_PRIX.REVISABLE].map((c) => [c, texte(`revision_btp.types.${c}`)]);
const ARRONDIS = () => [ARRONDI_REVISION.PROCHE, ARRONDI_REVISION.SUPERIEUR].map((c) => [c, texte(`revision_btp.arrondis.${c}`)]);
const mois = (v) => (v ? String(v).slice(0, 7) : '');
const jourMois = (v) => (v ? `${v}-01` : null);
const f = (v) => formatNombre(v ?? 0, 2);
const coef = (v) => (v === null || v === undefined ? '' : formatNombre(v, 6).replace(/0+$/, '').replace(/,$/, ''));

/** Rendu de l'onglet ; ouvrir(url, e) ouvre une pièce créée. */
export async function rendreRevision(zone, { marche, message, ouvrir, modifiable = true }) {
  const [r, formules] = await Promise.all([api.revisionMarche(marche), api.formulesRevision().catch(() => [])]);
  const p = r.parametres;
  const ferme = p.type_prix === TYPE_PRIX.FERME;
  const periodes = r.periodes ?? [];
  zone.innerHTML = `<div class="revision-marche">
    <h3>${texteHtml('revision_btp.marche.prix')}</h3>
    <div class="formulaire">
      <label>${texteHtml('revision_btp.marche.type')} <span data-r="type"></span></label>
      <label>${texteHtml('revision_btp.marche.mois_zero')} <input type="month" data-r="mois_zero" value="${mois(p.mois_zero)}" title="${texteHtml('revision_btp.marche.mois_zero_aide')}"></label>
      ${!p.mois_zero && r.mois_zero_propose ? `<small class="aide">${texteHtml('revision_btp.marche.mois_zero_propose', { mois: mois(r.mois_zero_propose) })}</small>` : ''}
    </div>
    ${r.proposee ? `<p class="avertissement">${texteHtml('revision_btp.marche.proposee')}</p>` : ''}
    <div class="formulaire" data-formule>
      <label>${texteHtml('revision_btp.marche.modele')} <span data-r="modele"></span></label>
      <label>${texteHtml('revision_btp.marche.partie_fixe')} <input data-r="partie_fixe" size="8" inputmode="decimal" value="${echapper(String(p.partie_fixe ?? '').replace('.', ','))}"></label>
      <label class="large">${texteHtml('revision_btp.marche.termes')} <input data-r="termes" size="40" placeholder="${texteHtml('revision_btp.marche.termes_exemple')}" value="${echapper(ecrireTermes(p.termes))}"></label>
      <label>${texteHtml('revision_btp.marche.decalage')} <input data-r="decalage" size="3" inputmode="numeric" value="${p.decalage ?? 0}" title="${texteHtml('revision_btp.marche.decalage_aide')}"></label>
      <label>${texteHtml('revision_btp.marche.precision')} <input data-r="precision" size="2" inputmode="numeric" value="${p.precision ?? 3}" title="${texteHtml('revision_btp.marche.precision_aide')}"></label>
      <label>${texteHtml('revision_btp.marche.arrondi')} <span data-r="arrondi"></span></label>
    </div>
    <p class="aide" data-r="formule"></p>
    <div class="formulaire" data-actualisation>
      <label>${texteHtml('revision_btp.marche.debut')} <input type="month" data-r="debut" value="${mois(p.debut_travaux)}" title="${texteHtml('revision_btp.marche.debut_aide')}"></label>
      <small class="aide">${texteHtml('revision_btp.marche.debut_retenu', { mois: r.debut_effectif ? mois(r.debut_effectif) : texte('revision_btp.marche.inconnu') })}</small>
      <label><input type="checkbox" data-r="baisse" ${p.baisse ? 'checked' : ''}> ${texteHtml('revision_btp.marche.baisse')}</label>
    </div>
    ${r.commandes.length > 1 ? `<h4>${texteHtml('revision_btp.marche.commandes')}</h4><table class="tableau-compact"><thead><tr><th>${texteHtml('revision_btp.marche.col.commande')}</th><th>${texteHtml('revision_btp.marche.col.objet')}</th><th>${texteHtml('revision_btp.marche.col.mois_zero_propre')}</th></tr></thead><tbody>
      ${r.commandes.map((c) => `<tr><td><a href="${urlDocument(Number(c.ent_id))}">${echapper(c.numero ?? `#${c.ent_id}`)}</a></td><td>${echapper(c.objet ?? '')}</td>
        <td><input type="month" data-commande="${c.ent_id}" value="${mois(c.mois_zero)}" title="${texteHtml('revision_btp.marche.mois_zero_commande_aide')}"></td></tr>`).join('')}</tbody></table>` : ''}
    ${modifiable ? `<div class="boutons"><button type="button" class="principal" data-enregistrer>${texteHtml('revision_btp.marche.enregistrer')}</button></div>` : ''}
    <h3>${texteHtml('revision_btp.marche.periodes')}</h3>
    ${ferme ? `<p class="aide">${texteHtml('revision_btp.marche.ferme')}</p>` : `<p class="aide">${texteHtml('revision_btp.marche.periodes_aide', { provisoire: icone('revision_btp_provisoire'), facture: r.facture_simple ? texte('revision_btp.marche.periodes_facture') : '' })}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('revision_btp.marche.col.piece')}</th><th>${texteHtml('revision_btp.marche.col.mois')}</th><th>${texteHtml('revision_btp.marche.col.commande')}</th><th class="nombre">${texteHtml('revision_btp.marche.col.base')}</th><th>${texteHtml('revision_btp.marche.col.index')}</th><th class="nombre">${texteHtml('revision_btp.marche.col.coef')}</th>
        <th class="nombre">${texteHtml('revision_btp.marche.col.due')}</th><th class="nombre">${texteHtml('revision_btp.marche.col.deja')}</th><th class="nombre">${texteHtml('revision_btp.marche.col.a_facturer')}</th></tr></thead><tbody>
      ${periodes.length ? periodes.map((x) => `<tr><td><a href="${urlDocument(Number(x.piece))}">${echapper(x.numero ?? `#${x.piece}`)}</a></td><td>${mois(x.mois)}</td>
        <td>${echapper(x.commande_numero ?? '')}</td><td class="nombre">${f(x.base)}</td><td>${mois(x.mois_index)}</td>
        <td class="nombre" title="${echapper((x.manquants ?? []).join(', '))}">${x.coef === null ? `<span class="avertissement">${texteHtml('revision_btp.marche.manque', { index: (x.manquants ?? []).join(', ') })}</span>` : `${coef(x.coef)}${x.provisoire ? ` ${iconeHtml('revision_btp_provisoire')}` : ''}`}</td>
        <td class="nombre">${f(x.revision)}</td><td class="nombre">${f(x.deja)}</td><td class="nombre">${Dz(x.a_facturer).isZero() ? '' : f(x.a_facturer)}</td></tr>`).join('')
        : `<tr><td colspan="9" class="aide">${texteHtml('revision_btp.marche.aucune')}</td></tr>`}
      </tbody><tfoot><tr><th colspan="3">${texteHtml('commun.total')}</th><th class="nombre">${f(r.totaux.base)}</th><th colspan="2"></th><th class="nombre">${f(r.totaux.revision)}</th>
        <th class="nombre">${f(r.totaux.deja)}</th><th class="nombre">${f(r.totaux.a_facturer)}</th></tr></tfoot></table>
      ${modifiable && r.facture_simple && !Dz(r.totaux.a_facturer).isZero() ? `<div class="boutons"><button type="button" data-facture title="${texteHtml('revision_btp.marche.facture_aide')}">${iconeHtml('revision_btp_facture')} ${texteHtml('revision_btp.marche.facture')}</button></div>` : ''}`}
  </div>`;

  const remplacer = (cle, combo) => { zone.querySelector(`[data-r="${cle}"]`).replaceWith(combo); return combo; };
  const type = remplacer('type', creerCombo({ options: TYPES().map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p.type_prix, vide: false }));
  const arrondi = remplacer('arrondi', creerCombo({ options: ARRONDIS().map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p.arrondi, vide: false }));
  const modele = remplacer('modele', creerCombo({ options: formules.filter((x) => x.actif).map((x) => ({ valeur: String(x.id), libelle: x.libelle })), valeur: '', titre: texte('revision_btp.marche.modele_aide') }));
  const champ = (cle) => zone.querySelector(`[data-r="${cle}"]`);

  const lire = () => ({
    type_prix: type.valeurCombo,
    mois_zero: jourMois(champ('mois_zero').value),
    partie_fixe: lireNombre(champ('partie_fixe').value) ?? '0',
    termes: lireTermes(champ('termes').value),
    decalage: Number.parseInt(champ('decalage').value || '0', 10),
    precision: Number.parseInt(champ('precision').value || '3', 10),
    arrondi: arrondi.valeurCombo,
    debut_travaux: jourMois(champ('debut').value),
    baisse: champ('baisse').checked,
    commandes: [...zone.querySelectorAll('[data-commande]')].map((x) => ({ ent_id: Number(x.dataset.commande), mois_zero: jourMois(x.value) })),
  });
  const actualiser = () => {
    const v = lire();
    zone.querySelector('[data-formule]').hidden = v.type_prix === TYPE_PRIX.FERME;
    zone.querySelector('[data-actualisation]').hidden = v.type_prix !== TYPE_PRIX.ACTUALISABLE;
    const sortie = champ('formule');
    if (v.type_prix === TYPE_PRIX.FERME) { sortie.textContent = ''; return v; }
    if (v.termes === null) { sortie.innerHTML = `<span class="erreur">${texteHtml('revision_btp.erreurs.illisible')}</span>`; return v; }
    const erreurs = controlerFormule(v);
    const formule = `Cn = ${String(v.partie_fixe).replace('.', ',')}${v.termes.map((t) => ` + ${String(t.poids).replace('.', ',')} × ${t.index}n / ${t.index}0`).join('')}`;
    sortie.innerHTML = erreurs.length ? `<span class="erreur">${erreurs.map((e) => echapper(MESSAGES_REVISION[e] ?? e)).join(' ; ')}</span>` : echapper(formule);
    return v;
  };
  zone.querySelectorAll('input').forEach((x) => x.addEventListener('input', actualiser));
  type.addEventListener('change', actualiser);
  arrondi.addEventListener('change', actualiser);
  modele.addEventListener('change', () => {
    const m = formules.find((x) => String(x.id) === modele.valeurCombo);
    if (!m) return;
    champ('partie_fixe').value = String(m.partie_fixe).replace('.', ',');
    champ('termes').value = ecrireTermes(m.termes);
    champ('precision').value = m.precision;
    arrondi.definirValeur?.(m.arrondi);
    actualiser();
  });
  actualiser();

  zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
    const v = actualiser();
    if (v.type_prix !== TYPE_PRIX.FERME && (v.termes === null || controlerFormule(v).length)) { message(texte('revision_btp.marche.a_corriger'), 'avertissement'); return; }
    if (v.type_prix !== TYPE_PRIX.FERME && !v.mois_zero) { message(texte('revision_btp.marche.mois_zero_obligatoire'), 'avertissement'); return; }
    try {
      await api.enregistrerRevisionMarche(marche, { ...v, termes: v.termes ?? [] });
      message(texte('revision_btp.marche.enregistres'), 'succes');
      await rendreRevision(zone, { marche, message, ouvrir, modifiable });
    } catch (e) { message(e.message, 'erreur'); }
  });
  zone.querySelector('[data-facture]')?.addEventListener('click', async (e) => {
    if (!await confirmer(texte('revision_btp.marche.facture_confirmer', { montant: f(r.totaux.a_facturer) }))) return;
    try {
      const d = await api.factureRevision(marche);
      message(texte('revision_btp.marche.facture_creee', { numero: d.document.ent_numero ?? '' }), 'succes');
      ouvrir?.(urlDocument(d.document.ent_id), e);
    } catch (x) { message(x.message, 'erreur'); }
  });
}
