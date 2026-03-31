# InMemoryKeyStore

An in-memory implementation of both [`JwksKeyStore`](./jose-jwks-authority#jwkskeystore-interface) and [`JwksRotationTimestampStore`](./jwks-rotator#jwksrotationtimestampstore-interface).

Suitable for single-process deployments and testing. State is not shared across processes and is lost on restart. For distributed or multi-process environments, implement the `JwksKeyStore` and `JwksRotationTimestampStore` interfaces backed by a shared store (e.g. Redis, database).

## `createInMemoryKeyStore()` {#factory}

```ts
function createInMemoryKeyStore(): InMemoryKeyStore
```

Creates a new `InMemoryKeyStore` instance with no keys stored. This is the recommended way to create a store.

```ts
import { createInMemoryKeyStore } from "@saurbit/oauth2-jwt";

const store = createInMemoryKeyStore();
```

The returned instance can be passed to both [`JoseJwksAuthority`](./jose-jwks-authority) (as the `JwksKeyStore`) and [`JwksRotator`](./jwks-rotator) (as the `JwksRotationTimestampStore`):

```ts
import {
  createInMemoryKeyStore,
  JoseJwksAuthority,
  JwksRotator,
} from "@saurbit/oauth2-jwt";

const store = createInMemoryKeyStore();
const authority = new JoseJwksAuthority(store, 8.64e6);

const rotator = new JwksRotator({
  keyGenerator: authority,
  rotatorKeyStore: store, // same instance, different interface
  rotationIntervalMs: 7.884e9,
});
```

## Methods

### `storeKeyPair(kid, privateKey, publicKey, ttl)`

```ts
.storeKeyPair(kid: string, privateKey: object, publicKey: object, ttl: number): Promise<void>
```

Stores a key pair. The private key replaces the existing one; the public key is appended to the list with an expiry computed from `ttl` (in seconds).

---

### `getPrivateKey()`

```ts
.getPrivateKey(): Promise<object | undefined>
```

Returns the current private key, or `undefined` if no key has been stored yet.

---

### `getPublicKeys()`

```ts
.getPublicKeys(): Promise<object[]>
```

Returns all non-expired public keys. Expired keys are automatically pruned on each call.

---

### `getLastRotationTimestamp()`

```ts
.getLastRotationTimestamp(): Promise<number>
```

Returns the Unix timestamp (in milliseconds) of the last key rotation, or `0` if no rotation has occurred.

---

### `setLastRotationTimestamp(msDate)`

```ts
.setLastRotationTimestamp(msDate: number): Promise<void>
```

Stores the Unix timestamp (in milliseconds) of the most recent key rotation.

## Custom Key Store

For distributed deployments, implement the [`JwksKeyStore`](./jose-jwks-authority#jwkskeystore-interface) and [`JwksRotationTimestampStore`](./jwks-rotator#jwksrotationtimestampstore-interface) interfaces backed by a shared store. A Redis-based implementation, for example, would use separate keys for the private key, the public key list, and the rotation timestamp with appropriate TTLs.
