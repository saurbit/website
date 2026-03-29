# OIDC Support

`@saurbit/oauth2` provides OpenID Connect (OIDC) extensions for each OAuth 2.0 flow. Each OIDC variant wraps the corresponding base flow with OIDC-specific behaviour: discovery document generation, ID token enforcement, `openIdConnect` security scheme, and optional UserInfo support.

## What OIDC Adds

Every OIDC flow builder and flow instance adds the following on top of the base OAuth 2.0 versions:

| Feature                        | Description                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Discovery URL**              | A `/.well-known/openid-configuration` endpoint URL is configured and exposed.                            |
| **JWKS Endpoint**              | A JWKS endpoint URL for publishing the provider's public signing keys.                                   |
| **`getDiscoveryConfiguration()`** | Generates a full OpenID Connect discovery document from the flow's configuration.                     |
| **`toOpenAPISecurityScheme()`** | Returns an `openIdConnect` scheme type (instead of `oauth2`) referencing the discovery URL.              |
| **`openid` scope enforcement** | The `openid` scope is automatically included in `getScopes()` and required at the authorization/token endpoints. |
| **ID token requirement**       | `generateAccessToken` must return an `idToken` field. The flow rejects token responses without one.      |
| **Static config overrides**    | `setOpenIdConfiguration()` lets you merge custom fields into the discovery document.                     |
| **UserInfo support**           | Optional `getUserInfo()` model callback for the UserInfo endpoint (authorization code & device flows).   |

---

## Shared OIDC Builder Methods {#shared-oidc-builder-methods}

These methods are available on `OIDCAuthorizationCodeFlowBuilder`, `OIDCDeviceAuthorizationFlowBuilder`, and `OIDCClientCredentialsFlowBuilder`, in addition to all [common builder methods](./builders).

#### `setDiscoveryUrl(url)`

```ts
.setDiscoveryUrl(url: string): this
```

Sets the OpenID Connect discovery document URL. Defaults to `"/.well-known/openid-configuration"`.

#### `setJwksEndpoint(url)`

```ts
.setJwksEndpoint(url: string): this
```

Sets the JWKS endpoint URL for publishing public signing keys. Defaults to `"/.well-known/jwks.json"`. Can be an absolute URL or a relative path resolved against the discovery URL's origin.

#### `setOpenIdConfiguration(config)`

```ts
.setOpenIdConfiguration(config: Record<string, string | string[] | undefined>): this
```

Sets static overrides merged into the discovery document. These take precedence over values derived from the flow's configuration.

```ts
.setOpenIdConfiguration({
  claims_supported: ["sub", "email", "name"],
  subject_types_supported: ["public", "pairwise"],
})
```

---

## Shared OIDC Flow Methods {#shared-oidc-flow-methods}

These methods are available on every OIDC flow instance, in addition to all [common flow methods](./builders#flow-instance-methods).

#### `getDiscoveryUrl()`

```ts
getDiscoveryUrl(): string
```

Returns the configured discovery document URL.

#### `getJwksEndpoint()`

```ts
getJwksEndpoint(): string | undefined
```

Returns the configured JWKS endpoint URL.

#### `getDiscoveryConfiguration(req?)`

```ts
getDiscoveryConfiguration(req?: Request): Record<string, string | string[] | undefined>
```

Generates the full OpenID Connect discovery document. Relative endpoint URLs are resolved against the request's origin (or the discovery URL's origin if no request is provided).

The returned document includes standard fields such as `issuer`, `token_endpoint`, `jwks_uri`, `grant_types_supported`, `scopes_supported`, `response_types_supported`, `token_endpoint_auth_methods_supported`, and more.

```ts
app.get("/.well-known/openid-configuration", (req) => {
  return new Response(
    JSON.stringify(flow.getDiscoveryConfiguration(req)),
    { headers: { "Content-Type": "application/json" } },
  );
});
```

#### `toOpenAPISecurityScheme()`

All OIDC flows return an `openIdConnect` scheme type referencing the discovery URL, instead of the `oauth2` scheme type used by base flows:

```ts
// Returns e.g. { "myOIDC": { type: "openIdConnect", openIdConnectUrl: "/.well-known/openid-configuration" } }
flow.toOpenAPISecurityScheme();
```

---

## OIDC Authorization Code {#oidc-authorization-code}

### `OIDCAuthorizationCodeFlowBuilder`

