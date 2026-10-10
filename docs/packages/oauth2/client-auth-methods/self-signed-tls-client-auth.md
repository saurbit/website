# Self-Signed TLS Client Authentication

`self_signed_tls_client_auth` is the OAuth 2.0 Mutual TLS (mTLS) client authentication method defined in [RFC 8705](https://datatracker.ietf.org/doc/html/rfc8705). The client authenticates at the token endpoint by presenting a **self-signed X.509 certificate** during the TLS handshake. No client secret is exchanged.

Because the certificate is self-signed, it is not validated against a certificate authority. Instead, the authorization server trusts a certificate only if it matches one of the certificates the client registered in its **JWK Set** (the `x5c` member of a key, in `jwks` or in the document behind `jwks_uri`).

In `@saurbit/oauth2` this method is implemented by the `SelfSignedTlsClientAuthMethod` class. It is usually combined with `MtlsCertificateBoundTokenType` to issue **certificate-bound access tokens** (RFC 8705, section 3).

::: info Reverse proxy required
`@saurbit/oauth2` is runtime-agnostic and does not terminate TLS. mTLS is terminated by a reverse proxy (NGINX, Envoy, a cloud load balancer, …) that forwards the client certificate to the authorization server in HTTP headers. See [Reverse proxy setup](#proxy-setup).
:::

## How it works {#how-it-works}

1. The client sends `POST /token` over a mutual TLS connection, with `client_id` in the `application/x-www-form-urlencoded` body.
2. The reverse proxy extracts the client certificate and forwards it in request headers (`x-ssl-client-cert`, `x-ssl-client-verify`, …).
3. `SelfSignedTlsClientAuthMethod` reads the headers and the `client_id`, then calls your `getClientData` handler (optional) and your `getJwks` handler.
4. The certificate from the header is compared with the `x5c` certificates of the client's trusted JWKS. A match authenticates the client.
5. The flow's `getClient` handler receives the client ID, the client data (`clientAuthData`) and the PEM certificate (as `clientSecret`), so you can run additional checks and bind the issued tokens to the certificate.

The method only applies to `POST` requests with an `application/x-www-form-urlencoded` content type. If any condition fails (missing certificate, `x-ssl-client-verify` missing or `NONE`, missing `client_id`, no JWKS, no matching certificate), the method reports that it does not match and the flow moves on to the next registered authentication method.

---

## Setup {#setup}

```ts
import { SelfSignedTlsClientAuthMethod } from "@saurbit/oauth2";

const selfSignedTls = new SelfSignedTlsClientAuthMethod({
  getJwks: async (clientId, headers, clientData) => {
    // Return the client's trusted JWKS (containing x5c certificates)
    return await fetchClientJwks(clientData?.jwksUri);
  },
});
```

### Constructor options {#options}

| Option                   | Type                 | Default               | Description                                                                                                                   |
| ------------------------ | -------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `certHeaderName`         | `string`             | `x-ssl-client-cert`   | Header carrying the (URL-encoded) PEM client certificate.                                                                      |
| `certVerifyHeaderName`   | `string`             | `x-ssl-client-verify` | Header carrying the proxy verification result (`SUCCESS`, `FAILED:…`, `NONE`). Requests with `NONE` or no value are ignored.   |
| `certDnHeaderName`       | `string`             | `x-ssl-client-dn`     | Header carrying the certificate subject distinguished name.                                                                    |
| `certSanHeaderName`      | `string`             | `x-ssl-client-san`    | Header carrying the subject alternative name(s).                                                                               |
| `certExpireHeaderName`   | `string`             | `x-ssl-client-expire` | Header carrying the certificate expiration date.                                                                               |
| `additionalHeadersNames` | `string[]`           | `[]`                  | Extra headers to read and pass to the handlers as `headers.additionalHeaders`.                                                 |
| `getJwks`                | `TrustedJwksHandler` | —                     | Returns the client's trusted JWKS. Without it no client can authenticate.                                                      |
| `getClientData`          | `function`           | —                     | Same as [`getClientData(handler)`](#get-client-data).                                                                          |

### Handler headers {#handler-headers}

Both `getJwks` and `getClientData` receive the headers read from the request, as a `TlsClientAuthHeadersValues` object:

| Property            | Type                     | Description                                               |
| ------------------- | ------------------------ | --------------------------------------------------------- |
| `cert`              | `string`                 | The raw (URL-encoded PEM) certificate header value.       |
| `certVerify`        | `string`                 | The proxy verification result.                            |
| `certDn`            | `string \| undefined`    | The subject distinguished name.                           |
| `certSan`           | `string \| undefined`    | The subject alternative name(s).                          |
| `certExpire`        | `string \| undefined`    | The certificate expiration date.                          |
| `additionalHeaders` | `Record<string, string>` | Values of the headers listed in `additionalHeadersNames`. |

### Configuration {#configuration}

#### `getClientData(handler)` {#get-client-data}

```ts
selfSignedTls.getClientData(async (clientId, { certDn, certExpire }) => {
  if (certExpire && Date.now() > new Date(certExpire).getTime()) {
    return undefined; // expired certificate
  }
  return await db.findClientBySubjectDnAndId(certDn ?? "", clientId);
});
```

Optionally resolves the client record from the `client_id` and the certificate headers. It is invoked **before** `getJwks`. Its result is passed to `getJwks` as the third argument, and is exposed as `tokenRequest.clientAuthData` in the flow builder's [`getClient`](/packages/oauth2/builders#client-auth-data) handler. It is the right place to bind a `client_id` to an expected certificate subject DN or to reject expired certificates.

#### `getJwks` option {#get-jwks}

```ts
type TrustedJwksHandler = (
  clientId: string,
  headers: TlsClientAuthHeadersValues,
  clientData?: Partial<OAuth2Client>,
) => Promise<TrustedJwks | undefined> | TrustedJwks | undefined;
```

Returns the client's trusted JWKS, or `undefined` if the client has none (authentication then fails). Each key that should be accepted must carry the base64 DER certificate in `x5c`:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "…",
      "e": "AQAB",
      "x5c": ["MIIC…"]
    }
  ]
}
```

::: tip Best practice
Retrieve the JWKS from a trusted source, typically the `jwks_uri` registered for the client, and cache it. Never take it from the request itself.
:::

#### `addAlgorithm(algo)` {#add-algorithm}

```ts
selfSignedTls.addAlgorithm(SelfSignedTlsClientAuthMethod.algo.ES256);
```

Adds an accepted key algorithm. Defaults to `RS256` when none is added. Keys of the JWKS are matched by their `alg` member, or inferred from `kty`/`crv` when absent (`RSA` → `RS256`, `P-256` → `ES256`, `P-384` → `ES384`, `P-521` → `ES512`, `Ed25519`/`Ed448` → `EdDSA`). Keys whose algorithm is not accepted are skipped.

| Algorithm                 | Description                              |
| ------------------------- | ---------------------------------------- |
| `RS256`, `RS384`, `RS512` | RSASSA-PKCS1-v1_5 using SHA-256/384/512. |
| `PS256`, `PS384`, `PS512` | RSASSA-PSS using SHA-256/384/512.        |
| `ES256`, `ES384`, `ES512` | ECDSA using P-256, P-384 and P-521.      |
| `EdDSA`                   | Edwards-curve DSA (Ed25519/Ed448).       |

::: warning
A client using an EC or EdDSA certificate requires the matching algorithm to be added, otherwise its key is skipped and authentication fails.
:::

#### `createCertificateBoundTokenType(decodeTokenPayload, boundRefreshToken?)` {#create-bound-token-type}

```ts
const tokenType = selfSignedTls.createCertificateBoundTokenType(
  async (token, isRefreshToken) => {
    if (isRefreshToken) return await getRefreshTokenData(token);
    return await jwksAuthority.verify(token);
  },
  true, // also bind refresh tokens
);
```

Creates a `MtlsCertificateBoundTokenType` that reuses this method's `certHeaderName`. Register it with the builder's `setTokenType()` so that:

- protected resource requests are accepted only if the presented certificate's SHA-256 thumbprint equals the access token's `cnf["x5t#S256"]` claim;
- when `boundRefreshToken` is `true`, `refresh_token` grant requests are accepted only from the certificate the refresh token was bound to.

`decodeTokenPayload` must return the decoded and **verified** payload of the access token (or the stored data of the refresh token when `isRefreshToken` is `true`), or `undefined` when invalid. A bound refresh token's data must carry the `cnf` claim as well.

The token type also exposes helpers for issuing bound tokens:

| Method                                                 | Description                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `computeThumbprint(pem)`                               | Returns `{ x5tS256 }`, the base64url SHA-256 thumbprint of the certificate. Accepts the URL-encoded PEM of the header.   |
| `applyBinding(claims, pemOrThumbprint)`                | Adds the thumbprint to the `cnf` claim (`x5t#S256`) of `claims`.                                                         |
| `addThumbprintToCnfClaim(claims, thumbprint)`          | Lower-level variant of `applyBinding` taking a precomputed thumbprint.                                                   |
| `calculateX5tS256(pem)`, `calculateHexThumbprint(pem)` | Thumbprint as base64url or lowercase hex.                                                                                |

