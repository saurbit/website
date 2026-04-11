# OIDC Authorization Code Flow with Hono

This guide walks through a complete OpenID Connect Authorization Code Flow implementation using `@saurbit/hono-oauth2` and Hono. The example includes JWT signing with key rotation, PKCE support, OpenAPI documentation, and a styled login form.

## Prerequisites

Install the required packages:

::: code-group

```sh [npm]
npm install hono @saurbit/hono-oauth2 @saurbit/oauth2 @saurbit/oauth2-jwt hono-openapi @hono/standard-validator @scalar/hono-api-reference
```

```sh [yarn]
yarn add hono @saurbit/hono-oauth2 @saurbit/oauth2 @saurbit/oauth2-jwt hono-openapi @hono/standard-validator @scalar/hono-api-reference
```

```sh [pnpm]
pnpm add hono @saurbit/hono-oauth2 @saurbit/oauth2 @saurbit/oauth2-jwt hono-openapi @hono/standard-validator @scalar/hono-api-reference
```

```sh [bun]
bun add hono @saurbit/hono-oauth2 @saurbit/oauth2 @saurbit/oauth2-jwt hono-openapi @hono/standard-validator @scalar/hono-api-reference
```

```sh [deno]
deno add npm:hono npm:@saurbit/hono-oauth2 npm:@saurbit/oauth2 npm:@saurbit/oauth2-jwt npm:hono-openapi npm:@hono/standard-validator npm:@scalar/hono-api-reference
```

:::

## Step 1: Imports and setup

Start by importing the Hono framework, the OIDC builder, JWT utilities, and error types:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { html } from "hono/html";

import { describeRoute, openAPIRouteHandler } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import { HonoOIDCAuthorizationCodeFlowBuilder } from "@saurbit/hono-oauth2";
import { HTTPException } from "hono/http-exception";

import {
  createInMemoryKeyStore,
  JoseJwksAuthority,
  JwksRotator,
} from "@saurbit/oauth2-jwt";
import {
  AccessDeniedError,
  StrategyInsufficientScopeError,
  StrategyInternalError,
  UnauthorizedClientError,
  UnsupportedGrantTypeError,
  UserCredentials,
} from "@saurbit/oauth2";
```

## Step 2: Extend `UserCredentials`

The `@saurbit/oauth2` module exposes a `UserCredentials` interface you can augment with your own fields. This is used by the authorization code flow to carry user data through the grant process:

```ts
declare module "@saurbit/oauth2" {
  interface UserCredentials {
    id: string;
    email: string;
    fullName: string;
    username: string;
  }
}
```

## Step 3: Configure JWT key management

Use [`@saurbit/oauth2-jwt`](/packages/oauth2-jwt/) to set up an in-memory key store, a JWKS authority for signing/verifying JWTs, and a key rotator:

```ts
const ISSUER = "http://localhost:3000";
const DISCOVERY_ENDPOINT_PATH = "/.well-known/openid-configuration";

const jwksStore = createInMemoryKeyStore();

// Signs JWTs and exposes the JWKS endpoint
const jwksAuthority = new JoseJwksAuthority(jwksStore, 8.64e6); // 100 days key lifetime

// Rotates keys and cleans up old ones
const jwksRotator = new JwksRotator({
  keyGenerator: jwksAuthority,
  rotationTimestampStore: jwksStore,
  rotationIntervalMs: 7.884e9, // 91 days
});
```

See [JoseJwksAuthority](/packages/oauth2-jwt/jose-jwks-authority) and [JWKS Rotator](/packages/oauth2-jwt/jwks-rotator) for details on these utilities.

## Step 4: Define clients and users

For this example, clients and users are stored in-memory. In production you would fetch these from a database.

```ts
const CLIENT = {
  id: "example-client",
  secret: "example-secret",
  grants: ["authorization_code"],
  redirectUris: [
    "http://localhost:3000/scalar",
  ],
  scopes: ["openid", "profile", "email", "content:read", "content:write"],
};

const USER = {
  id: "user123",
  fullName: "John Doe",
  email: "user@example.com",
  username: "user",
  password: "crossterm",
};
```

Authorization codes are also stored in-memory:

```ts
const codeStorage: Record<
  string,
  {
    clientId: string;
    scope: string[];
    userId: string;
    expiresAt: number;
    codeChallenge?: string;
    nonce?: string;
  }
