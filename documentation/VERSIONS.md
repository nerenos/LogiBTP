# Versions publiées

Procédure : [PUBLICATION.md](PUBLICATION.md). Images : `ghcr.io/nerenos/logibtp-api:<version>` et Docker Hub `<compte>/logibtp-api:<version>`.

## 1.0.0 (novembre 2026)
Première version publiée.
- Schéma : socle 1.0 de tous les modules, mineure `fiche 1.1` (champs supplémentaires des fiches) ; installation neuve
  par le manifeste `db/installation/scripts.txt`, mises à jour suivantes par mineures (versionnement du schéma par module).
- Contenu : devis, factures et documents BTP (métrés, bibliothèque, éditions), achats, sous-traitance, stock, exécution
  et terrain, planning, pointage, CRM, GED, règlements et relances, facturation électronique (réception, émission,
  e-reporting), rentabilité des chantiers, SAV, comptabilité (export Sage 100), module MCP (agents IA), personnalisation,
  droits et authentification, installeurs Windows et Debian (Docker).
- Base de données : PostgreSQL 17 (image officielle, projet Compose séparé).