Extends the base [AuthorizationCodeFlowBuilder](./authorization-code) with OIDC-specific configuration.

#### Additional builder methods

In addition to the [shared OIDC builder methods](#shared-oidc-builder-methods) and all base authorization code builder methods:

##### `setUserInfoEndpoint(url)`

```ts
.setUserInfoEndpoint(url: string): this
```

Sets the UserInfo endpoint URL (e.g. `/userinfo`). Included in the discovery document.

##### `setRegistrationEndpoint(url)`

```ts
.setRegistrationEndpoint(url: string): this
```

Sets the dynamic client registration endpoint URL. Included in the discovery document.

#### Model callback differences

##### `generateAccessToken(handler)`

The result **must** include an `idToken` field:

```ts
.generateAccessToken(async (context) => ({
  accessToken: await signJwt({ sub: userId, ... }),
  idToken: await signIdToken({ sub: userId, nonce, ... }),  // required
  refreshToken: "rt_abc123",
  scope: ["openid", "profile"],
}))
```

##### `getClientForAuthentication(handler)`

Receives an `OIDCAuthorizationCodeEndpointRequest` which extends the base request with OIDC-specific parameters:

| Parameter          | Type                                                  | Description                                     |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------- |
| `nonce`            | `string \| undefined`                                 | Value for ID token replay protection.           |
| `display`          | `"page" \| "popup" \| "touch" \| "wap" \| undefined`  | How to display the auth/consent UI.             |
| `prompt`           | `("none" \| "login" \| "consent" \| "select_account")[]` | UI behaviour directives.                     |
| `maxAge`           | `number \| undefined`                                 | Max age of user authentication in seconds.      |
| `uiLocales`        | `string[] \| undefined`                               | Preferred UI languages (BCP47 tags).            |
| `idTokenHint`      | `string \| undefined`                                 | Existing ID token as a hint.                    |
| `loginHint`        | `string \| undefined`                                 | Hint for the user's identifier.                 |
| `acrValues`        | `string[] \| undefined`                               | Desired authentication class references.        |

These same OIDC parameters are also available in the `context` passed to `getUserForAuthentication` and `generateAuthorizationCode`.

##### `getUserInfo` (model callback)

Optional. Implement to support the UserInfo endpoint:

```ts
// On the model (set via the builder's model option or constructor)
getUserInfo: async (accessToken) => {
  const payload = await verifyJwt(accessToken);
  if (!payload) return undefined;
  const user = await db.findUserById(payload.sub);
  return { sub: user.id, email: user.email, name: user.name };
}
```

### `OIDCAuthorizationCodeFlow`

Extends the base `AuthorizationCodeFlow` with:

- **`openid` scope enforcement** — The `openid` scope is required in the authorization request. Requests without it are rejected.
- **ID token requirement** — The `token()` method verifies that the token response includes an `id_token`. For refresh token grants, the ID token is optional per the OIDC spec.
- **OIDC request parameter parsing** — The authorization endpoint parses `nonce`, `prompt`, `display`, `max_age`, `ui_locales`, `id_token_hint`, `login_hint`, and `acr_values` from the query string and passes them through the context.

#### Additional flow methods

##### `getUserInfo(accessToken)`

```ts
async getUserInfo(accessToken: string): Promise<OIDCUserInfo | undefined>
```

Retrieves UserInfo claims by delegating to the model's `getUserInfo` callback. Returns `undefined` if not implemented.

```ts
app.get("/userinfo", async (req) => {
  const verify = await flow.verifyToken(req);
  if (!verify.success) return new Response("Unauthorized", { status: 401 });

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  const userInfo = await flow.getUserInfo(token);
  return new Response(JSON.stringify(userInfo), {
    headers: { "Content-Type": "application/json" },
  });
});
```

##### `getDiscoveryConfiguration(req?)`

The discovery document includes `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, `registration_endpoint`, and `grant_types_supported: ["authorization_code"]`.

#### Quick Start

```ts
import { OIDCAuthorizationCodeFlowBuilder } from "@saurbit/oauth2";

const flow = new OIDCAuthorizationCodeFlowBuilder<LoginFormData>({
  tokenEndpoint: "/token",
})
  .setDiscoveryUrl("/.well-known/openid-configuration")
  .setJwksEndpoint("/.well-known/jwks.json")
  .setAuthorizationEndpoint("/authorize")
  .setUserInfoEndpoint("/userinfo")
  .setSecuritySchemeName("oidcAuth")
  .setScopes({
    "openid": "OpenID Connect",
    "profile": "User profile",
    "email": "Email address",
  })
  .addClientAuthenticationMethod("client_secret_basic")

  .getClientForAuthentication(async ({ clientId, redirectUri, nonce, prompt }) => {
    // nonce, prompt, and other OIDC params are available here
    return db.findClient(clientId, redirectUri);
  })
  .getUserForAuthentication(async (context, { username, password }) => {
    // context includes nonce, prompt, maxAge, etc.
    const user = await db.authenticateUser(username, password);
    if (!user) return { type: "unauthenticated" };
    return { type: "authenticated", user };
  })
  .generateAuthorizationCode(async (context, user) => {
    const code = crypto.randomUUID();
    await db.saveAuthorizationCode(code, {
      clientId: context.client.id,
      userId: user.id,
      nonce: context.nonce,  // persist for ID token
      scope: context.scope,
    });
    return { type: "code", code };
  })
  .getClient(async (request) => {
    // same as base authorization code flow
    return db.findAndValidateClient(request);
  })
  .generateAccessToken(async (context) => ({
    accessToken: await signJwt({ sub: userId, scope }),
    idToken: await signIdToken({ sub: userId, nonce: storedNonce }),  // required
    refreshToken: crypto.randomUUID(),
    scope: ["openid", "profile"],
  }))
  .verifyToken(async (token) => {
    const payload = await verifyJwt(token);
    if (!payload) return { isValid: false };
    return { isValid: true, credentials: { user: payload.sub, scope: payload.scope } };
  })
  .build();
```

---

## OIDC Client Credentials {#oidc-client-credentials}

### `OIDCClientCredentialsFlowBuilder`

Extends the base [ClientCredentialsFlowBuilder](./client-credentials) with OIDC-specific configuration.

::: info Note
Because Client Credentials is a machine-to-machine flow with no end-user involvement, this OIDC variant does **not** issue ID tokens, does not expose a UserInfo endpoint, and the `none` authentication method is disabled. The discovery document is provided for interoperability with OIDC-aware clients.
:::

#### Additional builder methods

The [shared OIDC builder methods](#shared-oidc-builder-methods) (`setDiscoveryUrl`, `setJwksEndpoint`, `setOpenIdConfiguration`) are available. There are no additional OIDC-specific builder methods beyond those.

#### Model callback differences

`generateAccessToken` returns the same result shape as the base Client Credentials flow — no `idToken` is required.

### `OIDCClientCredentialsFlow`

Extends the base `ClientCredentialsFlow` with:

- **Discovery document generation** — `getDiscoveryConfiguration()` returns a standard OIDC discovery document with `grant_types_supported: ["client_credentials"]`.
- **`openIdConnect` security scheme** — `toOpenAPISecurityScheme()` returns an `openIdConnect` type instead of `oauth2`.

The discovery document fields `userinfo_endpoint`, `registration_endpoint`, and `claims_supported` are `undefined` by default since they are not relevant for this flow.

#### Quick Start

```ts
import { OIDCClientCredentialsFlowBuilder } from "@saurbit/oauth2";

const flow = new OIDCClientCredentialsFlowBuilder({ tokenEndpoint: "/token" })
  .setDiscoveryUrl("/.well-known/openid-configuration")
  .setJwksEndpoint("/.well-known/jwks.json")
  .setSecuritySchemeName("oidcService")
  .setScopes({ "data:read": "Read data", "data:write": "Write data" })
  .addClientAuthenticationMethod("client_secret_basic")
  .getClient(async ({ clientId, clientSecret }) => {
    return db.findAndValidateClient(clientId, clientSecret);
  })
  .generateAccessToken(async (context) => ({
    accessToken: await signJwt({ sub: context.client.id, scope: context.scope }),
  }))
  .verifyToken(async (token) => {
    const payload = await verifyJwt(token);
    if (!payload) return { isValid: false };
    return { isValid: true, credentials: { app: { id: payload.sub }, scope: payload.scope } };
  })
  .build();
```

---

## OIDC Device Authorization {#oidc-device-authorization}

### `OIDCDeviceAuthorizationFlowBuilder`

Extends the base [DeviceAuthorizationFlowBuilder](./device-authorization) with OIDC-specific configuration.

#### Additional builder methods

In addition to the [shared OIDC builder methods](#shared-oidc-builder-methods) and all base device authorization builder methods:

##### `setUserInfoEndpoint(url)`

```ts
.setUserInfoEndpoint(url: string): this
```

Sets the UserInfo endpoint URL. Included in the discovery document.

##### `setRegistrationEndpoint(url)`

```ts
.setRegistrationEndpoint(url: string): this
```

Sets the dynamic client registration endpoint URL. Included in the discovery document.

#### Model callback differences

##### `generateAccessToken(handler)`

The result **must** include an `idToken` field. May also return a `DeviceAuthorizationAccessTokenError` for polling states:

```ts
.generateAccessToken(async (context) => {
  const status = await db.getDeviceCodeStatus(context.deviceCode);
  if (status === "pending") return { type: "error", error: "authorization_pending" };

  return {
    accessToken: await signJwt({ sub: userId }),
    idToken: await signIdToken({ sub: userId }),  // required
    refreshToken: crypto.randomUUID(),
    scope: ["openid", "profile"],
  };
})
```

##### `getUserInfo` (model callback)

Optional. Same interface as the authorization code variant — implement to support the UserInfo endpoint.

### `OIDCDeviceAuthorizationFlow`

Extends the base `DeviceAuthorizationFlow` with:

- **`openid` scope enforcement** — The `openid` scope is automatically included in `getScopes()`.
- **ID token requirement** — The `token()` method verifies that the token response includes an `id_token`. For refresh token grants, the ID token is optional per the OIDC spec.
- **UserInfo support** — `getUserInfo(accessToken)` delegates to the model callback.

#### Additional flow methods

##### `getUserInfo(accessToken)`

```ts
async getUserInfo(accessToken: string): Promise<OIDCUserInfo | undefined>
```

Same as the [OIDC Authorization Code](#oidc-authorization-code) variant.

##### `getDiscoveryConfiguration(req?)`

The discovery document includes `authorization_endpoint` (the device authorization endpoint), `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, `registration_endpoint`, and `grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code"]`.

#### Quick Start

```ts
import { OIDCDeviceAuthorizationFlowBuilder } from "@saurbit/oauth2";

const flow = new OIDCDeviceAuthorizationFlowBuilder({ tokenEndpoint: "/token" })
  .setDiscoveryUrl("/.well-known/openid-configuration")
  .setJwksEndpoint("/.well-known/jwks.json")
  .setAuthorizationEndpoint("/device/authorize")
  .setVerificationEndpoint("/device/verify")
  .setUserInfoEndpoint("/userinfo")
  .setSecuritySchemeName("oidcDevice")
  .setScopes({ "openid": "OpenID Connect", "profile": "User profile" })
  .addClientAuthenticationMethod("client_secret_basic")
  .addClientAuthenticationMethod("none")

  .getClientForAuthentication(async ({ clientId }) => {
    return db.findClient(clientId);
  })
  .generateDeviceCode(async (context) => ({
    deviceCode: crypto.randomUUID(),
    userCode: generateUserFriendlyCode(),
  }))
  .verifyUserCode(async (userCode) => {
    return db.findDeviceCodeByUserCode(userCode);
  })
  .getClient(async (request) => {
    return db.findAndValidateClient(request);
  })
  .generateAccessToken(async (context) => {
    const record = await db.findDeviceCode(context.deviceCode);
    if (!record?.authorizedBy) return { type: "error", error: "authorization_pending" };
    return {
      accessToken: await signJwt({ sub: record.authorizedBy }),
      idToken: await signIdToken({ sub: record.authorizedBy }),  // required
      scope: ["openid", "profile"],
    };
  })
  .verifyToken(async (token) => {
    const payload = await verifyJwt(token);
    if (!payload) return { isValid: false };
    return { isValid: true, credentials: { user: payload.sub, scope: payload.scope } };
  })
  .build();
```

---

## OIDCMultipleFlows {#oidc-multiple-flows}

`OIDCMultipleFlows` aggregates multiple OIDC flow instances into a single handler with a unified token endpoint, token verification, and discovery document.

### Constructor

```ts
new OIDCMultipleFlows({
  flows: OIDCFlow[],
  discoveryUrl: string,
  securitySchemeName: string,
  tokenEndpoint?: string,      // defaults to "/token"
  jwksEndpoint?: string,       // defaults to "/jwks"
  description?: string,
  openidConfiguration?: Record<string, string | string[] | undefined>,
})
```

| Parameter              | Type                                                  | Description                                               |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `flows`                | `OIDCFlow[]`                                          | Ordered list of OIDC flows to delegate to.                |
| `discoveryUrl`         | `string`                                              | URL of the combined discovery document.                   |
| `securitySchemeName`   | `string`                                              | Name of the OpenAPI security scheme entry.                |
| `tokenEndpoint`        | `string`                                              | URL of the unified token endpoint. Defaults to `/token`.  |
| `jwksEndpoint`         | `string`                                              | URL of the JWKS endpoint. Defaults to `/jwks`.            |
| `description`          | `string`                                              | Optional description for the OpenAPI security scheme.     |
| `openidConfiguration`  | `Record<string, string \| string[] \| undefined>`     | Optional static overrides for the merged discovery document. |

### `token(request)`

```ts
async token(request: Request): Promise<OAuth2FlowTokenResponse>
```

Tries each registered flow in order. The first flow that returns a successful result is used. If no flow succeeds, returns a combined error from all flows.

### `verifyToken(request)`

```ts
async verifyToken(request: Request): Promise<StrategyResult>
```

Tries each registered flow's `verifyToken()` in order. The first flow that successfully verifies the token is used.

### `getDiscoveryConfiguration(req?)`

```ts
getDiscoveryConfiguration(req?: Request): Record<string, string | string[] | undefined>
```

Merges the discovery configurations of all registered flows. Array-valued fields (e.g. `grant_types_supported`, `scopes_supported`) are merged and deduplicated. Static overrides from the constructor's `openidConfiguration` take precedence.

The merged document uses the `OIDCMultipleFlows` instance's `tokenEndpoint` and `jwksEndpoint` (not the individual flows'), ensuring a single unified token endpoint.

