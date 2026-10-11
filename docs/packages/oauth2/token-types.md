# Token Types

`@saurbit/oauth2` uses token types to determine how access tokens are presented in the `Authorization` header and how they are validated on both the token endpoint and protected resource endpoints.

You set the token type on any flow builder using [`setTokenType()`](./builders#common-configuration). If not set, `BearerTokenType` is used by default.

## Overview

| Token Type       | Class              | Spec                                                             | Description                                              |
| ---------------- | ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `Bearer`         | `BearerTokenType`  | [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750)       | Standard bearer token — possession alone grants access.  |
| `DPoP`           | `DPoPTokenType`    | [RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449)       | Proof-of-possession token bound to a client key pair.    |
| `Bearer` (mTLS)  | `MtlsCertificateBoundTokenType` | [RFC 8705](https://datatracker.ietf.org/doc/html/rfc8705) | Access (and optionally refresh) token bound to the client's TLS certificate. |

## `TokenType` Interface

All built-in token types implement the `TokenType` interface. You can provide your own implementation to support additional token schemes.

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
    ctxt: { grantType: "refresh_token"; refreshToken: string } | { grantType: string },
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
import { calculateJwkThumbprint, verifyJwk } from "@saurbit/oauth2-jwt";

const dpop = new DPoPTokenType(
  verifyJwk,
  calculateJwkThumbprint,
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
new DPoPTokenType(jwkVerify: JwkVerify, jwkThumbprintCalculator: JwkThumbprintCalculator, replayDetector?: ReplayDetector)
```

| Parameter                 | Type                       | Description                                                                   |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `jwkVerify`               | `JwkVerify`                | A function that verifies a DPoP proof JWT against a JWK Set.                  |
| `jwkThumbprintCalculator` | `JwkThumbprintCalculator`  | A function that calculates the JWK thumbprint for a given JWK.                |
| `replayDetector`          | `ReplayDetector?`          | An optional replay detector for JTI tracking. Defaults to an in-memory store. |

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

#### `addJwkThumbprintToCnfClaim(claims, thumbprint)`

```ts
.addJwkThumbprintToCnfClaim(claims: JwtPayload, thumbprint: string): JwtPayload
.addJwkThumbprintToCnfClaim(claims: JwtPayload, response: TokenTypeValidationResponse): JwtPayload
```

Adds the JWK thumbprint to the `cnf.jkt` claim of a JWT payload, binding the access token to the client's public key. Call this when issuing a DPoP-bound access token.

The second argument is either:
- A `string` — the raw JWK thumbprint.
- A `TokenTypeValidationResponse` — the validation response returned by `isValidTokenRequest`, from which the thumbprint is extracted automatically.

```ts
// With a raw thumbprint string
dpop.addJwkThumbprintToCnfClaim(claims, "the-jwk-thumbprint");

// With a validation response
dpop.addJwkThumbprintToCnfClaim(claims, tokenTypeValidationResponse);
```

Throws if the thumbprint cannot be added to the payload.

#### `validateThumbprint(response, thumbprint)`

```ts
.validateThumbprint(response: TokenTypeValidationResponse, thumbprint: string): boolean
.validateThumbprint(response: TokenTypeValidationResponse, payload: JwtPayload): boolean
```

Validates that the JWK thumbprint in a `TokenTypeValidationResponse` matches an expected value. Use this on protected resource endpoints to verify that the DPoP proof was created with the same key that the access token was bound to.

The second argument is either:
- A `string` — the expected JWK thumbprint.
- A `JwtPayload` object — the access token payload containing the `cnf.jkt` claim.

```ts
// With a raw thumbprint string
dpop.validateThumbprint(tokenTypeValidationResponse, "the-jwk-thumbprint");

// With an access token payload
dpop.validateThumbprint(tokenTypeValidationResponse, accessTokenPayload);
```

Throws if the response is invalid or the thumbprint does not match.

#### `validateAccessTokenHash(response, accessToken)`

```ts
.validateAccessTokenHash(response: TokenTypeValidationResponse, accessToken: string): Promise<void>
```

Validates the access token hash (`ath`) in a DPoP proof against the provided access token. Use this on protected resource endpoints to confirm that the DPoP proof was created for the specific access token presented in the request.

Throws if the response is invalid, if the `ath` claim is missing from the DPoP proof payload, or if the computed hash does not match the `ath` claim.

```ts
await dpop.validateAccessTokenHash(tokenTypeValidationResponse, accessToken);
```

---

## `MtlsCertificateBoundTokenType` {#mtls}

Implements [certificate-bound access tokens](https://datatracker.ietf.org/doc/html/rfc8705#section-3) (OAuth 2.0 Mutual TLS, RFC 8705). The access token is bound to the client's TLS certificate through the `cnf` claim: it carries the certificate's SHA-256 thumbprint in `cnf["x5t#S256"]`, and is only accepted when the request presents the same certificate. A stolen token is useless without the matching private key.

The token is still sent as a bearer token, so the `Authorization` header prefix is `Bearer`.

Refresh tokens can optionally be bound to the certificate as well, so `refresh_token` grant requests are accepted only from the certificate the refresh token was issued to.

::: info Reverse proxy required
`@saurbit/oauth2` does not terminate TLS. The reverse proxy in front of your server must forward the client certificate in a request header (by default `x-ssl-client-cert`), and must overwrite that header on every request so it cannot be forged. See [Self-Signed TLS Client Authentication](/packages/oauth2/self-signed-tls-client-auth#proxy-setup).
:::

### How it works {#mtls-how-it-works}

1. **Issuing:** at the token endpoint, compute the thumbprint of the presented certificate and add it to the access token claims with `applyBinding()` before signing. If the refresh token is bound too, add the same binding to the stored refresh token data.
2. **Validating on protected resources:** `isValid()` reads the certificate from the header, decodes the token with your `decodeTokenPayload` callback, checks that `cnf["x5t#S256"]` is present, and compares it with the thumbprint of the presented certificate.
3. **Validating refresh requests:** when `boundRefreshToken` is `true`, `isValidTokenRequest()` does the same check for `refresh_token` grants, using the refresh token.

### Usage

The token type is usually created from [`SelfSignedTlsClientAuthMethod.createCertificateBoundTokenType()`](/packages/oauth2/self-signed-tls-client-auth#create-bound-token-type), which reuses the method's certificate header name. It can also be instantiated directly, for example with another client authentication method:

```ts
import { AuthorizationCodeFlowBuilder, MtlsCertificateBoundTokenType } from "@saurbit/oauth2";

const mtlsTokenType = new MtlsCertificateBoundTokenType(
  async (token, isRefreshToken) => {
    // Return the verified payload, or undefined when invalid
    if (isRefreshToken) return await getRefreshTokenData(token);
    return await jwksAuthority.verify(token);
  },
  true, // also bind refresh tokens
  "x-ssl-client-cert",
);

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .setTokenType(mtlsTokenType)
  // ... other builder methods
  .build();
```

### Constructor

```ts
new MtlsCertificateBoundTokenType(
  decodeTokenPayload: MtlsJwtDecode,
  boundRefreshToken?: boolean,
  certHeaderName?: string,
)
```

| Parameter            | Type             | Default             | Description                                                                                         |
| -------------------- | ---------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `decodeTokenPayload` | `MtlsJwtDecode`  | —                   | Decodes **and verifies** the token. Called with the access token, or with the refresh token and `isRefreshToken = true`. Returns the payload or `undefined`. |
| `boundRefreshToken`  | `boolean`        | `false`             | Whether refresh tokens are also bound to the client certificate.                                     |
| `certHeaderName`     | `string`         | `x-ssl-client-cert` | Header carrying the (URL-encoded) PEM client certificate.                                            |

```ts
type MtlsJwtPayload = JwtPayload & { cnf?: { "x5t#S256"?: string } };

type MtlsJwtDecode = (
  token: string,
  isRefreshToken: boolean,
) => Promise<MtlsJwtPayload | undefined> | MtlsJwtPayload | undefined;
```

::: warning
`decodeTokenPayload` is responsible for verifying the token (signature, expiration, …), not just decoding it. The token type only checks the certificate binding. A bound refresh token's payload must also carry the `cnf` claim: store it with the refresh token using `applyBinding()`.
:::

### Methods

#### `isValid(request, token)`

```ts
.isValid(request: Request, token: string): Promise<CertificateBoundValidationResponse>
```

Validates the access token on a protected resource request. Returns `isValid: false` with a `message` when the token is missing, the certificate header is absent, the payload can't be decoded, the `cnf["x5t#S256"]` claim is missing, or the thumbprint doesn't match the presented certificate.

On success, the response exposes the verified payload and the thumbprint in `data`:

```ts
interface CertificateBoundValidationResponse extends TokenTypeValidationResponse {
  data?: {
    mtlsPayload: JwtPayload;
    mtlsThumbprint?: string;
  };
}
```

In a flow builder's `verifyToken`, this is the `tokenTypeValidation` argument:

```ts
.verifyToken(async (request, { tokenTypeValidation }) => {
  const payload = (tokenTypeValidation as CertificateBoundValidationResponse).data?.mtlsPayload;
  // ... look up the user, return credentials
})
```

#### `isValidTokenRequest(request, ctxt)`

```ts
.isValidTokenRequest(
  request: Request,
  ctxt: { grantType: string; refreshToken?: string },
): Promise<CertificateBoundValidationResponse>
```

Validates the token endpoint request. It only checks `refresh_token` grants, and only when `boundRefreshToken` is `true`: the refresh token must be present and bound to the presented certificate. Every other request is considered valid.

#### `applyBinding(claims, pemOrThumbprint)`

```ts
.applyBinding(claims: JwtPayload, pemOrThumbprint: string): Promise<JwtPayload>
```

Adds the certificate thumbprint to the `cnf["x5t#S256"]` claim of `claims` and returns it. The second argument is either a PEM certificate (plain or URL-encoded, as forwarded by the proxy) or an already computed thumbprint. Call this when issuing the access token, and when storing a bound refresh token.

```ts
const { x5tS256 } = await mtlsTokenType.computeThumbprint(clientCertPem);

const claims = await mtlsTokenType.applyBinding(
  { sub: userId, aud: clientId, exp, iat },
  x5tS256,
);
const { token } = await jwksAuthority.sign(claims);

// Bind the stored refresh token to the same certificate
await storeRefreshToken(refreshToken, {
  clientId,
  userId,
  ...(await mtlsTokenType.applyBinding({}, x5tS256)),
});
```

#### `addThumbprintToCnfClaim(claims, thumbprint)`

```ts
.addThumbprintToCnfClaim(claims: JwtPayload, thumbprint: string): JwtPayload
```

Lower-level variant of `applyBinding()` taking a precomputed thumbprint. Throws if `claims` isn't an object or `thumbprint` isn't a non-empty string.

#### Thumbprint helpers

| Method                       | Returns                  | Description                                                                          |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `computeThumbprint(pem)`     | `Promise<{ x5tS256 }>`   | The base64url SHA-256 thumbprint of the certificate, wrapped in an object.           |
| `calculateX5tS256(pem)`      | `Promise<string>`        | The RFC 8705 base64url SHA-256 thumbprint of the certificate.                        |
| `calculateHexThumbprint(pem)` | `Promise<string>`       | The lowercase hexadecimal SHA-256 thumbprint. Not part of the binding process, useful for logging or comparisons. |

All helpers accept a plain or URL-encoded PEM certificate.

### Complete example

See [Self-Signed TLS Client Authentication](/packages/oauth2/self-signed-tls-client-auth#server-example) for a complete authorization server using this token type, and its [Docker Compose example](/packages/oauth2/self-signed-tls-client-auth#docker-example).

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