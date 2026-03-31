# JoseJwksAuthority

The main JWT authority class, backed by [jose](https://github.com/panva/jose). It manages RS256 signing key pairs, signs and verifies JWTs, and returns the JWKS endpoint payload.

Keys are stored in a [`JwksKeyStore`](#jwkskeystore-interface) and generated automatically on first use. When a new key pair is generated, the previous public key remains available in the JWKS until its TTL expires, so in-flight tokens continue to verify.

## Constructor

```ts
new JoseJwksAuthority(store: JwksKeyStore, ttl?: number)
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `store` | `JwksKeyStore` | — | The key store used to persist key pairs. Use [`createInMemoryKeyStore()`](./in-memory-key-store) for single-process deployments. |
| `ttl` | `number` | `36000` | Time-to-live for public keys in **seconds**. After this duration, a public key is no longer returned by the JWKS endpoint. |

```ts
import { createInMemoryKeyStore, JoseJwksAuthority } from "@saurbit/oauth2-jwt";

const store = createInMemoryKeyStore();
const authority = new JoseJwksAuthority(store, 8.64e6); // 100-day TTL
```

## Methods

### `sign(payload)` {#sign}

```ts
.sign(payload: JWTPayload): Promise<{ token: string; kid: string }>
```

Signs the given payload as a JWT using the current RS256 private key. The key's `kid` is included in the JWT header so verifiers can select the correct public key from the JWKS.

If no key pair exists yet, one is generated automatically.

```ts
const { token, kid } = await authority.sign({
  sub: "user-123",
  iss: "https://auth.example.com",
  aud: "my-client",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  jti: crypto.randomUUID(),
});
```

---

### `verify(token)` {#verify}

```ts
.verify<P extends JWTPayload = JWTPayload>(token: string): Promise<P>
```

Verifies a JWT against the matching public key from the JWKS. The `kid` in the JWT header is used to look up the correct key.

Additional security checks are performed:

- Algorithm must be `RS256`
- No embedded `jwk` in the protected header (prevents key injection)
- `typ` must be `"jwt"` if present

```ts
const payload = await authority.verify(token);
console.log(payload.sub); // "user-123"
```

---

### `signMany(payloads)` {#sign-many}

```ts
.signMany(payloads: JWTPayload[]): Promise<{ token: string; kid: string }[]>
```

Signs multiple payloads with the same private key in a single call. All resulting tokens share the same `kid` and can be verified against the same public key.

Useful for batch operations like issuing both an access token and an ID token at once.

```ts
const [accessToken, idToken] = await authority.signMany([
  { sub: "user-123", scope: "openid profile", ...registeredClaims },
  { name: "John Doe", email: "john@example.com", ...registeredClaims },
]);
```

---

### `getJwksEndpointResponse()` {#get-jwks-endpoint-response}

```ts
.getJwksEndpointResponse(): Promise<{ keys: RawKey[] }>
```

Returns the current set of public keys in [JWKS format](https://www.rfc-editor.org/rfc/rfc7517), ready to be served as JSON at a well-known endpoint (e.g. `/.well-known/jwks.json`).

```ts
// Example with Hono
app.get("/jwks", async (c) => {
  return c.json(await authority.getJwksEndpointResponse());
});
```

```ts
// Example with Express
app.get("/jwks", async (req, res) => {
  res.json(await authority.getJwksEndpointResponse());
});
```

---

### `getPublicKeys()` {#get-public-keys}

```ts
.getPublicKeys(): Promise<{ keys: RawKey[] }>
```

Retrieves all currently valid (non-expired) public keys from the key store. This is the same data returned by [`getJwksEndpointResponse()`](#get-jwks-endpoint-response).

---

### `getPublicKey(kid)` {#get-public-key}

```ts
.getPublicKey(kid: string): Promise<RSA | undefined>
```

Retrieves a specific public key by its key ID. Returns `undefined` if no key with the given `kid` exists or if the key is not an RSA key.

---

### `getCurrentKid()` {#get-current-kid}

```ts
.getCurrentKid(): Promise<string | undefined>
```

Returns the `kid` of the current active signing key. Useful for observability and debugging.

---

### `generateKeyPair()` {#generate-key-pair}

```ts
.generateKeyPair(): Promise<void>
```

Generates a new RS256 key pair, stores it, and makes the public key available in the JWKS. The new key becomes the active signing key. You typically don't call this directly — use [`JwksRotator`](./jwks-rotator) instead.

---

## `JwksKeyStore` Interface {#jwkskeystore-interface}

`JoseJwksAuthority` delegates all key persistence to a `JwksKeyStore`. The built-in [`InMemoryKeyStore`](./in-memory-key-store) is suitable for single-process deployments. For distributed environments, implement this interface backed by a shared store (e.g. Redis, database).

```ts
interface JwksKeyStore {
  /** Store the active private key and its corresponding public key with a TTL. */
  storeKeyPair(
    kid: string,
    privateKey: object,
    publicKey: object,
    ttl: number,
  ): void | Promise<void>;

  /** Retrieve the current private key used for signing. */
  getPrivateKey(): Promise<object | undefined>;

  /** Retrieve all non-expired public keys for JWKS exposure. */
  getPublicKeys(): Promise<object[]>;
}
```

| Method | Description |
| --- | --- |
| `storeKeyPair(kid, privateKey, publicKey, ttl)` | Persists a key pair. The `ttl` is in seconds. The public key should be returned by `getPublicKeys()` until it expires. |
| `getPrivateKey()` | Returns the current private key, or `undefined` if none exists. |
| `getPublicKeys()` | Returns all non-expired public keys. Expired keys should be pruned. |
