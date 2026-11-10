// Module Facturation électronique, réception hors plateforme (plans/facturation-electronique.md, lot 14) : fichier
// proposé comme facture reçue (glisser-déposer, pièce jointe d'un courriel). Règle miroir : ReglesReception.cs
// (jeu tests/cas/03_fichiers_facture.json). Le contenu reste contrôlé par la lecture du serveur.

/** Extensions d'une facture reçue : Factur-X (PDF) ou XML CII / UBL. */
export const EXTENSIONS_FACTURE = Object.freeze(['.pdf', '.xml']);

/** Types MIME d'une facture reçue. */
export const TYPES_MIME_FACTURE = Object.freeze(['application/pdf', 'application/xml', 'text/xml']);

/** Vrai si le fichier (nom, type MIME) est proposé comme facture reçue : extension .pdf ou .xml, ou type MIME d'une facture. */
export function estFichierFacture(nom, type) {
  const n = String(nom ?? '').trim().toLowerCase();
  const t = String(type ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS_FACTURE.some((e) => n.endsWith(e)) || TYPES_MIME_FACTURE.includes(t);
}
