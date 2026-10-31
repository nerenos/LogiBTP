import { echapper, formatNombre, lireNombre, creerCombo, confirmer } from '@logibtp/socle/ui';
import { Dz } from '@logibtp/socle';
import { api } from '../api.js';
import { urlDocument, TYPE_PRIX, ARRONDI_REVISION } from '../codes.js';
import { controlerFormule, lireTermes, ecrireTermes, MESSAGES_REVISION } from './revision.js';

// Onglet Révision de la fiche d'un marché de vente (CONCEPTION-REVISION-PRIX.md, lot G1) : type de prix, mois zéro, formule
// (modèle à recopier, contrôle en direct), décalage, arrondi, actualisation (début des travaux, à la baisse), mois zéro
// propre des commandes ; périodes facturées avec la révision due (meilleurs index connus), déjà facturée et à facturer ;
// facture simple de régularisation. Le calcul est fait par le serveur (règle partagée : revision.js ↔ ReglesRevision.cs).

const TYPES = [[TYPE_PRIX.FERME, 'Prix ferme'], [TYPE_PRIX.ACTUALISABLE, 'Prix ferme actualisable'], [TYPE_PRIX.REVISABLE, 'Prix révisable']];
const ARRONDIS = [[ARRONDI_REVISION.PROCHE, 'Au plus proche'], [ARRONDI_REVISION.SUPERIEUR, 'À la valeur supérieure']];
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
    <h3>Prix du marché</h3>
    <div class="formulaire">
      <label>Type de prix <span data-r="type"></span></label>
      <label>Mois zéro <input type="month" data-r="mois_zero" value="${mois(p.mois_zero)}" title="Mois d'établissement des prix (I0)"></label>
      ${!p.mois_zero && r.mois_zero_propose ? `<small class="aide">proposé : ${mois(r.mois_zero_propose)} (date du marché)</small>` : ''}
    </div>
    <div class="formulaire" data-formule>
      <label>Modèle <span data-r="modele"></span></label>
      <label>Partie fixe <input data-r="partie_fixe" size="8" inputmode="decimal" value="${echapper(String(p.partie_fixe ?? '').replace('.', ','))}"></label>
      <label class="large">Index et poids <input data-r="termes" size="40" placeholder="BT01 0,85 ; BT06 0,10" value="${echapper(ecrireTermes(p.termes))}"></label>
      <label>Décalage (mois) <input data-r="decalage" size="3" inputmode="numeric" value="${p.decalage ?? 0}" title="In = index du mois de la pièce moins ce décalage"></label>
      <label>Précision <input data-r="precision" size="2" inputmode="numeric" value="${p.precision ?? 3}" title="Décimales du coefficient"></label>
      <label>Arrondi <span data-r="arrondi"></span></label>
    </div>
    <p class="aide" data-r="formule"></p>
    <div class="formulaire" data-actualisation>
      <label>Début des travaux <input type="month" data-r="debut" value="${mois(p.debut_travaux)}" title="Vide : début réel, sinon prévu, du chantier"></label>
      <small class="aide">retenu : ${r.debut_effectif ? mois(r.debut_effectif) : 'inconnu'}</small>
      <label><input type="checkbox" data-r="baisse" ${p.baisse ? 'checked' : ''}> Actualisation à la baisse aussi</label>
    </div>
    ${r.commandes.length > 1 ? `<h4>Mois zéro des commandes</h4><table class="tableau-compact"><thead><tr><th>Commande</th><th>Objet</th><th>Mois zéro propre</th></tr></thead><tbody>
      ${r.commandes.map((c) => `<tr><td><a href="${urlDocument(Number(c.ent_id))}">${echapper(c.numero ?? `#${c.ent_id}`)}</a></td><td>${echapper(c.objet ?? '')}</td>
        <td><input type="month" data-commande="${c.ent_id}" value="${mois(c.mois_zero)}" title="Vide : mois zéro du marché"></td></tr>`).join('')}</tbody></table>` : ''}
    ${modifiable ? '<div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer les prix</button></div>' : ''}
    <h3>Révision des périodes facturées</h3>
    ${ferme ? '<p class="aide">Prix ferme : aucune révision.</p>' : `<p class="aide">Révision due avec les meilleurs index connus à ce jour (✱ : index provisoire ou
      dernier connu) ; l'écart avec la révision déjà facturée est régularisé sur la facture d'avancement suivante, ou par une facture de régularisation.</p>
      <table class="tableau-compact"><thead><tr><th>Pièce</th><th>Mois</th><th>Commande</th><th class="nombre">Base HT</th><th>Index</th><th class="nombre">Coefficient</th>
        <th class="nombre">Révision due</th><th class="nombre">Déjà facturée</th><th class="nombre">À facturer</th></tr></thead><tbody>
      ${periodes.length ? periodes.map((x) => `<tr><td><a href="${urlDocument(Number(x.piece))}">${echapper(x.numero ?? `#${x.piece}`)}</a></td><td>${mois(x.mois)}</td>
        <td>${echapper(x.commande_numero ?? '')}</td><td class="nombre">${f(x.base)}</td><td>${mois(x.mois_index)}</td>
        <td class="nombre" title="${echapper((x.manquants ?? []).join(', '))}">${x.coef === null ? `<span class="avertissement">manque ${echapper((x.manquants ?? []).join(', '))}</span>` : `${coef(x.coef)}${x.provisoire ? ' ✱' : ''}`}</td>
        <td class="nombre">${f(x.revision)}</td><td class="nombre">${f(x.deja)}</td><td class="nombre">${Dz(x.a_facturer).isZero() ? '' : f(x.a_facturer)}</td></tr>`).join('')
        : '<tr><td colspan="9" class="aide">Aucune facture d\'avancement validée.</td></tr>'}
      </tbody><tfoot><tr><th colspan="3">Total</th><th class="nombre">${f(r.totaux.base)}</th><th colspan="2"></th><th class="nombre">${f(r.totaux.revision)}</th>
        <th class="nombre">${f(r.totaux.deja)}</th><th class="nombre">${f(r.totaux.a_facturer)}</th></tr></tfoot></table>
      ${modifiable && !Dz(r.totaux.a_facturer).isZero() ? '<div class="boutons"><button type="button" data-facture title="Facture simple au client du marché : une ligne par commande, montants recalculés à la validation">🧾 Facture de régularisation</button></div>' : ''}`}
  </div>`;

  const remplacer = (cle, combo) => { zone.querySelector(`[data-r="${cle}"]`).replaceWith(combo); return combo; };
  const type = remplacer('type', creerCombo({ options: TYPES.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p.type_prix, vide: false }));
  const arrondi = remplacer('arrondi', creerCombo({ options: ARRONDIS.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: p.arrondi, vide: false }));
  const modele = remplacer('modele', creerCombo({ options: formules.filter((x) => x.actif).map((x) => ({ valeur: String(x.id), libelle: x.libelle })), valeur: '', titre: 'Recopier un modèle de formule' }));
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
    if (v.termes === null) { sortie.innerHTML = '<span class="erreur">Index et poids illisibles : « BT01 0,85 ; BT06 0,10 »</span>'; return v; }
    const erreurs = controlerFormule(v);
    const texte = `Cn = ${String(v.partie_fixe).replace('.', ',')}${v.termes.map((t) => ` + ${String(t.poids).replace('.', ',')} × ${t.index}n / ${t.index}0`).join('')}`;
    sortie.innerHTML = erreurs.length ? `<span class="erreur">${erreurs.map((e) => echapper(MESSAGES_REVISION[e] ?? e)).join(' ; ')}</span>` : echapper(texte);
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
    if (v.type_prix !== TYPE_PRIX.FERME && (v.termes === null || controlerFormule(v).length)) { message('Formule de révision à corriger', 'avertissement'); return; }
    if (v.type_prix !== TYPE_PRIX.FERME && !v.mois_zero) { message('Mois zéro obligatoire', 'avertissement'); return; }
    try {
      await api.enregistrerRevisionMarche(marche, { ...v, termes: v.termes ?? [] });
      message('Prix du marché enregistrés', 'succes');
      await rendreRevision(zone, { marche, message, ouvrir, modifiable });
    } catch (e) { message(e.message, 'erreur'); }
  });
  zone.querySelector('[data-facture]')?.addEventListener('click', async (e) => {
    if (!await confirmer(`Créer une facture de régularisation de ${f(r.totaux.a_facturer)} € HT ? Les montants seront recalculés à sa validation.`)) return;
    try {
      const d = await api.factureRevision(marche);
      message(`Facture de régularisation ${d.document.ent_numero ?? ''} créée : à valider`, 'succes');
      ouvrir?.(urlDocument(d.document.ent_id), e);
    } catch (x) { message(x.message, 'erreur'); }
  });
}
