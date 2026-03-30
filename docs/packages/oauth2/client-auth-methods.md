# Client Authentication Methods

`@saurbit/oauth2` supports five client authentication methods defined by OAuth 2.0 and OpenID Connect. Each method determines how a client proves its identity at the token endpoint.

You register methods on any flow builder using `addClientAuthenticationMethod()` or the shortcut methods. You can also pass a `ClientAuthMethod` instance directly for the JWT-based methods.

## Overview

| Method                | Class                | Secret required | Description                                                  |
| --------------------- | -------------------- | --------------- | ------------------------------------------------------------ |
| `client_secret_basic` | `ClientSecretBasic`  | Yes             | HTTP Basic authentication header.                            |
| `client_secret_post`  | `ClientSecretPost`   | Yes             | Client ID and secret in the request body.                    |
| `none`                | `NoneAuthMethod`     | No              | Public clients — client ID only, no secret.                  |
| `client_secret_jwt`   | `ClientSecretJwt`    | Yes             | JWT assertion signed with a shared secret (HMAC).            |
| `private_key_jwt`     | `PrivateKeyJwt`      | Yes             | JWT assertion signed with the client's private key (asymmetric). |

---

## `client_secret_basic` {#client-secret-basic}

The client sends its credentials via the `Authorization: Basic` header, where the value is `base64(client_id:client_secret)`.

This is the most widely used method for confidential clients.

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .addClientAuthenticationMethod("client_secret_basic")
  // or use the shortcut:
  // .clientSecretBasicAuthenticationMethod()
  // ... other builder methods
  .build();
```

The client authenticates like this:

```
POST /token HTTP/1.1
Authorization: Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=abc123
```

---

## `client_secret_post` {#client-secret-post}

The client sends `client_id` and `client_secret` as parameters in the request body (form-urlencoded or JSON).

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .addClientAuthenticationMethod("client_secret_post")
  // or use the shortcut:
  // .clientSecretPostAuthenticationMethod()
  // ... other builder methods
  .build();
```

The client authenticates like this:

```
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=abc123&client_id=my-client&client_secret=my-secret
```

---

## `none` {#none}

For public clients (e.g. native apps, SPAs) that cannot securely store a secret. Only the `client_id` is extracted from the request body — no secret is required.

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .addClientAuthenticationMethod("none")
  // or use the shortcut:
  // .noneAuthenticationMethod()
  // ... other builder methods
  .build();
```

::: warning
When using `none` with the Authorization Code flow, PKCE is **required** to protect against code interception attacks. For the Client Credentials flow, `none` has no effect since the client must always authenticate with a secret.
:::

The client authenticates like this:

```
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=abc123&client_id=my-public-client&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

---

## `client_secret_jwt` {#client-secret-jwt}

The client creates a JWT signed with its client secret using an HMAC algorithm and sends it as a `client_assertion` in the request body. The server verifies the signature using the same shared secret.

