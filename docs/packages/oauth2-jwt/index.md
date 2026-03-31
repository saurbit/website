# @saurbit/oauth2-jwt

JWT utilities and JWKS authority for [`@saurbit/oauth2`](/packages/oauth2/). Wraps [jose](https://github.com/panva/jose) to provide ready-made implementations of the JWT-related interfaces required by `@saurbit/oauth2`.

## Installation

::: code-group

```sh [npm]
npm install @saurbit/oauth2-jwt
```

```sh [yarn]
yarn add @saurbit/oauth2-jwt
```

```sh [pnpm]
pnpm add @saurbit/oauth2-jwt
```

```sh [bun]
bun add @saurbit/oauth2-jwt
```

```sh [deno]
deno add jsr:@saurbit/oauth2-jwt
```

:::

## What's Inside

| Export | Kind | Description |
| --- | --- | --- |
| [`verifyJwt`](./methods#verifyjwt) | Function | Verify a JWT with a secret or key. Can be used by [`ClientSecretJwt`](/packages/oauth2/client-auth-methods#client-secret-jwt) and [`PrivateKeyJwt`](/packages/oauth2/client-auth-methods#private-key-jwt). |
| [`decodeJwt`](./methods#decodejwt) | Function | Decode a JWT payload without verification. Can be used by [`ClientSecretJwt`](/packages/oauth2/client-auth-methods#client-secret-jwt) and [`PrivateKeyJwt`](/packages/oauth2/client-auth-methods#private-key-jwt). |
| [`verifyJwk`](./methods#verifyjwk) | Function | Verify a JWT with an embedded JWK (DPoP proofs). Can be used by [`DPoPTokenType`](/packages/oauth2/token-types#dpop). |
| [`JoseJwksAuthority`](./jose-jwks-authority) | Class | Signs and verifies JWTs, manages RS256 key pairs, serves the JWKS endpoint. |
| [`InMemoryKeyStore`](./in-memory-key-store) | Class | In-memory `JwksKeyStore` and `JwksRotationTimestampStore` implementation. |
| [`JwksRotator`](./jwks-rotator) | Class | Scheduled JWKS key rotation. |

## Quick Start

```ts
import {
  createInMemoryKeyStore,
  JoseJwksAuthority,
  JwksRotator,
} from "@saurbit/oauth2-jwt";

// 1. Create a key store and authority
const store = createInMemoryKeyStore();
const authority = new JoseJwksAuthority(store, 8.64e6); // 100-day TTL

// 2. Set up key rotation
const rotator = new JwksRotator({
  keyGenerator: authority,
  rotatorKeyStore: store,
  rotationIntervalMs: 7.884e9, // 91 days
});
await rotator.checkAndRotateKeys();

// 3. Sign a JWT
const { token } = await authority.sign({
  sub: "user-123",
  iss: "https://auth.example.com",
  aud: "my-client",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  jti: crypto.randomUUID(),
});

// 4. Verify a JWT
const payload = await authority.verify(token);

// 5. Serve the JWKS endpoint
const jwks = await authority.getJwksEndpointResponse();
// Return `jwks` as JSON at e.g. /.well-known/jwks.json
```