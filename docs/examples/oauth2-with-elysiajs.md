# OAuth2 with ElysiaJS

This example shows how to set up an OAuth 2.0 **Client Credentials** authorization server using `@saurbit/oauth2` and [ElysiaJS](https://elysiajs.com/). It covers building the flow, wiring up the token endpoint, protecting routes, and generating OpenAPI documentation.

## Prerequisites

Install the required packages:

::: code-group

```sh [npm]
npm install elysia @elysiajs/openapi @saurbit/oauth2
```

```sh [yarn]
yarn add elysia @elysiajs/openapi @saurbit/oauth2
```

```sh [pnpm]
pnpm add elysia @elysiajs/openapi @saurbit/oauth2
```

```sh [bun]
bun add elysia @elysiajs/openapi @saurbit/oauth2
```

:::

## Step 1: Configure the flow

Use `ClientCredentialsFlowBuilder` to configure the OAuth 2.0 Client Credentials flow. The builder uses a fluent API — you chain methods to register your model callbacks and options, then call `.build()` to get the flow instance.

```ts
import { ClientCredentialsFlowBuilder } from "@saurbit/oauth2";

const flow = new ClientCredentialsFlowBuilder({
  securitySchemeName: "clientCredentials",
})
  .setTokenEndpoint("/token")
  .setDescription("Client Credentials Flow for OAuth 2.0 authentication")
  .setScopes({ read: "Read access", write: "Write access", admin: "Admin access" })
  .clientSecretBasicAuthenticationMethod()
  // ... model callbacks below
  .build();
```

`securitySchemeName` is the key used when generating OpenAPI documentation — it identifies this security scheme in the `securitySchemes` component.

`clientSecretBasicAuthenticationMethod()` configures the flow to accept client credentials via the `Authorization: Basic <base64(client_id:client_secret)>` header. See [Client Authentication Methods](../packages/oauth2/client-auth-methods) for all available options.

### Authenticate the client

`getClient()` is called at the token endpoint to look up and validate the client making the request. Return an `OAuth2Client` object if the credentials are valid, or `undefined` to reject the request.

```ts
  .getClient((tokenRequest) => {
    if (
      tokenRequest.clientId !== "example-client" ||
      tokenRequest.clientSecret !== "example-secret"
    ) {
      return undefined; // Reject unknown or invalid clients
    }
    return {
      id: "example-client",
      grants: ["client_credentials"],
      redirectUris: [],
      scopes: ["read", "write"],
    };
  })
```

In a real application you would query a database here instead of hardcoding credentials.

### Generate an access token

`generateAccessToken()` is called after the client is authenticated successfully. Use the grant context to produce and return an access token string.

```ts
  .generateAccessToken((grantContext) => {
    // In production, generate a signed JWT or an opaque token stored in a database.
    return "valid-token-" + grantContext.scope.join("-");
  })
```

The `grantContext` contains the authenticated `client`, the granted `scope`, the `tokenType`, and the `accessTokenLifetime`. See [Client Credentials — `generateAccessToken`](../packages/oauth2/client-credentials#generateaccesstoken-handler) for the full shape.

### Verify access tokens on protected routes

`verifyToken()` is called when a protected endpoint receives a request. It validates the token extracted from the `Authorization` header and returns credentials your route handlers can use.

```ts
  .verifyToken((request, { token }) => {
    if (token.startsWith("valid-token-")) {
      return {
        isValid: true,
        credentials: {
          app: { clientId: "example-client" },
          scope: token.replace("valid-token-", "").split("-"),
        },
      };
    }
    return { isValid: false };
  })
```

In production, you would verify a JWT signature or look the token up in your database.

## Step 2: Create the Elysia app

Create your Elysia app and register the OpenAPI plugin. Spread `flow.toOpenAPISecurityScheme()` into `securitySchemes` to automatically include the OAuth 2.0 scheme in the generated OpenAPI document.

```ts{9}
import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";

const app = new Elysia()
  .use(openapi({
    documentation: {
      components: {
        securitySchemes: {
          ...flow.toOpenAPISecurityScheme(),
        },
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Local development server",
        },
      ],
    },
  }));
```

## Step 3: Register the token endpoint

Use `flow.getTokenEndpoint()` to retrieve the configured token URL (`/token`), then pass the web-standard `Request` object directly to `flow.token()`. Elysia's `request` property is already a web-standard `Request`, so no unwrapping is needed.

```ts{1,3}
app.post(flow.getTokenEndpoint(), async ({ request, status }) => {
  try {
    const result = await flow.token(request);

    if (!result.success) {
      return status(result.error.statusCode ?? 400, {
        error: result.error.errorCode,
        error_description: result.error.message,
      });
    }

    return status(200, result.tokenResponse);
  } catch (_err) {
    return status(500, { error: "Internal Server Error" });
  }
}, {
  detail: { hide: true }, // Hide this endpoint from the OpenAPI docs
});
```

`result.tokenResponse` contains the standard OAuth 2.0 response fields: `access_token`, `token_type`, `expires_in`, and optionally `scope`.

## Step 4: Protect routes

Use Elysia's `guard` and `resolve` to create a shared authentication layer for a group of routes. Call `flow.verifyToken(request)` inside the resolver — if the token is invalid, respond with `401` before the route handler runs. Valid credentials are forwarded to the handler via the resolved context.

```ts{6}
app.guard(
  {},
  (app) =>
    app
      .resolve(async ({ request, status }) => {
        const result = await flow.verifyToken(request);

        if (!result.success) {
          return status(401, { error: "Unauthorized" });
        }

        // Scope check: ensure the token grants the required permission.
        if (!result.credentials.scope?.includes("read")) {
          return status(403, { error: "Forbidden" });
        }

        return { credentials: result.credentials };
      })
      .get("/protected-guarded", async ({ credentials, status }) => {
        const client = credentials.app;
        const scope = credentials.scope;
        return status(200, {
          message: "This is a protected resource.",
          client,
          scope,
        });
      }, {
        detail: {
          tags: ["Protected"],
          description: "An endpoint that requires a valid access token to access.",
          security: [flow.toOpenAPIPathItem(["read"])],
        },
      })
);
```

`flow.toOpenAPIPathItem(["read"])` generates the OpenAPI security requirement object for the path, annotating the endpoint with the required scopes in the generated docs.

## Step 5: Start the server

```ts
app.listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
```

## Full example

```ts
import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { ClientCredentialsFlowBuilder } from "@saurbit/oauth2";

const flow = new ClientCredentialsFlowBuilder({
  securitySchemeName: "clientCredentials",
})
  .setTokenEndpoint("/token")
  .setDescription("Client Credentials Flow for OAuth 2.0 authentication")
  .setScopes({ read: "Read access", write: "Write access", admin: "Admin access" })
  .clientSecretBasicAuthenticationMethod()
  .getClient((tokenRequest) => {
    if (tokenRequest.clientId !== "example-client" || tokenRequest.clientSecret !== "example-secret") {
      return undefined;
    }
    return {
      id: "example-client",
      grants: ["client_credentials"],
      redirectUris: [],
      scopes: ["read", "write"],
    };
  })
  .generateAccessToken((grantContext) => {
    return "valid-token-" + grantContext.scope.join("-");
  })
  .verifyToken((request, { token }) => {
    if (token.startsWith("valid-token-")) {
      return {
        isValid: true,
        credentials: {
          app: { clientId: "example-client" },
          scope: token.replace("valid-token-", "").split("-"),
        },
      };
    }
    return { isValid: false };
  })
  .build();

const app = new Elysia()
  .use(openapi({
    documentation: {
      components: {
        securitySchemes: {
          ...flow.toOpenAPISecurityScheme(),
        },
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Local development server",
        },
      ],
    },
  }));

app.post(flow.getTokenEndpoint(), async ({ request, status }) => {
  try {
    const result = await flow.token(request);

    if (!result.success) {
      return status(result.error.statusCode ?? 400, {
        error: result.error.errorCode,
        error_description: result.error.message,
      });
    }

    return status(200, result.tokenResponse);
  } catch (_err) {
    return status(500, { error: "Internal Server Error" });
  }
}, {
  detail: { hide: true },
});

app.get("/", () => "Hello Elysia", { detail: { tags: ["Public"] } });

app.guard(
  {},
  (app) =>
    app
      .resolve(async ({ request, status }) => {
        const result = await flow.verifyToken(request);
        if (!result.success) {
          return status(401, { error: "Unauthorized" });
        }
        if (!result.credentials.scope?.includes("read")) {
          return status(403, { error: "Forbidden" });
        }
        return { credentials: result.credentials };
      })
      .get("/protected-guarded", async ({ credentials, status }) => {
        const client = credentials.app;
        const scope = credentials.scope;
        return status(200, {
          message: "This is a protected resource.",
          client,
          scope,
        });
      }, {
        detail: {
          tags: ["Protected"],
          description: "An endpoint that requires a valid access token to access.",
          security: [flow.toOpenAPIPathItem(["read"])],
        },
      })
);

app.listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
```