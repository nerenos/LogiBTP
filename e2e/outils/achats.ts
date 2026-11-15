import { expect, type Page } from '@playwright/test';
import {
  attendreDocument, attendreStatut, attendreMessage, actionDocument, dialogue, idDocument, numeroDocument, saisirObjet, rattacher,
  ajouterIntervenant, ajouterLigne, enregistrer, valider, type LignePrix,
} from './documents';

/**
 * Aides des scénarios du cycle achats (e2e/achats-*.spec.ts). Données de démonstration attendues en base : fournisseur
 * « Matériaux Rhône-Alpes », chantier CH-2026-001 (son adresse sert d'adresse de livraison), nature « MAT ».
 */

/** Fournisseur et chantier de la base de démonstration employés par les scénarios. */
export const ACHATS = Object.freeze({
  FOURNISSEUR: 'Matériaux Rhône-Alpes',
  CHANTIER: 'CH-2026-001',
  NATURE: 'MAT',
});

/** Type de pièce d'achat (codes de `type_document`). */
export type TypeAchat = 'A_DEVIS' | 'A_COMMANDE' | 'A_RECEPTION' | 'A_RETOUR' | 'A_FACTURE' | 'A_FACTURE_AVT' | 'A_AVOIR';

export type PieceAchat = { id: number; numero: string };

/** Pièce affichée : identifiant (adresse) et numéro de l'entête. */
export async function pieceOuverte(page: Page): Promise<PieceAchat> {
  return { id: idDocument(page), numero: (await numeroDocument(page)).numero };
}

/**
 * Nouvelle pièce d'achat saisie directement (sans source) : objet, chantier (adresse de livraison reprise du chantier),
 * fournisseur (première ligne de l'annuaire), lignes de prix en nature MAT ; enregistrée.
 */
export async function creerPieceAchat(page: Page, type: TypeAchat, { objet, lignes, referenceExterne }: { objet: string; lignes: LignePrix[]; referenceExterne?: string }) {
  await page.goto(`/document/nouveau?type=${type}`);
  await attendreDocument(page);
  await attendreStatut(page, 'Brouillon');
  await saisirObjet(page, objet);
  if (referenceExterne) await saisirReferenceExterne(page, referenceExterne);
  // Fournisseur avant le chantier : le rattachement d'un annuaire vide y reprend les intervenants du chantier.
  await ajouterIntervenant(page, ACHATS.FOURNISSEUR);
  await rattacher(page, 'Chantier', ACHATS.CHANTIER);
  for (const l of lignes) await ajouterLigne(page, { nature: ACHATS.NATURE, ...l });
  await enregistrer(page);
  return pieceOuverte(page);
}

/** Référence externe de l'entête (numéro de la pièce du fournisseur : obligatoire et unique sur ses factures et avoirs). */
export async function saisirReferenceExterne(page: Page, reference: string) {
  const champ = page.getByRole('textbox', { name: 'Référence externe', exact: true });
  await champ.fill(reference);
  await champ.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Référence externe', exact: true })).toHaveValue(reference);
}

/** Pièce validée puis acceptée par le fournisseur (devis, commande : statut Validé). */
export async function validerEtAccepter(page: Page) {
  await valider(page);
  await attendreStatut(page, 'Envoyé');
  await actionDocument(page, 'Validé par le tiers');
  await attendreMessage(page, /validé par le tiers/i);
  await attendreStatut(page, 'Validé');
}

/**
 * Transformation partielle : fenêtre de choix avec « Choisir les lignes et les quantités », puis quantité à transformer
 * de chaque ligne désignée par son libellé (null : ligne décochée, laissée en reliquat). Les lignes non citées gardent
 * le reste proposé. Ouvre le document créé.
 */
export async function transformerPartiellement(page: Page, cible: RegExp, quantites: Record<string, string | null>) {
  const avant = page.url();
  await actionDocument(page, 'Transformer…');
  const choix = dialogue(page);
  await choix.getByRole('checkbox', { name: 'Choisir les lignes et les quantités' }).check();
  await choix.getByRole('button', { name: cible }).click();
  const lignes = dialogue(page);
  await expect(lignes.getByRole('heading', { name: 'Lignes à transformer' })).toBeVisible();
  for (const [libelle, qte] of Object.entries(quantites)) {
    const tr = lignes.locator('tbody tr').filter({ hasText: libelle });
    if (qte === null) await tr.getByRole('checkbox').uncheck();
    else await tr.getByRole('textbox').fill(qte);
  }
  await lignes.getByRole('button', { name: 'Transformer', exact: true }).click();
  await expect(page).not.toHaveURL(avant);
  await attendreDocument(page);
}

/** Reste proposé d'une ligne dans la fenêtre « Lignes à transformer » (ouverte), pour contrôle. */
export const ligneATransformer = (page: Page, libelle: string) => dialogue(page).locator('tbody tr').filter({ hasText: libelle });

/**
 * Page des règlements du tiers ouverte (`/reglements?sens=…&tiers=…`) : nouveau règlement (montant, référence)
 * pointé en entier sur l'échéance de la pièce, enregistré ; il apparaît ensuite, pointé sur la pièce.
 */
export async function reglerEcheance(page: Page, numeroPiece: string, montant: string, reference: string) {
  // Échéance ouverte de la pièce : la ligne qui porte la zone de pointage (les règlements déjà pointés la citent aussi)
  const echeance = echeanceOuverte(page, numeroPiece);
  await expect(echeance).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Montant', exact: true }).first().fill(montant);
  await page.getByRole('textbox', { name: 'Référence', exact: true }).first().fill(reference);
  await echeance.getByRole('textbox').fill(montant);
  await page.getByRole('button', { name: 'Enregistrer le règlement', exact: true }).click();
  await attendreMessage(page, 'Règlement enregistré');
  await expect(page.getByRole('row').filter({ hasText: reference })).toContainText(numeroPiece);
}

/** Échéance ouverte d'une pièce dans la page des règlements du tiers (ligne à zone de pointage). */
export const echeanceOuverte = (page: Page, numeroPiece: string) =>
  page.getByRole('row').filter({ hasText: numeroPiece }).filter({ has: page.getByRole('textbox') });
