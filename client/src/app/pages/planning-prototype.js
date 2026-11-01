import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { dateLocale } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { ECHELLES, versMinutes, debutUnite, depuisMinutes } from '@logibtp/planning';
import { VuePlanning } from '@logibtp/planning/ui';
import { creerCombo } from '@logibtp/socle/ui';

// Prototype du composant de planning (lot 1, ANALYSE-MODULE-PLANNING.md § 5.1) : volume réaliste généré dans le
// navigateur (500 ressources, 3 mois, 20 000 tâches par défaut), mesures du chargement et du dessin.

// Couleurs des services du planning (variables du thème).
const COULEURS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--planning-service-${n})`);

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function aleatoire(graine) {
  let a = graine;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Ressources regroupées par service et tâches de 2 h à 5 jours, en heures ouvrées approximatives. */
function generer(nbRessources, nbTaches, debut, jours) {
  const r = aleatoire(42);
  const services = ['atelier', 'pose', 'etudes', 'logistique', 'chantier'].map((s) => texte(`planning_btp.prototype.services.${s}`));
  const lignes = [];
  services.forEach((s, i) => {
    lignes.push({ cle: `srv-${i}`, libelle: s, classe: 'groupe', ligneFixe: true });
    for (let k = 0; k < Math.ceil(nbRessources / services.length); k++) lignes.push({ cle: `res-${i}-${k}`, libelle: texte('planning_btp.prototype.ressource', { service: s, numero: k + 1 }) });
  });
  const ressources = lignes.filter((l) => !l.ligneFixe).slice(0, nbRessources);
  const taches = [];
  for (let n = 0; n < nbTaches; n++) {
    const l = ressources[Math.floor(r() * ressources.length)];
    const jour = debutUnite(debut + Math.floor(r() * jours) * 1440, 'JOUR');
    const longue = r() < 0.2;
    const d = jour + (longue ? 480 : 420 + Math.floor(r() * 8) * 60);
    const f = longue ? d + (1 + Math.floor(r() * 5)) * 1440 - 480 + 60 * Math.floor(r() * 4) : d + (2 + Math.floor(r() * 6)) * 60;
    taches.push({ cle: n, ligne: l.cle, debut: d, fin: f, libelle: texte('planning_btp.prototype.tache', { chantier: 100 + Math.floor(r() * 300), numero: n }), couleur: COULEURS[n % COULEURS.length] });
  }
  return { lignes, taches };
}

export class PagePlanningPrototype extends PageBase {
  icone = icone('planning_btp_planning');

  async ouvrir() {
    this.titre = texte('planning_btp.routes.prototype');
    const n = Number(this.requete.ressources ?? 500);
    const t = Number(this.requete.taches ?? 20000);
    this.conteneur.innerHTML = `<div class="page-planning"><div class="barre-planning ligne">
        <b>${iconeHtml('planning_btp_planning')} ${texteHtml('planning_btp.prototype.titre')}</b> <span data-echelle></span>
        <button type="button" data-zoom="0.8" title="${texteHtml('planning_btp.barre.zoom_arriere')}">${iconeHtml('planning_btp_zoom_arriere')}</button><button type="button" data-zoom="1.25" title="${texteHtml('planning_btp.barre.zoom_avant')}">${iconeHtml('ajouter')}</button>
        <label><input type="checkbox" data-adaptee checked> ${texteHtml('planning_btp.prototype.hauteur_adaptee')}</label>
        <button type="button" data-aujourdhui>${texteHtml('planning.vue.aujourdhui')}</button>
        <span class="aide" data-mesures></span> <span class="aide" data-action></span></div>
      <div class="zone-planning"><div data-planning></div></div></div>`;
    const debut = debutUnite(versMinutes(dateLocale()), 'SEMAINE') - 14 * 1440;
    const jours = 91;
    const t0 = performance.now();
    const { lignes, taches } = generer(n, t, debut, jours);
    const t1 = performance.now();
    const action = this.conteneur.querySelector('[data-action]');
    this.vue = new VuePlanning(this.conteneur.querySelector('[data-planning]'), {
      debut, fin: debut + jours * 1440, echelle: 'JOUR', largeurColonne: 48,
      actions: {
        deplacer: ({ tache, debut: d, fin: f, ligne, copie }) => {
          action.textContent = texte('planning_btp.prototype.deplacement', { operation: copie ? texte('planning_btp.prototype.copie') : texte('planning_btp.prototype.deplacer'), tache: tache.libelle, debut: depuisMinutes(d).replace('T', ' '), vers: icone('planning_vers'), fin: depuisMinutes(f).replace('T', ' '), ligne });
          if (copie) this.vue.ajouterTache({ ...tache, cle: `${tache.cle}-copie-${Date.now()}`, debut: d, fin: f, ligne });
          return true;
        },
        scinder: ({ tache, instant }) => {
          if (instant <= tache.debut || instant >= tache.fin) return;
          const fin = tache.fin;
          this.vue.majTache(tache, { fin: instant });
          this.vue.ajouterTache({ ...tache, cle: `${tache.cle}-suite`, debut: instant, fin });
          action.textContent = texte('planning_btp.prototype.scindee', { tache: tache.libelle, instant: depuisMinutes(instant).replace('T', ' ') });
        },
        selection: (x) => { if (x) action.textContent = texte('planning_btp.prototype.selection', { tache: x.libelle }); },
      },
    });
    const t2 = performance.now();
    this.vue.definirDonnees(lignes, taches);
    const t3 = performance.now();
    setTimeout(() => {
      this.vue.allerA(debut + 14 * 1440);
      const t4 = performance.now();
      this.vue.actualiser();
      const t5 = performance.now();
      this.conteneur.querySelector('[data-mesures]').textContent = texte('planning_btp.prototype.mesures', { ressources: n, taches: t, generation: Math.round(t1 - t0), donnees: Math.round(t3 - t2), dessin: Math.round(t5 - t4) });
    }, 50);
    const echelle = creerCombo({ options: Object.entries(ECHELLES).map(([valeur, e]) => ({ valeur, libelle: e.libelle })), valeur: 'JOUR', vide: false, titre: texte('planning_btp.barre.echelle') });
    this.conteneur.querySelector('[data-echelle]').append(echelle);
    const largeurs = { HEURE: 40, DEMI_JOUR: 60, JOUR: 48, SEMAINE: 90 };
    echelle.addEventListener('change', () => this.vue.regler({ echelle: echelle.valeurCombo, largeurColonne: largeurs[echelle.valeurCombo] }));
    this.conteneur.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => this.vue.zoomer(Number(b.dataset.zoom))));
    this.conteneur.querySelector('[data-adaptee]').addEventListener('change', (e) => this.vue.regler({ hauteurAdaptee: e.target.checked }));
    this.conteneur.querySelector('[data-aujourdhui]').addEventListener('click', () => this.vue.allerA(versMinutes(new Date().toISOString().slice(0, 16))));
  }
}