::: info Additional dependency
`ClientSecretJwt` requires JWT decode/verify functions. Install `@saurbit/oauth2-jwt` (which wraps [jose](https://github.com/panva/jose)) to get ready-made implementations.
:::

### Setup

```ts
import { ClientSecretJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const clientSecretJwt = new ClientSecretJwt(decodeJwt, verifyJwt);
```

### Configuration

#### `addAlgorithm(algo)`

```ts
clientSecretJwt.addAlgorithm(ClientSecretJwt.algo.HS256);
clientSecretJwt.addAlgorithm(ClientSecretJwt.algo.HS384);
```

Adds an HMAC algorithm to the accepted list. Available algorithms:

| Algorithm | Description          |
| --------- | -------------------- |
| `HS256`   | HMAC using SHA-256.  |
| `HS384`   | HMAC using SHA-384.  |
| `HS512`   | HMAC using SHA-512.  |

If no algorithms are added, defaults to `HS256`.

#### `getClientSecret(handler)`

```ts
clientSecretJwt.getClientSecret(async (clientId, decoded, clientAssertion) => {
  const client = await db.findClientById(clientId);
  if (!client) return null;
  return client.secret; // string or Uint8Array
});
```

Registers the handler that retrieves the client's secret for JWT signature verification. The handler receives:

| Parameter         | Type         | Description                                        |
| ----------------- | ------------ | -------------------------------------------------- |
| `clientId`        | `string`     | The client ID extracted from the JWT `aud` claim.  |
| `decoded`         | `JwtPayload` | The decoded (unverified) JWT payload.              |
| `clientAssertion` | `string`     | The raw JWT assertion string.                      |

Return the client secret as a `string` or `Uint8Array`, or `null` if the client is not found.

### Full example

```ts
import { AuthorizationCodeFlowBuilder, ClientSecretJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const clientSecretJwt = new ClientSecretJwt(decodeJwt, verifyJwt)
  .addAlgorithm(ClientSecretJwt.algo.HS256)
  .getClientSecret(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.secret ?? null;
  });

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .addClientAuthenticationMethod(clientSecretJwt)
  // ... other builder methods
  .build();
```

The client authenticates like this:

```
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=abc123&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&client_assertion=eyJhbGciOiJIUzI1NiJ9...
```

---

## `private_key_jwt` {#private-key-jwt}

The client creates a JWT signed with its private key and sends it as a `client_assertion` in the request body. The server verifies the signature using the client's corresponding public key.

::: info Additional dependency
`PrivateKeyJwt` requires JWT decode/verify functions. Install `@saurbit/oauth2-jwt` (which wraps [jose](https://github.com/panva/jose)) to get ready-made implementations.
:::

### Setup

```ts
import { PrivateKeyJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const privateKeyJwt = new PrivateKeyJwt(decodeJwt, verifyJwt);
```

### Configuration

#### `addAlgorithm(algo)`

```ts
privateKeyJwt.addAlgorithm(PrivateKeyJwt.algo.RS256);
privateKeyJwt.addAlgorithm(PrivateKeyJwt.algo.ES256);
```

Adds an asymmetric algorithm to the accepted list. Available algorithms:

| Algorithm | Description                        |
| --------- | ---------------------------------- |
| `RS256`   | RSASSA-PKCS1-v1_5 using SHA-256.  |
| `RS384`   | RSASSA-PKCS1-v1_5 using SHA-384.  |
| `RS512`   | RSASSA-PKCS1-v1_5 using SHA-512.  |
| `PS256`   | RSASSA-PSS using SHA-256.          |
| `PS384`   | RSASSA-PSS using SHA-384.          |
| `PS512`   | RSASSA-PSS using SHA-512.          |
| `ES256`   | ECDSA using P-256 and SHA-256.     |
| `ES384`   | ECDSA using P-384 and SHA-384.     |
| `ES512`   | ECDSA using P-521 and SHA-512.     |
| `EdDSA`   | Edwards-curve DSA (Ed25519/Ed448). |

If no algorithms are added, defaults to `RS256`.

#### `getPublicKeyForClient(handler)`

```ts
privateKeyJwt.getPublicKeyForClient(async (clientId, decoded, clientAssertion) => {
  const client = await db.findClientById(clientId);
  if (!client) return null;
  return client.publicKey; // PEM string or Uint8Array
});
```

Registers the handler that retrieves the client's public key for JWT signature verification. The handler receives the same parameters as `getClientSecret` above.

Return the public key as a PEM `string` or `Uint8Array`, or `null` if the client is not found.

### Full example

```ts
import { AuthorizationCodeFlowBuilder, PrivateKeyJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const privateKeyJwt = new PrivateKeyJwt(decodeJwt, verifyJwt)
  .addAlgorithm(PrivateKeyJwt.algo.RS256)
  .addAlgorithm(PrivateKeyJwt.algo.ES256)
  .getPublicKeyForClient(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.publicKey ?? null;
  });

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .addClientAuthenticationMethod(privateKeyJwt)
  // ... other builder methods
  .build();
```

The client authenticates like this:

```
POST /token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=abc123&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&client_assertion=eyJhbGciOiJSUzI1NiJ9...
```

---

## Combining Multiple Methods

You can register several authentication methods on the same flow. Regardless of registration order, the flow always evaluates methods in the following fixed priority:

1. `client_secret_basic`
2. `client_secret_post`
3. `client_secret_jwt`
4. `private_key_jwt`
5. `none`

The first method that matches the incoming request is used.

```ts
import { AuthorizationCodeFlowBuilder, ClientSecretJwt } from "@saurbit/oauth2";
import { decodeJwt, verifyJwt } from "@saurbit/oauth2-jwt";

const clientSecretJwt = new ClientSecretJwt(decodeJwt, verifyJwt)
  .getClientSecret(async (clientId) => {
    const client = await db.findClientById(clientId);
    return client?.secret ?? null;
  });

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .addClientAuthenticationMethod("client_secret_basic")
  .addClientAuthenticationMethod("client_secret_post")
  .addClientAuthenticationMethod(clientSecretJwt)
  .addClientAuthenticationMethod("none")
  // ... other builder methods
  .build();
```