::: tip
The certificate received in the header is URL-encoded. Compute the thumbprint with `computeThumbprint()` and give that thumbprint to `applyBinding()`.
:::

---

## Reverse proxy setup {#proxy-setup}

The proxy must request the client certificate on the token endpoint and forward it. Since the certificate is self-signed it cannot be validated against a CA, so use `optional_no_ca` and let the authorization server verify it through the JWKS. Example for NGINX:

```nginx
events { worker_connections 1024; }

http {
  server {
    listen 443 ssl;
    server_name localhost;

    ssl_certificate     /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;

    # Ask for a client certificate, but don't validate it against a CA
    ssl_client_certificate /etc/nginx/certs/ca.crt;
    ssl_verify_client      optional_no_ca;

    # mTLS endpoints: token endpoint and protected resources
    location ~ ^/(oauth2/token|api/) {
      proxy_pass http://auth-server:3000;

      # Reject expired certificates early
      if ($ssl_client_verify ~ "^FAILED:certificate\s+has\s+expired$") {
        return 401 "{\"error\": \"invalid_client\", \"error_description\": \"Client certificate expired\"}";
      }

      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;

      # Always set (overwrite) the mTLS headers
      proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
      proxy_set_header X-SSL-Client-DN     $ssl_client_s_dn;
      proxy_set_header X-SSL-Client-Cert   $ssl_client_escaped_cert;
      proxy_set_header X-SSL-Client-SAN    "";
      proxy_set_header X-SSL-Client-Expire $ssl_client_v_end;
    }

    # Everything else (e.g. the browser-facing authorization endpoint): no mTLS
    location / {
      proxy_pass http://auth-server:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

::: danger Never trust forwarded headers from the outside
The authorization server trusts the `x-ssl-client-*` headers. The proxy must always **overwrite** them on mTLS endpoints, and the authorization server must only be reachable through the proxy. Otherwise any caller could forge a certificate header.
:::

If you use different header names, pass them to the constructor (`certHeaderName`, `certDnHeaderName`, …).

---

## Authorization server example {#server-example}

The following sets up the Authorization Code flow with `self_signed_tls_client_auth`, certificate-bound access tokens and certificate-bound refresh tokens, using [Hono](https://hono.dev) and `@saurbit/oauth2-jwt`.

```ts
import { HonoAuthorizationCodeFlowBuilder } from "@saurbit/hono-oauth2";
import {
  type CertificateBoundValidationResponse,
  SelfSignedTlsClientAuthMethod,
} from "@saurbit/oauth2";
import { createInMemoryKeyStore, JoseJwksAuthority } from "@saurbit/oauth2-jwt";

