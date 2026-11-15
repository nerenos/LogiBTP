-- =============================================================================
-- Cœur LogiBTP – données de démonstration volumineuses des listes : 80 salariés, 50 matériels, 12 équipes et 40
-- sous-traitants (table demo_sous_traitant, reprise dans l'annuaire par 210b). Extrait de 120_listes.sql ; script de
-- démonstration (indicateur « demo » du manifeste), appliqué juste après 120.
-- =============================================================================

-- 80 salariés et 50 matériels (démonstration ; les listes longues sont éprouvées par les tests), valeurs
-- pseudo-aléatoires reproductibles (setseed).
SELECT setseed(0.42);
INSERT INTO salarie (sal_matricule, sal_nom, sal_prenom, sal_service, sal_poste, sal_statut, sal_date_entree, sal_salaire, sal_actif, sal_commentaire)
SELECT 'S' || lpad(i::text, 5, '0'),
       (ARRAY['Martin','Bernard','Dubois','Lefèvre','Moreau','Laurent','Garçon','Roux','Fournier','Girard','Bonnet','Dupré',
              'Lambert','Fontaine','Rousseau','Vincent','Müller','Faure','André','Mercier','Blanc','Guérin','Boyer','Chevalier'])[1 + floor(random() * 24)::int],
       (ARRAY['Hélène','Gaëlle','Jérôme','Lœtitia','François','Zoé','Noël','Agnès','Benoît','Céline','Loïc','Maëlys',
              'Thomas','Inès','Raphaël','Chloé','Jean-Marc','Anaïs','Mathéo','Léa','Ophélie','Grégoire','Nadège','Frédéric'])[1 + floor(random() * 24)::int],
       x.service,
       CASE x.service
           WHEN 'Chantier' THEN (ARRAY['Maçon','Chef d''équipe','Coffreur','Manœuvre','Grutier'])[1 + floor(random() * 5)::int]
           WHEN 'Bureau' THEN (ARRAY['Conducteur de travaux','Métreur','Assistante','Comptable'])[1 + floor(random() * 4)::int]
           WHEN 'Atelier' THEN (ARRAY['Mécanicien','Magasinier'])[1 + floor(random() * 2)::int]
           ELSE (ARRAY['Directeur','Responsable QSE'])[1 + floor(random() * 2)::int]
       END,
       (ARRAY['CDI','CDI','CDI','CDD','INTERIM'])[1 + floor(random() * 5)::int],
       DATE '2005-01-01' + floor(random() * 7600)::int,
       round((1900 + random() * 3600)::numeric, 2),
       random() > 0.08,
       CASE WHEN random() > 0.85 THEN 'Habilitation électrique' || chr(10) || 'CACES R482 cat. A'
            WHEN random() > 0.9 THEN 'Temps partiel 80 %' ELSE '' END
FROM generate_series(1, 80) AS i
CROSS JOIN LATERAL (SELECT (ARRAY['Chantier','Bureau','Atelier','Direction'])[1 + floor(random() * 4)::int] AS service, i AS j) x;

INSERT INTO materiel (mat_code, mat_designation, mat_famille, mat_etat, mat_chantier, mat_valeur_achat, mat_date_achat,
                           mat_heures, mat_heures_revision, mat_controle_ok, mat_observations)
SELECT 'M' || lpad(i::text, 5, '0'),
       x.designation || ' n° ' || (100 + i % 900),
       x.famille,
       x.etat,
       CASE WHEN x.etat = 'CHANTIER' THEN (ARRAY['Maison Martin – Lyon','Résidence Les Érables','École Jean-Moulin','Pont de la Saône','Entrepôt Sud – Vénissieux'])[1 + floor(random() * 5)::int] END,
       round((800 + random() * 180000)::numeric, 0),
       DATE '2012-01-01' + floor(random() * 5000)::int,
       floor(x.revision * (0.4 + random() * 0.8))::int,
       x.revision,
       random() > 0.2,
       (ARRAY['','','Pneus à changer','Fuite hydraulique signalée' || chr(10) || 'Devis réparation demandé','Contrôle VGP à planifier','Rayures carrosserie'])[1 + floor(random() * 6)::int]
FROM generate_series(1, 50) AS i
CROSS JOIN LATERAL (
    SELECT f.famille,
           (f.engins)[1 + floor(random() * array_length(f.engins, 1))::int] AS designation,
           (ARRAY['DISPO','DISPO','CHANTIER','CHANTIER','CHANTIER','PANNE','REBUT'])[1 + floor(random() * 7)::int] AS etat,
           250 * (1 + floor(random() * 8)::int) AS revision
    FROM (VALUES
        ('Engins', ARRAY['Mini-pelle 2,5 t','Chargeuse compacte','Tractopelle','Pelle sur chenilles 14 t']),
        ('Levage', ARRAY['Grue à tour','Nacelle ciseaux','Chariot télescopique']),
        ('Outillage', ARRAY['Bétonnière 350 l','Marteau-piqueur','Scie à sol','Groupe électrogène']),
        ('Véhicules', ARRAY['Fourgon 3,5 t','Camion benne','Utilitaire léger']),
        ('Coffrage', ARRAY['Banches métalliques','Étais tirants'])
    ) AS f(famille, engins)
    ORDER BY random() + i * 0 LIMIT 1
) x;

INSERT INTO equipe (equ_code, equ_libelle, equ_categorie, equ_chef, equ_effectif, equ_chantier, equ_active)
SELECT 'E' || lpad(i::text, 3, '0'),
       'Équipe ' || (ARRAY['gros œuvre','second œuvre','VRD','finitions'])[1 + (i - 1) % 4] || ' ' || (1 + (i - 1) / 4),
       (ARRAY['Gros œuvre','Second œuvre','VRD','Finitions'])[1 + (i - 1) % 4],
       (SELECT sal_prenom || ' ' || sal_nom FROM salarie WHERE sal_id = i * 6),
       3 + floor(random() * 6)::int,
       CASE WHEN random() > 0.3 THEN (ARRAY['Maison Martin – Lyon','Résidence Les Érables','École Jean-Moulin','Pont de la Saône'])[1 + floor(random() * 4)::int] END,
       random() > 0.3
FROM generate_series(1, 12) AS i;

INSERT INTO demo_sous_traitant (sst_code, sst_raison, sst_metier, sst_taux_horaire, sst_agree, sst_observations)
SELECT 'ST' || lpad(i::text, 3, '0'), x.nom || ' ' || x.metier, x.metier, round((38 + random() * 30)::numeric, 2), x.agree,
       (ARRAY['Lyon','Villeurbanne','Vénissieux','Saint-Étienne','Grenoble','Bourg-en-Bresse'])[1 + floor(random() * 6)::int]
         || CASE WHEN x.agree THEN '' ELSE chr(10) || 'Attestation URSSAF à fournir' END
FROM generate_series(1, 40) AS i
CROSS JOIN LATERAL (
    SELECT (ARRAY['Martin','Bernard','Dubois','Lefèvre','Moreau','Garçon','Roux','Müller'])[1 + floor(random() * 8)::int] AS nom,
           (ARRAY['Électricité','Plomberie','Charpente','Étanchéité','Plâtrerie','Peinture','Menuiserie','Terrassement'])[1 + floor(random() * 8)::int] AS metier,
           random() > 0.25 AS agree,
           i AS j
) x;
