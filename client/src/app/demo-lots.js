// Lots complémentaires du devis de démonstration : une centaine d'ouvrages (fourniture + main-d'œuvre), quelques
// prestations (forfaits, heures), des sous-tranches et un sous-total par lot. Données fictives, prix indicatifs.

const MO = 42; // taux horaire de main-d'œuvre (prix d'achat)

/** Natures de la bibliothèque de démonstration (identifiants de nature_element). */
export const NAT = { MO: 1, MAT: 2, LOC: 3, ST: 4, OUV: 5, ISO: 6 };

/**
 * Nature d'une ligne du devis de démonstration, déduite de son type, de son libellé et de son unité (sert aussi à
 * compléter les devis déjà enregistrés) : ouvrage, main-d'œuvre, location, isolant, prestation, matériaux.
 */
export function natureDemo(l, parent = null) {
  if (l.lig_tyl_id === 2) return NAT.OUV;
  if (l.lig_tyl_id !== 3) return null;
  const lib = String(l.lig_libelle_html ?? '').replace(/<[^>]+>/g, '');
  if (/main-d.œuvre|^pose$/i.test(lib) || (l.lig_unt_code === 'h' && parent?.lig_tyl_id === 2)) return NAT.MO;
  if (/^location/i.test(lib)) return NAT.LOC;
  if (/laine|isolant|PSE|pare-vapeur|complexe de doublage/i.test(lib)) return NAT.ISO;
  // Prestation directement dans une tranche : forfait sous-traité, heures de main-d'œuvre.
  if (parent && parent.lig_tyl_id !== 2) return l.lig_unt_code === 'h' ? NAT.MO : l.lig_unt_code === 'ft' ? NAT.ST : NAT.MAT;
  return NAT.MAT;
}

