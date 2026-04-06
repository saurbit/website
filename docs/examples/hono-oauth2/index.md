# OAuth2 with Hono

[`@saurbit/hono-oauth2`](https://www.npmjs.com/package/@saurbit/hono-oauth2) is a [Hono](https://hono.dev/) adapter for `@saurbit/oauth2`. It provides flow builders, token endpoints, and authorization middleware that plug directly into your Hono application.

## Installation

::: code-group

```sh [npm]
npm install @saurbit/hono-oauth2 @saurbit/oauth2
```

```sh [yarn]
yarn add @saurbit/hono-oauth2 @saurbit/oauth2
```

```sh [pnpm]
pnpm add @saurbit/hono-oauth2 @saurbit/oauth2
```

```sh [bun]
bun add @saurbit/hono-oauth2 @saurbit/oauth2
```

```sh [deno]
# from jsr registry
deno add jsr:@saurbit/hono-oauth2
# or from npm registry
deno add npm:@saurbit/hono-oauth2
```

:::

## Supported Flows

| Hono Builder                             | Grant Type                             |
| ---------------------------------------- | -------------------------------------- |
| `HonoAuthorizationCodeFlowBuilder`       | Authorization Code (with PKCE support) |
| `HonoClientCredentialsFlowBuilder`       | Client Credentials                     |
| `HonoDeviceAuthorizationFlowBuilder`     | Device Authorization                   |
| `HonoOIDCAuthorizationCodeFlowBuilder`   | OIDC Authorization Code                |
| `HonoOIDCDeviceAuthorizationFlowBuilder` | OIDC Device Authorization              |

Each builder mirrors its `@saurbit/oauth2` counterpart but replaces the raw `Request` parameter with Hono's `Context`, giving your callbacks access to environment bindings, variables, and other Hono-specific state.

## The `hono()` method {#hono-method}

Every flow class exposes a `hono()` method that returns a frozen object with Hono-adapted helpers. These methods accept a Hono `Context` instead of a raw `Request`.

### Methods shared by all flows

| Method                         | Description                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token(c)`                     | Handles a token endpoint request using the Hono context and returns a typed `OAuth2FlowTokenResponse`.                                                 |
| `verifyToken(c)`               | Extracts the bearer token from the request and verifies it, returning a `StrategyResult`.                                                              |
| `authorizeMiddleware(scopes?)` | Returns a Hono middleware that enforces token validity and optional scope requirements. On success it sets `c.get("credentials")` for downstream handlers. |

```ts
// Token endpoint
app.post("/token", async (c) => {
  const result = await flow.hono().token(c);
  // ...
});

// Verify a token manually
const result = await flow.hono().verifyToken(c);

// Protect a route with scope enforcement
app.get("/resource", flow.hono().authorizeMiddleware(["read"]), handler);
```

### Authorization Code flow methods

The Authorization Code and OIDC Authorization Code flows expose additional methods through `hono()`:

| Method                           | Description                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `initiateAuthorization(c)`       | Handles the GET request to the authorization endpoint — validates the client and requested scopes.         |
| `processAuthorization(c)`        | Handles the POST request to the authorization endpoint — authenticates the user and issues a code.         |
| `handleAuthorizationEndpoint(c)` | Convenience method that checks the HTTP method and delegates to `initiateAuthorization` or `processAuthorization`. |

### Device Authorization flow methods

| Method                           | Description                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `processAuthorization(c)`        | Processes the device authorization POST request.                                                          |
| `handleAuthorizationEndpoint(c)` | Checks the HTTP method and delegates to the appropriate handler.                                          |

## Builder callbacks that receive a Hono Context {#builder-callbacks}

The Hono builders add three callbacks that receive a `Context<E & OAuth2ServerEnv>` rather than a raw `Request`. These are set via fluent builder methods:

| Builder method                        | Available on                               | Description                                                                                          |
| ------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `parseAuthorizationEndpointData(fn)`  | Authorization Code builders                | Extracts user-submitted data (e.g. username/password from a form) from the Hono context on POST requests. |
| `tokenVerifier(fn)`                   | All builders                               | Verifies an extracted access token. Receives the full Hono context so you can access env, variables, etc. |
| `failedAuthorizationAction(fn)`       | All builders                               | Customises the error response when token verification or scope enforcement fails.                     |

```ts
const flow = HonoAuthorizationCodeFlowBuilder
  .create({
    parseAuthorizationEndpointData: async (c) => {
      const body = await c.req.formData();
      return {
        username: body.get("username") as string,
        password: body.get("password") as string,
      };
    },
  })
  .tokenVerifier(async (c, { token }) => {
    // c is a Hono Context — access c.env, c.var, etc.
    const payload = await verifyJwt(token);
    return payload
      ? { isValid: true, credentials: { user: payload } }
      : { isValid: false };
  })
  .failedAuthorizationAction((c, error) => {
    throw new HTTPException(401, { message: "Unauthorized" });
  })
  // ... other builder methods
  .build();
```

## Combining multiple flows {#multiple-flows}

`HonoOIDCMultipleFlows` lets you register several OIDC flows behind a single interface. It tries each flow in order and returns the first successful result:

```ts
import { HonoOIDCMultipleFlows } from "@saurbit/hono-oauth2";

const multiFlow = new HonoOIDCMultipleFlows([
  authCodeFlow,
  clientCredentialsFlow,
]);

// Uses the combined flow for token handling and route protection
app.post("/token", async (c) => {
  const result = await multiFlow.hono().token(c);
  // ...
});

app.get("/resource", multiFlow.hono().authorizeMiddleware(["read"]), handler);
```

## OpenAPI support {#openapi}

All flow classes provide helpers for generating OpenAPI security schemes and path-level security requirements:

| Method                         | Description                                                                 |
| ------------------------------ | --------------------------------------------------------------------------- |
| `toOpenAPISecurityScheme()`    | Returns an object to spread into the OpenAPI `securitySchemes` component.   |
| `toOpenAPIPathItem(scopes?)`   | Returns a security requirement object for a specific path.                  |

## Examples

- [OIDC Authorization Code Flow with Hono](./oidc-example) — a full working example with JWT signing, PKCE, OpenAPI docs, and a login form.