### `toOpenAPIPathItem(scopes?)`

```ts
toOpenAPIPathItem(scopes?: string[]): Record<string, string[]>
```

Returns an OpenAPI security requirement object using the aggregated security scheme name.

### `toOpenAPISecurityScheme()`

```ts
toOpenAPISecurityScheme(): Record<string, { type: "openIdConnect"; description?: string; openIdConnectUrl: string }>
```

Returns an `openIdConnect` security scheme definition pointing to the discovery URL.

### Quick Start

```ts
import {
  OIDCAuthorizationCodeFlowBuilder,
  OIDCClientCredentialsFlowBuilder,
  OIDCMultipleFlows,
} from "@saurbit/oauth2";

// Build individual OIDC flows
const authCodeFlow = new OIDCAuthorizationCodeFlowBuilder({ ... }).build();
const clientCredsFlow = new OIDCClientCredentialsFlowBuilder({ ... }).build();

// Combine them into a single handler
const oidc = new OIDCMultipleFlows({
  flows: [authCodeFlow, clientCredsFlow],
  discoveryUrl: "/.well-known/openid-configuration",
  securitySchemeName: "oidc",
  tokenEndpoint: "/oauth2/token",
  jwksEndpoint: "/.well-known/jwks.json",
  description: "OpenID Connect with Authorization Code and Client Credentials",
});

// Unified token endpoint — delegates to the matching flow
app.post(oidc.getTokenEndpoint(), async (req) => {
  const result = await oidc.token(req);
  if (result.success) return new Response(JSON.stringify(result.tokenResponse));
  return new Response(JSON.stringify({ error: result.error.errorCode }), { status: 400 });
});

// Unified discovery document — merges all flows
app.get("/.well-known/openid-configuration", (req) => {
  return new Response(JSON.stringify(oidc.getDiscoveryConfiguration(req)), {
    headers: { "Content-Type": "application/json" },
  });
});

// Unified token verification on protected routes
app.get("/api/protected", async (req) => {
  const result = await oidc.verifyToken(req);
  if (!result.success) return new Response("Unauthorized", { status: 401 });
  return new Response(JSON.stringify({ data: "secret" }));
});

// OpenAPI security scheme
const securitySchemes = oidc.toOpenAPISecurityScheme();
// { "oidc": { type: "openIdConnect", openIdConnectUrl: "/.well-known/openid-configuration" } }
```