// [libellé, unité, quantité, fourniture, PA fourniture, heures par unité, options]
const LOTS = [
  {
    titre: 'Installation et préparation de chantier', tva: 1,
    prestations: [
      ['Installation de chantier, clôture et signalisation', 'ft', 1, 950],
      ['Constat d\'huissier avant travaux', 'ft', 1, 420],
      ['Plans d\'exécution et note de calcul', 'ft', 1, 1350],
      ['Nettoyage de fin de chantier', 'h', 14, 38],
    ],
  },
  {
    titre: 'Terrassement et VRD', tva: 1,
    sous: [
      { titre: 'Terrassements', ouvrages: [
        ['Décapage de la terre végétale ép. 20 cm', 'm2', 180, 'Location pelle 8 t', 1.6, 0.03],
        ['Fouilles en rigole pour semelles filantes', 'm3', 22, 'Location mini-pelle', 9.5, 0.35],
        ['Fouilles en puits pour plots', 'm3', 6, 'Location mini-pelle', 9.5, 0.6],
        ['Remblaiement compacté en périphérie', 'm3', 18, 'Grave 0/31,5', 24, 0.25],
        ['Évacuation des terres en décharge agréée', 'm3', 35, 'Transport et redevance', 28, 0.05],
        ['Hérisson en pierres cassées ép. 20 cm', 'm2', 64, 'Pierres 40/80', 7.8, 0.15],
      ] },
      { titre: 'Réseaux', ouvrages: [
        ['Canalisation eaux usées PVC Ø 125', 'ml', 28, 'Tube PVC CR8 Ø 125', 8.4, 0.4],
        ['Canalisation eaux pluviales PVC Ø 100', 'ml', 36, 'Tube PVC Ø 100', 6.2, 0.35],
        ['Regard de visite béton 40 × 40', 'u', 4, 'Regard préfabriqué', 68, 1.5],
        ['Fourreau TPC Ø 90 pour alimentation électrique', 'ml', 25, 'Fourreau TPC rouge', 2.9, 0.2],
        ['Branchement au réseau public d\'assainissement', 'ft', 1, 'Raccord et pièces', 310, 6],
      ] },
    ],
  },
  {
    titre: 'Fondations et soubassement', tva: 1,
    sous: [
      { titre: 'Fondations', ouvrages: [
        ['Béton de propreté ép. 5 cm', 'm2', 32, 'Béton C16/20', 6.5, 0.12],
        ['Semelles filantes béton armé 50 × 30', 'ml', 46, 'Béton C25/30 et armatures', 38, 0.7],
        ['Plots béton armé 60 × 60', 'u', 6, 'Béton et cage d\'armature', 54, 1.2],
        ['Longrines béton armé 20 × 40', 'ml', 18, 'Béton, coffrage et aciers', 41, 0.9],
      ] },
      { titre: 'Soubassement', ouvrages: [
        ['Mur de soubassement en blocs à bancher', 'm2', 38, 'Blocs à bancher 20 cm', 24, 0.8],
        ['Arase étanche au mortier hydrofuge', 'ml', 46, 'Mortier hydrofuge', 2.4, 0.1],
        ['Enduit bitumineux sur parois enterrées', 'm2', 38, 'Émulsion bitumineuse', 3.8, 0.15],
        ['Drain agricole Ø 100 avec géotextile', 'ml', 32, 'Drain et géotextile', 5.6, 0.25],
        ['Plancher hourdis poutrelles sur vide sanitaire', 'm2', 64, 'Poutrelles et entrevous', 34, 0.6],
      ] },
    ],
  },
  {
    titre: 'Charpente et couverture', tva: 1,
    sous: [
      { titre: 'Charpente', ouvrages: [
        ['Charpente fermettes industrielles', 'm2', 78, 'Fermettes sapin traité', 22, 0.35],
        ['Contreventement et entretoises', 'm2', 78, 'Bois et connecteurs', 3.1, 0.08],
        ['Traitement fongicide et insecticide', 'm2', 78, 'Produit de traitement', 1.9, 0.05],
        ['Planches de rive et sous-face PVC', 'ml', 34, 'Lames PVC', 14, 0.3],
      ] },
      { titre: 'Couverture', ouvrages: [
        ['Écran sous-toiture HPV', 'm2', 82, 'Écran HPV', 2.6, 0.06],
        ['Liteaunage et contre-liteaunage', 'm2', 82, 'Liteaux 27 × 38', 3.4, 0.12],
        ['Couverture tuiles terre cuite à emboîtement', 'm2', 82, 'Tuiles et accessoires', 19, 0.45],
        ['Faîtage à sec ventilé', 'ml', 11, 'Closoir et faîtières', 17, 0.4],
        ['Gouttière zinc demi-ronde', 'ml', 24, 'Gouttière et crochets', 18, 0.45],
        ['Descente eaux pluviales zinc Ø 80', 'ml', 12, 'Tuyau zinc et colliers', 16, 0.35],
        ['Fenêtre de toit 78 × 98 avec raccord', 'u', 2, 'Fenêtre de toit', 410, 3.5, { type_prix: 'O', etiquette: 'ATTENTE_PRIX' }],
      ] },
    ],
  },
  {
    titre: 'Isolation et plâtrerie', tva: 2,
    sous: [
      { titre: 'Isolation', ouvrages: [
        ['Isolation des combles laine de verre soufflée R = 7', 'm2', 64, 'Laine soufflée', 9.8, 0.08],
        ['Doublage isolant PSE + plâtre 10 + 100', 'm2', 96, 'Complexe de doublage', 17, 0.45],
        ['Isolation des rampants laine de bois 200 mm', 'm2', 18, 'Panneaux laine de bois', 26, 0.4],
        ['Pare-vapeur et adhésifs d\'étanchéité', 'm2', 82, 'Membrane et adhésifs', 3.2, 0.1],
      ] },
      { titre: 'Cloisons et plafonds', ouvrages: [
        ['Cloison plaque de plâtre 72/48', 'm2', 54, 'Plaques, rails et montants', 12, 0.55],
        ['Cloison hydrofuge pour salle d\'eau', 'm2', 16, 'Plaques hydrofuges', 15, 0.6],
        ['Faux plafond plaque de plâtre sur fourrures', 'm2', 64, 'Plaques et fourrures', 11, 0.6],
        ['Bandes et enduit de finition', 'm2', 230, 'Bandes et enduit', 1.4, 0.12],
        ['Trappe de visite 60 × 60', 'u', 1, 'Trappe isolée', 85, 1],
        ['Habillage de gaine technique', 'ml', 6, 'Plaques et ossature', 19, 0.7],
      ] },
    ],
  },
  {
    titre: 'Électricité', tva: 2,
    prestations: [['Consuel et mise en service', 'ft', 1, 190]],
    sous: [
      { titre: 'Distribution', ouvrages: [
        ['Tableau électrique 3 rangées équipé', 'u', 1, 'Tableau et disjoncteurs', 480, 6],
        ['Liaison équipotentielle salle d\'eau', 'ft', 1, 'Câble et bornes', 35, 1.5],
        ['Prise de terre et piquet', 'u', 1, 'Piquet et câble cuivre', 62, 2],
        ['Gaine et filerie encastrée', 'ml', 220, 'Gaine ICTA et fils', 1.6, 0.06],
      ] },
      { titre: 'Appareillage', ouvrages: [
        ['Prise de courant 16 A encastrée', 'u', 28, 'Prise et boîte', 9, 0.5],
        ['Point lumineux simple allumage', 'u', 12, 'Interrupteur et DCL', 14, 0.7],
        ['Point lumineux va-et-vient', 'u', 5, 'Interrupteurs et DCL', 21, 0.9],
        ['Prise RJ45 catégorie 6', 'u', 6, 'Prise et câble', 16, 0.6],
        ['Spot encastré LED', 'u', 14, 'Spot LED', 18, 0.4],
        ['Détecteur de fumée', 'u', 3, 'Détecteur autonome', 19, 0.2],
        ['Volets roulants : alimentation et commandes', 'u', 4, 'Commandes filaires', 32, 1, { etiquette: 'A_VERIFIER' }],
      ] },
    ],
  },
  {
    titre: 'Plomberie et chauffage', tva: 2,
    sous: [
      { titre: 'Plomberie sanitaire', ouvrages: [
        ['Alimentation multicouche Ø 16 / Ø 20', 'ml', 48, 'Tube multicouche et raccords', 4.6, 0.3],
        ['Évacuations PVC Ø 40 / Ø 100', 'ml', 22, 'Tubes et raccords PVC', 5.2, 0.35],
        ['Receveur extra-plat 90 × 120 et paroi', 'u', 1, 'Receveur et paroi vitrée', 520, 5],
        ['Meuble vasque 80 cm avec mitigeur', 'u', 1, 'Meuble, vasque et mitigeur', 460, 3.5],
        ['WC suspendu avec bâti-support', 'u', 1, 'Bâti et cuvette', 390, 4],
        ['Évier cuisine raccordé', 'u', 1, 'Siphon et mitigeur', 140, 2],
        ['Ballon thermodynamique 200 L', 'u', 1, 'Ballon thermodynamique', 1650, 8, { etiquette: 'PRIX_CONFIRME' }],
      ] },
      { titre: 'Chauffage', ouvrages: [
        ['Pompe à chaleur air/eau 8 kW', 'u', 1, 'PAC et kit hydraulique', 5400, 16, { etiquette: 'ATTENTE_PRIX' }],
        ['Plancher chauffant basse température', 'm2', 64, 'Tubes, isolant et collecteur', 28, 0.35],
        ['Radiateur sèche-serviettes eau chaude', 'u', 1, 'Sèche-serviettes', 240, 2],
        ['Thermostat d\'ambiance connecté', 'u', 1, 'Thermostat', 160, 1],
        ['Mise en service et équilibrage', 'ft', 1, 'Consommables', 40, 4],
      ] },
    ],
  },
  {
    titre: 'Revêtements de sols et murs', tva: 2,
    sous: [
      { titre: 'Chapes et sols', ouvrages: [
        ['Chape fluide anhydrite ép. 5 cm', 'm2', 64, 'Chape anhydrite', 12, 0.12],
        ['Carrelage grès cérame 60 × 60', 'm2', 38, 'Carreaux et colle', 32, 0.8],
        ['Plinthes assorties', 'ml', 42, 'Plinthes et colle', 6, 0.2],
        ['Parquet contrecollé chêne', 'm2', 26, 'Parquet et sous-couche', 46, 0.5],
        ['Seuils et barres de transition', 'u', 5, 'Barres de seuil', 14, 0.3],
      ] },
      { titre: 'Faïence', ouvrages: [
        ['Faïence murale salle d\'eau', 'm2', 22, 'Faïence et colle', 28, 0.9],
        ['Système d\'étanchéité sous carrelage', 'm2', 12, 'Résine et bandes', 14, 0.3],
        ['Crédence cuisine', 'm2', 3, 'Carreaux décor', 45, 1.2, { type_prix: 'O' }],
        ['Profilés de finition inox', 'ml', 14, 'Profilés inox', 9, 0.2],
      ] },
    ],
  },
  {
    titre: 'Peinture et finitions', tva: 2,
    prestations: [['Protection des ouvrages et des sols', 'ft', 1, 180]],
    sous: [
      { titre: 'Peinture intérieure', ouvrages: [
        ['Impression sur plaques de plâtre', 'm2', 230, 'Impression acrylique', 0.9, 0.06],
        ['Peinture murs velours 2 couches', 'm2', 170, 'Peinture velours', 2.1, 0.14],
        ['Peinture plafonds mat 2 couches', 'm2', 64, 'Peinture mat', 1.9, 0.16],
        ['Peinture des boiseries et huisseries', 'ml', 48, 'Laque satinée', 1.6, 0.2],
        ['Peinture des pièces humides', 'm2', 24, 'Peinture spéciale', 3.4, 0.18],
      ] },
      { titre: 'Façades', ouvrages: [
        ['Enduit monocouche gratté', 'm2', 96, 'Enduit monocouche', 8.5, 0.35],
        ['Échafaudage de façade (location 4 semaines)', 'm2', 110, 'Location échafaudage', 6.5, 0.05],
        ['Appuis de fenêtres béton préfabriqués', 'u', 6, 'Appuis préfabriqués', 38, 0.8],
        ['Traitement hydrofuge de façade', 'm2', 96, 'Hydrofuge', 2.2, 0.06, { type_prix: 'M' }],
      ] },
    ],
  },
  {
    titre: 'Menuiseries intérieures et aménagements', tva: 2,
    ouvrages: [
      ['Bloc-porte isoplane 83 × 204', 'u', 6, 'Bloc-porte et quincaillerie', 145, 2],
      ['Porte coulissante à galandage', 'u', 1, 'Châssis et porte', 390, 4],
      ['Placard coulissant 2 portes', 'u', 2, 'Portes et rails', 310, 3],
      ['Aménagement intérieur de placard', 'u', 2, 'Kit d\'aménagement', 180, 2],
      ['Escalier quart tournant hêtre', 'u', 1, 'Escalier et garde-corps', 2600, 12, { etiquette: 'A_VERIFIER' }],
      ['Trappe d\'accès aux combles isolée', 'u', 1, 'Trappe escamotable', 290, 2],
      ['Habillage d\'escalier et nez de marche', 'ml', 8, 'Nez de marche', 22, 0.5],
    ],
  },
  {
    titre: 'Aménagements extérieurs', tva: 1,
    ouvrages: [
      ['Terrasse bois pin traité classe 4', 'm2', 24, 'Lames et lambourdes', 38, 0.9],
      ['Plots réglables pour terrasse', 'u', 60, 'Plots PVC', 3.2, 0.08],
      ['Allée en pavés béton sur lit de sable', 'm2', 18, 'Pavés et sable', 26, 0.7],
      ['Bordures béton P1', 'ml', 22, 'Bordures et mortier', 7.5, 0.3],
      ['Clôture grillage rigide H 1,50 m', 'ml', 30, 'Panneaux et poteaux', 32, 0.5],
      ['Portillon assorti', 'u', 1, 'Portillon et serrure', 290, 3],
      ['Engazonnement des espaces verts', 'm2', 120, 'Semences et terreau', 1.2, 0.04, { type_prix: 'O' }],
      ['Éclairage extérieur sur détecteur', 'u', 3, 'Applique LED', 55, 1.2],
    ],
  },
];

