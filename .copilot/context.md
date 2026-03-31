# Website Project Context

This is a [VitePress](https://vitepress.dev/) documentation site for the **@saurbit** organization. It documents the packages in the [saurbit/saurbit](https://github.com/saurbit/saurbit) monorepo.

## Tech Stack

- **VitePress** 2.0.0-alpha.17
- **pnpm** as package manager
- **Catppuccin** theme (latte/mocha for light/dark)
- Deployed with base path `/website/`

## Config

- VitePress config: `docs/.vitepress/config.mts`
- Content root: `docs/`

## Scripts

- `pnpm docs:dev` — local dev server
- `pnpm docs:build` — production build
- `pnpm docs:preview` — preview production build

## Structure

```
docs/
  index.md                            — Landing page
  introduction.md                     — "What is Saurbit?"
  packages/
    index.md                          — Packages overview
    oauth2/                           — @saurbit/oauth2 docs
      index.md
      builders.md
      authorization-code.md
      client-credentials.md
      device-authorization.md
      oidc-support.md
      client-auth-methods.md
      token-types.md
    oauth2-jwt/                       — @saurbit/oauth2-jwt docs
      index.md
      jose-jwks-authority.md
      jwks-rotator.md
      in-memory-key-store.md
      methods.md
  examples/
    index.md
    oauth2-with-elysiajs.md
    hono-oauth2/
      index.md
  public/
    images/                           — Logo, favicons
```

## Conventions

- Markdown features: `::: code-group`, `::: tip`, `::: warning`, `::: info` directives
- Code examples use TypeScript
- Heading anchors use `{#id}` syntax for stable links
- API docs follow the pattern: signature in fenced code block, parameters in a table, usage example
- Cross-package links use absolute paths (e.g. `/packages/oauth2/token-types#dpop`)