const jwksAuthority = new JoseJwksAuthority(createInMemoryKeyStore(), 8.64e6);

// 1. Client authentication method
const selfSignedTls = new SelfSignedTlsClientAuthMethod({
  certHeaderName: "x-ssl-client-cert",
  certDnHeaderName: "x-ssl-client-dn",
  certExpireHeaderName: "x-ssl-client-expire",
  // The client's trusted JWKS is published at its registered jwks_uri
  getJwks: async (_clientId, _headers, clientData) =>
    typeof clientData?.jwksUri === "string" ? await fetchJwks(clientData.jwksUri) : undefined,
}).getClientData(async (clientId, { certDn, certExpire }) =>
  certExpire && Date.now() > new Date(certExpire).getTime()
    ? undefined
    : await findClientBySubjectDnAndId(certDn ?? "", clientId)
);

// 2. Certificate-bound token type (access + refresh tokens)
const certificateBoundTokenType = selfSignedTls.createCertificateBoundTokenType(
  async (token, isRefreshToken) =>
    isRefreshToken ? await getRefreshTokenData(token) : await jwksAuthority.verify(token),
  true,
);

// 3. Flow
export const authCodeFlow = new HonoAuthorizationCodeFlowBuilder({
  securitySchemeName: "authCodeMtls",
  scopes: {
    offline_access: "Request refresh token for offline access",
    "content:read": "Read access to content",
  },
  authorizationEndpoint: "/oauth2/authorize",
  tokenEndpoint: "/oauth2/token",
  accessTokenLifetime: 3600,
  parseAuthorizationEndpointData: async (c) => ({ /* … */ }),
})
  .addClientAuthenticationMethod(selfSignedTls)
  .setTokenType(certificateBoundTokenType)
  .getClientForAuthentication(async (data) => { /* validate client_id and redirect_uri */ })
  .getUserForAuthentication(async (_c, parsedData) => { /* … */ })
  .generateAuthorizationCode(async (grantContext, user) => { /* … */ })
  .getClient(async (tokenRequest) => {
    // Resolved by getClientData during client authentication
    const client = tokenRequest.clientAuthData as ClientData | undefined;
    // For this method, clientSecret holds the PEM certificate from the header
    const pem = tokenRequest.clientSecret;
    if (!client || !pem) return undefined;

    const { x5tS256 } = await certificateBoundTokenType.computeThumbprint(pem);

    // … validate the authorization code (and PKCE) or the refresh token …

    return {
      id: client.clientId,
      grants: client.grantTypes,
      redirectUris: client.redirectUris,
      scopes: client.allowedScopes,
      // Carry the thumbprint to the token generation step
      metadata: { incomingThumbprint: x5tS256, /* accessScope, userId, … */ },
    };
  })
  .generateAccessToken(async (grantContext) => {
    const thumbprint = grantContext.client.metadata?.incomingThumbprint;
    if (typeof thumbprint !== "string") return undefined;

    const now = Math.floor(Date.now() / 1000);
    // Adds cnf["x5t#S256"] to the claims
    const claims = await certificateBoundTokenType.applyBinding(
      {
        exp: now + grantContext.accessTokenLifetime,
        iat: now,
        nbf: now,
        iss: grantContext.origin,
        aud: grantContext.client.id,
        jti: crypto.randomUUID(),
        sub: `${grantContext.client.metadata?.userId}`,
      },
      thumbprint,
    );
    const { token: accessToken } = await jwksAuthority.sign({ scope: "content:read", ...claims });

    // Bind the stored refresh token to the same certificate
    const refreshToken = crypto.randomUUID();
    await storeRefreshToken(refreshToken, {
      clientId: grantContext.client.id,
      /* userId, scope, expiresAt, … */
      ...(await certificateBoundTokenType.applyBinding({}, thumbprint)),
    });

    return { accessToken, scope: ["content:read"], refreshToken };
  })
  .generateAccessTokenFromRefreshToken(async (grantContext) => { /* same as above */ })
  .tokenVerifier(async (_c, { tokenTypeValidation }) => {
    // Payload already verified and the certificate thumbprint already matched
    const payload = (tokenTypeValidation as CertificateBoundValidationResponse).data?.mtlsPayload;
    if (!payload || typeof payload.scope !== "string" || !payload.sub) {
      return { isValid: false, message: "Malformed token payload." };
    }
    const user = await findUserById(payload.sub);
    if (!user) return { isValid: false, message: "User not found." };
    return { isValid: true, credentials: { user, scope: payload.scope.split(" ") } };
  })
  .build();
