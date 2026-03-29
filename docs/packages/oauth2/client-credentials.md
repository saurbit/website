# Client Credentials Flow

Build and configure an OAuth 2.0 Client Credentials grant using the `ClientCredentialsFlowBuilder`.

## Overview

The client credentials flow is a machine-to-machine flow with no end-user involvement. The client authenticates directly with the authorization server using its own credentials and receives an access token.

This flow has a single step:

1. **Token endpoint** — The client sends its `client_id` and `client_secret` and receives an access token.

The `ClientCredentialsFlowBuilder` provides a fluent API to wire up the required callbacks, and produces a `ClientCredentialsFlow` instance you can plug into your HTTP framework.

## Quick Start

```ts
import { ClientCredentialsFlowBuilder } from "@saurbit/oauth2";

const flow = new ClientCredentialsFlowBuilder({ tokenEndpoint: "/token" })
  .setScopes({ "read:data": "Read access", "write:data": "Write access" })
  .addClientAuthenticationMethod("client_secret_basic")
  .getClient(async ({ clientId, clientSecret }) => {
    return db.findAndValidateClient(clientId, clientSecret);
  })
  .generateAccessToken(async (context) => {
    return {
      accessToken: await issueToken(context),
    };
  })
  .verifyToken(async (token) => {
    return await verifyAccessToken(token);
  })
  .build();
```

## Builder Methods

### Constructor

```ts
new ClientCredentialsFlowBuilder(params?: Partial<ClientCredentialsFlowOptions>)
```

Creates a new builder instance. Model callbacks default to no-op implementations — you must set them via the builder methods below before calling `.build()`.

You can pass any of the [common configuration options](#common-configuration) directly in the constructor, or set them individually through the chainable setters.

---

### Model Callbacks

These are the core functions you must provide. They define how your application looks up clients and generates tokens.

#### `getClient(handler)`

```ts
.getClient(
  handler: (request: ClientCredentialsTokenRequest) => Promise<OAuth2Client | undefined> | OAuth2Client | undefined
): this
```

Called at the **token endpoint** to look up and authenticate a client by its ID and secret. Your handler receives the parsed token request parameters:

| Parameter      | Type                   | Description                                            |
| -------------- | ---------------------- | ------------------------------------------------------ |
| `clientId`     | `string`               | The client identifier.                                 |
| `clientSecret` | `string`               | The client secret.                                     |
| `grantType`    | `string`               | The grant type. Always `"client_credentials"`.         |
| `scope`        | `string[] \| undefined` | The requested scopes, if provided in the request body. |

Your implementation should:
1. Verify the `clientId` and `clientSecret` match a registered client.
2. Optionally validate the requested scopes against the client's allowed scopes.

Return an `OAuth2Client` if valid, or `undefined` to reject.

#### `generateAccessToken(handler)`

```ts
.generateAccessToken(
  handler: (context: ClientCredentialsGrantContext) => Promise<OAuth2AccessTokenResult | string | undefined> | OAuth2AccessTokenResult | string | undefined
): this
```

Called after successful client authentication to generate an access token. Receives the grant context:

| Property              | Type               | Description                              |
| --------------------- | ------------------ | ---------------------------------------- |
| `client`              | `OAuth2Client`     | The authenticated client.                |
| `grantType`           | `string`           | Always `"client_credentials"`.           |
| `scope`               | `string[]`         | The validated scopes for this token.     |
| `tokenType`           | `string`           | The token type (e.g. `"Bearer"`).        |
| `accessTokenLifetime` | `number`           | Lifetime in seconds.                     |

Return either a plain access token string, or a result object:

```ts
{
  accessToken: "eyJhbGciOi...",
}
```

::: info Note
Unlike the Authorization Code flow, the Client Credentials flow does **not** support refresh tokens. Each token request requires the client to authenticate again.
:::

#### `verifyToken(handler)`

See [Common Builder & Flow API — `verifyToken`](./builders#builder-verify-token).

---

### Common Configuration

See [Common Builder & Flow API — Common Configuration](./builders#common-configuration) for the full list of shared configuration methods (`setTokenEndpoint`, `setAccessTokenLifetime`, `setSecuritySchemeName`, `setDescription`, `setScopes`, `setTokenType`).

---

### Client Authentication Methods

See [Common Builder & Flow API — Client Authentication Methods](./builders#client-authentication-methods) for available methods.

::: warning
Passing `"none"` has no effect on this builder. Client credentials require the client to authenticate with a secret.
:::

---

### `.build()`

```ts
.build(): ClientCredentialsFlow
```

Constructs and returns a fully configured `ClientCredentialsFlow` instance ready for use in your route handlers.

---

## ClientCredentialsFlow

The `ClientCredentialsFlow` class is the result of calling `.build()` on the builder. It exposes the methods you need to handle token requests and protect resources.

### `token(request)`

```ts
async token(request: Request): Promise<OAuth2FlowTokenResponse>
```

Handles a `POST` request to the token endpoint. Validates the client credentials and generates an access token if valid.

Returns:

```ts
// On success
{ success: true, tokenResponse: { access_token, token_type, expires_in, scope? }, grantType: string }

// On failure
{ success: false, error: OAuth2Error }
```

### `getTokenEndpoint()`

See [Common Builder & Flow API — `getTokenEndpoint`](./builders#gettokenendpoint).

### `verifyToken(request)`

See [Common Builder & Flow API — `verifyToken`](./builders#flow-verify-token).

### `toOpenAPIPathItem(scopes?)`

See [Common Builder & Flow API — `toOpenAPIPathItem`](./builders#toopenapipathitem-scopes).

### `toOpenAPISecurityScheme()`

```ts
toOpenAPISecurityScheme(): Record<string, { type: "oauth2"; description?: string; flows: { clientCredentials: { scopes: Record<string, string>; tokenUrl: string } } }>
```

Returns an OpenAPI-compatible security scheme definition for this flow. Useful for auto-generating API documentation.

---

## Full Example

```ts
import { ClientCredentialsFlowBuilder } from "@saurbit/oauth2";

const flow = new ClientCredentialsFlowBuilder({ tokenEndpoint: "/token" })
  .setSecuritySchemeName("serviceAuth")
  .setDescription("Client Credentials for service-to-service communication")
  .setScopes({
    "data:read": "Read data",
    "data:write": "Write data",
  })
  .setAccessTokenLifetime(1800)
  .addClientAuthenticationMethod("client_secret_basic")
  .addClientAuthenticationMethod("client_secret_post")

  // Token endpoint: authenticate the client
  .getClient(async ({ clientId, clientSecret, scope }) => {
    const client = await db.findClientById(clientId);
    if (!client || client.secret !== clientSecret) return undefined;
    // Verify the client is allowed to use this grant
    if (!client.grants.includes("client_credentials")) return undefined;
    return client;
  })

  // Token endpoint: issue access token
  .generateAccessToken(async (context) => ({
    accessToken: await signJwt({
      sub: context.client.id,
      scope: context.scope,
      exp: Math.floor(Date.now() / 1000) + context.accessTokenLifetime,
    }),
  }))

  // Strategy middleware: verify tokens on protected routes
  .verifyToken(async (token) => {
    const payload = await verifyJwt(token);
    if (!payload) return { isValid: false };
    return { 
      isValid: true, 
      credentials: { 
        app: { id: payload.sub }, 
        scope: payload.scope 
      } 
    };
  })

  .build();
```