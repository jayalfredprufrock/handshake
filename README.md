<p align="center">
  <img src="handshake-logo.png" alt="Handshake" width="200" />
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@jayalfredprufrock/handshake"><img src="https://img.shields.io/npm/v/@jayalfredprufrock/handshake.svg" alt="npm version" /></a>
  <a href="https://github.com/jayalfredprufrock/handshake/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@jayalfredprufrock/handshake.svg" alt="license" /></a>
</p>

Tired of managing API schemas in multiple places? With handshake, you define each resource once using [TypeBox](https://github.com/sinclairzx81/typebox) schemas and compose those contracts into a single api. Server adapters consume that api, automatically providing strongly-typed and validated request and response objects. Consumers get a fully-typed HTTP client — no code generation, no compile step.

## Installation

```sh
npm install @jayalfredprufrock/handshake typebox
```

Hono is an optional peer dependency — install it if you're using the server adapter:

```sh
npm install hono
```

## Quick Start

### 1. Define a Contract

A contract describes a group of related endpoints — each with its HTTP method, path, request shapes (`params`, `query`, `body`, `headers`), and `response`. Compose one or more contracts into a single **api** with `createApi`; the api is the unit the server adapters, client, and OpenAPI generator all consume.

```ts
// contract.ts
import { createApi, createContract } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";

// A resource contract — endpoint paths are relative to the group's base path
export const users = createContract("/users", {
  getUser: {
    method: "GET",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String(), email: Type.String() }),
  },
  listUsers: {
    method: "GET",
    path: "/",
    response: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  },
  createUser: {
    method: "POST",
    path: "/",
    body: Type.Object({ name: Type.String(), email: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String(), email: Type.String() }),
    responseCode: 201, // success status (defaults to 200)
  },
});

// Compose the api — routes resolve to /api/users, /api/users/:id, etc.
export const api = createApi("/api", { users });
```

The first argument to both `createContract` and `createApi` is an optional base path that prefixes the paths beneath it (defaults to `"/"`). Pass only the endpoints/groups object to omit it.

### 2. Create a Server

Use `buildRoutes(api, "group", handlers)` to bind handlers to a named group, then assemble the Hono app with `createHonoApp`.

```ts
// server.ts
import { serve } from "@hono/node-server";
import { buildRoutes, createHonoApp } from "@jayalfredprufrock/handshake/hono";
import { api } from "./contract";

const users = new Map<string, { id: string; name: string; email: string }>();
let nextId = 1;

const routes = buildRoutes(api, "users", {
  getUser: ({ params }) => {
    const user = users.get(params.id);
    if (!user) throw api.error("NOT_FOUND", "user not found"); // see "Errors" below
    return user;
  },
  listUsers: () => [...users.values()],
  createUser: ({ body }) => {
    const id = String(nextId++);
    const user = { id, ...body };
    users.set(id, user);
    return user;
  },
});

const app = createHonoApp({ routes: [routes] });

serve({ fetch: app.fetch, port: 3000 });
```

Handler inputs are fully typed — `params`, `query`, `body`, and `headers` are inferred from the api. Handlers return plain objects (serialized as JSON) or a raw `Response` for full control. The named form implements the whole group, so `buildRoutes` throws immediately if any handler is missing.

The adapter validates every request automatically:

- **Path params, query params, and headers** are coerced to the schema (e.g. `"42"` → `42`).
- **Request bodies** are validated and reject missing or extra properties.
- **Responses** are validated by default — unknown properties are stripped, and a mismatch is treated as a server bug (see [Error handling](#error-handling)). Disable per group or per handler:

```ts
const routes = buildRoutes(api, "users", handlers, { validateResponse: false });

// or per handler via the closure form
const routes = buildRoutes(api, "users", (group) => {
  group.implement("listUsers", () => [...users.values()], { validateResponse: false });
});
```

Routes are sorted by path specificity before registration — literal segments take precedence over `:param` segments, so `/users/me` resolves to the literal handler regardless of definition order.

### 3. Create a Client

The client is generated directly from the api — no code generation. Each endpoint becomes a typed method.

```ts
// client.ts
import { createFetchClient } from "@jayalfredprufrock/handshake/client";
import { api } from "./contract";

const client = createFetchClient(api, { baseUrl: "http://localhost:3000" });

const users = await client.listUsers();
const created = await client.createUser({ name: "Alice", email: "alice@example.com" });
const user = await client.getUser({ id: created.id });
```

`fetch` defaults to `globalThis.fetch`; pass your own (Node fetch, a mock, etc.) via `fetch`. The client serializes JSON bodies, builds the URL, and parses the response for you.

Method signatures adapt to the endpoint: endpoints with path params take a params object first, endpoints with a body take it next, and an `options` object (`query`, `headers`, `request`) comes last. The `options` argument — and each of its fields — is **required only when the corresponding schema has a required property**, and optional otherwise.

## Errors

Errors are declared as a **code-keyed map**, where each `code` maps to its HTTP `status` and an optional `details` schema. Declare them on a contract (shown here) or api-wide in `createApi`'s options:

```ts
import { Type } from "typebox";
import { createApi, createContract } from "@jayalfredprufrock/handshake/contract";

export const accounts = createContract(
  "/accounts",
  {
    getUser: {
      method: "GET",
      path: "/:id",
      params: Type.Object({ id: Type.String() }),
      response: Type.Object({ id: Type.String() }),
    },
    transfer: { method: "POST", path: "/transfer", body: Transfer, response: Receipt },
  },
  {
    errors: {
      UNAUTHORIZED: { status: 401 },
      NOT_FOUND: { status: 404 },
      CONFLICT: { status: 409, details: Type.Object({ conflictingId: Type.String() }) },
    },
  },
);

export const api = createApi("/api", { accounts });
```

Errors are **api-wide** — once composed, the api merges every group's errors (plus any declared on the api itself), and any endpoint may return any of them. Codes are unique by construction (map keys).

### Raising errors (server)

The api exposes a typed `error` factory (each contract exposes the same for its own codes). The status comes from the code's definition; the second argument is the `Error.message`; the third is the code's `details` payload (required only when the code declares a `details` schema). Then just `throw` the result:

```ts
getUser: ({ params }) => {
  const user = db.find(params.id);
  if (!user) throw api.error("NOT_FOUND", `no user ${params.id}`); // → 404
  return user;
},
transfer: ({ body }) => {
  const dup = db.findTransfer(body.idempotencyKey);
  if (dup) throw api.error("CONFLICT", "duplicate transfer", { conflictingId: dup.id }); // → 409
  return db.transfer(body);
},
```

`ApiError` mirrors the wire envelope exactly — `{ code, status, message, details }` (plus a client-only `response`) — and the client reconstructs the same `ApiError` from the response. Undeclared codes and bad details are compile errors. You can also `throw new ApiError({ code, status, message, details })` directly for one-off cases.

### Handling errors (client)

A handshake error response is thrown as an `ApiError`; a non-handshake error response (proxy, gateway, foreign backend) is thrown as an [`HttpError`](#handling-errors-client); network failures propagate as-is. Recognize and narrow api errors with `api.isError` (the api is reachable from the client as `client.$api`):

```ts
import { api } from "./contract";

try {
  await client.getUser({ id: "42" });
} catch (err) {
  if (api.isError(err)) {
    switch (err.code) {
      case "NOT_FOUND":
        return null;
      case "UNAUTHORIZED":
        return login();
    }
  }
  throw err; // HttpError / network / unexpected
}

// or check a specific code directly
if (api.isError(err, "CONFLICT")) {
  err.details.conflictingId; // typed
}
```

`ApiError` is reserved for handshake errors. Anything else non-OK is an `HttpError` (`{ status, body, response }`), so `api.isError(err)` is `false` for it and it falls through to your unexpected-error branch.

### Error handling

Every error the server emits — declared or not — is a handshake error envelope, so clients reconstruct them uniformly as `ApiError`. Two codes are **reserved** by the framework and cannot be declared in a contract (but are always available to `api.error`/`api.isError`, since the client can receive them on any endpoint):

- **`VALIDATION_ERROR`** (400) — a request failed schema validation; `details` is a normalized `{ path?, keyword?, message }[]` array of issues.
- **`UNKNOWN_ERROR`** (500) — an unexpected error, or a handler response that failed validation. The cause is **never leaked** to the client; inspect or log it in `onError`. (The library never writes to the console itself.)

A thrown `ApiError` with a **recognized code** (declared by the api, or a built-in `VALIDATION_ERROR`/`UNKNOWN_ERROR`) is serialized automatically — wherever it's thrown (handler, middleware, service), with no `onError` needed. `onError` handles everything else: plain exceptions, Hono `HTTPException`s, and `ApiError`s with an unrecognized code. Return an `ApiError` to shape the response, or return nothing for the default — an `HTTPException` keeps its own status, anything else becomes `UNKNOWN_ERROR`. The server can **never** emit a non-`ApiError` body, regardless of what `onError` does:

```ts
import { ApiError } from "@jayalfredprufrock/handshake/contract";
import { ResponseValidationError } from "@jayalfredprufrock/handshake/server";

const app = createHonoApp({
  routes: [routes],
  onError: (err, c) => {
    // take special action on a known internal error — client still gets UNKNOWN_ERROR
    if (err instanceof ResponseValidationError) alert("contract drift", err.issues);
    if (err instanceof PaymentGatewayError) return api.error("UNAUTHORIZED", "gateway rejected");
    // return nothing → UNKNOWN_ERROR (cause never sent to the client)
  },
});
```

Any error that isn't a recognized contract error reaches `onError` fully intact (every property, the stack) while the client only ever sees the generic `UNKNOWN_ERROR` — so you can carry internal context on your own error classes and inspect it there.

## Request headers

Declare request headers per route (names **must be lowercase**), and the client sends them like query params:

```ts
secret: {
  method: "GET",
  path: "/secret",
  headers: Type.Object({ "x-api-key": Type.String() }),
  response: Type.Object({ ok: Type.Boolean() }),
},
```

```ts
await client.secret({ headers: { "x-api-key": key } }); // typed; required because the schema is
```

To enforce headers across **every** route, pass `headers` at the contract (or `createApi`) level — it's merged into each route's own headers:

```ts
const contract = createContract(endpoints, {
  headers: Type.Object({ authorization: Type.String() }),
});

// or api-wide, applied to every group
const api = createApi(
  "/api",
  { users },
  {
    headers: Type.Object({ authorization: Type.String() }),
  },
);
```

## Larger Apps

### Splitting contracts across files

Define each resource as its own contract and compose them into an api with `createApi`. The named-record form gives each group a name used by `buildRoutes` on the server:

```ts
// contracts/index.ts
import { createApi } from "@jayalfredprufrock/handshake/contract";
import { usersContract } from "./users";
import { postsContract } from "./posts";

export const api = createApi(
  "/api",
  { users: usersContract, posts: postsContract },
  {
    // optional api-wide `errors`, `headers`, and `meta`
  },
);
```

This barrel has zero server dependencies — safe to import from client bundles.

Each route file imports the api and calls `buildRoutes` with the group name:

```ts
// routes/users.ts
import { buildRoutes } from "@jayalfredprufrock/handshake/hono";
import { api } from "../contracts";

export const usersRoutes = buildRoutes(api, "users", {
  getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
  listUsers: () => [],
});
```

Use the closure form for per-group middleware:

```ts
import { bearerAuth } from "hono/bearer-auth";

export const postsRoutes = buildRoutes(api, "posts", (group) => {
  group.use(bearerAuth({ token: process.env.API_TOKEN! }));
  group.implement("getPost", ({ params }) => ({ id: params.id, title: "Hello" }));
});
```

Assemble the server by importing the route bundles — each is fully built at import time, with no shared mutable app instance:

```ts
import { createHonoApp } from "@jayalfredprufrock/handshake/hono";

const app = createHonoApp({ routes: [usersRoutes, postsRoutes] });
```

### Global middleware

`createHonoApp` returns a plain `Hono` instance. For app-level middleware (logging, CORS), mount it on your own root Hono:

```ts
import { Hono } from "hono";
import { logger } from "hono/logger";

const root = new Hono();
root.use("*", logger());
root.get("/health", (c) => c.json({ ok: true }));
root.route("/", createHonoApp({ routes: [usersRoutes, postsRoutes] }));
```

## Advanced client behavior

`createFetchClient` accepts hooks that run around the standard `fetch`:

```ts
import { createFetchClient } from "@jayalfredprufrock/handshake/client";
import { api } from "./contract";

const client = createFetchClient(api, {
  baseUrl: "https://api.example.com",

  // mutate/replace the outgoing request (re-runs each attempt — picks up a refreshed token)
  handleRequest: (ctx) => ctx.request.headers.set("authorization", `Bearer ${tokens.access}`),

  // reject an otherwise-successful response (e.g. an AWS WAF 202 challenge) or reshape an error
  handleResponse: (ctx) => {
    if (ctx.response?.status === 202) throw new WafChallenge();
  },

  // decide whether to retry a failed attempt; ctx.error is the ApiError / thrown error
  retry: async (ctx) => {
    if (ctx.error instanceof WafChallenge) {
      await solveChallenge();
      return true;
    }
    if (api.isError(ctx.error, "TOKEN_EXPIRED")) {
      await tokens.refresh();
      return true;
    }
    return false;
  },
});
```

## TypeBox utilities

`@jayalfredprufrock/handshake/typebox` ships `DeepPick` / `DeepOmit` — like `Type.Pick`/`Type.Omit`, but they support unions of objects and one level of nested keys via dot notation, with strongly-typed key paths:

```ts
import { DeepOmit } from "@jayalfredprufrock/handshake/typebox";

const Public = DeepOmit(User, ["password", "profile.secretToken"]);
```

## CRUD contracts

`createCrud` (from `/contract`) generates `get`/`list`/`create`/`update`/`delete` endpoints from a single schema, with `create` defaulting to `201`. See the docs for `params`/`hidden`/`readonly`/`immutable` options.

## License

MIT