```

Key points:

- `getClientData` matches the registered client against the certificate subject DN, and `getJwks` fetches the trusted certificates from the client's `jwks_uri`.
- In `getClient`, `tokenRequest.clientSecret` is the certificate PEM, not a secret. Compute its thumbprint and propagate it to `generateAccessToken()` through the client `metadata`.
- Call `applyBinding()` when signing the access token (and when storing the refresh token if you bind it) to add the `cnf` claim.
- On protected resources, the `tokenTypeValidation` result passed to `tokenVerifier` carries the verified payload in `data.mtlsPayload` and the matched thumbprint in `data.mtlsThumbprint`.

Add a guard (your own middleware checking the proxy headers) in front of the token endpoint and the protected resources, so unauthenticated requests are rejected early:

```ts
app.use("/api/*", mtlsGuard());
app.use(authCodeFlow.getTokenEndpoint(), mtlsGuard());

app.post(authCodeFlow.getTokenEndpoint(), async (c) => {
  const result = await authCodeFlow.hono().token(c);
  return result.success ? c.json(result.tokenResponse) : c.json({ error: "invalid_request" }, 400);
});

app.get(
  "/api/protected-resource",
  authCodeFlow.hono().authorizeMiddleware(["content:read"]),
  (c) => c.json({ message: "Hello!" }),
);
```

See [Authorization Code](/packages/oauth2/authorization-code) and [Builders](/packages/oauth2/builders) for the other handlers.

---

## Client requirements {#client}

### Certificate {#client-certificate}

Generate a key pair and a self-signed certificate (RSA here, matching the default `RS256` algorithm):

```bash
openssl genrsa -out self-signed-client.key 2048
openssl req -new -x509 -days 365 \
  -key self-signed-client.key \
  -out self-signed-client.crt \
  -subj "/CN=test-client-id"