/**
 * Lignes des lots (ID à partir de `premierId`, lots à la racine à partir de l'ordre `premierOrdre`).
 * `ligne` crée une ligne avec les valeurs par défaut du devis de démonstration.
 */
export function lignesLotsDemo(ligne, premierId = 1000, premierOrdre = 3) {
  const lignes = [];
  let id = premierId;
  const ajouter = (o) => { const l = ligne({ lig_id: id++, ...o }); lignes.push(l); return l.lig_id; };
  const ouvrage = (parent, ordre, [libelle, unite, qte, fourniture, pa, heures, opt = {}], tva) => {
    const o = ajouter({
      lig_parent_id: parent, lig_ordre: ordre, lig_tyl_id: 2, lig_libelle_html: libelle, lig_qte: qte, lig_unt_code: unite,
      lig_coef_fg: 1.1, lig_coef_benef: 1.2, lig_tva_id: tva,
      ...(opt.type_prix ? { lig_type_prix: opt.type_prix } : {}), ...(opt.etiquette ? { lig_etiquette: opt.etiquette } : {}),
    });
    // Les composantes héritent du mode de vente de l'ouvrage (option, pour mémoire).
    const herite = opt.type_prix ? { lig_type_prix: opt.type_prix } : {};
    ajouter({ lig_parent_id: o, lig_ordre: 1, lig_tyl_id: 3, lig_libelle_html: fourniture, lig_qte: 1, lig_qte_type: 'R', lig_unt_code: unite, lig_pa: pa, lig_coef_fg: 1.1, lig_coef_benef: 1.2, ...herite });
    ajouter({ lig_parent_id: o, lig_ordre: 2, lig_tyl_id: 3, lig_libelle_html: 'Main-d\'œuvre', lig_qte: heures, lig_qte_type: 'R', lig_precision_qte: 3, lig_unt_code: 'h', lig_pa: MO, lig_coef_fg: 1.1, lig_coef_benef: 1.2, ...herite });
  };
  const prestation = (parent, ordre, [libelle, unite, qte, pa], tva) => ajouter({
    lig_parent_id: parent, lig_ordre: ordre, lig_tyl_id: 3, lig_libelle_html: libelle, lig_qte: qte, lig_unt_code: unite, lig_pa: pa,
    lig_coef_fg: 1.1, lig_coef_benef: 1.25, lig_tva_id: tva,
  });
  const parId = new Map();
  LOTS.forEach((lot, i) => {
    const t = ajouter({ lig_parent_id: null, lig_ordre: premierOrdre + i, lig_tyl_id: 1, lig_libelle_html: `<b>${lot.titre}</b>`, lig_tva_id: lot.tva });
    let ordre = 1;
    for (const p of lot.prestations ?? []) prestation(t, ordre++, p, lot.tva);
    for (const o of lot.ouvrages ?? []) ouvrage(t, ordre++, o, lot.tva);
    for (const s of lot.sous ?? []) {
      const st = ajouter({ lig_parent_id: t, lig_ordre: ordre++, lig_tyl_id: 1, lig_libelle_html: `<b>${s.titre}</b>`, lig_tva_id: lot.tva });
      s.ouvrages.forEach((o, k) => ouvrage(st, k + 1, o, lot.tva));
    }
    ajouter({ lig_parent_id: t, lig_ordre: ordre, lig_tyl_id: 5, lig_libelle_html: `Sous-total ${lot.titre.toLowerCase()}` });
  });
  for (const l of lignes) parId.set(l.lig_id, l);
  for (const l of lignes) l.lig_nat_id = natureDemo(l, parId.get(l.lig_parent_id) ?? null);
  return lignes;
}

/** Nombre de lots ajoutés (les lignes de pied du devis se placent après). */
export const NB_LOTS_DEMO = LOTS.length;
