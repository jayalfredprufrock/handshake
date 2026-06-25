<p align="center">
  <img src="handshake-logo.png" alt="Handshake" width="200" />
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@jayalfredprufrock/handshake"><img src="https://img.shields.io/npm/v/@jayalfredprufrock/handshake.svg" alt="npm version" /></a>
  <a href="https://github.com/jayalfredprufrock/handshake/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@jayalfredprufrock/handshake.svg" alt="license" /></a>
</p>

Tired of managing API schemas in multiple places? With handshake, you define your API contract once using [TypeBox](https://github.com/sinclairzx81/typebox) schemas. Server adapters consume those contracts, automatically providing strongly-typed and validated request and response objects. Consumers get a fully-typed HTTP client — no code generation, no compile step.

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

A contract describes every endpoint in your API: its HTTP method, path, request shapes (`params`, `query`, `body`, `headers`), and `response`.

```ts
// contract.ts
import { createContract } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";

export const contract = createContract("/api", {
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String(), email: Type.String() }),
  },
  listUsers: {
    method: "GET",
    path: "/users",
    response: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  },
  createUser: {
    method: "POST",
    path: "/users",
    body: Type.Object({ name: Type.String(), email: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String(), email: Type.String() }),
    responseCode: 201, // success status (defaults to 200)
  },
});
```

The first argument is an optional base path that prefixes all endpoint paths (defaults to `"/"`). Pass only the endpoints object to omit it.

### 2. Create a Server

Use `implementContract` to bind handlers to a contract, then assemble the Hono app with `createHonoApp`.

```ts
// server.ts
import { serve } from "@hono/node-server";
import { implementContract, createHonoApp } from "@jayalfredprufrock/handshake/hono";
import { contract } from "./contract";

const users = new Map<string, { id: string; name: string; email: string }>();
let nextId = 1;

const module = implementContract(contract, {
  getUser: ({ params }) => {
    const user = users.get(params.id);
    if (!user) throw contract.error("NOT_FOUND"); // see "Errors" below
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

const app = createHonoApp([module]);

serve({ fetch: app.fetch, port: 3000 });
```

Handler inputs are fully typed — `params`, `query`, `body`, and `headers` are inferred from the contract. Handlers return plain objects (serialized as JSON) or a raw `Response` for full control. `implementContract` throws immediately if any handler is missing.

The adapter validates every request automatically:

- **Path params, query params, and headers** are coerced to the schema (e.g. `"42"` → `42`).
- **Request bodies** are validated and reject missing or extra properties.
- **Responses** are validated by default — unknown properties are stripped, and a mismatch is treated as a server bug (see [Error handling](#error-handling)). Disable per module or per handler:

```ts
const module = implementContract(contract, handlers, { validateResponse: false });

// or per handler via the closure form
const module = implementContract(contract, (group) => {
  group.implement("listUsers", () => [...users.values()], { validateResponse: false });
});
```

Routes are sorted by path specificity before registration — literal segments take precedence over `:param` segments, so `/users/me` resolves to the literal handler regardless of definition order.

### 3. Create a Client

The client is generated directly from the contract — no code generation. Each endpoint becomes a typed method.

```ts
// client.ts
import { createFetchClient } from "@jayalfredprufrock/handshake/client";
import { contract } from "./contract";

const api = createFetchClient(contract, { baseUrl: "http://localhost:3000" });

const users = await api.listUsers();
const created = await api.createUser({ name: "Alice", email: "alice@example.com" });
const user = await api.getUser({ id: created.id });
```

`fetch` defaults to `globalThis.fetch`; pass your own (Node fetch, a mock, etc.) via `fetch`. The client serializes JSON bodies, builds the URL, and parses the response for you.

Method signatures adapt to the endpoint: endpoints with path params take a params object first, endpoints with a body take it next, and an `options` object (`query`, `headers`, `request`) comes last. The `options` argument — and each of its fields — is **required only when the corresponding schema has a required property**, and optional otherwise.

## Errors

Errors are declared once on the contract as a **status-keyed map**, where each error body is discriminated by a `code` literal:

```ts
import { Type } from "typebox";
import { createContract } from "@jayalfredprufrock/handshake/contract";

export const contract = createContract(
  "/api",
  {
    getUser: {
      method: "GET",
      path: "/users/:id",
      params: Type.Object({ id: Type.String() }),
      response: Type.Object({ id: Type.String() }),
    },
    transfer: { method: "POST", path: "/transfer", body: Transfer, response: Receipt },
  },
  {
    errors: {
      401: Type.Object({ code: Type.Literal("UNAUTHORIZED") }),
      404: Type.Object({ code: Type.Literal("NOT_FOUND") }),
      409: Type.Object({ code: Type.Literal("CONFLICT"), conflictingId: Type.String() }),
    },
  },
);
```

Errors are **contract-wide** — any endpoint may return any declared error. Codes must be unique across statuses.

### Raising errors (server)

The contract exposes a typed `error` factory that infers the status from the code — just `throw` the result:

```ts
getUser: ({ params }) => {
  const user = db.find(params.id);
  if (!user) throw contract.error("NOT_FOUND"); // → 404
  return user;
},
transfer: ({ body }) => {
  const dup = db.findTransfer(body.idempotencyKey);
  if (dup) throw contract.error("CONFLICT", { conflictingId: dup.id }); // → 409, typed extra fields
  return db.transfer(body);
},
```

Undeclared codes and missing/extra fields are compile errors. You can also `throw new ApiError(status, body)` directly for one-off cases.

### Handling errors (client)

Any non-OK response is thrown as an `ApiError`; network failures propagate as-is. Recognize and narrow contract errors with `contract.isError` (the contract is reachable from the client as `client.$contract`):

```ts
import { contract } from "./contract";

try {
  await api.getUser({ id: "42" });
} catch (err) {
  if (contract.isError(err)) {
    // err.body is the contract's error union; narrow with your own discriminator
    switch (err.body.code) {
      case "NOT_FOUND":
        return null;
      case "UNAUTHORIZED":
        return login();
    }
  }
  throw err; // network / unexpected
}

// or check a specific code directly
if (contract.isError(err, "CONFLICT")) {
  err.body.conflictingId; // typed
}
```

`code` is just a convention for _your_ errors — narrow on whatever discriminator your schemas use (`kind`, `type`, …). The library never forces it.

### Error handling

Every error the server emits — declared or not — is an `ApiError` with a `{ code }` body, so clients handle them uniformly. Two codes are **reserved** by the framework and cannot be declared in a contract:

- **`VALIDATION_ERROR`** (400) — a request failed schema validation; the body includes `issues`.
- **`UNKNOWN_ERROR`** (500) — an unexpected error, or a handler response that failed validation. The cause is **never leaked** to the client and is logged on the server.

Map unexpected (non-`ApiError`) errors to a typed `ApiError` with `onError`. Returning an `ApiError` shapes the response; returning nothing falls through to `UNKNOWN_ERROR`. The server can **never** emit a non-`ApiError` body, regardless of what `onError` does:

```ts
import { ApiError } from "@jayalfredprufrock/handshake/contract";
import { ResponseValidationError } from "@jayalfredprufrock/handshake/server";

const app = createHonoApp([module], {
  onError: (err, c) => {
    // take special action on a known internal error — client still gets UNKNOWN_ERROR
    if (err instanceof ResponseValidationError) alert("contract drift", err.issues);
    if (err instanceof PaymentGatewayError) return contract.error("UNAUTHORIZED");
    // return nothing → UNKNOWN_ERROR (logged)
  },
});
```

Any error you throw from a handler that isn't a declared `ApiError` reaches `onError` fully intact (every property, the stack) while the client only ever sees the generic `UNKNOWN_ERROR` — so you can carry internal context on your own error classes and inspect it there.

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
await api.secret({ headers: { "x-api-key": key } }); // typed; required because the schema is
```

To enforce headers across **every** route, pass `headers` at the contract (or `combineContracts`) level — it's merged into each route's own headers:

```ts
const contract = createContract(endpoints, {
  headers: Type.Object({ authorization: Type.String() }),
});
```

## Larger Apps

### Splitting contracts across files

Define each resource as its own contract and combine them. The named-object form gives each group a name used by `implementContract` on the server:

```ts
// contracts/index.ts
import { combineContracts } from "@jayalfredprufrock/handshake/contract";
import { usersContract } from "./users";
import { postsContract } from "./posts";

export const contract = combineContracts(
  { users: usersContract, posts: postsContract },
  { basePath: "/api" }, // also accepts contract-wide `errors` and `headers`
);
```

This barrel has zero server dependencies — safe to import from client bundles.

Each route file imports the combined contract and calls `implementContract` with the group name:

```ts
// routes/users.ts
import { implementContract } from "@jayalfredprufrock/handshake/hono";
import { contract } from "../contracts";

export const usersModule = implementContract(contract, "users", {
  getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
  listUsers: () => [],
});
```

Use the closure form for per-group middleware:

```ts
import { bearerAuth } from "hono/bearer-auth";

export const postsModule = implementContract(contract, "posts", (group) => {
  group.use(bearerAuth({ token: process.env.API_TOKEN! }));
  group.implement("getPost", ({ params }) => ({ id: params.id, title: "Hello" }));
});
```

Assemble the server by importing the modules — each is fully built at import time, with no shared mutable app instance:

```ts
import { createHonoApp } from "@jayalfredprufrock/handshake/hono";

const app = createHonoApp([usersModule, postsModule]);
```

### Global middleware

`createHonoApp` returns a plain `Hono` instance. For app-level middleware (logging, CORS), mount it on your own root Hono:

```ts
import { Hono } from "hono";
import { logger } from "hono/logger";

const root = new Hono();
root.use("*", logger());
root.get("/health", (c) => c.json({ ok: true }));
root.route("/", createHonoApp([usersModule, postsModule]));
```

## Advanced client behavior

`createFetchClient` accepts hooks that run around the standard `fetch`:

```ts
import { createFetchClient } from "@jayalfredprufrock/handshake/client";
import { contract } from "./contract";

const api = createFetchClient(contract, {
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
    if (contract.isError(ctx.error, "TOKEN_EXPIRED")) {
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
