---
layout: home

hero:
  name: "LogiBTP"
  text: "L'ERP Open Source taillé pour les professionnels du BTP"
  tagline: "Robuste, modulaire, rapide et utilisable partout (bureau, chantier, mobilité hors-ligne)."
  actions:
    - theme: brand
      text: Démarrer l'installation
      link: /getting-started/installation
    - theme: alt
      text: Guide de prise en main
      link: /getting-started/

features:
  - icon: 🏗️
    title: Études de prix & Métrés
    details: Moteur de calcul miroir JS/C# garantissant une stricte parité, formules de métrés dynamiques, actualisation des prix et tranches paramétrées.
  - icon: 👷
    title: Mobilité Terrain & PWA
    details: Conçu pour tablettes et smartphones avec mode 100% hors-ligne, synchronisation automatique au retour réseau, pointage et PV de réception.
  - icon: 🏢
    title: Multi-Sociétés & Isolation
    details: Une base PostgreSQL dédiée par société pour une étanchéité absolue des données et une résolution automatique par sous-domaine.
  - icon: ⚡
    title: Architecture Découplée
    details: Découpage rigoureux en 3 couches (socle neutre → modules réutilisables → cœur spécialisé BTP) et zéro framework lourd côté client.
  - icon: 🔒
    title: Coffre-fort GED & Sécurité
    details: Classement documentaire structuré, journal chaîné horodaté SHA-256, certificats TLS stricts et sauvegardes chiffrées AES-256-GCM.
  - icon: 📊
    title: Rentabilité & Suivi de Chantier
    details: Comparatif en temps réel budget / engagé / déboursé / facturé, gestion des stocks multi-dépôts et planification des ressources.
---

## Bienvenue sur la documentation de LogiBTP

**LogiBTP** est un progiciel de gestion intégré (ERP) open source spécialement conçu pour répondre aux défis quotidiens des entreprises du Bâtiment et des Travaux Publics, des artisans et des majors de la construction.

Couvrant l'intégralité du cycle de vie des chantiers — de l'étude de prix initiale jusqu'à la facturation, la comptabilité et l'analyse de rentabilité post-chantier —, LogiBTP allie **rigueur de calcul**, **simplicité d'utilisation** et **haute disponibilité**.

---

## 🎯 Piliers d'ingénierie du projet

Le socle technique de LogiBTP repose sur des choix d'architecture éprouvés et documentés :

1. **Moteurs Miroirs JS / C# :**  
   Les règles de calcul des devis, ventilations, déboursés et TVA sont implémentées à la fois côté navigateur (JavaScript moderne) et côté serveur (.NET C#). Elles partagent les mêmes jeux de tests unitaires pour garantir une parité mathématique au centime près.
2. **Modèle relationnel PostgreSQL maîtrisé :**  
   Schéma rigoureusement typé (colonnes en `snake_case`), pas de migrations opaques d'ORM. Tous les scripts de création et de mise à jour sont gérés via le manifeste unique `db/installation/scripts.txt`.
3. **Zéro texte en dur & Personnalisation complète :**  
   Tous les libellés, icônes, statuts et couleurs sont gérés par un dictionnaire dynamique et peuvent être surchargés par instance sans toucher au code source ni recompiler l'application.
4. **Multi-fenêtrage natif :**  
   Pensé pour les configurations multi-écrans des métreurs et conducteurs de travaux : ouvrez simultanément vos fiches, métrés et documents sur des fenêtres distinctes synchronisées en direct via l'API Web `BroadcastChannel`.

---

## 🗺️ Par où commencer ?

<div class="tip custom-block" style="padding-top: 8px">

Pour une prise en main immédiate, suivez notre guide pas-à-pas :
- 🚀 **[Guide d'installation](/getting-started/installation)** : Déploiement rapide en local via Docker ou mise en production automatisée (Windows / Debian).
- ⚙️ **[Configuration & Secrets](/getting-started/configuration)** : Paramétrage du fichier `.env`, certificats HTTPS et personnalisation graphique.
- 🏢 **[Architecture Multi-sociétés](/getting-started/multi-societe)** : Comprendre le principe d'une base par société et configurer vos sous-domaines.
- 🏆 **[Premières étapes (Quick Win)](/getting-started/premieres-etapes)** : Créez votre premier client, votre chantier et émettez votre premier devis chiffré en moins de 15 minutes.

</div>

---

## 👥 Parcours par profil utilisateur

| Profil | Cas d'usage principaux | Modules clés |
| :--- | :--- | :--- |
| **Métreur / Chargé d'affaires** | Chiffrage de devis, formules de métré, bordereaux de prix, tranches et options | `document`, `metre`, `bibliotheque` |
| **Conducteur de travaux** | Ordres d'exécution, avancement des situations, consultations sous-traitants | `execution`, `sous-traitance`, `crm` |
| **Chef de chantier / Terrain** | Pointage journalier des équipes, saisie hors-ligne, PV de pose et SAV sur tablette | `terrain`, `pointage`, `planning` |
| **Magasinier / Gestionnaire de parc** | Gestion des stocks, matériels, dotations EPI, réévaluations PMP | `stock`, `ressources` |
| **Comptable / DAF** | Situations de travaux, TVA, retenues de garantie, exports Sage 100 | `comptabilite`, `reglement`, `rentabilite` |
| **Administrateur système** | Gestion Docker, sauvegardes chiffrées, gestion des droits et certificats | `installation`, `authentification`, `droits` |

---

## 📚 Référence documentaire & Évolution

Consultez le **[Plan de formation](/plan-formation)** pour suivre l'avancement de la rédaction modulaire et les futurs ateliers thématiques.
