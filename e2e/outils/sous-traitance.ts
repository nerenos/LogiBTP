import { expect, type Page } from '@playwright/test';
import {
  attendreDocument, attendreStatut, attendreMessage, actionDocument, dialogue, saisirObjet, rattacher, ajouterIntervenant, ajouterLigne,
  enregistrer, onglet, ligneGrille, saisirCellule, texteCellule, type LignePrix,
} from './documents';
import { pieceOuverte, saisirReferenceExterne } from './achats';

/**
 * Aides des scénarios de la sous-traitance (e2e/sous-traitance-*.spec.ts). Données de démonstration attendues en base :
 * sous-traitant « Plomberie Dupuis et Fils », chantier CH-2026-002 et son marché de vente privé M-2026-002-1, nature « ST ».
 */
export const SOUS_TRAITANCE = Object.freeze({
  SOUS_TRAITANT: 'Plomberie Dupuis et Fils',
  CHANTIER: 'CH-2026-002',
  MARCHE_VENTE: 'M-2026-002-1',
  NATURE: 'ST',
});

/** Type de pièce de sous-traitance (codes de `type_document`). */
export type TypeSousTraitance = 'T_AO' | 'T_COMMANDE' | 'T_FACTURE_AVT' | 'T_AVOIR';

/**
 * Nouvelle pièce de sous-traitance saisie sans source : objet, sous-traitant (première ligne de l'annuaire), chantier,
 * lignes de prix en nature ST ; enregistrée.
 */
export async function creerPieceSousTraitance(page: Page, type: TypeSousTraitance, { objet, lignes, sousTraitant = SOUS_TRAITANCE.SOUS_TRAITANT, chantier = SOUS_TRAITANCE.CHANTIER }:
  { objet: string; lignes: LignePrix[]; sousTraitant?: string; chantier?: string }) {
  await page.goto(`/document/nouveau?type=${type}`);
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  await saisirObjet(page, objet);
  // Sous-traitant avant le chantier : le rattachement d'un annuaire vide y reprend les intervenants du chantier.
  await ajouterIntervenant(page, sousTraitant);
  await rattacher(page, 'Chantier', chantier);
  for (const l of lignes) await ajouterLigne(page, { nature: SOUS_TRAITANCE.NATURE, ...l });
  await enregistrer(page);
  return pieceOuverte(page);
}

export type MarcheSousTraitance = { venteLiee?: string; venteAttendue?: string; garantie?: string; agree?: string; autoliquidation?: boolean };

/**
 * Validation d'une commande de sous-traitance : fenêtre du marché (nouveau marché toujours, marché de vente lié, garantie,
 * montant agréé, autoliquidation), puis validation par l'entreprise (Envoyé).
 */
export async function validerCommandeDansMarche(page: Page, { venteLiee, venteAttendue, garantie, agree, autoliquidation = true }: MarcheSousTraitance = {}) {
  await actionDocument(page, 'Valider');
  const d = dialogue(page);
  const titre = d.getByRole('heading', { name: /Marché de sous-traitance de la commande/ });
  // Saisie recalculée après l'enregistrement (prix modifié) : confirmation « Enregistrer puis valider ? » acceptée
  const enregistrerAvant = d.getByText(/doit d'abord être enregistré/);
  await expect(titre.or(enregistrerAvant)).toBeVisible();
  if (await enregistrerAvant.isVisible()) await d.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(titre).toBeVisible();
  // Un marché propre au scénario (les passages précédents ont laissé les leurs : avenant proposé par défaut)
  await d.getByRole('radio', { name: /Nouveau marché/ }).check();
  if (venteAttendue) await expect(d.getByRole('combobox', { name: 'Marché de vente lié', exact: true })).toHaveValue(new RegExp(`^${venteAttendue} `));
  if (venteLiee) await choisirOption(page, d.getByRole('combobox', { name: 'Marché de vente lié', exact: true }), venteLiee);
  if (garantie) await choisirOption(page, d.getByRole('combobox', { name: 'Garantie de paiement', exact: true }), garantie);
  if (agree) await d.getByRole('textbox', { name: 'Montant agréé (DC4)', exact: true }).fill(agree);
  await d.getByRole('checkbox', { name: 'Autoliquidation de la TVA' }).setChecked(autoliquidation);
  await d.getByRole('button', { name: 'Valider la commande', exact: true }).click();
  await attendreMessage(page, /Document validé/);
}

/** Choix d'une option d'un combo du socle par le début de son libellé. */
export async function choisirOption(page: Page, combo: ReturnType<Page['locator']>, texte: string) {
  await combo.click();
  await combo.fill(texte);
  await page.getByRole('option', { name: new RegExp(`^${texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
}

/** Marché rattaché au document ouvert (section Rattachement) : identifiant (lien) et code. */
export async function marcheDuDocument(page: Page) {
  await onglet(page, 'Entête');
  const ratt = page.getByRole('group', { name: 'Rattachement' });
  const code = await ratt.getByRole('textbox', { name: 'Marché', exact: true }).inputValue();
  const lien = ratt.locator('a[href*="/fiche/marche/"]').first();
  return { code, id: Number((await lien.getAttribute('href'))!.split('/').pop()) };
}

/**
 * Facture d'avancement de sous-traitance ouverte (brouillon) : avancement cumulé de chaque ligne, référence du
 * sous-traitant, enregistrée.
 */
export async function saisirAvancement(page: Page, avancements: Record<string, string>, reference: string) {
  await onglet(page, 'Entête');
  await saisirReferenceExterne(page, reference);
  await onglet(page, 'Lignes');
  for (const [libelle, pct] of Object.entries(avancements)) {
    // Grille redessinée après chaque saisie : saisie reprise si elle est perdue.
    await expect(async () => {
      await saisirCellule(page, ligneGrille(page, libelle), '% cumul', pct);
      expect(await texteCellule(page, ligneGrille(page, libelle), '% cumul')).toMatch(new RegExp(`^${pct},00\\b`));
    }).toPass({ timeout: 15000 });
  }
  await enregistrer(page);
}

/**
 * Facture de sous-traitance validée : la règle APPROBATION du type remplace « Valider » par « Approuver » (bon à payer :
 * validation et approbation interne d'un même geste).
 */
export async function approuver(page: Page) {
  await actionDocument(page, 'Approuver');
  await attendreMessage(page, /Document validé/);
}

/** Total TTC du tableau des totaux de l'entête. */
export async function attendreTotalTtc(page: Page, montant: string) {
  await onglet(page, 'Entête');
  await expect(page.locator('#vue-entete table.totaux tr').filter({ hasText: 'Total TTC' }).locator('td')).toHaveText(montant);
}
