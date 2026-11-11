import { defineConfig } from 'vitepress'

// Adresse de la documentation : « / » en local ; sous /documentation/ sur la démonstration Vercel (vercel.json à la
// racine : LOGIBTP_DOCS_BASE=/documentation/), écrite alors dans dist/documentation/ pour que le service statique
// réponde au chemin d'origine.
const base = process.env.LOGIBTP_DOCS_BASE ?? '/'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base,
  outDir: `.vitepress/dist${base === '/' ? '' : base.replace(/\/$/, '')}`,
  lang: 'fr-FR',
  title: "LogiBTP",
  description: "Documentation officielle de LogiBTP - ERP modulaire open source pour le BTP",
  ignoreDeadLinks: true,

  themeConfig: {
    siteTitle: "LogiBTP Documentation",

    nav: [
      { text: 'Accueil', link: '/' },
      { text: 'Démarrage rapide', link: '/getting-started/' },
      {
        text: 'Modules',
        items: [
          { text: 'Document & Facturation', link: '/modules/document/' },
          { text: 'Métré & Quantités', link: '/modules/metre/' },
          { text: 'Bibliothèque & Prix', link: '/modules/bibliotheque/' },
          { text: 'Planning des équipes', link: '/modules/planning/' },
          { text: 'Pointage & Paie', link: '/modules/pointage/' },
          { text: 'Exécution des travaux', link: '/modules/execution/' },
          { text: 'Stock & Dépôts', link: '/modules/stock/' },
          { text: 'Sous-traitance & Agrément', link: '/modules/sous-traitance/' }
        ]
      },
      { text: 'Plan de formation', link: '/plan-formation' }
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Modules Métier BTP',
          items: [
            { text: 'Document & Facturation', link: '/modules/document/' },
            { text: 'Métré & Quantités', link: '/modules/metre/' },
            { text: 'Bibliothèque & Prix', link: '/modules/bibliotheque/' },
            { text: 'Planning des équipes', link: '/modules/planning/' },
            { text: 'Pointage & Paie', link: '/modules/pointage/' },
            { text: 'Exécution des travaux', link: '/modules/execution/' },
            { text: 'Stock & Dépôts', link: '/modules/stock/' },
            { text: 'Sous-traitance & Agrément', link: '/modules/sous-traitance/' }
          ]
        },
        {
          text: 'Démarrage rapide',
          items: [
            { text: 'Vue d’ensemble', link: '/getting-started/' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Configuration & Secrets', link: '/getting-started/configuration' },
            { text: 'Architecture Multi-sociétés', link: '/getting-started/multi-societe' },
            { text: 'Premières étapes (Quick Win)', link: '/getting-started/premieres-etapes' }
          ]
        }
      ],
      '/getting-started/': [
        {
          text: 'Prise en main',
          items: [
            { text: 'Vue d’ensemble', link: '/getting-started/' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Configuration & Secrets', link: '/getting-started/configuration' },
            { text: 'Architecture Multi-sociétés', link: '/getting-started/multi-societe' },
            { text: 'Premières étapes (Quick Win)', link: '/getting-started/premieres-etapes' }
          ]
        },
        {
          text: 'Modules Métier BTP',
          items: [
            { text: 'Document & Facturation', link: '/modules/document/' },
            { text: 'Métré & Quantités', link: '/modules/metre/' },
            { text: 'Bibliothèque & Prix', link: '/modules/bibliotheque/' },
            { text: 'Planning des équipes', link: '/modules/planning/' },
            { text: 'Pointage & Paie', link: '/modules/pointage/' },
            { text: 'Exécution des travaux', link: '/modules/execution/' },
            { text: 'Stock & Dépôts', link: '/modules/stock/' },
            { text: 'Sous-traitance & Agrément', link: '/modules/sous-traitance/' }
          ]
        }
      ],
      '/': [
        {
          text: 'Prise en main',
          items: [
            { text: 'Vue d’ensemble', link: '/getting-started/' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Configuration & Secrets', link: '/getting-started/configuration' },
            { text: 'Architecture Multi-sociétés', link: '/getting-started/multi-societe' },
            { text: 'Premières étapes (Quick Win)', link: '/getting-started/premieres-etapes' }
          ]
        },
        {
          text: 'Modules Métier BTP',
          items: [
            { text: 'Document & Facturation', link: '/modules/document/' },
            { text: 'Métré & Quantités', link: '/modules/metre/' },
            { text: 'Bibliothèque & Prix', link: '/modules/bibliotheque/' },
            { text: 'Planning des équipes', link: '/modules/planning/' },
            { text: 'Pointage & Paie', link: '/modules/pointage/' },
            { text: 'Exécution des travaux', link: '/modules/execution/' },
            { text: 'Stock & Dépôts', link: '/modules/stock/' },
            { text: 'Sous-traitance & Agrément', link: '/modules/sous-traitance/' }
          ]
        }
      ]
    },

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: 'Rechercher',
                buttonAriaLabel: 'Rechercher dans la documentation'
              },
              modal: {
                noResultsText: 'Aucun résultat trouvé',
                resetButtonTitle: 'Effacer la recherche',
                footer: {
                  selectText: 'pour sélectionner',
                  navigateText: 'pour naviguer',
                  closeText: 'pour fermer'
                }
              }
            }
          }
        }
      }
    },

    docFooter: {
      prev: 'Page précédente',
      next: 'Page suivante'
    },

    outline: {
      label: 'Sommaire de la page',
      level: [2, 3]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/nerenos/LogiBTP' }
    ],

    footer: {
      message: 'ERP modulaire open source pour les professionnels du Bâtiment et des Travaux Publics',
      copyright: 'Copyright © 2026 LogiBTP'
    }
  }
})
