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
                  { text: 'Client Authentication Methods', link: '/packages/oauth2/client-auth-methods' },
                  { text: 'Token Types', link: '/packages/oauth2/token-types' },
                ]
              },
              {
                text: '@saurbit/oauth2-jwt', link: '/packages/oauth2-jwt/', items: [
                  { text: 'JoseJwksAuthority', link: '/packages/oauth2-jwt/jose-jwks-authority' },
                  { text: 'JWKS Rotator', link: '/packages/oauth2-jwt/jwks-rotator' },
                  { text: 'In-Memory Key Store', link: '/packages/oauth2-jwt/in-memory-key-store' },
                  { text: 'JWT Methods', link: '/packages/oauth2-jwt/methods' },
                ]
              }
            ]
          },
        ],
      },
      {
        text: 'Examples',
        link: '/examples/',
        collapsed: false,
        items: [
          { text: 'OAuth2 with ElysiaJS', link: '/examples/oauth2-with-elysiajs' },
          { text: 'OAuth2 with Hono', link: '/examples/hono-oauth2/' },
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/saurbit/saurbit' }
    ]
  }
})
