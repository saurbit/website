# Device Authorization Flow

Build and configure an OAuth 2.0 Device Authorization grant (RFC 8628) using the `DeviceAuthorizationFlowBuilder`.

## Overview

The device authorization flow is designed for input-constrained devices (smart TVs, CLI tools, IoT devices) that cannot easily display a browser. It works in three steps:

1. **Device authorization endpoint** — The device requests a device code and user code from the authorization server.
2. **Verification endpoint** — The user visits a URL on a secondary device (e.g. phone or laptop) and enters the user code to authorize the device.
3. **Token endpoint** — The device polls the token endpoint with the device code until the user completes authorization, then receives an access token (and optionally a refresh token).

The `DeviceAuthorizationFlowBuilder` provides a fluent API to wire up every callback in this flow, and produces a `DeviceAuthorizationFlow` instance you can plug into your HTTP framework.

## Quick Start

```ts
import { DeviceAuthorizationFlowBuilder } from "@saurbit/oauth2";

const flow = new DeviceAuthorizationFlowBuilder({ tokenEndpoint: "/token" })
  .setAuthorizationEndpoint("/device/authorize")
  .setVerificationEndpoint("/device/verify")
  .setScopes({ "read:data": "Read access", "write:data": "Write access" })
  .addClientAuthenticationMethod("client_secret_basic")
  .getClientForAuthentication(async ({ clientId }) => {
    return db.findClient(clientId);
  })
  .generateDeviceCode(async (context) => {
    const codes = await db.createDeviceCodes(context);
    return { deviceCode: codes.deviceCode, userCode: codes.userCode };
  })
  .verifyUserCode(async (userCode) => {
    return db.findDeviceCodeByUserCode(userCode);
  })
  .getClient(async ({ clientId, clientSecret, deviceCode }) => {
    return db.findAndValidateClient(clientId, clientSecret, deviceCode);
  })
  .generateAccessToken(async (context) => {
    const status = await db.getDeviceCodeStatus(context.deviceCode);
    if (status === "pending") return { type: "error", error: "authorization_pending" };
    return { accessToken: await issueToken(context) };
  })
  .verifyToken(async (token) => {
    return await verifyAccessToken(token);
  })
  .build();
```

## Builder Methods

### Constructor

```ts
new DeviceAuthorizationFlowBuilder(params?: Partial<DeviceAuthorizationFlowOptions>)
```

Creates a new builder instance. All model callbacks default to no-op implementations — you must set them via the builder methods below before calling `.build()`.

