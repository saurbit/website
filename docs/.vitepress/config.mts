import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Saurbit",
  description: "Toolkit of modular, reusable packages",
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
  markdown: {
    theme: {
      light: "catppuccin-latte",
      dark: "catppuccin-mocha"
    }
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Docs', link: '/introduction' },
      { text: 'Examples', link: '/markdown-examples' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [{ text: 'What is Saurbit?', link: '/introduction' }]
      },
      {
        text: 'Packages',
        items: [
          {
            text: 'OAuth2',
            collapsed: true,
            items: [
              {
                text: '@saurbit/oauth2', link: '/packages/oauth2/', items: [
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
        items: [
          { text: 'Markdown Examples', link: '/markdown-examples' },
          { text: 'Runtime API Examples', link: '/api-examples' }
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/saurbit/saurbit' }
    ]
  }
})
