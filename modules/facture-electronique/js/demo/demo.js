// Démonstration des écrans du module Facturation électronique avec la plateforme simulée (api-simulee.js) : paramètres
// et essai de connexion, tableau des flux, détail et chronologie, dépôt et import manuels, chronologie d'un élément.
import { initialiserDictionnaire, fusionner, texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import '@logibtp/socle/ui/socle.css';
import '../../../../socle/js/personnalisation/theme.css';
import '../personnalisation/theme.css';
import '../ui/facture-electronique.css';
import libellesSocle from '../../../../socle/js/personnalisation/fr.json';
import iconesSocle from '../../../../socle/js/personnalisation/images/icones.json';
import libelles from '../personnalisation/fr.json';
import icones from '../personnalisation/images/icones.json';

initialiserDictionnaire({ libelles: fusionner(libellesSocle, libelles), icones: fusionner(iconesSocle, icones) });

// Les écrans déclarent leurs raccourcis (libellés du dictionnaire) à l'import : après le dictionnaire.
const { activerDates, echapper, saisir, alerter } = await import('@logibtp/socle/ui');
const { messageErreur } = await import('@logibtp/socle/dictionnaire');
const { ParametresFe, TableauFlux, DetailFlux, PanneauDepotManuel, Chronologie } = await import('../ui/index.js');
const { creerApiSimulee } = await import('./api-simulee.js');
const { CONNECTEUR_FE } = await import('../src/index.js');

const api = creerApiSimulee();
const peut = { modifier: true };
const zone = (nom) => document.querySelector(`[data-zone="${nom}"]`);
const erreur = (e) => alerter(messageErreur(e?.code, e?.message ?? String(e)));
const ELEMENT = 'FA-2026-0001';
const libelleElement = (type, id) => texte('facture_electronique.demo.element', { type, id });

let detail;
let tableau;
let depot;
let chronologieElement;
const actualiser = async () => { await Promise.all([tableau.charger(), depot.charger(), chronologieElement.charger()]); };
const ouvrirFlux = async (id) => { zone('detail').hidden = false; await detail.ouvrir(id); zone('detail').scrollIntoView({ behavior: 'smooth' }); };

const parametres = new ParametresFe(zone('parametres'), { peut, api, erreur });
tableau = new TableauFlux(zone('flux'), { peut, api, ouvrirFlux, libelleElement, erreur, apresEcriture: () => depot.charger() });
detail = new DetailFlux(zone('detail'), { peut, api, libelleElement, ouvrirFlux, erreur, apresEcriture: actualiser });
depot = new PanneauDepotManuel(zone('depot'), { peut, api, ouvrirFlux, erreur, apresEcriture: () => tableau.charger() });
const corpsElement = document.createElement('div');
chronologieElement = new Chronologie(corpsElement, { charger: () => api.chronologieElement('DOCUMENT', ELEMENT), element: true, libelleElement, ouvrirFlux, erreur });

// Jeu de départ : une facture acceptée puis approuvée, une refusée par la plateforme, un dépôt manuel en attente.
await api.emettre(ELEMENT, ELEMENT);
await api.emettre('FA-2026-0002-REJET');
for (let i = 0; i < 4; i++) await api.relever();
await api.enregistrer({ ...(await api.parametres()), connecteurs: undefined, connecteur: CONNECTEUR_FE.MANUEL });
await api.emettre('FA-2026-0003');
await api.enregistrer({ ...(await api.parametres()), connecteurs: undefined, connecteur: CONNECTEUR_FE.SIMULE });

const ONGLETS = ['parametres', 'flux', 'depot', 'element'];
document.title = texte('facture_electronique.demo.titre');
document.querySelector('[data-titre]').innerHTML = `${iconeHtml('fe_flux')} ${texteHtml('facture_electronique.demo.titre')}`;
document.querySelector('[data-onglets]').innerHTML = `<span class="groupe-outils">${ONGLETS.map((o) => `<button type="button" data-onglet="${o}">${texteHtml(`facture_electronique.demo.onglets.${o}`)}</button>`).join('')}</span>
  <span class="groupe-outils"><button type="button" data-emettre>${iconeHtml('fe_depot')} ${texteHtml('facture_electronique.demo.emettre')}</button>
  <button type="button" data-relever>${iconeHtml('fe_relever')} ${texteHtml('facture_electronique.tableau.relever')}</button></span>`;
zone('element').innerHTML = `<h2 class="titre-actions">${iconeHtml('fe_chronologie')} ${echapper(texte('facture_electronique.demo.chronologie_element', { element: ELEMENT }))}</h2>`;
zone('element').append(corpsElement);

const montrer = (onglet) => {
  for (const o of ONGLETS) zone(o).hidden = o !== onglet;
  document.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('principal', b.dataset.onglet === onglet));
};
document.querySelector('[data-onglets]').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.onglet) montrer(b.dataset.onglet);
  else if (b.matches('[data-emettre]')) {
    const numero = await saisir(texte('facture_electronique.demo.numero'), `FA-2026-${String(Date.now()).slice(-4)}`, { titre: texte('facture_electronique.demo.emettre'), obligatoire: true });
    if (numero) { await api.emettre(numero.trim()); await actualiser(); }
  } else if (b.matches('[data-relever]')) { await api.relever(); await actualiser(); if (!zone('detail').hidden) await detail.charger(); }
});

await Promise.all([parametres.charger(), actualiser()]);
activerDates(document.body);
montrer('flux');
// Adresse « #flux=<id> » : détail du flux ouvert d'emblée.
const lien = /^#flux=(\d+)$/.exec(location.hash);
if (lien) await ouvrirFlux(Number(lien[1]));
