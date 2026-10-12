// Correspondance d'un résultat de l'API Recherche d'entreprises (recherche-entreprises.api.gouv.fr) vers une entreprise
// prête à remplir une fiche : identité, établissement (siège ou SIRET cherché), adresse, dirigeants personnes physiques.
// Réplique de Correspondance.cs (jeu partagé modules/entreprises-fr/tests/cas/01_correspondance.json).

/** Tranches d'effectif salarié (INSEE). */
export const TRANCHES_EFFECTIF = {
  NN: 'Non employeuse', '00': '0 salarié', '01': '1 ou 2 salariés', '02': '3 à 5 salariés', '03': '6 à 9 salariés', 11: '10 à 19 salariés',
  12: '20 à 49 salariés', 21: '50 à 99 salariés', 22: '100 à 199 salariés', 31: '200 à 249 salariés', 32: '250 à 499 salariés',
  41: '500 à 999 salariés', 42: '1 000 à 1 999 salariés', 51: '2 000 à 4 999 salariés', 52: '5 000 à 9 999 salariés', 53: '10 000 salariés et plus',
};

/** Catégories juridiques courantes (INSEE, niveau III) ; les autres codes restent sans libellé. */
export const FORMES_JURIDIQUES = {
  1000: 'Entrepreneur individuel', 5202: 'Société en nom collectif', 5306: 'Société en commandite simple',
  5485: "Société d'exercice libéral à responsabilité limitée", 5498: 'SARL unipersonnelle (EURL)', 5499: 'Société à responsabilité limitée (SARL)',
  5599: "SA à conseil d'administration", 5699: 'SA à directoire', 5710: 'Société par actions simplifiée (SAS)',
  5720: 'Société par actions simplifiée à associé unique (SASU)', 5785: "Société d'exercice libéral par actions simplifiée",
  6220: "Groupement d'intérêt économique (GIE)", 6540: 'Société civile immobilière (SCI)', 6541: 'SCI de construction-vente', 6599: 'Autre société civile',
  7210: 'Commune', 7220: 'Département', 7344: 'Métropole', 7346: 'Communauté de communes', 7348: "Communauté d'agglomération", 9220: 'Association déclarée',
};

const texte = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

/** Casse d'un nom propre : minuscules, majuscule en début de mot (après espace, tiret, apostrophe ou parenthèse). */
export function casseNom(v) {
  const s = texte(v);
  if (!s) return null;
  return s.toLowerCase().replace(/(^|[\s\-'’(])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase());
}

/** Adresse d'un établissement : champs détaillés (siège), sinon adresse sur une ligne « … 69002 LYON ». */
export function adresseEtablissement(e) {
  if (!e) return null;
  if (texte(e.libelle_voie) || texte(e.numero_voie)) {
    return {
      ligne1: [e.numero_voie, e.indice_repetition, e.type_voie, e.libelle_voie].map(texte).filter(Boolean).join(' ') || null,
      ligne2: texte(e.complement_adresse), code_postal: texte(e.cedex) ?? texte(e.code_postal), ville: texte(e.libelle_cedex) ?? texte(e.libelle_commune), pays: 'FR',
    };
  }
  const m = /^(.*?)\s*([0-9]{5})\s+(.+)$/.exec(texte(e.adresse) ?? '');
  if (m) return { ligne1: texte(m[1]), ligne2: null, code_postal: m[2], ville: texte(m[3]), pays: 'FR' };
  return texte(e.adresse) ? { ligne1: texte(e.adresse), ligne2: null, code_postal: texte(e.code_postal), ville: texte(e.libelle_commune), pays: 'FR' } : null;
}

/** Entreprise d'un résultat ; établissement : celui du SIRET cherché s'il est trouvé, sinon le siège. */
export function versEntreprise(r, siret = null) {
  const cherche = texte(siret);
  const e = (cherche && [r.siege, ...(r.matching_etablissements ?? [])].find((x) => x?.siret === cherche)) || r.siege || {};
  const etat = texte(e.etat_administratif) ?? texte(r.etat_administratif);
  const forme = texte(r.nature_juridique);
  return {
    siren: texte(r.siren),
    siret: texte(e.siret),
    raison_sociale: texte(r.nom_raison_sociale) ?? texte(r.nom_complet),
    nom_commercial: texte(e.nom_commercial) ?? texte(e.liste_enseignes?.[0]),
    sigle: texte(r.sigle),
    naf: texte(e.activite_principale) ?? texte(r.activite_principale),
    forme_juridique: forme,
    forme_libelle: forme ? FORMES_JURIDIQUES[forme] ?? null : null,
    date_creation: texte(r.date_creation),
    effectif: TRANCHES_EFFECTIF[texte(e.tranche_effectif_salarie) ?? texte(r.tranche_effectif_salarie) ?? ''] ?? null,
    etat_administratif: etat === 'A' ? 'A' : etat ? 'F' : null,
    siege: e.est_siege === true,
    tva_intra: texte(r.tva?.[0]),
    service_public: r.complements?.est_service_public === true || r.complements?.est_administration === true,
    rge: r.complements?.est_rge === true,
    categorie: texte(r.categorie_entreprise),
    etablissements_ouverts: r.nombre_etablissements_ouverts ?? null,
    adresse: adresseEtablissement(e),
    dirigeants: (r.dirigeants ?? []).filter((d) => d.type_dirigeant === 'personne physique' && texte(d.nom))
      .map((d) => ({ nom: casseNom(d.nom), prenom: casseNom(texte(d.prenoms)?.split(/\s+/)[0]), qualite: texte(d.qualite) })),
  };
}
