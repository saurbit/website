# @saurbit/oauth2

A framework-agnostic [OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749) authorization server
implementation.

## Installation

::: code-group

```sh [npm]
npm install @saurbit/oauth2
```

```sh [yarn]
yarn add @saurbit/oauth2
```

```sh [pnpm]
pnpm add @saurbit/oauth2
```

```sh [bun]
bun add @saurbit/oauth2
```

```sh [deno]
# from jsr registry
deno add jsr:@saurbit/oauth2 
# or from npm registry
deno add npm:@saurbit/oauth2 
```

:::

## Features

- **Authorization Code** flow (with PKCE support)
- **Client Credentials** flow
- **Device Authorization** flow
- Framework-agnostic - bring your own HTTP layer
- Pluggable model interface for storage

## Flow Builders

| Builder                              | Grant Type                             |
| ------------------------------------ | -------------------------------------- |
| `AuthorizationCodeFlowBuilder`       | Authorization Code (with PKCE support) |
| `ClientCredentialsFlowBuilder`       | Client Credentials                     |
| `DeviceAuthorizationFlowBuilder`     | Device Authorization                   |
| `OIDCAuthorizationCodeFlowBuilder`   | OIDC Authorization Code                |
| `OIDCClientCredentialsFlowBuilder`   | OIDC Client Credentials                |
| `OIDCDeviceAuthorizationFlowBuilder` | OIDC Device Authorization              |

## Quick Start

### 1. Create a flow

Use `ClientCredentialsFlowBuilder` (or its counterparts for other grant types) to configure a flow
with your client lookup and token generation logic:

```ts
import { ClientCredentialsFlowBuilder } from "@saurbit/oauth2";

const flow = new ClientCredentialsFlowBuilder({
  securitySchemeName: "clientCredentials",
})
  .clientSecretBasicAuthenticationMethod()
  .getClient((tokenRequest) => {
    // Look up the client by ID/secret and return it, or undefined if not found.
    return undefined;
  })
  .generateAccessToken((grantContext) => {
    // Generate and return an access token string for the authenticated client.
    return undefined;
  })
  .verifyToken((request, { token }) => {
    // Implement logic to verify the access token.
    if (token === "valid-token") {
      return { isValid: true, credentials: { app: { clientId: "example-client" } } };
    }
    return { isValid: false };
  })
  .build();
```

### 2. Wire it into your HTTP framework

The flow's `token()` method accepts a web-standard
[`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) and returns a typed result
object, no framework-specific dependencies. Below is an example using
[Oak](https://jsr.io/@oak/oak):

> **Note:** Oak's `ctx.request` is its own wrapper class, not a web-standard `Request`. Use
> `ctx.request.source` to get the underlying native request.

```ts{7}
import { Application, Router } from "@oak/oak";

const router = new Router();

router.post("/token", async (ctx) => {
  try {
    const result = await flow.token(ctx.request.source as Request);

    if (!result.success) {
      ctx.response.status = result.error.statusCode ?? 400;
      ctx.response.body = {
        error: result.error.errorCode,
        error_description: result.error.message,
      };
    } else {
      ctx.response.status = 200;
      ctx.response.body = result.tokenResponse;
    }
  } catch (_err) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal Server Error" };
  }
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
app.listen({ port: 8000 });
```

### 3. Access protected resources

Use the flow's `verifyToken()` method on protected endpoints. It extracts the token from the request
and delegates to the `verifyToken` handler you registered in the builder (step 1), returning its
result:

```ts{2}
router.get("/protected", async (ctx, next) => {
  const result = await flow.verifyToken(ctx.request.source as Request);
  if (!result.success) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Unauthorized" };
  } else {
    // Access token is valid, and the token info is available in result.credentials.
    ctx.state.client = result.credentials.app;
    await next();
  }
}, (ctx) => {
  ctx.response.body = { message: "This is a protected resource.", client: ctx.state.client };
});
```

### 4. Generate an OpenAPI security scheme (optional)

```ts
const securityScheme = flow.toOpenAPISecurityScheme();
```

Returns an object keyed by the security scheme name (default: `"oauth2-flow"`), with the flow type,
scopes, and token URL. Customise via constructor options or builder methods:
`setSecuritySchemeName`, `setDescription`, `setScopes`, `setTokenEndpoint`.