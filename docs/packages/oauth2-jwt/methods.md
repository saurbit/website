# JWT Methods

Ready-made functions that satisfy the `JwtVerify`, `JwtDecode`, `ClientAssertionJwtVerify`, `JwkVerify`, and `JwkThumbprintCalculator` interfaces expected by `@saurbit/oauth2`. They wrap [jose](https://github.com/panva/jose) and handle the necessary type conversions so you can plug them directly into the `@saurbit/oauth2` builders.

## `verifyJwt` {#verifyjwt}

```ts
const verifyJwt: JwtVerify
```

Verifies a JWT using the provided secret or key and returns the decoded payload. Wraps jose's [`jwtVerify`](https://github.com/panva/jose/blob/main/docs/functions/jwt_verify.jwtVerify.md).

::: tip
For verifying client assertion JWTs in `ClientSecretJwt` or `PrivateKeyJwt`, use [`verifyClientAssertionJwt`](#verifyclientassertionjwt) or [`createClientAssertionJwtVerify`](#createclientassertionjwtverify) instead — they accept the richer `ClientAssertionJwtVerify` signature and allow to enforce the claims required by RFC 7523.
:::

---

## `createJwtVerify` {#createjwtverify}

Creates a `JwtVerify` function with pre-configured claim verification options (issuer, audience, etc.). This is useful when you want to reuse the same verification settings across multiple calls without repeating them each time.

```ts
function createJwtVerify(options: JwtClaimVerificationOptions): JwtVerify
```

::: tip
For pre-configuring verification options when using `ClientSecretJwt` or `PrivateKeyJwt`, use [`createClientAssertionJwtVerify`](#createclientassertionjwtverify) instead — it accepts the full `ClientAssertionJwtContext` and `Request` for more context-aware verification.
:::

---

## `verifyClientAssertionJwt` {#verifyclientassertionjwt}

```ts
const verifyClientAssertionJwt: ClientAssertionJwtVerify
```

Verifies a client assertion JWT using the provided secret or key and returns the decoded payload. Wraps jose's `jwtVerify` and allows to enforce `issuer` and `subject` equal to `clientId` as required by [RFC 7523](https://datatracker.ietf.org/doc/html/rfc7523#section-3).

Pass this as the `ClientAssertionJwtVerify` argument to [`ClientSecretJwt`](/packages/oauth2/client-auth-methods#client-secret-jwt) or [`PrivateKeyJwt`](/packages/oauth2/client-auth-methods#private-key-jwt).

### Usage with `ClientSecretJwt`

```ts
import { ClientSecretJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyClientAssertionJwt } from "@saurbit/oauth2-jwt";

const clientSecretJwt = new ClientSecretJwt(decodeJwt, verifyClientAssertionJwt)
  .addAlgorithm(ClientSecretJwt.algo.HS256)
  .getClientSecret(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.secret ?? null;
  });
```

### Usage with `PrivateKeyJwt`

```ts
import { PrivateKeyJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyClientAssertionJwt } from "@saurbit/oauth2-jwt";

const privateKeyJwt = new PrivateKeyJwt(decodeJwt, verifyClientAssertionJwt)
  .addAlgorithm(PrivateKeyJwt.algo.RS256)
  .getPublicKeyForClient(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.publicKey ?? null;
  });
```

---

## `createClientAssertionJwtVerify` {#createclientassertionjwtverify}

Creates a `ClientAssertionJwtVerify` function with pre-configured claim verification options. Useful when you need to enforce additional claims (e.g. `audience`) beyond the default `iss`/`sub` enforcement, or when verification options depend on the request context.

```ts
// Static options
function createClientAssertionJwtVerify(
  options: JwtClaimVerificationOptions,
): ClientAssertionJwtVerify;

// Dynamic options from context
function createClientAssertionJwtVerify(
  callback: (context: ClientAssertionJwtContext, request: Request, key: Uint8Array | object, options?: { algorithms?: string[] }) => JwtClaimVerificationOptions | Promise<JwtClaimVerificationOptions>,
): ClientAssertionJwtVerify;
```

### Usage with static options

```ts
import { ClientSecretJwt } from "@saurbit/oauth2";
import { createClientAssertionJwtVerify, decodeJwt } from "@saurbit/oauth2-jwt";

const verifyClientAssertion = createClientAssertionJwtVerify({
  audience: "https://auth.example.com/token",
});

const clientSecretJwt = new ClientSecretJwt(decodeJwt, verifyClientAssertion)
  .addAlgorithm(ClientSecretJwt.algo.HS256)
  .getClientSecret(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.secret ?? null;
  });
```

### Usage with dynamic options

```ts
import { PrivateKeyJwt } from "@saurbit/oauth2";
import { createClientAssertionJwtVerify, decodeJwt } from "@saurbit/oauth2-jwt";

const verifyClientAssertion = createClientAssertionJwtVerify(
  async (context, request) => {
    const url = new URL(request.url);
    return {
      audience: url.origin + url.pathname,
      issuer: context.clientId,
    };
  },
);

const privateKeyJwt = new PrivateKeyJwt(decodeJwt, verifyClientAssertion)
  .addAlgorithm(PrivateKeyJwt.algo.ES256)
  .getPublicKeyForClient(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.publicKey ?? null;
  });
```

---

## `decodeJwt` {#decodejwt}

```ts
const decodeJwt: JwtDecode
```

Decodes a JWT payload **without** verifying its signature. Wraps jose's [`decodeJwt`](https://github.com/panva/jose/blob/main/docs/functions/jwt_decode.decodeJwt.md).

Pass this as the `JwtDecode` argument to [`ClientSecretJwt`](/packages/oauth2/client-auth-methods#client-secret-jwt) or [`PrivateKeyJwt`](/packages/oauth2/client-auth-methods#private-key-jwt) alongside [`verifyClientAssertionJwt`](#verifyclientassertionjwt).

::: warning
This function does not validate the token's signature, expiration, or any other claims. Use it only to inspect the token payload before verification, as done internally by `ClientSecretJwt` and `PrivateKeyJwt` to extract the `client_id` from the assertion.
:::

---

## `verifyJwk` {#verifyjwk}

```ts
const verifyJwk: JwkVerify
```

Verifies a JWT whose header embeds the public key as a JWK (`"jwk"` header parameter). The public key is extracted from the JWT header itself and used to verify the signature. Only the `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, and `PS512` algorithms are accepted.

Pass this as the `JwkVerify` argument to [`DPoPTokenType`](/packages/oauth2/token-types#dpop).

### Usage with `DPoPTokenType`

```ts
import { createInMemoryReplayStore, DPoPTokenType } from "@saurbit/oauth2";
import { calculateJwkThumbprint, verifyJwk } from "@saurbit/oauth2-jwt";

const dpop = new DPoPTokenType(verifyJwk, calculateJwkThumbprint, createInMemoryReplayStore());
```

Then pass it to your flow builder:

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .setTokenType(dpop)
  // ... other builder methods
  .build();
```

---

## `createDPoPJwkVerify` {#createdpopjwkverify}

Creates a `JwkVerify` function with a custom set of allowed algorithms. This is useful if you want to restrict the algorithms accepted for DPoP token validation.

```ts
const createDPoPJwkVerify: (config?: DPoPJwkVerifierConfig) => JwkVerify
```

### Usage with `DPoPTokenType`

```ts
import { createInMemoryReplayStore, DPoPTokenType } from "@saurbit/oauth2";
import { calculateJwkThumbprint, createDPoPJwkVerify } from "@saurbit/oauth2-jwt";

const dpop = new DPoPTokenType(
  createDPoPJwkVerify(["ES256", "PS256"]), 
  calculateJwkThumbprint, 
  createInMemoryReplayStore()
);
```

---

## `calculateJwkThumbprint` {#calculatejwkthumbprint}

```ts
const calculateJwkThumbprint: JwkThumbprintCalculator
```

Calculates the SHA-256 JWK thumbprint for a given JSON Web Key. The result is a base64url-encoded string that uniquely identifies the key. Wraps jose's `calculateJwkThumbprint`.

Pass this as the `JwkThumbprintCalculator` argument to [`DPoPTokenType`](/packages/oauth2/token-types#dpop).

### Usage in an Authorization Code Flow

```ts
import { AuthorizationCodeFlowBuilder, DPoPTokenType, createInMemoryReplayStore,  } from "@saurbit/oauth2";
import { JoseJwksAuthority, calculateJwkThumbprint, createInMemoryKeyStore, verifyJwk } from "@saurbit/oauth2-jwt";

// key store and authority
const jwksAuthority = new JoseJwksAuthority(createInMemoryKeyStore(), 8.64e6);

// token type
const dpop = new DPoPTokenType(verifyJwk, calculateJwkThumbprint, createInMemoryReplayStore());

// flow builder
const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  // set the DPoP token type for the flow
  .setTokenType(dpop)
  // handle token verification
  .verifyToken(async (_, { token, tokenTypeValidation }) => {
    
    // verify the JWT and extract its payload
    const jwtAccessTokenPayload = await jwksAuthority.verify(token);
    
    try {
      // validate the DPoP proof and its thumbprint
      dpop.validateThumbprint(tokenTypeValidation, jwtAccessTokenPayload);
    } catch (error) {
      // If the DPoP proof is invalid or the thumbprint does not match, return an invalid token response.
      return { isValid: false, message: error.message };
    }

    // ... additional validation logic ...
  })
  // ... other builder methods
  .build();

```
