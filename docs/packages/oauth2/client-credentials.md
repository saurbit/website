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

```ts
.verifyToken(
  handler: (token: string) => Promise<StrategyResult> | StrategyResult
): this
```

Sets the token verification function used by the strategy middleware to validate access tokens on protected routes.

---

### Common Configuration {#common-configuration}

These methods are inherited from the base `OAuth2FlowBuilder` and apply to all flow types.

#### `setTokenEndpoint(url)`

```ts
.setTokenEndpoint(url: string): this
```

Sets the token endpoint URL (e.g. `/oauth/token`). Used in OpenAPI documentation.

#### `setAccessTokenLifetime(lifetime)`

```ts
.setAccessTokenLifetime(lifetime: number): this
```

Sets the default access token lifetime in seconds. Defaults to `3600` (1 hour).

#### `setSecuritySchemeName(name)`

```ts
.setSecuritySchemeName(name: string): this
```

Sets the key used to identify this security scheme in OpenAPI documentation.

#### `setDescription(description)`

```ts
.setDescription(description: string): this
```

Sets a human-readable description for the OpenAPI security scheme.

#### `setScopes(scopes)`

```ts
.setScopes(scopes: Record<string, string>): this
```

Sets the scopes supported by this flow. The keys are scope names, values are human-readable descriptions.

```ts
.setScopes({
  "content:read": "Read content",
  "content:write": "Write content",
  "admin": "Full admin access",
})
```

#### `setTokenType(tokenType)`

```ts
.setTokenType(tokenType: TokenType): this
```

Sets the token type implementation (e.g. `BearerTokenType`, `DPoPTokenType`). Defaults to Bearer.

---

### Client Authentication Methods

Configure how clients authenticate at the token endpoint. Since this is a machine-to-machine flow, clients **must** authenticate with a secret — the `none` method is intentionally disabled.

#### `addClientAuthenticationMethod(method)`

```ts
.addClientAuthenticationMethod(
  method: "client_secret_basic" | "client_secret_post" | ClientAuthMethod
): this
```

Registers a client authentication method. You can pass a well-known string or a custom `ClientAuthMethod` instance. Call multiple times to support several methods.

::: warning
Passing `"none"` has no effect on this builder. Client credentials require the client to authenticate with a secret.
:::

#### `clientSecretBasicAuthenticationMethod()`

Shortcut for registering HTTP Basic authentication (`Authorization: Basic <base64(client_id:client_secret)>`).

#### `clientSecretPostAuthenticationMethod()`

Shortcut for registering `client_id` and `client_secret` as POST body parameters.

#### `removeClientAuthenticationMethod(method)`

```ts
.removeClientAuthenticationMethod(method: TokenEndpointAuthMethod): this
```

Removes a previously registered authentication method.

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

```ts
getTokenEndpoint(): string
```

Returns the configured token endpoint URL. Useful for registering routes dynamically.

```ts
app.post(flow.getTokenEndpoint(), async (req) => {
  const result = await flow.token(req);
  // ...
});
```

### `verifyToken(request)`

```ts
async verifyToken(request: Request): Promise<StrategyResult>
```

Verifies that the incoming request contains a valid access token. Extracts the token from the `Authorization` header, validates it using the configured token type (e.g. Bearer) and the `verifyToken` handler you set on the builder.

Use this in your protected route handlers to gate access:

```ts
app.get("/api/protected", async (req) => {
  const result = await flow.verifyToken(req);
  if (!result.success) {
    return new Response("Unauthorized", { status: 401 });
  }
  return new Response(JSON.stringify({ data: "secret" }));
});
```

### `toOpenAPIPathItem(scopes?)`

```ts
toOpenAPIPathItem(scopes?: string[]): Record<string, string[]>
```

Returns an OpenAPI security requirement object for a specific path. Use this to annotate individual endpoints with the required scopes.

```ts
// Returns e.g. { "myOAuth2": ["read:data"] }
const security = flow.toOpenAPIPathItem(["read:data"]);
```

This is meant to be used inside an OpenAPI path item's `security` array, alongside `toOpenAPISecurityScheme()` which defines the scheme itself.

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