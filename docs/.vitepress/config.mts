import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
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
          { text: 'Module Document', link: '/modules/document/' },
          { text: 'Module Métré', link: '/modules/metre/' },
          { text: 'Module Bibliothèque', link: '/modules/bibliotheque/' }
        ]
      },
      { text: 'Plan de formation', link: '/plan-formation' }
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Modules Cœur BTP',
          items: [
            { text: 'Module Document', link: '/modules/document/' },
            { text: 'Module Métré', link: '/modules/metre/' },
            { text: 'Module Bibliothèque', link: '/modules/bibliotheque/' }
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
          text: 'Modules Cœur BTP',
          items: [
            { text: 'Module Document', link: '/modules/document/' },
            { text: 'Module Métré', link: '/modules/metre/' },
            { text: 'Module Bibliothèque', link: '/modules/bibliotheque/' }
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
          text: 'Modules Cœur BTP',
          items: [
            { text: 'Module Document', link: '/modules/document/' },
            { text: 'Module Métré', link: '/modules/metre/' },
            { text: 'Module Bibliothèque', link: '/modules/bibliotheque/' }
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