> = {};
```

## Step 5: Build the OIDC flow {#build-flow}

Use `HonoOIDCAuthorizationCodeFlowBuilder` to configure the entire flow. The builder uses a fluent API — chain methods to register your callbacks and options, then call `.build()`.

### Parse the authorization endpoint data

The `parseAuthorizationEndpointData` handler is required. It extracts user credentials from the Hono `Context` when the login form is submitted:

```ts
const flow = HonoOIDCAuthorizationCodeFlowBuilder.create({
  parseAuthorizationEndpointData: async (c) => {
    const formData = await c.req.formData();
    const username = formData.get("username");
    const password = formData.get("password");

    return {
      username: typeof username === "string" ? username : undefined,
      password: typeof password === "string" ? password : undefined,
    };
  },
})
```

### Configure endpoints and scopes

```ts
  .setSecuritySchemeName("openidConnect")
  .setScopes({
    openid: "OpenID Connect scope",
    profile: "Access to your profile information",
    email: "Access to your email address",
    "content:read": "Access to read content",
    "content:write": "Access to write content",
  })
  .setDescription("Example OpenID Connect Authorization Code Flow")
  .setDiscoveryUrl(`${ISSUER}${DISCOVERY_ENDPOINT_PATH}`)
  .setJwksEndpoint("/.well-known/jwks.json")
  .setAuthorizationEndpoint("/authorize")
  .setTokenEndpoint("/token")
  .setUserInfoEndpoint("/userinfo")
```

### Set client authentication methods

This example supports both `client_secret_post` (client sends its secret in the request body) and `none` (for public clients using PKCE):

```ts
  .clientSecretPostAuthenticationMethod()
  .noneAuthenticationMethod()
```

See [Client Authentication Methods](/packages/oauth2/client-auth-methods) for all available options.

### Configure token lifetime and OIDC metadata

```ts
  .setAccessTokenLifetime(3600)
  .setOpenIdConfiguration({
    claims_supported: [
      "sub", "aud", "iss", "exp", "iat", "nbf",
      "name", "email", "username",
    ],
  })
```

### Authenticate the client for authorization

`getClientForAuthentication` is called during the authorization endpoint to validate the client before showing the login page. Return an `OAuth2Client` if valid, or `undefined` to reject:

```ts
  .getClientForAuthentication((data) => {
    if (
      data.clientId === CLIENT.id &&
      CLIENT.redirectUris.includes(data.redirectUri)
    ) {
      return {
        id: CLIENT.id,
        grants: CLIENT.grants,
        redirectUris: CLIENT.redirectUris,
        scopes: CLIENT.scopes,
      };
    }
  })
```

### Authenticate the user

`getUserForAuthentication` validates the user's credentials submitted through the login form. Return an authenticated user object or `undefined`:

```ts
  .getUserForAuthentication((_ctxt, parsedData) => {
    if (parsedData.username === USER.username && parsedData.password === USER.password) {
      return {
        type: "authenticated",
        user: {
          id: USER.id,
          fullName: USER.fullName,
          email: USER.email,
          username: USER.username,
        },
      };
    }
  })
```

### Generate an authorization code

Once the user is authenticated, generate a short-lived authorization code. Store it so it can be exchanged for tokens at the token endpoint:

```ts
  .generateAuthorizationCode((grantContext, user) => {
    if (!user.id) {
      return undefined;
    }
    const code = crypto.randomUUID();
    codeStorage[code] = {
      clientId: grantContext.client.id,
      scope: grantContext.scope,
      userId: `${user.id}`,
      expiresAt: Date.now() + 60000,
      codeChallenge: grantContext.codeChallenge,
      nonce: grantContext.nonce,
    };
    return {
      type: "code",
      code: code,
    };
  })
