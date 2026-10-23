import { echapper, formatLibre, htmlSur, editerLibelle, creerCombo } from '@logibtp/socle/ui';
import { MODES, LIBELLES_MODES, enSaisie, titreFiche } from '../src/modes.js';
import { validerFiche, MESSAGES } from '../src/validation.js';
import { ParametrageFiche } from './parametrage.js';

const BATTEMENT = 30000;
const CLE_CONFIDENTIEL = 'logibtp.fiche.confidentiel';

const jetonNeuf = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const vide = (v) => v === null || v === undefined || v === '';
const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Option de session : afficher les informations confidentielles sans les masquer (durée de l'onglet). */
export function confidentielSession() {
  try { return sessionStorage.getItem(CLE_CONFIDENTIEL) === '1'; } catch { return false; }
}
export function definirConfidentielSession(actif) {
  try { if (actif) sessionStorage.setItem(CLE_CONFIDENTIEL, '1'); else sessionStorage.removeItem(CLE_CONFIDENTIEL); } catch { /* option non conservée */ }
}

/**
 * Fiche d'un élément (classe mère), ouverte à partir d'un type et d'un ID, dans un mode (consultation,
 * modification, création, copie) qui peut changer une fois la fiche ouverte.
 *
 * - Droits du type : VOIR, MODIFIER, DEBLOQUER (reprendre la main), CONFIDENTIEL.
 * - Verrou : passer en modification prend le verrou (renouvelé toutes les 30 s) ; si un autre utilisateur modifie
 *   la fiche, un bandeau l'indique et propose « Reprendre la main » à qui a le droit DEBLOQUER.
 * - Onglets peu nombreux, composés de groupes de champs (cadres titrés) : section { code, titre, groupes: [{ titre,
 *   champs, largeur }] } (ou champs à plat : un seul groupe sans titre).
 * - Champs obligatoires du programme (*) et par paramétrage (◆), champs supplémentaires paramétrés (regroupés en
 *   cadres, dans un onglet de la définition ou dans Informations complémentaires), champs confidentiels masqués
 *   (affichage à la demande, ou pendant toute la session), mots de passe (jamais chargés, révélés à la demande :
 *   accès journalisé), onglet Pièces jointes (GED).
 *
 * Points de spécialisation : sousTitre, champsNonCopies, valeursCreation, validerMetier, rendreChamp,
 * rendreInformations (encart calculé), actionsSupplementaires, apresChargement.
 * Options : conteneur, fournisseur, type, id, mode, message, ged (vue simplifiée de la GED), peutParametrer,
 * surEnregistre(fiche, { cree }), surFerme().
 */
/** Bulle d'un bouton : libellé (bouton en icône seule) puis explication. */
const bulle = (b) => (b.icone ? [b.libelle, b.titre].filter(Boolean).join(' — ') : (b.titre ?? ''));

export class FicheBase {
  constructor({ conteneur, fournisseur, type, id = null, mode = MODES.CONSULTATION, message, ged = null, peutParametrer = false, actions = [], surEnregistre, surFerme, surSupprime }) {
    this.conteneur = conteneur;
    this.fournisseur = fournisseur;
    this.type = type;
    this.id = id;
    this.mode = mode;
    this.message = message ?? (() => {});
    this.ged = ged;
    this.peutParametrer = peutParametrer;
    this.actionsHote = actions;
    this.surEnregistre = surEnregistre;
    this.surFerme = surFerme;
    this.surSupprime = surSupprime;
    this.jeton = jetonNeuf();
    this.erreurs = [];
    this.section = null;
    this.reveles = false;
    this.secretsReveles = new Map();
    this.saisie = { valeurs: {}, proprietes: {} };
  }

  // ---------------------------------------------------------------- points de spécialisation

  /** Ligne sous le titre (ex. matricule et poste). */
  sousTitre(_valeurs) { return this.definition.sous_titre ? titreFiche(this.definition.sous_titre, _valeurs) : ''; }

  /** Champs vidés lors d'une copie (identifiants, numéros uniques… et champs gérés : données liées à la fiche copiée). */
  champsNonCopies() { return this.definition.champs.filter((c) => c.non_copie || c.gere).map((c) => c.code); }

  /** Valeurs initiales d'une création. */
  valeursCreation() { return Object.fromEntries(this.definition.champs.filter((c) => c.defaut !== undefined).map((c) => [c.code, c.defaut])); }

  /** Contrôles métier en plus des règles des champs : [{ champ, message }]. */
  validerMetier(_valeurs, _proprietes) { return []; }

  /** Encart d'informations calculées affiché sous l'en-tête (HTML), ou ''. */
  rendreInformations(_valeurs) { return ''; }

  /** Boutons supplémentaires de l'en-tête : [{ libelle, titre, action, visible }]. */
  actionsSupplementaires() { return []; }

  /**
   * Onglets propres à la classe fille, placés après ceux de la définition : [{ code, titre, rendre(corps, { modifiable }) }] ;
   * avec « dans: <code d'onglet> », le contenu est ajouté sous les groupes de cet onglet au lieu d'un onglet séparé.
   * Un onglet modifie la fiche par definirValeur(code, valeur) : la valeur part avec l'enregistrement (verrou, validation).
   */
  ongletsSpecifiques() { return []; }

  /** Valeur saisie par un onglet spécifique (tableau, objet JSON, valeur calculée…). */
  definirValeur(code, valeur) {
    this.saisie.valeurs[code] = valeur;
    this.#majTitre();
  }

  /** Fiche en saisie (modification, création ou copie). */
  estEnSaisie() { return enSaisie(this.mode); }

  apresChargement() {}

  // ---------------------------------------------------------------- ouverture et chargement

  async ouvrir() {
    this.definition = await this.fournisseur.definition(this.type);
    if (!this.definition.droits.voir) throw new Error(`Accès refusé aux fiches ${this.definition.libelle}`);
    if (this.mode === MODES.CREATION) {
      this.fiche = { id: null, valeurs: this.valeursCreation(), proprietes: {}, h: null, masques: [], verrou: null };
    } else {
      await this.recharger();
      if (this.mode === MODES.COPIE) this.#preparerCopie();
      else if (this.mode === MODES.MODIFICATION) {
        this.mode = MODES.CONSULTATION;
        this.#construire();
        await this.modifier();
        return this;
      }
    }
    this.#construire();
    return this;
  }

  async recharger() {
    this.fiche = await this.fournisseur.charger(this.type, this.id, { confidentiel: confidentielSession() || this.reveles });
    this.saisie = { valeurs: {}, proprietes: {} };
    this.secretsReveles = new Map();
    if (confidentielSession() && this.fiche.masques.length === 0) this.reveles = true;
  }

  #preparerCopie() {
    const valeurs = { ...this.fiche.valeurs };
    for (const c of this.champsNonCopies()) valeurs[c] = null;
    // Une copie ne reprend pas les informations confidentielles non affichées.
    for (const m of this.fiche.masques) if (!m.startsWith('+')) valeurs[m] = null;
    this.copieDe = this.id;
    // Les mots de passe ne sont pas copiés (jamais chargés) : à ressaisir.
    this.fiche = { id: null, valeurs, proprietes: { ...this.fiche.proprietes }, h: null, masques: [], secrets: [], verrou: null };
    this.secretsReveles = new Map();
    this.mode = MODES.COPIE;
    this.saisie = { valeurs: {}, proprietes: {} };
  }

  // ---------------------------------------------------------------- valeurs

  valeur(code) { return code in this.saisie.valeurs ? this.saisie.valeurs[code] : this.fiche.valeurs[code]; }
  propriete(code) { return code in this.saisie.proprietes ? this.saisie.proprietes[code] : this.fiche.proprietes?.[code]; }
  valeurs() { return { ...this.fiche.valeurs, ...this.saisie.valeurs }; }
  proprietes() { return { ...this.fiche.proprietes, ...this.saisie.proprietes }; }
  get modifiee() { return Object.keys(this.saisie.valeurs).length + Object.keys(this.saisie.proprietes).length > 0; }
  get masques() { return new Set(this.fiche.masques); }

  // ---------------------------------------------------------------- construction

  #construire() {
    this.conteneur.classList.add('fiche');
    this.conteneur.innerHTML = `
      <header class="fiche-entete">
        <div class="fiche-titre">
          <span class="fiche-type"></span>
          <h2></h2>
          <span class="fiche-sous-titre"></span>
        </div>
        <span class="fiche-mode"></span>
        <div class="fiche-actions"></div>
      </header>
      <div class="fiche-bandeau" hidden></div>
      <div class="fiche-informations" hidden></div>
      <ul class="fiche-erreurs" hidden></ul>
      <nav class="fiche-onglets"></nav>
      <div class="fiche-corps"></div>`;
    this.rendre();
    this.apresChargement();
  }

  /**
   * Onglets : ceux de la définition (groupes de champs), Informations complémentaires (champs supplémentaires sans
   * onglet) et Pièces jointes (GED). Les champs supplémentaires sont regroupés par cadre (groupe paramétré), dans
   * l'ordre paramétré, après les groupes de l'onglet choisi. Chaque onglet expose la liste à plat de ses champs
   * (champs : programme, supplementairesSection : codes supplémentaires) pour les erreurs et la navigation.
   */
  sections() {
    const base = this.definition.sections ?? [{ code: 'general', titre: 'Général', champs: this.definition.champs.map((c) => c.code) }];
    const supplementaires = (this.definition.supplementaires ?? []).map((c) => ({ ...c, supplementaire: true }));
    const codes = new Set(base.map((x) => x.code));
    const parGroupe = (champs, titre) => {
      const m = new Map();
      for (const c of champs) {
        const t = c.groupe || titre;
        if (!m.has(t)) m.set(t, []);
        m.get(t).push(c);
      }
      return [...m].map(([t, cs]) => ({ titre: t, champs: cs, supplementaire: true, largeur: m.size === 1 && !titre ? 'plein' : null }));
    };
    const s = base.map((x) => {
      const groupes = x.groupes ?? [{ titre: null, champs: x.champs ?? [] }];
      const ajout = parGroupe(supplementaires.filter((c) => c.section === x.code), 'Informations complémentaires');
      return { ...x, groupes: [...groupes, ...ajout], champs: groupes.flatMap((g) => g.champs), supplementairesSection: ajout.flatMap((g) => g.champs.map((c) => c.code)) };
    });
    for (const o of this.ongletsSpecifiques().filter((x) => !x.dans)) s.push({ code: `+${o.code}`, titre: o.titre, specifique: o, champs: o.champs ?? [] });
    const reste = supplementaires.filter((c) => !c.section || !codes.has(c.section));
    if (reste.length) {
      s.push({ code: '+supplementaires', titre: 'Informations complémentaires', groupes: parGroupe(reste, null), champs: [], supplementairesSection: reste.map((c) => c.code) });
    }
    s.push({ code: '+pieces', titre: 'Pièces jointes', pieces: true });
    return s;
  }

  /** Onglet qui contient le champ d'une erreur. */
  #sectionErreur(sections, e) {
    return sections.find((s) => (e.supplementaire ? s.supplementairesSection?.includes(e.champ) : s.champs?.includes(e.champ)))?.code;
  }

  rendre() {
    const v = this.valeurs();
    const def = this.definition;
    const c = this.conteneur;
    c.classList.toggle('fiche-saisie', enSaisie(this.mode));
    c.querySelector('.fiche-type').textContent = def.libelle;
    c.querySelector('h2').textContent = titreFiche(def.titre, v) || (this.mode === MODES.CREATION || this.mode === MODES.COPIE ? `Nouveau ${def.libelle.toLowerCase()}` : `${def.libelle} ${this.id}`);
    c.querySelector('.fiche-sous-titre').textContent = this.sousTitre(v);
    const mode = c.querySelector('.fiche-mode');
    mode.textContent = LIBELLES_MODES[this.mode] + (this.copieDe ? ` de ${this.copieDe}` : '');
    mode.className = `fiche-mode mode-${this.mode}`;
    this.#rendreActions();
    this.#rendreBandeau();
    const infos = c.querySelector('.fiche-informations');
    const html = this.rendreInformations(v);
    infos.hidden = !html;
    infos.innerHTML = html;
    this.#rendreErreurs();
    const sections = this.sections();
    if (!sections.some((s) => s.code === this.section)) this.section = sections[0].code;
    const enErreur = new Set(this.erreurs.map((e) => this.#sectionErreur(sections, e)));
    c.querySelector('.fiche-onglets').innerHTML = sections.map((s) =>
      `<button type="button" data-section="${echapper(s.code)}" class="${s.code === this.section ? 'actif' : ''} ${enErreur.has(s.code) ? 'erreur' : ''}">${echapper(s.titre)}</button>`).join('');
    c.querySelectorAll('[data-section]').forEach((b) => b.addEventListener('click', () => { this.section = b.dataset.section; this.rendre(); }));
    this.#rendreSection(sections.find((s) => s.code === this.section));
  }

  #rendreActions() {
    const d = this.definition.droits;
    const saisie = enSaisie(this.mode);
    const masques = this.fiche.masques.length > 0;
    const boutons = [
      { icone: '✎', libelle: 'Modifier', titre: 'Passer en modification (verrouille la fiche)', action: () => this.modifier(), visible: !saisie && d.modifier && this.id !== null, principal: true },
      { libelle: 'Enregistrer', titre: 'Enregistrer (Ctrl+S)', action: () => this.enregistrer(), visible: saisie, principal: true },
      { libelle: 'Annuler', titre: 'Abandonner les modifications', action: () => this.annuler(), visible: saisie },
      { icone: '⧉', libelle: 'Copier', titre: 'Créer une nouvelle fiche à partir de celle-ci', action: () => this.copier(), visible: !saisie && d.modifier && this.id !== null },
      { icone: '🗑', libelle: 'Supprimer', titre: 'Supprimer cette fiche (refusé si elle est utilisée ailleurs)', action: () => this.supprimer(), visible: !saisie && d.supprimer && this.id !== null },
      { icone: '👁', libelle: 'Confidentiel', titre: 'Afficher les informations confidentielles (accès journalisé)', action: () => this.reveler(), visible: masques && d.confidentiel },
      ...this.actionsSupplementaires(),
      // Actions de l'application hôte (imprimer…), hors saisie et sur une fiche enregistrée.
      ...this.actionsHote.map((a) => ({ ...a, visible: !saisie && this.id !== null && a.visible !== false })),
      { icone: '⚙', libelle: 'Paramétrer', titre: 'Paramétrer la fiche : champs obligatoires et champs supplémentaires', action: () => this.parametrer(), visible: this.peutParametrer },
      { icone: '✕', libelle: 'Fermer', titre: 'Fermer (Échap)', action: () => this.fermer(), visible: true },
    ].filter((b) => b.visible !== false);
    const zone = this.conteneur.querySelector('.fiche-actions');
    zone.innerHTML = `${d.confidentiel ? `<label class="fiche-option" title="Ne pas masquer les informations confidentielles pendant cette session (onglet du navigateur)">
      <input type="checkbox" data-session ${confidentielSession() ? 'checked' : ''}> Visible (session)</label>` : ''}
      ${boutons.map((b, i) => `<button type="button" data-i="${i}" class="${b.principal ? 'principal' : ''}${b.icone ? ' bouton-icone' : ''}" title="${echapper(bulle(b))}" aria-label="${echapper(b.libelle)}">${echapper(b.icone ?? b.libelle)}</button>`).join('')}`;
    zone.querySelectorAll('button[data-i]').forEach((el) => el.addEventListener('click', () => Promise.resolve(boutons[Number(el.dataset.i)].action()).catch((e) => this.#erreur(e))));
    zone.querySelector('[data-session]')?.addEventListener('change', (e) => {
      definirConfidentielSession(e.target.checked);
      if (e.target.checked && this.fiche.masques.length) this.reveler().catch((x) => this.#erreur(x));
    });
  }

  #rendreBandeau() {
    const b = this.conteneur.querySelector('.fiche-bandeau');
    const v = this.fiche.verrou;
    // Son propre verrou (autre fenêtre, onglet fermé) n'est pas annoncé : il sera repris en passant en modification.
    if (!v || v.moi || v.meme_utilisateur) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = `🔒 En cours de modification par <strong>${echapper(v.utilisateur)}</strong> depuis ${heure(v.depuis)}
      ${this.definition.droits.debloquer && this.definition.droits.modifier ? '<button type="button" data-reprendre>Reprendre la main</button>' : ''}`;
    b.querySelector('[data-reprendre]')?.addEventListener('click', () => this.modifier({ forcer: true }).catch((e) => this.#erreur(e)));
  }

  #rendreErreurs() {
    const z = this.conteneur.querySelector('.fiche-erreurs');
    z.hidden = !this.erreurs.length;
    const libelle = (e) => (e.supplementaire ? this.definition.supplementaires : this.definition.champs).find((c) => c.code === e.champ)?.libelle ?? e.champ;
    z.innerHTML = this.erreurs.map((e) => `<li data-champ="${echapper(e.champ)}">${echapper(libelle(e))} : ${echapper(e.message)}</li>`).join('');
  }

  #rendreSection(section) {
    const corps = this.conteneur.querySelector('.fiche-corps');
    if (section.pieces) { this.#rendrePieces(corps); return; }
    if (section.specifique) {
      corps.innerHTML = '';
      section.specifique.rendre(corps, { modifiable: enSaisie(this.mode) });
      return;
    }
    const groupes = section.groupes.map((g) => (g.supplementaire ? g : { ...g, champs: g.champs.map((code) => this.definition.champs.find((c) => c.code === code)).filter(Boolean) }));
    corps.innerHTML = '<div class="fiche-groupes"></div>';
    const zone = corps.firstElementChild;
    for (const g of groupes.filter((x) => x.champs.length && this.groupeVisible(x, section))) zone.append(this.#groupe(g));
    if (!zone.children.length) zone.innerHTML = '<p class="aide">Aucun champ.</p>';
    for (const o of this.ongletsSpecifiques().filter((x) => x.dans === section.code)) {
      const bloc = document.createElement('div');
      bloc.className = 'fiche-complement';
      corps.append(bloc);
      o.rendre(bloc, { modifiable: enSaisie(this.mode) });
    }
  }

  /** Groupe affiché (point de spécialisation : groupe propre à une variante de la fiche) ; tous par défaut. */
  groupeVisible(_groupe, _section) { return true; }

  /** Groupe de champs (cadre titré) ; tout masqué : une seule ligne « informations confidentielles ». */
  #groupe(g) {
    const fs = document.createElement('fieldset');
    fs.className = `fiche-groupe ${g.largeur === 'plein' ? 'plein' : ''}`;
    if (g.titre) fs.innerHTML = `<legend>${echapper(g.titre)}</legend>`;
    const masques = this.masques;
    const toutMasque = g.champs.every((c) => masques.has(c.supplementaire ? `+${c.code}` : c.code));
    if (toutMasque) {
      const p = document.createElement('div');
      p.className = 'fiche-masque fiche-masque-groupe';
      p.innerHTML = `<span>🔒 Informations confidentielles (${g.champs.length})</span>${this.definition.droits.confidentiel ? '<button type="button">Afficher</button>' : '<em>non autorisé</em>'}`;
      p.querySelector('button')?.addEventListener('click', () => this.reveler().catch((e) => this.#erreur(e)));
      fs.append(p);
      return fs;
    }
    const grille = document.createElement('div');
    grille.className = 'fiche-grille';
    for (const c of g.champs) grille.append(this.#bloc(c));
    fs.append(grille);
    return fs;
  }

  #bloc(champ) {
    const code = champ.supplementaire ? `+${champ.code}` : champ.code;
    const masque = this.masques.has(code);
    const erreur = this.erreurs.find((e) => e.champ === champ.code && !!e.supplementaire === !!champ.supplementaire);
    const div = document.createElement('div');
    div.className = `fiche-champ ${champ.largeur === 'plein' || champ.type === 'zone' || champ.type === 'html' ? 'plein' : ''} ${erreur ? 'erreur' : ''} ${champ.confidentiel ? 'confidentiel' : ''}`;
    const marques = `${champ.obligatoire ? '<span class="obligatoire" title="Obligatoire (programme)">*</span>' : ''}${champ.obligatoire_parametre ? '<span class="obligatoire-parametre" title="Obligatoire (paramétrage)">◆</span>' : ''}${champ.confidentiel ? '<span class="marque-confidentiel" title="Information confidentielle">🔒</span>' : ''}`;
    div.innerHTML = `<label>${echapper(champ.libelle)} ${marques}</label>`;
    if (champ.aide) div.title = champ.aide;
    if (masque) {
      const m = document.createElement('div');
      m.className = 'fiche-masque';
      m.innerHTML = `<span>••••••••</span>${this.definition.droits.confidentiel ? '<button type="button">Afficher</button>' : '<em>non autorisé</em>'}`;
      m.querySelector('button')?.addEventListener('click', () => this.reveler().catch((e) => this.#erreur(e)));
      div.append(m);
    } else div.append(this.rendreChamp(champ, champ.supplementaire ? this.propriete(champ.code) : this.valeur(champ.code)));
    if (erreur) div.insertAdjacentHTML('beforeend', `<span class="fiche-message">${echapper(erreur.message)}</span>`);
    return div;
  }

  /** Champ saisissable selon son type ; lecture seule en consultation (ou champ en lecture seule). */
  rendreChamp(champ, valeur) {
    const lecture = !enSaisie(this.mode) || champ.lecture_seule || (champ.saisie === 'creation' && this.mode === MODES.MODIFICATION);
    let el;
    switch (champ.type) {
      case 'zone':
        el = document.createElement('textarea');
        el.rows = 3;
        el.value = valeur ?? '';
        break;
      case 'html': {
        // Libellé mis en forme (stocké mis en forme et en texte brut) : éditeur de mise en forme du socle.
        el = document.createElement('div');
        el.className = 'fiche-html';
        el.innerHTML = htmlSur(valeur ?? '') || '<span class="aide">(vide)</span>';
        if (!lecture) {
          el.tabIndex = 0;
          el.title = 'Cliquer pour modifier la mise en forme';
          const editer = async () => {
            const html = await editerLibelle({ html: this.valeur(champ.code) ?? '', titre: champ.libelle });
            if (html === undefined) return;
            this.saisie.valeurs[champ.code] = html;
            el.innerHTML = htmlSur(html ?? '') || '<span class="aide">(vide)</span>';
            this.#majTitre();
          };
          el.addEventListener('click', editer);
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); editer(); } });
        } else el.classList.add('lecture');
        el.classList.add('fiche-saisie-champ');
        return el;
      }
      case 'motdepasse': return this.#champSecret(champ, lecture);
      case 'booleen':
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = valeur === true;
        break;
      case 'liste':
        // Combo saisissable : la saisie filtre les options ou désigne directement l'option (libellé ou code).
        el = creerCombo({
          options: (champ.options ?? []).map((o) => ({ valeur: o.valeur, libelle: o.libelle ?? String(o.valeur) })),
          valeur: valeur ?? '',
        });
        break;
      case 'date':
        el = document.createElement('input');
        el.type = 'date';
        el.value = String(valeur ?? '').slice(0, 10);
        break;
      case 'nombre':
        el = document.createElement('input');
        el.inputMode = 'decimal';
        el.value = vide(valeur) ? '' : lecture ? formatLibre(valeur) : String(valeur).replace('.', ',');
        el.classList.add('nombre');
        break;
      default:
        el = document.createElement('input');
        el.type = champ.format === 'email' ? 'email' : champ.format === 'telephone' ? 'tel' : 'text';
        el.value = valeur ?? '';
        if (champ.longueur) el.maxLength = champ.longueur;
    }
    el.classList.add('fiche-saisie-champ');
    if (lecture) { el.disabled = champ.type === 'booleen'; el.readOnly = true; return el; }
    el.addEventListener(champ.type === 'booleen' || champ.type === 'liste' ? 'change' : 'input', () => {
      const v = champ.type === 'booleen' ? el.checked : champ.type === 'liste' ? el.valeurCombo : el.value;
      const cible = champ.supplementaire ? this.saisie.proprietes : this.saisie.valeurs;
      cible[champ.code] = v;
      this.#majTitre();
    });
    return el;
  }

  /**
   * Mot de passe : jamais chargé avec la fiche ; 👁 l'affiche (demandé au serveur, accès journalisé) ou le masque.
   * Une saisie remplace la valeur enregistrée ; un champ laissé intact ne change pas.
   */
  #champSecret(champ, lecture) {
    const cle = champ.supplementaire ? `+${champ.code}` : champ.code;
    const cible = champ.supplementaire ? this.saisie.proprietes : this.saisie.valeurs;
    const enregistre = (this.fiche.secrets ?? []).includes(cle);
    const zone = document.createElement('div');
    zone.className = 'fiche-secret';
    const el = document.createElement('input');
    el.type = 'password';
    el.autocomplete = 'new-password';
    el.className = 'fiche-saisie-champ';
    if (champ.longueur) el.maxLength = champ.longueur;
    const revele = this.secretsReveles.get(cle);
    el.value = champ.code in cible ? cible[champ.code] ?? '' : revele ?? '';
    if (!(champ.code in cible) && revele === undefined) el.placeholder = enregistre ? '•••••••• (enregistré)' : lecture ? '(aucun)' : '';
    const oeil = document.createElement('button');
    oeil.type = 'button';
    oeil.textContent = '👁';
    oeil.title = 'Afficher / masquer le mot de passe (accès journalisé)';
    oeil.disabled = lecture && !enregistre;
    oeil.addEventListener('click', () => (async () => {
      if (el.type === 'text') { el.type = 'password'; return; }
      if (enregistre && !(champ.code in cible) && !this.secretsReveles.has(cle) && this.id !== null) {
        const r = await this.fournisseur.revelerSecret(this.type, this.id, cle);
        this.secretsReveles.set(cle, r.valeur ?? '');
        el.value = r.valeur ?? '';
        el.placeholder = '';
      }
      el.type = 'text';
    })().catch((e) => this.#erreur(e)));
    if (lecture) el.readOnly = true;
    else el.addEventListener('input', () => { cible[champ.code] = el.value; });
    zone.append(el, oeil);
    return zone;
  }

  #majTitre() {
    const v = this.valeurs();
    const t = titreFiche(this.definition.titre, v);
    if (t) this.conteneur.querySelector('h2').textContent = t;
    this.conteneur.querySelector('.fiche-sous-titre').textContent = this.sousTitre(v);
  }

  /**
   * Onglet Pièces jointes : vue simplifiée de la GED, fournie par l'application (option ged) :
   * ged({ conteneur, type, id, libelle, modifiable }) → composant (detruire() facultatif).
   */
  #rendrePieces(corps) {
    this.composantGed?.detruire?.();
    this.composantGed = null;
    corps.innerHTML = '<div class="fiche-pieces"></div>';
    const zone = corps.firstElementChild;
    if (this.id === null) { zone.innerHTML = '<p class="aide">Enregistrez la fiche pour joindre des documents.</p>'; return; }
    if (!this.ged) { zone.innerHTML = "<p class='aide'>Pièces jointes : la GED n'est pas branchée.</p>"; return; }
    this.composantGed = this.ged({
      conteneur: zone, type: this.type, id: this.id, libelle: titreFiche(this.definition.titre, this.valeurs()) || `${this.definition.libelle} ${this.id}`,
      modifiable: this.definition.droits.modifier,
    });
  }

  #erreur(e) {
    console.error(e);
    this.message(e.message ?? String(e), 'erreur');
  }

  // ---------------------------------------------------------------- modes et verrou

  /** Passage en modification : prise du verrou (ou reprise de la main), fiche relue, battement démarré. */
  async modifier({ forcer = false } = {}) {
    const r = await this.fournisseur.verrouiller(this.type, this.id, { jeton: this.jeton, forcer });
    if (!r.ok) {
      this.fiche.verrou = r.verrou;
      this.rendre();
      this.message(`Fiche en cours de modification par ${r.verrou.utilisateur}`, 'avertissement');
      return false;
    }
    if (forcer) this.message('Vous avez repris la main sur la fiche', 'succes');
    await this.recharger();
    this.fiche.verrou = r.verrou;
    this.mode = MODES.MODIFICATION;
    this.#demarrerBattement();
    this.rendre();
    return true;
  }

  #demarrerBattement() {
    clearInterval(this.battement);
    this.battement = setInterval(() => this.controlerVerrou(), BATTEMENT);
  }

  /** Battement : renouvelle le verrou ; s'il a été repris par un autre, la fiche repasse en consultation. */
  async controlerVerrou() {
    if (this.mode !== MODES.MODIFICATION) return;
    try {
      const r = await this.fournisseur.verrouiller(this.type, this.id, { jeton: this.jeton });
      if (!r.ok) this.#verrouPerdu(r.verrou);
    } catch { /* réseau : nouvel essai au prochain battement */ }
  }

  #verrouPerdu(verrou) {
    clearInterval(this.battement);
    this.mode = MODES.CONSULTATION;
    this.fiche.verrou = verrou;
    this.message(`${verrou?.utilisateur ?? 'Un autre utilisateur'} a repris la main : vos modifications non enregistrées ne peuvent plus l'être`, 'erreur');
    this.rendre();
  }

  async #liberer() {
    clearInterval(this.battement);
    if (this.mode === MODES.MODIFICATION && this.id !== null) await this.fournisseur.deverrouiller(this.type, this.id, this.jeton).catch(() => {});
  }

  async annuler() {
    if (this.modifiee && !confirm('Abandonner les modifications ?')) return;
    if (this.mode === MODES.CREATION || this.mode === MODES.COPIE) { await this.fermer({ sansConfirmation: true }); return; }
    await this.#liberer();
    this.mode = MODES.CONSULTATION;
    this.erreurs = [];
    await this.recharger();
    this.rendre();
  }

  async copier() {
    this.#preparerCopie();
    this.erreurs = [];
    this.rendre();
  }

  async reveler() {
    const r = await this.fournisseur.reveler(this.type, this.id);
    Object.assign(this.fiche.valeurs, r.valeurs);
    this.fiche.proprietes = { ...this.fiche.proprietes, ...r.proprietes };
    this.fiche.masques = [];
    this.reveles = true;
    this.rendre();
  }

  // ---------------------------------------------------------------- enregistrement

  async enregistrer() {
    const valeurs = this.valeurs(), proprietes = this.proprietes();
    this.erreurs = [
      // Mots de passe enregistrés et non ressaisis : inconnus du poste, contrôlés par le serveur.
      ...validerFiche(this.definition, valeurs, proprietes, { masques: new Set([...this.masques, ...this.#secretsIntacts()]) }),
      ...this.validerMetier(valeurs, proprietes).map((e) => ({ supplementaire: false, code: 'METIER', ...e })),
    ];
    if (this.erreurs.length) {
      this.#allerErreur();
      this.message(`${this.erreurs.length} erreur(s) à corriger`, 'erreur');
      return false;
    }
    try {
      let fiche;
      const cree = this.mode === MODES.CREATION || this.mode === MODES.COPIE;
      const confidentiel = this.reveles || confidentielSession();
      if (cree) fiche = await this.fournisseur.creer(this.type, { valeurs: this.#pourCreation(valeurs), proprietes: this.#nonVides(proprietes), confidentiel });
      else {
        fiche = await this.fournisseur.enregistrer(this.type, this.id, {
          jeton: this.jeton, h: this.fiche.h, valeurs: this.saisie.valeurs, proprietes: this.saisie.proprietes, confidentiel,
        });
      }
      await this.#liberer();
      this.id = fiche.id;
      this.copieDe = null;
      this.fiche = { ...fiche, verrou: null };
      this.saisie = { valeurs: {}, proprietes: {} };
      this.mode = MODES.CONSULTATION;
      this.erreurs = [];
      this.rendre();
      this.message(cree ? `${this.definition.libelle} créé` : 'Fiche enregistrée', 'succes');
      this.surEnregistre?.(fiche, { cree });
      return true;
    } catch (e) {
      if (e.code === 'VALIDATION' && Array.isArray(e.details)) { this.erreurs = e.details; this.#allerErreur(); }
      else if (e.code === 'VERROU_PERDU') { this.#verrouPerdu(e.details); return false; }
      this.#erreur(e);
      return false;
    }
  }

  #secretsIntacts() {
    return (this.fiche.secrets ?? []).filter((k) => (k.startsWith('+') ? !(k.slice(1) in this.saisie.proprietes) : !(k in this.saisie.valeurs)));
  }

  #pourCreation(valeurs) {
    return Object.fromEntries(Object.entries(valeurs).filter(([code, v]) => !vide(v) && !this.definition.champs.find((c) => c.code === code)?.lecture_seule));
  }

  #nonVides(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => !vide(v))); }

  #allerErreur() {
    const e = this.erreurs[0];
    if (e) this.section = this.#sectionErreur(this.sections(), e) ?? this.section;
    this.rendre();
  }

  parametrer() {
    new ParametrageFiche({
      fournisseur: this.fournisseur, type: this.type, definition: this.definition, message: this.message,
      fermer: async (modifie) => {
        if (!modifie) return;
        this.definition = await this.fournisseur.definition(this.type);
        if (this.id !== null && this.mode === MODES.CONSULTATION) await this.recharger();
        this.rendre();
      },
    });
  }

  /** Suppression après confirmation ; la fiche se ferme (surSupprime, sinon surFerme). */
  async supprimer() {
    const titre = titreFiche(this.definition.titre, this.valeurs()) || `${this.definition.libelle} ${this.id}`;
    if (!confirm(`Supprimer « ${titre} » ? Cette suppression est définitive.`)) return false;
    await this.fournisseur.supprimer(this.type, this.id);
    this.message(`${this.definition.libelle} supprimé`, 'succes');
    this.surSupprime?.(this.id);
    await this.fermer({ sansConfirmation: true });
    return true;
  }

  async fermer({ sansConfirmation = false } = {}) {
    if (!sansConfirmation && this.modifiee && !confirm('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return false;
    await this.#liberer();
    this.surFerme?.();
    return true;
  }
}

export { MESSAGES };
