# Token Types

`@saurbit/oauth2` uses token types to determine how access tokens are presented in the `Authorization` header and how they are validated on both the token endpoint and protected resource endpoints.

You set the token type on any flow builder using [`setTokenType()`](./builders#common-configuration). If not set, `BearerTokenType` is used by default.

## Overview

| Token Type       | Class              | Spec                                                             | Description                                              |
| ---------------- | ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `Bearer`         | `BearerTokenType`  | [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750)       | Standard bearer token — possession alone grants access.  |
| `DPoP`           | `DPoPTokenType`    | [RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449)       | Proof-of-possession token bound to a client key pair.    |

## `TokenType` Interface

Both built-in token types implement the `TokenType` interface. You can provide your own implementation to support additional token schemes.

```ts
interface TokenType {
  /** The prefix in the `Authorization` header (e.g. `"Bearer"`, `"DPoP"`). */
  readonly prefix: string;

  /** Validates a token on a protected resource endpoint. */
  isValid(
    request: Request,
    token: string,
  ): TokenTypeValidationResponse | Promise<TokenTypeValidationResponse>;

  /** Optional — validates the request at the token endpoint before client auth. */
  isValidTokenRequest?(
    request: Request,
  ): TokenTypeValidationResponse | Promise<TokenTypeValidationResponse>;
}
```

---

## `BearerTokenType` {#bearer}

The default token type. By default, considers any non-empty token string valid. Use the `validate()` method to supply custom validation logic (e.g. JWT signature verification, database lookup).

### Usage

```ts
import { BearerTokenType } from "@saurbit/oauth2";

const bearer = new BearerTokenType();
```

Since `BearerTokenType` is the default, you don't need to call `setTokenType()` unless you want to configure custom validation:

```ts
import { AuthorizationCodeFlowBuilder, BearerTokenType } from "@saurbit/oauth2";

const bearer = new BearerTokenType()
  .validate((request, token) => {
    // Custom validation logic (e.g. verify JWT, look up in database)
    return { isValid: !!token };
  });

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .setTokenType(bearer)
  // ... other builder methods
  .build();
```

### Methods

#### `validate(handler)`

```ts
.validate(handler: BearerTokenValidation): this
```

Overrides the default validation handler. The handler receives the incoming `Request` and the raw token string extracted from the `Authorization: Bearer <token>` header.

---

## `DPoPTokenType` {#dpop}

Implements the [DPoP (Demonstration of Proof-of-Possession)](https://datatracker.ietf.org/doc/html/rfc9449) token scheme. DPoP binds access tokens to a client's key pair, preventing token theft and replay attacks.

The default handler validates DPoP proofs on both the token endpoint and protected resource endpoints by checking:

- The `DPoP` header is present and is a valid JWT
- The `htm` claim matches the HTTP method
- The `htu` claim matches the request URL
- The `iat` claim is within the configured lifetime
- The `jti` claim has not been seen before (replay detection)

### Setup

::: info Additional dependency
`DPoPTokenType` requires a JWK verification function. Install `@saurbit/oauth2-jwt` (which wraps [jose](https://github.com/panva/jose)) to get a ready-made implementation.
:::

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

### Usage

```ts
import { createInMemoryReplayStore, DPoPTokenType } from "@saurbit/oauth2";
import { verifyJwk } from "@saurbit/oauth2-jwt";

const dpop = new DPoPTokenType(
  verifyJwk,
  createInMemoryReplayStore(),
);
```

Then pass it to your flow builder:

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .setTokenType(dpop)
  // ... other builder methods
  .build();
```

### Constructor

```ts
new DPoPTokenType(jwkVerify: JwkVerify, replayDetector?: ReplayDetector)
```

| Parameter        | Type              | Description                                                                  |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| `jwkVerify`      | `JwkVerify`       | A function that verifies a DPoP proof JWT against a JWK Set.                 |
| `replayDetector` | `ReplayDetector?` | An optional replay detector for JTI tracking. Defaults to an in-memory store. |

### Methods

#### `setTokenLifetime(tokenLifetime)`

```ts
.setTokenLifetime(tokenLifetime: number): this
```

Sets the maximum acceptable age of a DPoP proof in seconds. Default is `300` (5 minutes).

#### `setReplayDetector(value)`

```ts
.setReplayDetector(value: ReplayDetector): this
```

Replaces the replay detector used for JTI tracking. Use this to provide a distributed store (e.g. Redis) in multi-process deployments.

#### `validate(handler)`

```ts
.validate(handler: DPoPTokenTypeValidation): this
```

Overrides the default DPoP proof validation handler for protected resource requests. The handler receives the incoming `Request`, the DPoP-bound access token, and the configured token lifetime.

#### `validateTokenRequest(handler)`

```ts
.validateTokenRequest(handler: DPoPTokenTypeRequestValidation): this
```

Overrides the default DPoP proof validation handler for token endpoint requests. The handler receives the incoming `Request` and the configured token lifetime.

---

## Replay Detection {#replay-detection}

DPoP requires tracking `jti` claims to prevent proof replay. `@saurbit/oauth2` provides a `ReplayStore` interface and a built-in in-memory implementation.

### `InMemoryReplayStore`

Suitable for single-process deployments. Entries are automatically evicted after their TTL expires.

```ts
import { createInMemoryReplayStore } from "@saurbit/oauth2";

const store = createInMemoryReplayStore();
```

### Custom replay store

For distributed or multi-process environments, implement the `ReplayStore` interface backed by a shared store (e.g. Redis):

```ts
interface ReplayStore<T extends string | number> {
  has(value: T): Promise<boolean>;
  add(value: T, ttlSeconds: number): Promise<void>;
  delete(value: T): Promise<void>;
}
```