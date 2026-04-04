# Packages

Saurbit is a collection of modular, reusable packages. Each package is published separately and can be used on its own or combined with other packages.

::: warning Cross-registry split
Saurbit packages are published on multiple registries (e.g. [JSR](https://jsr.io) and [npm](https://www.npmjs.com)). When one package depends on another, **install all Saurbit packages from the same registry**. Mixing registries can cause issues where two packages reference different module identities for the same dependency, leading to subtle runtime errors or broken type compatibility.
:::

| Package | Description |
| ------- | ----------- |
| [@saurbit/oauth2](/packages/oauth2/) | A framework-agnostic OAuth 2.0 authorization server implementation with OIDC support. |
