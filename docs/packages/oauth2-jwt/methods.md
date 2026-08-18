# JWT Methods

Four ready-made functions that satisfy the `JwtVerify`, `JwtDecode`, `JwkVerify`, and `JwkThumbprintCalculator` interfaces expected by `@saurbit/oauth2`. They wrap [jose](https://github.com/panva/jose) and handle the necessary type conversions so you can plug them directly into the `@saurbit/oauth2` builders.

## `verifyJwt` {#verifyjwt}

```ts
const verifyJwt: JwtVerify
```

Verifies a JWT using the provided secret or key and returns the decoded payload. Wraps jose's [`jwtVerify`](https://github.com/panva/jose/blob/main/docs/functions/jwt_verify.jwtVerify.md).

Pass this as the `JwtVerify` argument to [`ClientSecretJwt`](/packages/oauth2/client-auth-methods#client-secret-jwt) or [`PrivateKeyJwt`](/packages/oauth2/client-auth-methods#private-key-jwt).

### Usage with `ClientSecretJwt`

```ts
import { ClientSecretJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const clientSecretJwt = new ClientSecretJwt(decodeJwt, verifyJwt)
  .addAlgorithm(ClientSecretJwt.algo.HS256)
  .getClientSecret(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.secret ?? null;
  });
```

### Usage with `PrivateKeyJwt`

```ts
import { PrivateKeyJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const privateKeyJwt = new PrivateKeyJwt(decodeJwt, verifyJwt)
  .addAlgorithm(PrivateKeyJwt.algo.RS256)
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

Pass this as the `JwtDecode` argument to [`ClientSecretJwt`](/packages/oauth2/client-auth-methods#client-secret-jwt) or [`PrivateKeyJwt`](/packages/oauth2/client-auth-methods#private-key-jwt) alongside [`verifyJwt`](#verifyjwt).

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

## `createDPoPJwkVerifier` {#createdpopjwkverifier}

Creates a `JwkVerify` function with a custom set of allowed algorithms. This is useful if you want to restrict the algorithms accepted for DPoP token validation.

```ts
const createDPoPJwkVerifier: (config?: DPoPJwkVerifierConfig) => JwkVerify
```

### Usage with `DPoPTokenType`

```ts
import { createInMemoryReplayStore, DPoPTokenType } from "@saurbit/oauth2";
import { calculateJwkThumbprint, createDPoPJwkVerifier } from "@saurbit/oauth2-jwt";

const dpop = new DPoPTokenType(
  createDPoPJwkVerifier(["ES256", "PS256"]), 
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