You can pass any of the [common configuration options](./builders#common-configuration) directly in the constructor, or set them individually through the chainable setters.

---

### Endpoint Configuration

#### `setAuthorizationEndpoint(url)`

```ts
.setAuthorizationEndpoint(url: string): this
```

Sets the URL of the device authorization endpoint where the device requests a device code and user code (e.g. `/device/authorize`). Defaults to `"/device_authorization"`.

#### `setVerificationEndpoint(url)`

```ts
.setVerificationEndpoint(url: string): this
```

Sets the URL of the user verification endpoint where the end user enters the user code to authorize the device (e.g. `/device/verify`). Defaults to `"/verify_user_code"`. This URL is returned to the device as `verification_uri` in the device authorization response.

---

### Model Callbacks

These are the core functions you must provide. They define how your application looks up clients, generates codes, and issues tokens.

#### `getClientForAuthentication(handler)`

```ts
.getClientForAuthentication(
  handler: (request: DeviceAuthorizationEndpointRequest) => Promise<OAuth2Client | undefined> | OAuth2Client | undefined
): this
```

Called at the **device authorization endpoint** to look up and validate the client before issuing a device code. Your handler receives the parsed request parameters:

| Parameter      | Type                    | Description                                          |
| -------------- | ----------------------- | ---------------------------------------------------- |
| `clientId`     | `string`                | The client identifier.                               |
| `clientSecret` | `string \| undefined`   | The client secret, if the client is confidential.    |
| `scope`        | `string[] \| undefined` | The requested scopes, if provided in the request body. |

Return an `OAuth2Client` if valid, or `undefined` to reject.

#### `generateDeviceCode(handler)`

```ts
.generateDeviceCode(
  handler: (context: DeviceAuthorizationEndpointContext) => Promise<{ deviceCode: string; userCode: string } | undefined> | { deviceCode: string; userCode: string } | undefined
): this
```

Called after successful client validation to generate and persist a device code and a user-facing user code. Receives the validated context:

| Property | Type           | Description                              |
| -------- | -------------- | ---------------------------------------- |
| `client` | `OAuth2Client` | The authenticated client.                |
| `scope`  | `string[]`     | The validated scopes for this request.   |

Return an object with `deviceCode` and `userCode`, or `undefined` on failure.

Your implementation should persist both codes along with the associated context (client, scope) for later lookup when the device polls the token endpoint or the user visits the verification URI.

#### `verifyUserCode(handler)`

```ts
.verifyUserCode(
  handler: (userCode: string) => Promise<{ deviceCode: string; client: OAuth2Client } | undefined> | { deviceCode: string; client: OAuth2Client } | undefined
): this
```

Called at the **verification endpoint** when the end user enters their user code. Should resolve the user code to the associated device code and client.

Return the matching `{ deviceCode, client }` pair on success, or `undefined` if the user code is invalid or expired.

#### `getClient(handler)`

```ts
.getClient(
  handler: (request: DeviceAuthorizationTokenRequest | OAuth2RefreshTokenRequest) => Promise<OAuth2Client | undefined> | OAuth2Client | undefined
): this
```

Called at the **token endpoint** to validate client credentials and the device code (or refresh token). Your handler receives the parsed token request.

For `urn:ietf:params:oauth:grant-type:device_code` grants, the request contains:

| Parameter      | Type                   | Description                                                    |
| -------------- | ---------------------- | -------------------------------------------------------------- |
| `clientId`     | `string`               | The client identifier.                                         |
| `clientSecret` | `string \| undefined`  | The client secret (if confidential client).                    |
| `grantType`    | `"urn:ietf:params:oauth:grant-type:device_code"` | The grant type.                       |
| `deviceCode`   | `string`               | The device code to validate.                                   |

For `refresh_token` grants:

| Parameter      | Type                    | Description                              |
| -------------- | ----------------------- | ---------------------------------------- |
| `clientId`     | `string`                | The client identifier.                   |
| `clientSecret` | `string \| undefined`   | The client secret (if confidential).     |
| `grantType`    | `"refresh_token"`       | The grant type.                          |
| `refreshToken` | `string`                | The refresh token to validate.           |
| `scope`        | `string[] \| undefined` | The requested scopes for the new token.  |

::: warning Important
When handling device code requests, your implementation **must**:
1. Verify the device code is valid and has not been used before (one-time use).
2. Verify the `clientId` matches the client that requested the device code.
3. Optionally verify the `clientSecret` if the client is confidential.
:::

#### `generateAccessToken(handler)`

```ts
.generateAccessToken(
  handler: (context: DeviceAuthorizationGrantContext) => Promise<DeviceAuthorizationAccessTokenResult | DeviceAuthorizationAccessTokenError | string | undefined> | DeviceAuthorizationAccessTokenResult | DeviceAuthorizationAccessTokenError | string | undefined
): this
```

Called when the device polls the token endpoint. Receives the grant context:

| Property              | Type               | Description                                                           |
| --------------------- | ------------------ | --------------------------------------------------------------------- |
| `client`              | `OAuth2Client`     | The authenticated client.                                             |
| `grantType`           | `string`           | Always `"urn:ietf:params:oauth:grant-type:device_code"`.             |
| `tokenType`           | `string`           | The token type (e.g. `"Bearer"`).                                     |
| `accessTokenLifetime` | `number`           | Lifetime in seconds.                                                  |
| `deviceCode`          | `string`           | The device code being polled.                                         |

Return either a plain access token string, a success result object, or an **error result** to signal polling states:

```ts
// Success — user has authorized the device
{
  accessToken: "eyJhbGciOi...",
  scope?: ["read:data"],
  refreshToken?: "rt_abc123",
  idToken?: "eyJhbGciOi...",   // for OpenID Connect
}

// Polling states — return an error result
{ type: "error", error: "authorization_pending" }  // user hasn't authorized yet
{ type: "error", error: "slow_down" }               // device is polling too fast
{ type: "error", error: "expired_token" }            // device code has expired
{ type: "error", error: "access_denied" }            // user denied the request
```

::: info Note
The RFC 8628 polling error codes (`authorization_pending`, `slow_down`, `expired_token`, `access_denied`) are automatically mapped to the appropriate OAuth 2.0 error responses by the flow.
:::

#### `generateAccessTokenFromRefreshToken(handler)`

```ts
.generateAccessTokenFromRefreshToken(
  handler: (context: OAuth2RefreshTokenGrantContext) => Promise<DeviceAuthorizationAccessTokenResult | string | undefined> | DeviceAuthorizationAccessTokenResult | string | undefined
): this
```

Called when a client presents a refresh token at the token endpoint. Optional — only needed if you want to support refresh token grants.

The context includes:

| Property              | Type                    | Description                       |
| --------------------- | ----------------------- | --------------------------------- |
| `client`              | `OAuth2Client`          | The authenticated client.         |
| `grantType`           | `"refresh_token"`       | Always `"refresh_token"`.         |
| `tokenType`           | `string`                | The token type (e.g. `"Bearer"`). |
| `accessTokenLifetime` | `number`                | Lifetime in seconds.              |
| `refreshToken`        | `string`                | The refresh token string.         |
| `scope`               | `string[] \| undefined` | Requested scopes, if any.         |

Return the same shape as `generateAccessToken` (without the error variant).

#### `verifyToken(handler)`

See [Common Builder & Flow API — `verifyToken`](./builders#builder-verify-token).

---

### Common Configuration

See [Common Builder & Flow API — Common Configuration](./builders#common-configuration) for the full list of shared configuration methods (`setTokenEndpoint`, `setAccessTokenLifetime`, `setSecuritySchemeName`, `setDescription`, `setScopes`, `setTokenType`).

---

### Client Authentication Methods

See [Common Builder & Flow API — Client Authentication Methods](./builders#client-authentication-methods) for available methods.

Both confidential and public clients can use the device authorization flow. When using `none`, the device authenticates with only its `client_id`.

---

### `.build()`

```ts
.build(): DeviceAuthorizationFlow
```

Constructs and returns a fully configured `DeviceAuthorizationFlow` instance ready for use in your route handlers.

---

## DeviceAuthorizationFlow

The `DeviceAuthorizationFlow` class is the result of calling `.build()` on the builder. It exposes the methods you need to handle device authorization, user verification, and token requests.

### `handleAuthorizationEndpoint(request)`

```ts
async handleAuthorizationEndpoint(
  request: Request
): Promise<DeviceAuthorizationEndpointResponse>
```

Unified handler for `POST` requests to the device authorization endpoint. Delegates to `processAuthorization()` and wraps the result with the HTTP method. Returns an error for any method other than `POST`.

Returns a discriminated union you can pattern-match on:

| `method` | `type`          | Description                                                          |
| -------- | --------------- | -------------------------------------------------------------------- |
| `"POST"` | `"device_code"` | Device and user codes were successfully generated.                   |
| —        | `"error"`       | A protocol error occurred. Check the `error` field for details.      |

### `processAuthorization(request)`

```ts
async processAuthorization(
  request: Request
): Promise<DeviceAuthorizationProcessResponse>
```

Processes a `POST` request to the device authorization endpoint. Validates the client, resolves scopes, and calls your `generateDeviceCode` callback.

On success, returns the device code response containing:

| Property                        | Type           | Description                                           |
| ------------------------------- | -------------- | ----------------------------------------------------- |
| `deviceCode`                    | `string`       | The device verification code (opaque to the user).    |
| `userCode`                      | `string`       | The code displayed to the user for entry.             |
| `verificationEndpoint`          | `string`       | The URL the user should visit (`verification_uri`).   |
| `verificationEndpointComplete`  | `string`       | The URL with the user code pre-filled.                |
| `context`                       | `object`       | The device authorization endpoint context.            |

### `verifyUserCode(userCode)`

```ts
async verifyUserCode(userCode: string): Promise<
  | { success: true; deviceCode: string; client: OAuth2Client }
  | { success: false; error: OAuth2Error }
>
```

Verifies a user code entered by the end user at the verification endpoint. Delegates to your `verifyUserCode` model callback.

Also accepts an HTTP `Request` object — the `user_code` is extracted from the query string automatically:

```ts
async verifyUserCode(request: Request): Promise<
  | { success: true; deviceCode: string; client: OAuth2Client }
  | { success: false; error: OAuth2Error }
>
```

```ts
// With a string
const result = await flow.verifyUserCode("ABCD-1234");

// With a request (extracts user_code from query string)
const result = await flow.verifyUserCode(request);

if (result.success) {
  // Mark the device code as authorized in your data store
  await db.authorizeDeviceCode(result.deviceCode, authenticatedUser);
}
```

### `initiateToken(request)`

```ts
async initiateToken(
  request: Request
): Promise<
  | { success: true; context: DeviceAuthorizationGrantContext | OAuth2RefreshTokenGrantContext }
  | { success: false; error: OAuth2Error }
>
```

Validates the token endpoint request and returns the resolved grant context **without** generating tokens. Useful when you need to inspect the context before deciding how to issue tokens. Most callers should use `token()` directly instead.

### `token(request)`

```ts
async token(request: Request): Promise<OAuth2FlowTokenResponse>
```

Handles a `POST` request to the token endpoint. Validates the device code (or refresh token), generates an access token via your model callbacks, and returns a token response body.

For device code polling, RFC 8628 error codes from your `generateAccessToken` callback are automatically mapped to the appropriate OAuth 2.0 error responses:

| Error Code                | HTTP Status | Description                            |
| ------------------------- | ----------- | -------------------------------------- |
| `authorization_pending`   | 400         | The user has not yet authorized.       |
| `slow_down`               | 400         | The device is polling too frequently.  |
| `expired_token`           | 400         | The device code has expired.           |
| `access_denied`           | 400         | The user denied the authorization.     |

Returns:

```ts
// On success
{ success: true, tokenResponse: { access_token, token_type, expires_in, scope?, refresh_token?, id_token? }, grantType: string }

// On failure
{ success: false, error: OAuth2Error }
```

### `getAuthorizationEndpoint()`

```ts
getAuthorizationEndpoint(): string
```

Returns the configured device authorization endpoint URL.

```ts
app.post(flow.getAuthorizationEndpoint(), async (req) => {
  const result = await flow.processAuthorization(req);
  // ...
});
```

### `getVerificationEndpoint()`

```ts
getVerificationEndpoint(): string
```

Returns the configured user verification endpoint URL.

```ts
app.get(flow.getVerificationEndpoint(), async (req) => {
  const userCode = new URL(req.url).searchParams.get("user_code");
  if (userCode) {
    const result = await flow.verifyUserCode(userCode);
    // ...
  }
  // Render the user code input form
});
```

### `getTokenEndpoint()`

See [Common Builder & Flow API — `getTokenEndpoint`](./builders#gettokenendpoint).

### `verifyToken(request)`

See [Common Builder & Flow API — `verifyToken`](./builders#flow-verify-token).

### `toOpenAPIPathItem(scopes?)`

See [Common Builder & Flow API — `toOpenAPIPathItem`](./builders#toopenapipathitem-scopes).

### `toOpenAPISecurityScheme()`

```ts
toOpenAPISecurityScheme(): Record<string, { type: "oauth2"; description?: string; flows: { deviceAuthorization: { deviceAuthorizationUrl: string; scopes: Record<string, string>; tokenUrl: string } } }>
```

Returns an OpenAPI-compatible security scheme definition for this flow. Uses the `deviceAuthorization` flow type.

---

## Full Example

```ts
import { DeviceAuthorizationFlowBuilder } from "@saurbit/oauth2";

const flow = new DeviceAuthorizationFlowBuilder({ tokenEndpoint: "/oauth2/token" })
  .setAuthorizationEndpoint("/oauth2/device_authorization")
  .setVerificationEndpoint("/oauth2/verify_user_code")
  .setSecuritySchemeName("deviceAuth")
  .setDescription("OAuth 2.0 Device Authorization Grant (RFC 8628)")
  .setScopes({
    "content:read": "Read content",
    "content:write": "Write content",
  })
  .setAccessTokenLifetime(3600)
  .addClientAuthenticationMethod("client_secret_basic")
  .addClientAuthenticationMethod("none")

  // Device authorization endpoint: validate the client
  .getClientForAuthentication(async ({ clientId }) => {
    const client = await db.findClientById(clientId);
    if (!client || !client.grants.includes("urn:ietf:params:oauth:grant-type:device_code")) {
      return undefined;
    }
    return client;
  })

  // Device authorization endpoint: generate device and user codes
  .generateDeviceCode(async (context) => {
    const deviceCode = crypto.randomUUID();
    const userCode = generateUserFriendlyCode(); // e.g. "ABCD-1234"
    await db.saveDeviceCode(deviceCode, {
      userCode,
      clientId: context.client.id,
      scope: context.scope,
      expiresAt: Date.now() + 300_000, // 5 minutes
    });
    return { deviceCode, userCode };
  })

  // Verification endpoint: look up a user code
  .verifyUserCode(async (userCode) => {
    const record = await db.findDeviceCodeByUserCode(userCode);
    if (!record || record.expiresAt < Date.now()) return undefined;
    const client = await db.findClientById(record.clientId);
    if (!client) return undefined;
    return { deviceCode: record.deviceCode, client };
  })

  // Token endpoint: validate client + device code / refresh token
  .getClient(async (request) => {
    if (request.grantType === "urn:ietf:params:oauth:grant-type:device_code") {
      const record = await db.findDeviceCode(request.deviceCode);
      if (!record || record.clientId !== request.clientId) return undefined;
      if (!record.authorizedBy) return undefined; // not yet authorized
      await db.revokeDeviceCode(request.deviceCode); // one-time use
      const client = await db.findClientById(request.clientId);
      if (client) {
        client.metadata = {
          userId: record.authorizedBy,
          scope: record.scope,
        };
      }
      return client;
    }
    // refresh_token grant
    const token = await db.findRefreshToken(request.refreshToken);
    if (!token || token.clientId !== request.clientId) return undefined;
    const client = await db.findClientById(request.clientId);
    if (client) {
      client.metadata = {
        userId: token.userId,
        scope: token.scope,
      };
    }
    return client;
  })

  // Token endpoint: issue access token (or return polling error)
  .generateAccessToken(async (context) => {
    const record = await db.findDeviceCode(context.deviceCode);

    // Handle RFC 8628 polling states
    if (!record) return { type: "error", error: "expired_token" };
    if (record.denied) return { type: "error", error: "access_denied" };
    if (!record.authorizedBy) return { type: "error", error: "authorization_pending" };

    return {
      accessToken: await signJwt({
        sub: context.client.metadata.userId,
        scope: context.client.metadata.scope,
        aud: context.client.id,
        exp: Math.floor(Date.now() / 1000) + context.accessTokenLifetime,
      }),
      refreshToken: crypto.randomUUID(),
      scope: context.client.metadata.scope,
    };
  })

  // Token endpoint: issue new access token from refresh token
  .generateAccessTokenFromRefreshToken(async (context) => ({
    accessToken: await signJwt({
      sub: context.client.metadata.userId,
      scope: context.client.metadata.scope,
      aud: context.client.id,
      exp: Math.floor(Date.now() / 1000) + context.accessTokenLifetime,
    }),
    scope: context.client.metadata.scope,
  }))

  // Strategy middleware: verify tokens on protected routes
  .verifyToken(async (token) => {
    const payload = await verifyJwt(token);
    if (!payload) return { isValid: false };
    const user = await db.findUserById(payload.sub);
    if (!user) return { isValid: false };
    const client = await db.findClientById(payload.aud);
    if (!client) return { isValid: false };
    return {
      isValid: true,
      credentials: {
        client,
        user,
        scope: payload.scope,
      },
    };
  })

  .build();
```