import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Saurbit",
  description: "Toolkit of modular, reusable packages",
  markdown: {
    theme: {
      light: "catppuccin-latte",
      dark: "catppuccin-mocha"
    }
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/markdown-examples' }
    ],

    sidebar: [
      { text: 'Concepts', link: '/concepts/main' },
      {
        text: 'Packages',
        items: [
          { 
            text: 'OAuth2', 
            collapsed: true,
            items: [
              { text: '@saurbit/oauth2', link: '/packages/oauth2/' },
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