```

### Publish the certificate in a JWKS {#client-jwks}

The client exposes (or registers) a JWKS whose key contains the certificate in `x5c`. The `x5c` value is the base64 DER body of the PEM (no header/footer, no line breaks).

```ts
import { exportJWK, importX509 } from "jose";

app.get("/.well-known/jwks.json", async (c) => {
  const pem = await Bun.file("/etc/ssl/certs/self-signed-client.crt").text();
  const x5c = pem
    .replace(/-----\s*(BEGIN|END) ?[^-]*-----/g, "")
    .replace(/\s+/g, "");

  const jwk = await exportJWK(await importX509(pem, "RS256"));
  return c.json({ keys: [{ ...jwk, alg: "RS256", use: "sig", x5c: [x5c] }] });
});
```

The authorization server must know the URL of this document (`jwks_uri`) for the client. In the example it is stored with the client record.

### Calling the token endpoint {#client-token-request}

The token request must be sent over a TLS connection that presents the client certificate, and must include `client_id` in the form body:

```ts
const response = await fetch("https://nginx/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "example-client",
    code,
    redirect_uri: "http://localhost:3001/callback",
    code_verifier: codeVerifier,
  }).toString(),
  // Bun runtime TLS options; other runtimes have equivalents
  tls: {
    key: clientKey,
    cert: clientCert,
    ca: caCert, // CA that signed the proxy's server certificate
    rejectUnauthorized: true,
    serverName: "localhost", // must match the server certificate identity
  },
});
```

The same certificate must be presented when refreshing tokens and when calling protected resources with the access token, otherwise the certificate-bound token is rejected:

```
POST /oauth2/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&client_id=example-client&refresh_token=3f1c…
```

---

## Complete example with Docker Compose {#docker-example}

A runnable example wires all the pieces together with `docker compose`:

| Service       | Role                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx`       | Terminates TLS on port `443`, requests the client certificate (`optional_no_ca`) and forwards it in `X-SSL-Client-*` headers.                                          |
| `auth-server` | Hono authorization server using `SelfSignedTlsClientAuthMethod` and `MtlsCertificateBoundTokenType`. Only reachable through NGINX.                                      |
| `client-app`  | Web app with a backend that runs the Authorization Code flow (with PKCE) and uses mTLS for the token exchange, refresh and API calls. Exposes its JWKS at `/.well-known/jwks.json`. |

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - auth-server

  auth-server:
    build: ./auth-server
    environment:
      - NODE_ENV=development

  client-app:
    build: ./client-app
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=development
    volumes:
      - ./certs/ca.crt:/etc/ssl/certs/ca.crt:ro
      - ./certs-self-signed/self-signed-client.key:/etc/ssl/certs/self-signed-client.key:ro
      - ./certs-self-signed/self-signed-client.crt:/etc/ssl/certs/self-signed-client.crt:ro
