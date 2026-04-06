/*************************************************
 * Example OpenID Connect Authorization Code Flow implementation using Hono.
 *
 * This example demonstrates how to set up an OpenID Connect Authorization Code Flow
 * using the @saurbit/hono-oauth2 integration with the Hono web framework. It includes
 * handlers for the discovery, JWKS, authorization, token, and user info endpoints,
 * as well as a protected resource endpoint.
 *
 * The flow is configured with in-memory client and user data for demonstration purposes.
 * In a production application, you would typically integrate with a database or other
 * persistent storage for clients, users, and authorization codes.
 *
 * The example also includes error handling and logging for various failure scenarios.
 *
 * OpenAPI documentation is generated for the protected resource endpoint, and Scalar
 * is available for testing the API.
 *************************************************/

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

declare module "@saurbit/oauth2" {
  interface UserCredentials {
    id: string;
    email: string;
    fullName: string;
    username: string;
  }
}

const ISSUER = "http://localhost:3000";
const DISCOVERY_ENDPOINT_PATH = "/.well-known/openid-configuration";

// in-memory key store
const jwksStore = createInMemoryKeyStore();

// For signing JWTs and exposing the JWKS endpoint.
export const jwksAuthority = new JoseJwksAuthority(jwksStore, 8.64e6); // 100 days key lifetime

// To rotate keys and clean up old keys from the store.
export const jwksRotator = new JwksRotator({
  keyGenerator: jwksAuthority,
  rotatorKeyStore: jwksStore,
  rotationIntervalMs: 7.884e9, // 91 days
});

// Authorized client
const CLIENT = {
  id: "example-client",
  secret: "example-secret",
  grants: ["authorization_code"],
  redirectUris: [
    "http://localhost:3000/scalar",
    "http://localhost:5054/"
  ],
  scopes: ["openid", "profile", "email", "content:read", "content:write"],
};

// Authorized user
const USER = {
  id: "user123",
  fullName: "John Doe",
  email: "user@example.com",
  username: "user",
};

// Authorization code storage
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

