# Common Builder & Flow API

All flow builders in `@saurbit/oauth2` extend a base `OAuth2FlowBuilder` class, and all flow instances extend a base `OAuth2Flow` class. This page documents the shared configuration methods and flow instance methods inherited by every flow type.

## Builder Methods

### Common Configuration {#common-configuration}

These methods are available on every flow builder.

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

### Client Authentication Methods {#client-authentication-methods}

Configure how clients authenticate at the token endpoint. These methods are available on every flow builder.

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

Shortcut for public clients that don't authenticate with a secret.

::: info Note
The availability of `none` depends on the flow type. For authorization code grants, using `none` requires PKCE. For client credentials grants, `none` has no effect since the client must authenticate with a secret.
:::

#### `removeClientAuthenticationMethod(method)`

```ts
.removeClientAuthenticationMethod(method: TokenEndpointAuthMethod): this
```

Removes a previously registered authentication method.

---

### `verifyToken(handler)` {#builder-verify-token}

```ts
.verifyToken(
  handler: (token: string) => Promise<StrategyResult> | StrategyResult
): this
```

Sets the token verification function used by the strategy middleware to validate access tokens on protected routes.

---

## Flow Instance Methods

These methods are available on every flow instance returned by `.build()`.

### `getTokenEndpoint()`

```ts
getTokenEndpoint(): string
```

Returns the configured token endpoint URL. Useful when you need to register endpoint routes dynamically.

```ts
app.post(flow.getTokenEndpoint(), async (req) => {
  const result = await flow.token(req);
  // ...
});
```

### `verifyToken(request)` {#flow-verify-token}

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
  // result.credentials contains the verified token payload
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
