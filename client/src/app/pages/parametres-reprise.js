import { texte, texteHtml, icone, iconeHtml, textesParCode, langue } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDateHeure, telechargerFichier } from '@logibtp/socle/ui';
import { erreursParChamp } from '@logibtp/socle';
import { SOURCE_REPRISE, ETAT_REPRISE, NIVEAU_ANOMALIE, VOLUME_MDE, groupesFusion, controlerFusions, choixDepuisFusions } from '@logibtp/import';
import { api } from '../api.js';

const SOURCES = textesParCode('parametres_btp.reprise.sources', Object.values(SOURCE_REPRISE));
const ETATS = textesParCode('parametres_btp.reprise.etats', Object.values(ETAT_REPRISE));
const NIVEAUX = textesParCode('parametres_btp.reprise.niveaux', Object.values(NIVEAU_ANOMALIE));
const VOLUMES = textesParCode('parametres_btp.reprise.volumes', Object.values(VOLUME_MDE));

const t = (cle, valeurs) => texte(`parametres_btp.reprise.${cle}`, valeurs);
const th = (cle, valeurs) => texteHtml(`parametres_btp.reprise.${cle}`, valeurs);
const nombre = (n) => Number(n ?? 0).toLocaleString(langue());
// Affichage seulement (écarts d'arrondi du rapport) : le calcul reste au serveur.
const montant = (n) => Number(n ?? 0).toLocaleString(langue(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sections du rapport : clé du titre, clés des colonnes, lignes et cellules (texte brut, échappé au rendu). */
export function sectionsRapport(r) {
  return [
    { cle: 'anomalies', colonnes: ['niveau', 'code', 'emplacement', 'message'], lignes: r.anomalies ?? [],
      cellules: (a) => [NIVEAUX[a.niveau] ?? a.niveau, a.code, a.emplacement ?? '', a.message] },
    { cle: 'volumes', colonnes: ['table', 'lues', 'ecrites', 'ecartees'], lignes: r.volumes ?? [],
      cellules: (v) => [v.table, nombre(v.lues), nombre(v.ecrites), nombre(v.ecartees)] },
    { cle: 'valeurs_forcees', colonnes: ['fiche', 'cle', 'champ', 'valeur'], lignes: r.valeurs_forcees ?? [],
      cellules: (v) => [v.fiche, v.cle, v.champ, v.valeur] },
    { cle: 'ecarts_arrondi', colonnes: ['piece', 'total_source', 'total_calcule', 'ecart'], lignes: r.ecarts_arrondi ?? [],
      cellules: (e) => [e.piece, montant(e.total_source), montant(e.total_calcule), montant(e.ecart)] },
    { cle: 'champs_perdus', colonnes: ['table', 'champ', 'nombre', 'exemples', 'motif'], lignes: r.champs_perdus ?? [],
      cellules: (p) => [p.table, p.champ, nombre(p.nombre), (p.exemples ?? []).join(' ; '), p.motif ?? ''] },
    { cle: 'correspondances', colonnes: ['table', 'source', 'resultat'],
      lignes: Object.entries(r.correspondances ?? {}).flatMap(([table, v]) => Object.entries(v).map(([source, resultat]) => ({ table, source, resultat }))),
      cellules: (c) => [c.table, c.source, c.resultat] },
    { cle: 'utilisateurs', colonnes: ['identifiant', 'nom', 'courriel', 'profil', 'fiche'], lignes: r.utilisateurs ?? [],
      cellules: (u) => [u.identifiant, u.nom ?? '', u.courriel ?? '', u.profil ?? '', u.fiche_type ? `${u.fiche_type} ${u.fiche_id}` : ''] },
    { cle: 'tables_source', colonnes: ['table', 'lignes'],
      lignes: Object.entries(r.tables_source ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      cellules: ([table, n]) => [table, nombre(n)] },
  ];
}

/** Sociétés saisies « 1, 2 » → ['1', '2'] (vides ignorés). */
export const lireSocietes = (saisie) => String(saisie ?? '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
/** Décimales saisies (0 à 6) ; vide ou invalide : null (décimales de la source). */
export const lireDecimales = (saisie) => {
  const n = Number.parseInt(String(saisie ?? '').trim(), 10);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
};

/**
 * Reprise de données (module Import, plan reprise-mde-optim, lot 3) : connexion à la base MDE ou OptimBTP (saisie à
 * chaque fois, jamais conservée), sociétés OPTIM regroupées, correspondances par défaut à télécharger ou fichier
 * ajusté à recharger, simulation puis rapport par section, doublons proposés à cocher (fusions enregistrées pour la
 * reprise suivante), puis reprise réelle confirmée. Administrateur ; refusée si la base contient déjà des données.
 */
export class PageParametresReprise extends PageBase {
  icone = icone('parametres_btp_reprise');

  async ouvrir() {
    this.titre = t('titre');
    this.correspondances = null;
    this.conteneur.innerHTML = `<div class="page-parametres page-reprise"><div class="entete-page"><h1 class="page-titre">${iconeHtml('parametres_btp_reprise')} ${th('titre')}</h1></div>
      <p class="aide">${th('aide')}</p><div data-etat></div>
      <table class="tableau-compact largeur-contenu" data-formulaire><tbody>
        <tr><th>${th('source')}</th><td data-source></td></tr>
        <tr><th>${th('connexion')}</th><td><input type="password" data-c="connexion" size="60" autocomplete="off" spellcheck="false" placeholder="${th('connexion_aide')}"><span class="erreur" data-erreur="connexion"></span></td></tr>
        <tr data-ligne-societes><th>${th('societes')}</th><td><input data-c="societes" size="20" placeholder="${th('societes_aide')}"></td></tr>
        <tr><th>${th('decimales')}</th><td><label class="ligne">${th('decimales_qte')} <input type="number" data-c="decimales_qte" min="0" max="6" step="1" size="3" placeholder="${th('decimales_source')}"></label>
          <label class="ligne">${th('decimales_prix')} <input type="number" data-c="decimales_prix" min="0" max="6" step="1" size="3" placeholder="${th('decimales_source')}"></label>
          <span class="aide">${th('decimales_aide')}</span></td></tr>
        <tr data-ligne-volume><th>${th('volume')}</th><td><span data-volume></span><span class="aide">${th('volume_aide')}</span></td></tr>
        <tr><th>${th('correspondances')}</th><td><span data-fichier>${th('correspondances_defaut')}</span>
          <button type="button" data-action="telecharger" title="${th('telecharger')}">${iconeHtml('parametres_btp_reprise_telecharger')}</button>
          <button type="button" data-action="charger" title="${th('charger')}">${iconeHtml('parametres_btp_reprise_charger')}</button><input type="file" accept=".json,application/json" data-c="fichier" hidden>
          <button type="button" data-action="retirer" title="${th('retirer')}" hidden>${iconeHtml('supprimer')}</button></td></tr>
      </tbody></table>
      <div class="barre-outils"><div class="groupe-outils">
        <button type="button" class="principal" data-action="simuler">${iconeHtml('parametres_btp_reprise_simuler')} ${th('simuler')}</button>
        <button type="button" class="danger" data-action="lancer">${iconeHtml('parametres_btp_reprise_lancer')} ${th('lancer')}</button>
      </div></div>
      <div data-rapport></div>
      <h2>${th('historique.titre')}</h2><div data-historique></div></div>`;
    this.combo = creerCombo({ options: Object.entries(SOURCES).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: SOURCE_REPRISE.MDE, vide: false });
    this.combo.addEventListener('change', () => { this.proposerDecimales(); this.synchroniser(); });
    this.conteneur.querySelector('[data-source]').append(this.combo);
    this.comboVolume = creerCombo({ options: Object.entries(VOLUMES).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: VOLUME_MDE.SURFACE, vide: false });
    this.conteneur.querySelector('[data-volume]').append(this.comboVolume);
    this.conteneur.querySelector('[data-c="fichier"]').addEventListener('change', (e) => this.chargerFichier(e.target).catch((x) => this.app.erreur(x)));
    this.conteneur.querySelector('.page-reprise').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const actions = {
        telecharger: () => this.telechargerDefaut(),
        charger: () => this.conteneur.querySelector('[data-c="fichier"]').click(),
        retirer: () => { this.correspondances = null; this.synchroniser(); },
        simuler: () => this.executer(true),
        lancer: () => this.executer(false),
        afficher: () => this.afficher(Number(b.dataset.id)),
        markdown: () => this.telechargerMarkdown(Number(b.dataset.id)),
        fusions: () => this.enregistrerFusions(),
      };
      Promise.resolve(actions[b.dataset.action]?.()).catch((x) => this.app.erreur(x));
    });
    await this.charger();
  }

  get source() { return this.combo.valeurCombo || SOURCE_REPRISE.MDE; }

  async charger() {
    this.etat = await api.reprise.etat();
    const zone = this.conteneur.querySelector('[data-etat]');
    zone.innerHTML = this.etat.base_vide ? '' : `<p class="erreur">${iconeHtml('avertissement')} ${th('base_non_vide')}</p>`;
    this.conteneur.querySelectorAll('[data-action="simuler"], [data-action="lancer"]').forEach((b) => { b.disabled = !this.etat.base_vide; });
    this.rendreHistorique();
    if (!this.decimalesProposees) { this.proposerDecimales(); this.decimalesProposees = true; }
    this.synchroniser();
  }

  /** Décimales proposées pour la source choisie (MDE : quantités 3, prix 2) ; vide : celles de la source. */
  proposerDecimales() {
    const d = this.etat?.decimales?.[this.source] ?? {};
    this.conteneur.querySelector('[data-c="decimales_qte"]').value = d.qte ?? '';
    this.conteneur.querySelector('[data-c="decimales_prix"]').value = d.prix ?? '';
  }

  /** Sociétés pour OPTIM seulement ; nom du fichier de correspondances chargé ; doublons recochés selon la source. */
  synchroniser() {
    this.conteneur.querySelector('[data-ligne-societes]').hidden = this.source !== SOURCE_REPRISE.OPTIM;
    this.conteneur.querySelector('[data-ligne-volume]').hidden = this.source !== SOURCE_REPRISE.MDE;
    this.conteneur.querySelector('[data-fichier]').textContent = this.correspondances ? t('correspondances_fichier', { nom: this.correspondances.nom }) : t('correspondances_defaut');
    this.conteneur.querySelector('[data-action="retirer"]').hidden = !this.correspondances;
    this.conteneur.querySelector('[data-c="fichier"]').value = '';
  }

  async telechargerDefaut() {
    const f = await api.reprise.correspondances(this.source);
    telechargerFichier(f.nom, f.contenu, 'application/json;charset=utf-8');
  }

  async chargerFichier(input) {
    const fichier = input.files?.[0];
    if (!fichier) return;
    this.correspondances = { nom: fichier.name, contenu: await fichier.text() };
    this.synchroniser();
  }

  async executer(simulation) {
    const champ = (c) => this.conteneur.querySelector(`[data-c="${c}"]`);
    const erreur = this.conteneur.querySelector('[data-erreur="connexion"]');
    erreur.textContent = '';
    const source = this.source;
    if (!simulation && !await confirmer(t('confirmer_lancement', { source: SOURCES[source] ?? source }))) return;
    const boutons = this.conteneur.querySelectorAll('[data-action="simuler"], [data-action="lancer"]');
    boutons.forEach((b) => { b.disabled = true; });
    this.conteneur.querySelector('[data-rapport]').innerHTML = `<p class="aide">${th(simulation ? 'simulation_en_cours' : 'reprise_en_cours')}</p>`;
    try {
      const r = await api.reprise.executer({
        source, connexion: champ('connexion').value, simulation,
        societes: source === SOURCE_REPRISE.OPTIM ? lireSocietes(champ('societes').value) : [],
        correspondances: this.correspondances?.contenu ?? null,
        decimales_qte: lireDecimales(champ('decimales_qte').value),
        decimales_prix: lireDecimales(champ('decimales_prix').value),
        volume_mde: source === SOURCE_REPRISE.MDE ? this.comboVolume.valeurCombo || VOLUME_MDE.SURFACE : null,
      });
      this.rapportId = r.reprise_id;
      const message = r.rapport.etat === ETAT_REPRISE.TERMINEE ? t(simulation ? 'simulation_terminee' : 'reprise_terminee') : t('reprise_echec');
      this.app.message(message, r.rapport.etat === ETAT_REPRISE.TERMINEE ? 'succes' : 'avertissement');
      await this.charger();
      this.rendreRapport(r.reprise_id, r.rapport);
    } catch (e) {
      this.conteneur.querySelector('[data-rapport]').innerHTML = '';
      const champs = erreursParChamp(e).filter((d) => d.champ === 'connexion');
      if (champs.length) erreur.textContent = champs.map((d) => d.message).join(' ');
      else throw e;
    } finally {
      boutons.forEach((b) => { b.disabled = !this.etat?.base_vide; });
    }
  }

  rendreHistorique() {
    const zone = this.conteneur.querySelector('[data-historique]');
    const liste = this.etat.executions ?? [];
    if (!liste.length) { zone.innerHTML = `<p class="aide">${th('historique.aucune')}</p>`; return; }
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${th('historique.numero')}</th><th>${th('historique.debut')}</th>
      <th>${th('source')}</th><th>${th('historique.type')}</th><th>${th('historique.etat')}</th><th>${th('historique.anomalies')}</th><th>${th('historique.auteur')}</th><th></th></tr></thead><tbody>
      ${liste.map((x) => `<tr data-execution="${x.id}"><td>${x.id}</td><td>${formatDateHeure(x.debut)}</td><td>${echapper(SOURCES[x.source] ?? x.source)}${x.societes?.length ? ` <small class="aide">(${echapper(x.societes.join(', '))})</small>` : ''}</td>
        <td>${th(x.simulation ? 'historique.simulation' : 'historique.reelle')}</td>
        <td${x.etat === ETAT_REPRISE.TERMINEE ? '' : ' class="erreur"'}>${echapper(ETATS[x.etat] ?? x.etat)}</td>
        <td>${th('historique.compte', { bloquantes: x.bloquantes, avertissements: x.avertissements })}</td><td>${echapper(x.auteur ?? '')}</td>
        <td class="cellule-boutons"><button type="button" data-action="afficher" data-id="${x.id}" title="${th('historique.afficher')}">${iconeHtml('parametres_btp_reprise_rapport')}</button>
          <button type="button" data-action="markdown" data-id="${x.id}" title="${th('historique.markdown')}">${iconeHtml('parametres_btp_reprise_telecharger')}</button></td></tr>`).join('')}
      </tbody></table>`;
  }

  async afficher(id) {
    this.rendreRapport(id, await api.reprise.rapport(id));
  }

  async telechargerMarkdown(id) {
    const f = await api.reprise.markdown(id);
    telechargerFichier(f.nom, f.contenu, 'text/markdown;charset=utf-8');
  }

  /** Rapport d'une exécution : résumé, doublons à cocher, puis une section repliable par rubrique. */
  rendreRapport(id, r) {
    this.rapport = r;
    this.doublons = r.doublons ?? [];
    this.choix = choixDepuisFusions(this.doublons, this.etat?.fusions?.[r.source] ?? []);
    const sections = sectionsRapport(r).map((s) => `<details${s.cle === 'anomalies' && s.lignes.length ? ' open' : ''} data-section="${s.cle}">
      <summary>${th(`rapport.${s.cle}.titre`)} (${s.lignes.length})</summary>
      ${s.lignes.length === 0 ? `<p class="aide">${th('rapport.aucune')}</p>` : `<table class="tableau-compact largeur-contenu"><thead><tr>${s.colonnes.map((c) => `<th>${th(`rapport.${s.cle}.${c}`)}</th>`).join('')}</tr></thead><tbody>
        ${s.lignes.map((l) => `<tr>${s.cellules(l).map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}</details>`).join('');
    this.conteneur.querySelector('[data-rapport]').innerHTML = `<h2>${th('rapport.titre', { numero: id })}</h2>
      <p>${th('rapport.resume', { etat: ETATS[r.etat] ?? r.etat, type: t(r.simulation ? 'historique.simulation' : 'historique.reelle'), debut: formatDateHeure(r.debut), domaines: (r.domaines ?? []).length })}</p>
      ${this.renduDoublons()}${sections}`;
  }

  renduDoublons() {
    if (!this.doublons.length) return '';
    return `<h3>${th('doublons.titre')}</h3><p class="aide">${th('doublons.aide')}</p>
      <table class="tableau-compact largeur-contenu" data-doublons><thead><tr><th>${th('doublons.fusionner')}</th><th>${th('doublons.critere')}</th><th>${th('doublons.conservee')}</th></tr></thead><tbody>
      ${this.doublons.map((d, i) => `<tr data-doublon="${i}"><td><input type="checkbox" data-fusionner ${this.choix[i].fusionner ? 'checked' : ''}></td>
        <td>${echapper(d.table)} · ${echapper(d.critere)} ${echapper(d.valeur)}</td>
        <td>${d.fiches.map((f) => `<label class="ligne"><input type="radio" name="conservee-${i}" value="${echapper(f.cle)}" ${String(f.cle).trimEnd() === this.choix[i].conservee ? 'checked' : ''}> ${echapper(f.cle)} ${echapper(f.libelle)}</label>`).join('')}</td></tr>`).join('')}
      </tbody></table><span class="erreur" data-erreur="fusions"></span>
      <div class="barre-outils"><div class="groupe-outils"><button type="button" data-action="fusions">${iconeHtml('parametres_btp_reprise_fusionner')} ${th('doublons.enregistrer')}</button></div></div>`;
  }

  async enregistrerFusions() {
    const choix = this.doublons.map((_, i) => {
      const tr = this.conteneur.querySelector(`tr[data-doublon="${i}"]`);
      return { fusionner: tr.querySelector('[data-fusionner]').checked, conservee: tr.querySelector('input[type="radio"]:checked')?.value };
    });
    const groupes = groupesFusion(this.doublons, choix);
    const erreurs = controlerFusions(groupes);
    const zone = this.conteneur.querySelector('[data-erreur="fusions"]');
    zone.textContent = erreurs.map((e) => t(`doublons.erreurs.${e.code}`, { cle: e.cle })).join(' ');
    if (erreurs.length) return;
    await api.reprise.fusions(this.rapport.source, groupes);
    this.app.message(t('doublons.enregistrees', { nombre: groupes.length }), 'succes');
    await this.charger();
  }
}
