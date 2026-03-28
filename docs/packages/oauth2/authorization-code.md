# Authorization Code Flow

Build and configure an OAuth 2.0 Authorization Code grant (with optional PKCE) using the `AuthorizationCodeFlowBuilder`.

## Overview

The authorization code flow is a two-step process:

1. **Authorization endpoint** — The user is redirected to your server, authenticates, and an authorization code is issued.
2. **Token endpoint** — The client exchanges the authorization code for an access token (and optionally a refresh token).

The `AuthorizationCodeFlowBuilder` provides a fluent API to wire up every callback in this flow, and produces an `AuthorizationCodeFlow` instance you can plug into your HTTP framework.

## Quick Start

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new AuthorizationCodeFlowBuilder({ tokenEndpoint: "/token" })
  .setAuthorizationEndpoint("/authorize")
  .setScopes({ "read:data": "Read access", "write:data": "Write access" })
  .addClientAuthenticationMethod("client_secret_basic")
  .getClientForAuthentication(async ({ clientId, redirectUri }) => {
    return db.findClient(clientId, redirectUri);
  })
  .getUserForAuthentication(async (context, reqData, request) => {
    const user = await authenticate(reqData.username, reqData.password);
    if (!user) return { type: "unauthenticated", message: "Invalid credentials" };
    return { type: "authenticated", user };
  })
  .generateAuthorizationCode(async (context, user) => {
    const code = await db.createAuthorizationCode(context, user);
    return { type: "code", code };
  })
  .getClient(async ({ clientId, clientSecret, grantType, ...rest }) => {
    return db.findAndValidateClient(clientId, clientSecret, rest);
  })
  .generateAccessToken(async (context) => {
    return {
      accessToken: await issueToken(context),
      refreshToken: await issueRefreshToken(context),
      scope: context.client.scopes,
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
new AuthorizationCodeFlowBuilder(params?: Partial<AuthorizationCodeFlowOptions>)
```

Creates a new builder instance. All model callbacks default to no-op implementations — you must set them via the builder methods below before calling `.build()`.

You can pass any of the [common configuration options](#common-configuration) directly in the constructor, or set them individually through the chainable setters.

---

### Authorization Endpoint Configuration

#### `setAuthorizationEndpoint(url)`

```ts
.setAuthorizationEndpoint(url: string): this
```

Sets the URL of the authorization endpoint where users are redirected to authenticate (e.g. `/authorize`). Used in OpenAPI documentation generation.

---

### Model Callbacks

These are the core functions you must provide. They define how your application looks up clients, authenticates users, and generates codes and tokens.

#### `getClientForAuthentication(handler)`

```ts
.getClientForAuthentication(
  handler: (request: AuthorizationCodeEndpointRequest) => Promise<OAuth2Client | undefined> | OAuth2Client | undefined
): this
```

Called during the **authorization endpoint** request to look up and validate the client before the user authenticates. Your handler receives the parsed authorization request parameters:

| Parameter           | Type                  | Description                                      |
| ------------------- | --------------------- | ------------------------------------------------ |
| `clientId`          | `string`              | The `client_id` from the query string.           |
| `responseType`      | `"code"`              | Always `"code"` for this grant.                  |
| `redirectUri`       | `string`              | The `redirect_uri` from the query string.        |
| `scope`             | `string[] \| undefined` | The requested scopes, if provided.             |
| `state`             | `string \| undefined` | The opaque state parameter, if provided.         |
| `codeChallenge`     | `string \| undefined` | The PKCE code challenge, if provided.            |
| `codeChallengeMethod` | `"plain" \| "S256" \| undefined` | The PKCE challenge method.          |

Return an `OAuth2Client` if valid, or `undefined` to reject.

#### `getUserForAuthentication(handler)`

```ts
.getUserForAuthentication(
  handler: (context, reqData, request) => Promise<GetUserForAuthenticationResult | undefined> | GetUserForAuthenticationResult | undefined
): this
```

Called when the user submits credentials at the authorization endpoint. Receives:

- `context` — The validated `AuthorizationCodeEndpointContext` (client, scopes, redirect URI, PKCE params, etc.).
- `reqData` — The user-submitted data (e.g. form fields like username/password). The shape is determined by the `AuthReqData` type parameter.
- `request` — The original HTTP `Request` object.

Return one of:

```ts
{ type: "authenticated", user: { /* your user object */ } }
{ type: "unauthenticated", message?: "Invalid credentials" }
```

Or `undefined` to treat as unauthenticated.

#### `generateAuthorizationCode(handler)`

```ts
.generateAuthorizationCode(
  handler: (context, user) => Promise<GenerateAuthorizationCodeResult | undefined> | GenerateAuthorizationCodeResult | undefined
): this
```

Called after successful user authentication to generate and persist the authorization code. Receives the validated context and the authenticated user.

Return one of:

```ts
// Code issued successfully — user will be redirected with this code
{ type: "code", code: "abc123" }

// More interaction needed (e.g. consent screen)
{ type: "continue", message?: "Please confirm consent" }

// Explicitly deny the request (e.g. user declined consent)
{ type: "deny", message?: "User denied access" }
```

Your implementation should persist the code along with the associated context (client, scope, PKCE params, redirect URI) for later validation at the token endpoint.

#### `getClient(handler)`

```ts
.getClient(
  handler: (request: AuthorizationCodeTokenRequest | OAuth2RefreshTokenRequest) => Promise<OAuth2Client | undefined> | OAuth2Client | undefined
): this
```

Called at the **token endpoint** to validate client credentials and the authorization code (or refresh token). Your handler receives the parsed token request.

For `authorization_code` grants, the request contains:

| Parameter      | Type                  | Description                                         |
| -------------- | --------------------- | --------------------------------------------------- |
| `clientId`     | `string`              | The client identifier.                              |
| `clientSecret` | `string \| undefined` | The client secret (if confidential client).         |
| `grantType`    | `"authorization_code"` | The grant type.                                    |
| `code`         | `string`              | The authorization code to validate.                 |
| `codeVerifier` | `string \| undefined` | The PKCE code verifier, if PKCE was used.           |
| `redirectUri`  | `string \| undefined` | The redirect URI (must match the original request). |

For `refresh_token` grants:

| Parameter      | Type                  | Description                              |
| -------------- | --------------------- | ---------------------------------------- |
| `clientId`     | `string`              | The client identifier.                   |
| `clientSecret` | `string \| undefined` | The client secret (if confidential).     |
| `grantType`    | `"refresh_token"`     | The grant type.                          |
| `refreshToken` | `string`              | The refresh token to validate.           |
| `scope`        | `string[] \| undefined` | The requested scopes for the new token.|

::: warning Important
When handling `authorization_code` requests, your implementation **must**:
1. Verify the code is valid and has not been used before (one-time use).
2. Verify the `clientId` matches the client that requested the code.
3. If `redirectUri` is present, verify it matches the one from the original authorization request.
4. If `codeVerifier` is present, verify it against the stored `code_challenge` using the stored `code_challenge_method`.
:::

#### `generateAccessToken(handler)`

```ts
.generateAccessToken(
  handler: (context: AuthorizationCodeGrantContext) => Promise<AuthorizationCodeAccessTokenResult | string | undefined> | AuthorizationCodeAccessTokenResult | string | undefined
): this
```

Called after successful code validation at the token endpoint. Receives the grant context containing the authenticated client, grant type, token type, access token lifetime, code, and optional PKCE/redirect URI info.

Return either a plain access token string, or a result object:

```ts
{
  accessToken: "eyJhbGciOi...",
  scope?: ["read:data"],          // recommended — returned to the client
  refreshToken?: "rt_abc123",     // optional
  idToken?: "eyJhbGciOi...",      // optional — for OpenID Connect
}
```

#### `generateAccessTokenFromRefreshToken(handler)`

```ts
.generateAccessTokenFromRefreshToken(
  handler: (context: OAuth2RefreshTokenGrantContext) => Promise<AuthorizationCodeAccessTokenResult | string | undefined> | AuthorizationCodeAccessTokenResult | string | undefined
): this
```

Called when a client presents a refresh token at the token endpoint. Optional — only needed if you want to support refresh token grants.

The context includes:

| Property              | Type                   | Description                       |
| --------------------- | ---------------------- | --------------------------------- |
| `client`              | `OAuth2Client`         | The authenticated client.         |
| `grantType`           | `"refresh_token"`      | Always `"refresh_token"`.         |
| `tokenType`           | `string`               | The token type (e.g. `"Bearer"`). |
| `accessTokenLifetime` | `number`               | Lifetime in seconds.              |
| `refreshToken`        | `string`               | The refresh token string.         |
| `scope`               | `string[] \| undefined` | Requested scopes, if any.        |

Return the same shape as `generateAccessToken`.

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

Configure how clients authenticate at the token endpoint.

#### `addClientAuthenticationMethod(method)`

```ts
.addClientAuthenticationMethod(
  method: "client_secret_basic" | "client_secret_post" | "none" | ClientAuthMethod
): this
```

Registers a client authentication method. You can pass a well-known string or a custom `ClientAuthMethod` instance. Call multiple times to support several methods.

#### `clientSecretBasicAuthenticationMethod()`

Shortcut for registering HTTP Basic authentication (`Authorization: Basic <base64(client_id:client_secret)>`).

#### `clientSecretPostAuthenticationMethod()`

Shortcut for registering `client_id` and `client_secret` as POST body parameters.

#### `noneAuthenticationMethod()`

Shortcut for public clients that don't authenticate with a secret. When using `none`, PKCE is **required** for authorization code grants.

#### `removeClientAuthenticationMethod(method)`

```ts
.removeClientAuthenticationMethod(method: TokenEndpointAuthMethod): this
```

Removes a previously registered authentication method.

---

### `.build()`

```ts
.build(): AuthorizationCodeFlow
```

Constructs and returns a fully configured `AuthorizationCodeFlow` instance ready for use in your route handlers.

---

## AuthorizationCodeFlow

The `AuthorizationCodeFlow` class is the result of calling `.build()` on the builder. It exposes the methods you need to handle authorization and token requests.

### `handleAuthorizationEndpoint(request, reqData)`

```ts
async handleAuthorizationEndpoint(
  request: Request,
  reqData: AuthReqData
): Promise<AuthorizationCodeEndpointResponse>
```

Unified handler for both `GET` and `POST` requests to the authorization endpoint. Delegates `GET` to `initiateAuthorization()` and `POST` to `processAuthorization()`.

Returns a discriminated union you can pattern-match on:

| `method` | `type`             | Description                                                            |
| -------- | ------------------ | ---------------------------------------------------------------------- |
| `"GET"`  | `"initiated"`      | Authorization request validated. Render a login/consent UI.            |
| `"POST"` | `"code"`          | Authorization code issued. Redirect the user with the code.            |
| `"POST"` | `"continue"`      | Further user interaction needed (e.g. consent step).                   |
| `"POST"` | `"unauthenticated"` | Authentication failed. Re-render the login UI with an error message. |
| —        | `"error"`          | A protocol error occurred. Check `redirectable` to decide the response.|

### `initiateAuthorization(request)`

```ts
async initiateAuthorization(
  request: Request
): Promise<AuthorizationCodeInitiationResponse>
```

Validates an incoming `GET` request to the authorization endpoint and returns the authorization context. Use this when you want fine-grained control over the two-step flow instead of using `handleAuthorizationEndpoint()`.

On success, store the returned `context` and render your login/consent UI.

### `processAuthorization(request, reqData)`

```ts
async processAuthorization(
  request: Request,
  reqData: AuthReqData
): Promise<AuthorizationCodeProcessResponse>
```

Processes the user's submitted credentials or consent. Authenticates the user via your `getUserForAuthentication` callback and, if successful, generates an authorization code via your `generateAuthorizationCode` callback.

### `initiateToken(request)`

```ts
async initiateToken(
  request: Request
): Promise<
  | { success: true; context: AuthorizationCodeGrantContext | OAuth2RefreshTokenGrantContext }
  | { success: false; error: OAuth2Error }
>
```

Validates the token endpoint request and returns the resolved grant context **without** generating tokens. Useful when you need to inspect the context before deciding how to issue tokens. Most callers should use `token()` directly instead.

### `token(request)`

```ts
async token(request: Request): Promise<OAuth2FlowTokenResponse>
```

Handles a `POST` request to the token endpoint. Validates the authorization code (or refresh token), generates an access token via your model callbacks, and returns a token response body.

Returns:

```ts
// On success
{ success: true, tokenResponse: { access_token, token_type, expires_in, scope?, refresh_token?, id_token? }, grantType: string }

// On failure
{ success: false, error: OAuth2Error }
```

### `getTokenEndpoint()`

```ts
getTokenEndpoint(): string
```

Returns the configured token endpoint URL. Useful when you need to build redirect URLs or register endpoint routes dynamically.

```ts
app.post(flow.getTokenEndpoint(), async (req) => {
  const result = await flow.token(req);
  // ...
});
```

### `getAuthorizationEndpoint()`

```ts
getAuthorizationEndpoint(): string
```

Returns the configured authorization endpoint URL. Handy for registering routes or generating links to the authorization page.

```ts
app.get(flow.getAuthorizationEndpoint(), async (req) => {
  const result = await flow.initiateAuthorization(req);
  // ...
});
app.post(flow.getAuthorizationEndpoint(), async (req) => {
  const result = await flow.processAuthorization(req, reqData);
  // ...
});
```

### `verifyToken(request)`

```ts
async verifyToken(request: Request): Promise<StrategyResult>
```

Verifies that the incoming request contains a valid access token. Extracts the token from the `Authorization` header, validates it using the configured token type (e.g. Bearer) and the `verifyToken` handler you set on the builder.

Returns a `StrategyResult`:

```ts
// On success — credentials are available for your route handler
{ success: true, credentials: AuthCredentials }

// On failure
{ success: false, error: StrategyError }
```

Use this in your protected route handlers to gate access:

```ts
app.get("/api/protected", async (req) => {
  const result = await flow.verifyToken(req);
  if (!result.success) {
    return new Response("Unauthorized", { status: 401 });
  }
  // result.token contains the verified token payload
  return new Response(JSON.stringify({ data: "secret" }));
});
```

### `toOpenAPIPathItem(scopes?)`

```ts
toOpenAPIPathItem(scopes?: string[]): Record<string, string[]>
```

Returns an OpenAPI security requirement object for a specific path. Use this to annotate individual endpoints with the required scopes.

```ts
// Returns e.g. { "myOAuth2": ["content:read"] }
const security = flow.toOpenAPIPathItem(["content:read"]);
```

This is meant to be used inside an OpenAPI path item's `security` array, alongside `toOpenAPISecurityScheme()` which defines the scheme itself.

### `toOpenAPISecurityScheme()`

```ts
toOpenAPISecurityScheme(): Record<string, { type: "oauth2"; description?: string; flows: { authorizationCode: { authorizationUrl: string; scopes: Record<string, string>; tokenUrl: string } } }>
```

Returns an OpenAPI-compatible security scheme definition for this flow. Useful for auto-generating API documentation.

---

## Full Example

```ts
import { AuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

interface LoginFormData {
  username: string;
  password: string;
}

const flow = new AuthorizationCodeFlowBuilder<LoginFormData>({
  tokenEndpoint: "/token",
})
  .setAuthorizationEndpoint("/authorize")
  .setSecuritySchemeName("myOAuth2")
  .setDescription("OAuth 2.0 Authorization Code with PKCE")
  .setScopes({
    "content:read": "Read content",
    "content:write": "Write content",
  })
  .setAccessTokenLifetime(3600)
  .addClientAuthenticationMethod("client_secret_basic")
  .addClientAuthenticationMethod("client_secret_post")
  .addClientAuthenticationMethod("none")

  // Authorization endpoint: validate the client
  .getClientForAuthentication(async ({ clientId, redirectUri }) => {
    const client = await db.findClientById(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) return undefined;
    return client;
  })

  // Authorization endpoint: authenticate the user
  .getUserForAuthentication(async (context, { username, password }) => {
    const user = await db.authenticateUser(username, password);
    if (!user) return { type: "unauthenticated", message: "Invalid credentials" };
    return { type: "authenticated", user: { id: user.id, username: user.username } };
  })

  // Authorization endpoint: generate and persist the code
  .generateAuthorizationCode(async (context, user) => {
    const code = crypto.randomUUID();
    await db.saveAuthorizationCode(code, {
      clientId: context.client.id,
      userId: user.id,
      scope: context.scope,
      redirectUri: context.redirectUri,
      codeChallenge: context.codeChallenge,
      codeChallengeMethod: context.codeChallengeMethod,
    });
    return { type: "code", code };
  })

  // Token endpoint: validate client + code/refresh token
  .getClient(async (request) => {
    if (request.grantType === "authorization_code") {
      const stored = await db.findAuthorizationCode(request.code);
      if (!stored || stored.clientId !== request.clientId) return undefined;
      // Validate PKCE if applicable
      if (stored.codeChallenge && !verifyPkce(stored, request.codeVerifier)) {
        return undefined;
      }
      await db.revokeAuthorizationCode(request.code); // one-time use
      const client = await db.findClientById(request.clientId);
      if (client) {
        client.metadata = { 
            userId: stored.userId,
            scope: stored.scope,
            redirectUri: stored.redirectUri,
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

  // Token endpoint: issue access token
  .generateAccessToken(async (context) => ({
    accessToken: await signJwt({ sub: context.client.metadata.userId, scope: context.client.metadata.scope, aud: context.client.id }),
    refreshToken: crypto.randomUUID(),
    scope: context.client.metadata.scope,
  }))

  // Token endpoint: issue new access token from refresh token
  .generateAccessTokenFromRefreshToken(async (context) => ({
    accessToken: await signJwt({ sub: context.client.metadata.userId, scope: context.client.metadata.scope, aud: context.client.id }),
    scope: context.scope,
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
            client: client,
            user: user, 
            scope: payload.scope,
        } 
    };
  })

  .build();
```