```

### 1. Create the certificates {#docker-certs}

Use Linux or WSL with OpenSSL installed.

```bash
# Private CA and the NGINX server certificate (used by the client to trust the proxy)
mkdir certs && cd certs
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj "/CN=Local-Testing-CA"
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=localhost"
openssl x509 -req -days 365 -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt
cd ..

# Self-signed client certificate (RS256)
mkdir certs-self-signed && cd certs-self-signed
openssl genrsa -out self-signed-client.key 2048
openssl req -new -x509 -days 365 \
  -key self-signed-client.key \
  -out self-signed-client.crt \
  -subj "/CN=test-client-id"
cd ..
```

::: warning
The registered client's `subjectDn` must equal the subject of the client certificate as NGINX reports it in `$ssl_client_s_dn` (for example `CN=test-client-id`), since `getClientData` matches on it.
:::

### 2. Register the client {#docker-client}

The authorization server stores, for the client, its redirect URI, grant types, the expected certificate subject DN and the `jwks_uri` from which the trusted certificate is fetched:

```ts
const clients = [
  {
    clientId: "example-client",
    allowedScopes: ["content:read", "content:write", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
    redirectUris: ["http://localhost:3001/callback"],
    jwksUri: "http://client-app:3001/.well-known/jwks.json",
    subjectDn: "CN=test-client-id",
  },
];
```

### 3. Run it {#docker-run}

```bash
docker compose up --build
```

Then, in a browser:

1. Open `http://localhost:3001/login`. The client creates a PKCE pair and redirects to `https://localhost/oauth2/authorize` (the authorization endpoint does not require a client certificate).
2. Sign in and give consent on the authorization server. The browser is redirected to `http://localhost:3001/callback?code=…`.
3. The client backend exchanges the code at `https://nginx/oauth2/token` over mTLS. The server authenticates it through `self_signed_tls_client_auth` and returns an access token and a refresh token bound to the client certificate.
4. Open `http://localhost:3001/protected`: the client calls `https://nginx/api/protected-resource` with the access token and the same certificate, and gets a `200`.
5. Open `http://localhost:3001/refresh` to exchange the refresh token over mTLS for new tokens.

Calling the protected resource or the refresh endpoint **without** the client certificate (or with another one) fails, even if the token is valid. That is the certificate binding at work.

::: tip Browser trust
The `localhost` server certificate is signed by your private CA. Browsers warn about it on `https://localhost/oauth2/authorize` unless you trust `ca.crt`.
:::

---

## Security considerations {#security}

- **Protect the proxy boundary.** The authorization server blindly trusts the forwarded `x-ssl-client-*` headers. Overwrite them on every mTLS location and never expose the authorization server directly.
- **Trust comes from the JWKS, not from a CA.** With `optional_no_ca`, NGINX accepts any certificate. The client is authenticated only if its certificate matches an `x5c` entry of the JWKS you obtained from a trusted source for that `client_id`.
- **Check validity yourself.** Reject expired certificates, at the proxy and/or in `getClientData` using `certExpire`.
- **Bind the client to its certificate.** Matching `client_id` with the certificate subject DN in `getClientData` prevents a client from authenticating as another registered client.
- **Use certificate-bound tokens.** Bind access tokens (and refresh tokens) through `createCertificateBoundTokenType()` so a leaked token is useless without the private key.
- **Use PKCE** with the Authorization Code flow, as shown in the example.

## See also {#see-also}

- [Client Authentication Methods](/packages/oauth2/client-auth-methods)
- [Builders: `clientAuthData`](/packages/oauth2/builders#client-auth-data)
- [Token Types](/packages/oauth2/token-types)
- [RFC 8705: OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://datatracker.ietf.org/doc/html/rfc8705)