```

### Exchange the authorization code for tokens

`getClient` is called at the token endpoint to validate the authorization code and the client. This is where you verify the code hasn't expired, matches the requesting client, and validate PKCE or the client secret:

```ts
  .getClient(async (tokenRequest) => {
    if (
      tokenRequest.grantType === "authorization_code" &&
      tokenRequest.clientId === CLIENT.id &&
      tokenRequest.code
    ) {
      const codeData = codeStorage[tokenRequest.code];
      if (!codeData) return undefined;
      if (codeData.clientId !== tokenRequest.clientId) return undefined;
      if (codeData.expiresAt < Date.now()) {
        delete codeStorage[tokenRequest.code];
        return undefined;
      }

      if (tokenRequest.clientSecret) {
        // Private client: verify the secret
        if (tokenRequest.clientSecret !== CLIENT.secret) return undefined;
      } else if (tokenRequest.codeVerifier && codeData.codeChallenge) {
        // Public client: verify PKCE code_verifier against stored code_challenge
        const data = new TextEncoder().encode(tokenRequest.codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = new Uint8Array(hashBuffer);
        const base64url = btoa(String.fromCharCode(...hashArray))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        if (base64url !== codeData.codeChallenge) return undefined;
      } else {
        return undefined;
      }

      return {
        id: CLIENT.id,
        grants: CLIENT.grants,
        redirectUris: CLIENT.redirectUris,
        scopes: CLIENT.scopes,
        metadata: {
          accessScope: codeData.scope,
          userId: codeData.userId,
          username: USER.username,
          userEmail: USER.email,
          userFullName: USER.fullName,
          nonce: codeData.nonce,
        },
      };
    }
  })
```

::: tip
The `metadata` field on the returned client object is a freeform record. Use it to pass context (e.g. user info, granted scopes) from the authorization code exchange to the `generateAccessToken` callback.
:::

### Generate access and ID tokens

`generateAccessToken` produces signed JWTs using the JWKS authority. The OIDC Authorization Code flow expects both an `accessToken` and an `idToken`:

```ts
  .generateAccessToken(async (grantContext) => {
    const accessScope = Array.isArray(grantContext.client.metadata?.accessScope)
      ? grantContext.client.metadata.accessScope
      : [];

    const registeredClaims = {
      exp: Math.floor(Date.now() / 1000) + grantContext.accessTokenLifetime,
      iat: Math.floor(Date.now() / 1000),
      nbf: Math.floor(Date.now() / 1000),
      iss: ISSUER,
      aud: grantContext.client.id,
      jti: crypto.randomUUID(),
      sub: `${grantContext.client.metadata?.userId}`,
    };

    const { token: accessToken } = await jwksAuthority.sign({
      scope: accessScope.join(" "),
      ...registeredClaims,
    });

    const { token: idToken } = await jwksAuthority.sign({
      username: `${grantContext.client.metadata?.username}`,
      name: accessScope.includes("profile")
        ? `${grantContext.client.metadata?.userFullName}`
        : undefined,
      email: accessScope.includes("email")
        ? `${grantContext.client.metadata?.userEmail}`
        : undefined,
      nonce: grantContext.client.metadata?.nonce
        ? `${grantContext.client.metadata?.nonce}`
        : undefined,
      ...registeredClaims,
    });

    return {
      accessToken: accessToken,
      scope: accessScope,
      idToken: idToken,
    };
  })
```

### Verify access tokens

`tokenVerifier` receives the Hono `Context` and the extracted token string. Verify the JWT signature and return the credentials:

```ts
  .tokenVerifier(async (_c, { token }) => {
    try {
      const payload = await jwksAuthority.verify(token);
      if (
        payload &&
        payload.sub === USER.id &&
        typeof payload.scope === "string"
      ) {
        return {
          isValid: true,
          credentials: {
            user: {
              id: USER.id,
              fullName: USER.fullName,
              email: USER.email,
              username: USER.username,
            },
            scope: payload.scope.split(" "),
          },
        };
      }
    } catch (error) {
      console.error("Token verification error:", error);
    }
    return { isValid: false };
  })
```

### Handle authorization failures

`failedAuthorizationAction` customises the error response when the `authorizeMiddleware` rejects a request:

```ts
  .failedAuthorizationAction((_, error) => {
    if (error instanceof StrategyInternalError) {
      throw new HTTPException(500, { message: "Internal server error" });
    }
    if (error instanceof StrategyInsufficientScopeError) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  })
  .build();
```

## Step 6: Register the endpoints {#endpoints}

Create the Hono app and wire up each endpoint.

### Discovery and JWKS

```ts
const app = new Hono();

app.use("/*", cors());

// OpenID Connect discovery
app.get(DISCOVERY_ENDPOINT_PATH, (c) => {
  const config = flow.getDiscoveryConfiguration(c.req.raw);
  return c.json(config);
});

// JWKS endpoint
app.get(flow.getJwksEndpoint(), async (c) => {
  return c.json(await jwksAuthority.getJwksEndpointResponse());
});
```

### Authorization endpoint (login page)

The GET handler initiates the flow and renders the login form. The POST handler processes the user's credentials:

```ts
// GET — render the login page
app.get(flow.getAuthorizationEndpoint(), async (c) => {
  const result = await flow.hono().initiateAuthorization(c);
  if (result.success) {
    return c.html(
      HtmlFormContent({ usernameField: "username", passwordField: "password" }),
    );
  }
  return c.json({ error: "invalid_request" }, 400);
});

// POST — process login submission
app.post(flow.getAuthorizationEndpoint(), async (c) => {
  const result = await flow.hono().processAuthorization(c);

  if (result.type === "error") {
    const error = result.error;
    if (result.redirectable) {
      // Redirect to client with error
      const qs = [
        `error=${encodeURIComponent(
          error instanceof AccessDeniedError ? error.errorCode : "invalid_request"
        )}`,
        `error_description=${encodeURIComponent(
          error instanceof AccessDeniedError ? error.message : "Invalid request"
        )}`,
        result.state ? `state=${encodeURIComponent(result.state)}` : null,
      ].filter(Boolean).join("&");
      return c.redirect(`${result.redirectUri}?${qs}`);
    }
    // Non-redirectable error — re-render the form with an error message
    return c.html(
      HtmlFormContent({
        usernameField: "username",
        passwordField: "password",
        errorMessage: error.message,
      }),
      400,
    );
  }

  if (result.type === "code") {
    // Redirect with the authorization code
    const { code, context: { state, redirectUri } } =
      result.authorizationCodeResponse;
    const searchParams = new URLSearchParams();
    searchParams.set("code", code);
    if (state) searchParams.set("state", state);
    return c.redirect(`${redirectUri}?${searchParams.toString()}`);
  }

  if (result.type === "unauthenticated") {
    return c.html(
      HtmlFormContent({
        usernameField: "username",
        passwordField: "password",
        errorMessage: result.message || "Authentication failed. Please try again.",
      }),
      400,
    );
  }
});
```

::: info
The `processAuthorization` response has several possible types:
- **`code`** — the user was authenticated successfully and an authorization code was generated.
- **`error`** — something went wrong. Check `result.redirectable` to decide whether to redirect or re-render.
- **`continue`** — used for consent pages (not implemented in this example).
- **`unauthenticated`** — the user's credentials were invalid.
:::

### Token endpoint

Use `flow.hono().token(c)` to handle token exchange:

```ts
app.post(flow.getTokenEndpoint(), async (c) => {
  const result = await flow.hono().token(c);
  if (result.success) {
    return c.json(result.tokenResponse);
  }

  const error = result.error;
  if (
    error instanceof UnsupportedGrantTypeError ||
    error instanceof UnauthorizedClientError
  ) {
    return c.json(
      { error: error.errorCode, errorDescription: error.message },
      400,
    );
  }
  return c.json({ error: "invalid_request" }, 400);
});
```

### User info endpoint

Protect the `/userinfo` endpoint with `authorizeMiddleware` requiring the `openid` scope. The verified credentials are available via `c.get("credentials")`:

```ts
app.get(
  flow.getUserInfoEndpoint() || "/user-info",
  flow.hono().authorizeMiddleware(["openid"]),
  (c) => {
    const credentials = c.get("credentials");
    const user = credentials?.user;
    const scope = credentials?.scope || [];
    return c.json({
      sub: user?.id,
      username: user?.username,
      name: scope.includes("profile") ? user?.fullName : undefined,
      email: scope.includes("email") ? user?.email : undefined,
    });
  },
);
```

### Protected resource

Similarly, protect a resource endpoint with a different scope:

```ts
app.get(
  "/protected-resource",
  flow.hono().authorizeMiddleware(["content:read"]),
  (c) => {
    const user = c.get("credentials")?.user;
    return c.json({
      message: `Hello, ${user?.fullName}! You have accessed a protected resource.`,
    });
  },
);
```

## Step 7: OpenAPI and Scalar {#openapi}

Generate an OpenAPI spec and serve an interactive API reference using [Scalar](https://github.com/scalar/scalar):

```ts
app.get(
  "/openapi.json",
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: "Hono OIDC Example API",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          ...flow.toOpenAPISecurityScheme(),
        },
      },
    },
  }),
);

app.get("/scalar", Scalar({ url: "/openapi.json" }));
```

Use `flow.toOpenAPISecurityScheme()` to inject the security scheme into your OpenAPI document, and `flow.toOpenAPIPathItem(scopes)` in route descriptions to annotate which scopes each endpoint requires.

## Step 8: Key rotation {#key-rotation}

Rotate keys on startup and schedule periodic checks:

```ts
await jwksRotator.checkAndRotateKeys();

setInterval(async () => {
  await jwksRotator.checkAndRotateKeys();
}, 3.6e6); // every hour
```

## Running the example

Start the server and visit `http://localhost:3000/scalar` to explore the API. The Scalar UI lets you trigger the authorization code flow with the pre-configured client.

**Test credentials:**
- **Client ID:** `example-client`
- **Client Secret:** `example-secret` (or use **PKCE** `SHA-256` with no secret)
- **Credentials Location:** `body`
- **Username:** `user`
- **Password:** `crossterm`

## Download

<a href="/website/examples/hono-oauth2-example.ts" download="hono-oauth2-example.ts">Download the full example file</a>

After installing the dependencies, you can run the example directly with [Bun](https://bun.sh/):

```sh
bun run --hot src/hono-oauth2-example.ts
```
