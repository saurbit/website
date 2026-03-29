import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/website/',
  title: "Saurbit",
  description: "Toolkit of modular, reusable packages",
  head: [
    ['link', { rel: 'icon', href: '/website/favicon.ico' }]
  ],
  markdown: {
    theme: {
      light: "catppuccin-latte",
      dark: "catppuccin-mocha"
    }
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/images/saurbit-sit-pfp.png',
    search: {
      provider: 'local'
    },
    nav: [
      { text: 'Docs', link: '/introduction' },
      { text: 'Examples', link: '/examples/' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [{ text: 'What is Saurbit?', link: '/introduction' }]
      },
      {
        text: 'Packages',
        link: '/packages/',
        items: [
          {
            text: 'OAuth2',
            collapsed: true,
            items: [
              {
                text: '@saurbit/oauth2', link: '/packages/oauth2/', items: [
                  { text: 'Builders', link: '/packages/oauth2/builders' },
                  { text: 'Authorization Code', link: '/packages/oauth2/authorization-code' },
                  { text: 'Client Credentials', link: '/packages/oauth2/client-credentials' },
                  { text: 'Device Authorization', link: '/packages/oauth2/device-authorization' },
                  { text: 'OIDC Support', link: '/packages/oauth2/oidc-support' },
                ]
              },

            ]
          },
        ],
      },
      {
        text: 'Examples',
        link: '/examples/',
        items: [
          { text: 'OAuth2 with Hono', link: '/examples/hono-oauth2/' },
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/saurbit/saurbit' }
    ]
  }
})
