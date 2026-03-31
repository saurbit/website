# JwksRotator

Manages automatic JWKS key rotation based on a configurable interval. Call `checkAndRotateKeys()` at service startup and/or on a recurring schedule to ensure that signing keys are rotated before they expire.

During rotation, a new key pair is generated and the previous public key remains available in the JWKS until its TTL expires, so in-flight tokens continue to verify correctly.

## Constructor

```ts
new JwksRotator(options: JwksRotatorOptions)
```

### `JwksRotatorOptions`

```ts
interface JwksRotatorOptions {
  keyGenerator: KeyGenerator;
  rotatorKeyStore: JwksRotationTimestampStore;
  rotationIntervalMs: number;
}
```

| Property | Type | Description |
| --- | --- | --- |
| `keyGenerator` | `KeyGenerator` | The key generator that produces new signing key pairs. [`JoseJwksAuthority`](./jose-jwks-authority) implements this interface. |
| `rotatorKeyStore` | `JwksRotationTimestampStore` | The store that tracks the last rotation timestamp. [`InMemoryKeyStore`](./in-memory-key-store) implements this interface. |
| `rotationIntervalMs` | `number` | How often (in milliseconds) new keys should be generated. For example, `7.884e9` for ~91 days. |

### Setup

```ts
import {
  createInMemoryKeyStore,
  JoseJwksAuthority,
  JwksRotator,
} from "@saurbit/oauth2-jwt";

const store = createInMemoryKeyStore();
const authority = new JoseJwksAuthority(store, 8.64e6); // 100-day key TTL

const rotator = new JwksRotator({
  keyGenerator: authority,
  rotatorKeyStore: store,
  rotationIntervalMs: 7.884e9, // 91 days
});
```

::: tip Choosing intervals
Set `rotationIntervalMs` shorter than the authority's `ttl` so the old public key remains available long enough for any JWT signed just before rotation to still verify. For example, if the TTL is 100 days and the rotation interval is 91 days, there's a ~9 day overlap.
:::

## Methods

### `checkAndRotateKeys()` {#check-and-rotate-keys}

```ts
.checkAndRotateKeys(): Promise<void>
```

Checks whether the rotation interval has elapsed since the last rotation. If it has, generates a new key pair and updates the stored timestamp. Otherwise, the call is a no-op.

```ts
// At startup
await rotator.checkAndRotateKeys();
```

You can also call it on a recurring schedule to ensure rotation happens even for long-running processes:

```ts
// Every hour
setInterval(async () => {
  await rotator.checkAndRotateKeys();
}, 60 * 60 * 1000);
```

---

## `JwksRotationTimestampStore` Interface {#jwksrotationtimestampstore-interface}

`JwksRotator` delegates rotation timestamp persistence to a `JwksRotationTimestampStore`. The built-in [`InMemoryKeyStore`](./in-memory-key-store) implements this interface. For distributed environments, implement it backed by a shared store.

```ts
interface JwksRotationTimestampStore {
  /** Returns the Unix timestamp (ms) of the last rotation, or 0 if none. */
  getLastRotationTimestamp(): Promise<number>;

  /** Stores the Unix timestamp (ms) of the most recent rotation. */
  setLastRotationTimestamp(rotationTimestamp: number): Promise<void>;
}
```

---

## `KeyGenerator` Interface {#keygenerator-interface}

The interface consumed by `JwksRotator` to generate new key pairs. [`JoseJwksAuthority`](./jose-jwks-authority) implements it.

```ts
interface KeyGenerator {
  generateKeyPair(): Promise<void>;
}
```
