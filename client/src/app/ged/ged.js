import { FournisseurGedApi, FournisseurGedMemoire, PARAMETRES_DEFAUT } from '@logibtp/ged';
import { ENTETES } from '../api.js';

// GED du cœur : fournisseur (API ou démo hors ligne) et documents de démonstration.

/** PDF minimal d'une page (texte en Helvetica), valide pour les visionneuses des navigateurs. */
export function pdfSimple(titre, lignes) {
  const echappe = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, (c) => ({ 'é': 'e', 'è': 'e', 'ê': 'e', 'à': 'a', 'ç': 'c', 'ô': 'o', '€': 'EUR', '’': "'" }[c] ?? '?'));
  const texte = [`BT /F1 18 Tf 60 780 Td (${echappe(titre)}) Tj ET`,
    ...lignes.map((l, i) => `BT /F1 11 Tf 60 ${740 - i * 18} Td (${echappe(l)}) Tj ET`)].join('\n');
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${texte.length} >>\nstream\n${texte}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const positions = objets.map((o, i) => { const p = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
}

const svgPlan = (titre) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <rect width="640" height="420" fill="#f4f1e8"/><g stroke="#1d5fbf" stroke-width="3" fill="none">
  <rect x="60" y="60" width="520" height="300"/><line x1="300" y1="60" x2="300" y2="360"/><line x1="60" y1="210" x2="300" y2="210"/>
  <path d="M420 360 v-60 h60 v60"/></g><g font-family="sans-serif" font-size="16" fill="#333">
  <text x="140" y="140">Séjour 24 m²</text><text x="140" y="290">Cuisine 12 m²</text><text x="390" y="200">Chambre 15 m²</text>
  <text x="60" y="400" font-size="18" font-weight="bold">${titre}</text></g></svg>`], { type: 'image/svg+xml' });

const eml = ({ de, a, objet, date, message }) => new Blob([[
  `From: ${de}`, `To: ${a}`, `Subject: ${objet}`, `Date: ${new Date(date).toUTCString()}`, 'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8', '', message, '',
].join('\r\n')], { type: 'message/rfc822' });

const fichier = (blob, nom) => new File([blob], nom, { type: blob.type });

/** Documents de démonstration liés aux premiers salariés et matériels des listes, et au devis de démonstration. */
async function semer(ged, { salaries, materiels }) {
  const premiers = [...salaries].sort((x, y) => x.nom.localeCompare(y.nom, 'fr') || x.id - y.id).slice(0, 3);
  const [s1, s2, s3] = premiers;
  const lie = (type, id) => ({ type_element: type, id_element: String(id) });

  // Devis signé : étapes envoi et signature (toutes conservées), puis coffre-fort.
  const devis = await ged.deposer({
    fichier: fichier(pdfSimple('Devis DV2026-00012', ['Extension maison individuelle', 'Montant HT : 10 298,54 EUR', 'Bon pour accord']), 'Devis DV2026-00012.pdf'),
    meta: { titre: 'Devis DV2026-00012', categorie: 'devis_signe', date_document: '2026-09-23', auteur: 'Bureau', ...lie('V_DEVIS', 0), resume: 'Devis de l\'extension, signé par le client.' },
  });
  await ged.etape(devis.id, { etape: 'ENVOI', commentaire: 'Envoyé à M. Martin par mail' });
  await ged.nouvelleVersion(devis.id, {
    fichier: fichier(pdfSimple('Devis DV2026-00012 - SIGNE', ['Extension maison individuelle', 'Bon pour accord, le 02/10/2026', 'Signature : J. Martin']), 'Devis DV2026-00012 signé.pdf'),
    genre: 'etape', etape: 'SIGNATURE', etat: 'SIGNATURE', commentaire: 'Retour signé du client',
  });
  await ged.mettreAuCoffre(devis.id, 'Devis signé');

  if (s1) {
    // Dossier créé dans l'explorateur de la fiche du salarié.
    const formations = await ged.creerRepertoire({ nom: 'Formations', ...lie('salarie', s1.id) });
    await ged.deposer({ fichier: fichier(pdfSimple('Attestation CACES R482', [`${s1.prenom} ${s1.nom}`, 'Catégorie A - valable jusqu\'au 31/12/2028']), 'CACES R482.pdf'),
      meta: { titre: 'CACES R482 cat. A', categorie: 'certificat', date_document: '2024-03-12', auteur: 'Organisme de formation', repertoire_id: formations.id } });
    await ged.deposer({ fichier: fichier(new Blob([`Entretien annuel ${s1.prenom} ${s1.nom}\n\nObjectifs : habilitation électrique B1V.\nSouhaits : formation conduite d'engins.`], { type: 'text/plain' }), 'Entretien annuel.txt'),
      meta: { titre: 'Compte rendu d\'entretien annuel', categorie: 'courrier', date_document: '2026-01-20', auteur: 'Direction', ...lie('salarie', s1.id), notes: 'À revoir en juin.' } });
    // Mail reçu avec pièce jointe enregistrée à côté de lui.
    const message = { de: `${s1.prenom} ${s1.nom} <${s1.email}>`, a: 'Ressources humaines <rh@logibtp.fr>', objet: 'Arrêt de travail', date: '2026-10-05T07:12:00Z',
      message: 'Bonjour,\n\nVeuillez trouver ci-joint mon arrêt de travail.\n\nCordialement' };
    const mail = await ged.deposer({ fichier: fichier(eml(message), 'Arrêt de travail.eml'),
      meta: { titre: message.objet, categorie: 'mail', nature: 'mail', date_document: '2026-10-05', auteur: message.de, ...lie('salarie', s1.id), mail: { ...message, cc: '', sens: 'recu' } } });
    await ged.deposer({ fichier: fichier(pdfSimple('Avis d\'arret de travail', ['Du 05/10/2026 au 09/10/2026']), 'Arrêt.pdf'),
      meta: { titre: 'Arrêt', date_document: '2026-10-05', auteur: message.de, ...lie('salarie', s1.id), parent_id: mail.id, notes: `Pièce jointe du mail « ${message.objet} »` } });
  }
  if (s2) {
    await ged.deposer({ fichier: fichier(pdfSimple('Contrat de travail', [`${s2.prenom} ${s2.nom}`, `Poste : ${s2.poste}`, `Entree : ${s2.date_entree}`]), 'Contrat de travail.pdf'),
      meta: { titre: 'Contrat de travail', categorie: 'contrat', date_document: s2.date_entree, auteur: 'Direction', ...lie('salarie', s2.id), coffre: true } });
  }
  if (s3) {
    await ged.deposer({ fichier: fichier(pdfSimple('Habilitation electrique B1V', [`${s3.prenom} ${s3.nom}`]), 'Habilitation B1V.pdf'),
      meta: { titre: 'Habilitation électrique B1V', categorie: 'certificat', date_document: '2025-06-02', auteur: 'Organisme de formation', ...lie('salarie', s3.id) } });
  }
  // Bibliothèque : notice technique de l'acier HA10 (DOE) et image de l'ouvrage « Dalle béton armé ».
  await ged.deposer({ fichier: fichier(pdfSimple('Fiche technique Acier HA10', ['Fe E500 - NF A 35-080-1', 'Poids : 0,617 kg/ml', 'Marquage CE']), 'FT acier HA10.pdf'),
    meta: { titre: 'Fiche technique acier HA10', categorie: 'notice_technique', date_document: '2026-02-01', auteur: 'Aciers du Rhône', type_element: 'element', id_element: '1' } });
  await ged.deposer({ fichier: fichier(svgPlan('Dalle béton armé ép. 15 cm'), 'Dalle BA 15.svg'),
    meta: { titre: 'Coupe de la dalle', categorie: 'photo', date_document: '2026-02-01', auteur: "Bureau d'études", type_element: 'element', id_element: '7' } });
  for (const m of materiels.slice(0, 2)) {
    await ged.deposer({ fichier: fichier(svgPlan(`Implantation ${m.code}`), `Plan implantation ${m.code}.svg`),
      meta: { titre: `Plan d'implantation ${m.code}`, categorie: 'plan', date_document: '2026-04-15', auteur: 'Bureau d\'études', ...lie('materiel', m.id) } });
    const facture = await ged.deposer({ fichier: fichier(pdfSimple(`Facture d'achat ${m.code}`, [m.designation, `Montant : ${m.valeur_achat} EUR HT`]), `Facture achat ${m.code}.pdf`),
      meta: { titre: `Facture d'achat ${m.code}`, categorie: 'facture_recue', date_document: m.date_achat, auteur: m.marque, ...lie('materiel', m.id), coffre: true } });
    await ged.modifier(facture.id, { notes: 'Payée par virement.' });
  }
}

export async function creerFournisseurGed({ enLigne, lignes }) {
  if (enLigne) return new FournisseurGedApi({ base: '/api/ged', entetes: ENTETES });
  const ged = new FournisseurGedMemoire({
    utilisateur: ENTETES['X-Utilisateur'] ?? 'demo', profil: ENTETES['X-Profil'] ?? 'ADMIN',
    // Catégorie du cœur : notices techniques des éléments de bibliothèque, remises au client dans le DOE.
    parametres: { categories: [...PARAMETRES_DEFAUT.categories, { code: 'notice_technique', libelle: 'Notice technique (DOE)', doe: true }] },
  });
  await semer(ged, lignes);
  return ged;
}