// Build the OpenID Connect Authorization Code Flow using the Hono integration.
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
  .setJwksEndpoint("/jwks")
  .setAuthorizationEndpoint("/authorize")
  .setTokenEndpoint("/token")
  .setUserInfoEndpoint("/userinfo")
  .clientSecretPostAuthenticationMethod()
  .noneAuthenticationMethod()
  .setAccessTokenLifetime(3600)
  .setOpenIdConfiguration({
    claims_supported: [
      "sub",
      "aud",
      "iss",
      "exp",
      "iat",
      "nbf",
      "name",
      "email",
      "username",
    ],
  })
  .getClientForAuthentication((data) => {
    // Look up the client by ID/secret and return it, or undefined if not found.
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
  .getUserForAuthentication((_ctxt, parsedData) => {
    // Look up the user by username/password and return it, or undefined if not found.
    if (parsedData.username === "user" && parsedData.password === "crossterm") {
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
  .generateAuthorizationCode((grantContext, user) => {
    // Generate and return an authorization code string for the authenticated client.
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
  .getClient(async (tokenRequest) => {
    // Look up the client by ID/secret and return it, or undefined if not found.
    if (
      tokenRequest.grantType === "authorization_code" &&
      tokenRequest.clientId === CLIENT.id &&
      tokenRequest.code
    ) {
      const codeData = codeStorage[tokenRequest.code];
      if (!codeData) {
        return undefined; // Invalid or expired authorization code
      }
      if (codeData.clientId !== tokenRequest.clientId) {
        return undefined; // Authorization code was not issued to this client
      }
      if (codeData.expiresAt < Date.now()) {
        delete codeStorage[tokenRequest.code]; // Clean up expired code
        return undefined; // Authorization code has expired
      }
      if (codeData.userId !== USER.id) {
        return undefined; // User associated with the code does not exist
      }

      if (tokenRequest.clientSecret) {
        // Private client authentication using client secret
        if (tokenRequest.clientSecret !== CLIENT.secret) {
          return undefined; // Invalid client secret
        }
      } else if (tokenRequest.codeVerifier && codeData.codeChallenge) {
        // Public client authentication using PKCE
        const codeChallenge = codeData.codeChallenge;
        const data = new TextEncoder().encode(tokenRequest.codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);

        // Convert ArrayBuffer → base64url
        const hashArray = new Uint8Array(hashBuffer);
        const base64url = btoa(String.fromCharCode(...hashArray))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        if (base64url !== codeChallenge) {
          return undefined; // Invalid PKCE code verifier
        }
      } else {
        return undefined; // Missing authentication method
      }

      return {
        id: CLIENT.id,
        grants: CLIENT.grants,
        redirectUris: CLIENT.redirectUris,
        scopes: CLIENT.scopes,
        metadata: {
          // Include any additional metadata needed for token generation or verification.
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
  .generateAccessToken(async (grantContext) => {
    // Generate and return an access token string for the authenticated client.
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
      scope: accessScope,
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
  .tokenVerifier(async (
    _c,
    { token },
  ) => {
    try {
      const accessTokenJwtPayload = await jwksAuthority.verify(token);
      if (
        accessTokenJwtPayload &&
        accessTokenJwtPayload.sub === USER.id &&
        Array.isArray(accessTokenJwtPayload.scope)
      ) {
        const user: UserCredentials = {
          id: USER.id,
          fullName: USER.fullName,
          email: USER.email,
          username: USER.username,
        };
        return {
          isValid: true,
          credentials: {
            user: { ...user },
            scope: accessTokenJwtPayload.scope,
          },
        };
      }
    } catch (error) {
      console.error("Token verification error:", {
        error: error instanceof Error ? { name: error.name, message: error.message } : error
      });
    }
    return { isValid: false };
  })
  .failedAuthorizationAction((_, error) => {
    // logging the error
    console.error("Authorization failed:", {
      error: error.name,
      message: error.message,
    });

    if (error instanceof StrategyInternalError) {
      throw new HTTPException(500, {
        message: "Internal server error",
      });
    }

    if (error instanceof StrategyInsufficientScopeError) {
      throw new HTTPException(403, {
        message: "Forbidden",
      });
    }

    throw new HTTPException(401, {
      message: "Unauthorized",
    });
  })
  .build();

const app = new Hono();

app.use('/*', cors())

// OpenID Connect discovery endpoint handler
app.get(DISCOVERY_ENDPOINT_PATH, (c) => {
  // Issuer dynamically set based on the incoming request's host header and protocol
  const config = flow.getDiscoveryConfiguration(c.req.raw);
  return c.json(config);
});

// JWKS endpoint handler
app.get(flow.getJwksEndpoint(), async (c) => {
  return c.json(await jwksAuthority.getJwksEndpointResponse());
});

// Login page handler
app.get(flow.getAuthorizationEndpoint(), async (c) => {
  const result = await flow.hono().initiateAuthorization(c);
  if (result.success) {
    return c.html(
      HtmlFormContent({ usernameField: "username", passwordField: "password" }),
    );
  } else {
    const error = result.error;
    console.error("Authorization endpoint error:", {
      error: error.name,
      message: error.message,
    });
    return c.json({ error: "invalid_request" }, 400);
  }
});

// Login submission handler
app.post(flow.getAuthorizationEndpoint(), async (c) => {
  try {
    // Here you would typically validate the user's credentials and then proceed with the authorization process
    const result = await flow.hono().processAuthorization(c);

    if (result.type === "error") {
      // for security reasons, it is recommended to return a generic error message in production instead of the specific error message
      const error = result.error;
      console.error("Authorization endpoint error:", {
        error: error.name,
        message: error.message,
      });

      if (result.redirectable) {
        // If the error is redirectable, redirect the user to the client's redirect_uri with the error and state as query parameters
        const qs = [
          `error=${encodeURIComponent(
            error instanceof AccessDeniedError
              ? error.errorCode
              : "invalid_request",
          )
          }`,
          `error_description=${encodeURIComponent(
            error instanceof AccessDeniedError
              ? error.message
              : "Invalid request",
          )
          }`,
          result.state ? `state=${encodeURIComponent(result.state)}` : null,
        ].filter(Boolean).join("&");

        return c.redirect(`${result.redirectUri}?${qs}`);
      }

      // If the error is not redirectable, render an error message
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
      // redirect the user to the client's redirect_uri with the authorization code and state as query parameters
      const { code, context: { state, redirectUri } } =
        result.authorizationCodeResponse;

      const searchParams = new URLSearchParams();
      searchParams.set("code", code);
      if (state) {
        searchParams.set("state", state);
      }

      return c.redirect(`${redirectUri}?${searchParams.toString()}`);
    } else if (result.type === "continue") {
      // In a real implementation, you would render a consent page here for the user to authorize the client to access their resources.
      return c.json({ message: "Consent page was not implemented" }, 500);
    } else if (result.type === "unauthenticated") {
      // render the login page with an optional error message
      return c.html(
        HtmlFormContent({
          usernameField: "username",
          passwordField: "password",
          errorMessage: result.message ||
            "Authentication failed. Please try again.",
        }),
        400,
      );
    }
  } catch (error) {
    // unexpected errors should be logged and a generic error message should be returned to the user
    console.error("Unexpected error at authorization endpoint:", {
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : error,
    });
    return c.html(
      HtmlFormContent({
        usernameField: "username",
        passwordField: "password",
        errorMessage: "An unexpected error occurred. Please try again later.",
      }),
      500,
    );
  }
});

// Token endpoint handler
app.post(flow.getTokenEndpoint(), async (c) => {
  const result = await flow.hono().token(c);
  if (result.success) {
    return c.json(result.tokenResponse);
  } else {
    const error = result.error;
    if (
      error instanceof UnsupportedGrantTypeError ||
      error instanceof UnauthorizedClientError
    ) {
      return c.json(
        {
          error: result.error.errorCode,
          errorDescription: result.error.message,
        },
        400,
      );
    } else {
      console.error("Token endpoint error:", {
        error: error.name,
        message: error.message,
      });
      return c.json({ error: "invalid_request" }, 400);
    }
  }
});

// User info endpoint handler
app.get(
  flow.getUserInfoEndpoint() || "/user-info",
  flow.hono().authorizeMiddleware(["openid"]),
  describeRoute({
    summary: "User Info",
    description:
      "Returns claims about the authenticated user. Requires a valid access token with the 'openid' scope.",
    security: [
      flow.toOpenAPIPathItem(["openid"]),
    ],
    responses: {
      200: {
        description: "Successful response with user claims.",
        content: {
          "application/json": {
            example: {
              sub: "user123",
              username: "user",
              name: "John Doe",
              email: "user@example.com",
            },
          },
        },
      },
    },

  }),
  (c) => {
    const credentials = c.get("credentials");
    const user = credentials?.user;
    const scope = credentials?.scope || [];
    const userInfoResponse = {
      sub: user?.id,
      username: user?.username,
      name: scope.includes("profile") ? user?.fullName : undefined,
      email: scope.includes("email") ? user?.email : undefined,
    };
    return c.json(userInfoResponse);
  },
);

// Protected resource endpoint handler
app.get(
  "/protected-resource",
  flow.hono().authorizeMiddleware(["content:read"]),
  describeRoute({
    summary: "Protected Resource",
    description:
      "An example endpoint that requires a valid access token with the 'content:read' scope to access.",
    responses: {
      200: {
        description: "Successful response with protected resource data.",
        content: {
          "application/json": {
            example: {
              message:
                "Hello, John Doe! You have accessed a protected resource.",
            },
          },
        },
      },
      401: {
        description: "Unauthorized - missing or invalid access token.",
      },
      403: {
        description:
          "Forbidden - valid access token but insufficient scope to access the resource.",
      },
    },
    security: [
      flow.toOpenAPIPathItem(["content:read"]),
    ],
  }),
  (c) => {
    const user = c.get("credentials")?.user;
    return c.json({
      message:
        `Hello, ${user?.fullName}! You have accessed a protected resource.`,
    });
  },
);

// OpenAPI documentation endpoint
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

// API reference endpoint using Scalar
app.get("/scalar", Scalar({ url: "/openapi.json" }));

// Rotate keys on startup
await jwksRotator.checkAndRotateKeys();

// Schedule regular key rotation checks
setInterval(async () => {
  await jwksRotator.checkAndRotateKeys();
}, 3.6e6); // Check for key rotation every hour

// HTML content for the login form
function HtmlFormContent(props: {
  errorMessage?: string;
  username?: string;
  usernameField: string;
  passwordField: string;
}) {
  return html`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>Sign in</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle at top, #6366f1 0, #1e293b 55%);
            color: #e5e7eb;
        }
        .glass-card {
            width: 100%;
            max-width: 380px;
            padding: 2.5rem 2.25rem;
            border-radius: 1.5rem;
            background: rgba(30, 41, 59, 0.55);
            box-shadow:
                0 18px 45px rgba(0, 0, 0, 0.25),
                0 0 0 1px rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(18px);
            position: relative;
            overflow: hidden;
        }
        .glass-card::before {
            content: "";
            position: absolute;
            inset: -40%;
            background:
                radial-gradient(circle at 0 0, rgba(96, 165, 250, 0.18), transparent 55%),
                radial-gradient(circle at 100% 0, rgba(244, 114, 182, 0.18), transparent 55%);
            opacity: 0.9;
            pointer-events: none;
            z-index: -1;
        }
        .logo-circle {
            width: 48px;
            height: 48px;
            border-radius: 999px;
            background: conic-gradient(from 180deg, #4f46e5, #22c55e, #ec4899, #4f46e5);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.5rem;
        }
        .logo-inner {
            width: 32px;
            height: 32px;
            border-radius: 999px;
            background: #020617;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e5e7eb;
            font-weight: 700;
            font-size: 0.9rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        h1 {
            font-size: 1.5rem;
            margin-bottom: 0.35rem;
            color: #f9fafb;
        }
        .subtitle {
            font-size: 0.9rem;
            color: #9ca3af;
            margin-bottom: 1.75rem;
        }
        .message {
            display: none;
            padding: 0.75rem 1rem 0.75rem 2.6rem;
            border-radius: 0.75rem;
            font-size: 0.85rem;
            margin-bottom: 1.2rem;
            border: 1px solid transparent;
            position: relative;
            opacity: 0;
            transform: translateY(-6px);
            animation: fadeIn 0.35s ease forwards;
        }
        .message.error {
            display: block;
            background: rgba(239, 68, 68, 0.15);
            border-color: rgba(239, 68, 68, 0.4);
            color: #fca5a5;
        }
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(-6px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        @keyframes fadeOut {
            from {
                opacity: 1;
                transform: translateY(0);
            }
            to {
                opacity: 0;
                transform: translateY(-100px);
            }
        }
        @keyframes minimize {
            from {
                height: auto;
                margin: auto;
                padding: auto;
            }
            to {
                height: 0;
                margin: 0;
                padding: 0;
            }
        }
        .message.hide {
            animation: fadeOut 0.35s ease forwards, minimize 0.35s ease forwards 0.35s;
        }
        .field-group {
            margin-bottom: 1.1rem;
        }
        label {
            display: block;
            font-size: 0.8rem;
            font-weight: 500;
            color: #e5e7eb;
            margin-bottom: 0.35rem;
            text-transform: capitalize;
        }
        .input-wrapper {
            position: relative;
        }
        .input-wrapper span {
            position: absolute;
            left: 0.9rem;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.8rem;
            color: #6b7280;
            pointer-events: none;
        }
        input {
            width: 100%;
            padding: 0.7rem 0.9rem 0.7rem 2.1rem;
            border-radius: 0.8rem;
            border: 1px solid rgba(148, 163, 184, 0.4);
            background: rgba(15, 23, 42, 0.85);
            color: #e5e7eb;
            font-size: 0.9rem;
            outline: none;
        }
        .row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.4rem;
            margin-top: 0.2rem;
        }
        button {
            width: 100%;
            border: none;
            border-radius: 999px;
            padding: 0.75rem 1rem;
            margin-bottom: 1.1rem;
            background: linear-gradient(135deg, #4f46e5, #6366f1);
            color: #f9fafb;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="glass-card">
        <div class="logo-circle">
            <div class="logo-inner">AS</div>
        </div>
        <h1>OAuth2</h1>
        <p class="subtitle">Sign in to continue</p>
            ${props.errorMessage
      ? html`
                <div class="message error">${props.errorMessage}</div>
              `
      : ""}
        <form method="POST">
            <div class="field-group">
            <label for="${props.usernameField}">${props.usernameField}</label>
                <div class="input-wrapper">
                    <span>👤</span>
                    <input 
                      id="${props.usernameField}"
                      name="${props.usernameField}"
                      type="text"
                      placeholder="${props.usernameField}"
                      autocomplete="username"
                      value="${props.username || ""}"
                      required
                    />
                </div>
            </div>
            <div class="field-group">
                <label for="${props.passwordField}">${props.passwordField}</label>
                <div class="input-wrapper">
                    <span>🔒</span>
                    <input 
                      id="${props.passwordField}"
                      name="${props.passwordField}"
                      type="password"
                      placeholder="••••••••"
                      autocomplete="current-password"
                      required
                    />
                </div>
            </div>
            <div class="row"></div>
            <button type="submit">Sign in</button>
        </form>
    </div>
    <script>
        const msg = document.querySelector('.message');
        if (msg && !msg.classList.contains('hide')) {
            setTimeout(() => {
                msg.classList.add('hide');
            }, 3000);
        }
    </script>
</body>
</html>
    `;
}
export default app
