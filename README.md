<p align="center">
  <img src="handshake-logo.png" alt="Handshake" width="200" />
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@jayalfredprufrock/handshake"><img src="https://img.shields.io/npm/v/@jayalfredprufrock/handshake.svg" alt="npm version" /></a>
  <a href="https://github.com/jayalfredprufrock/handshake/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@jayalfredprufrock/handshake.svg" alt="license" /></a>
</p>

Tired of managing API schemas in multiple places? With handshake, you define your API contract once using [TypeBox](https://github.com/sinclairzx81/typebox) schemas. Server adapters then consume those contracts, automatically providing strongly-typed and validated request and response objects. Consumers get a fully-typed HTTP client without a compile step.

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

A contract describes every endpoint in your API: its HTTP method, path, path parameters, request body, and response shape.

```ts
// contract.ts
import { createContract } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";

export const contract = createContract("/api", {
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({
      id: Type.String(),
      name: Type.String(),
      email: Type.String(),
    }),
  },

  listUsers: {
    method: "GET",
    path: "/users",
    response: Type.Array(
      Type.Object({
        id: Type.String(),
        name: Type.String(),
        email: Type.String(),
      }),
    ),
  },

  createUser: {
    method: "POST",
    path: "/users",
    body: Type.Object({
      name: Type.String(),
      email: Type.String(),
    }),
    response: Type.Object({
      id: Type.String(),
      name: Type.String(),
      email: Type.String(),
    }),
  },

  deleteUser: {
    method: "DELETE",
    path: "/users/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String() }),
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
    if (!user) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }
    return user;
  },
  listUsers: () => [...users.values()],
  createUser: ({ body }) => {
    const id = String(nextId++);
    const user = { id, ...body };
    users.set(id, user);
    return user;
  },
  deleteUser: ({ params }) => {
    users.delete(params.id);
    return { id: params.id };
  },
});

const app = createHonoApp(contract, [module]);

serve({ fetch: app.fetch, port: 3000 });
```

Handler inputs are fully typed — `params`, `body`, and `query` are inferred from the contract. Handlers can return plain objects (automatically serialized as JSON) or raw `Response` objects for full control.

Providing a handler for every endpoint in the contract is enforced at call time — `implementContract` throws immediately if any handler is missing.

The adapter validates incoming requests automatically:

- **Path params** and **query params** are coerced to match the schema (e.g. string `"42"` becomes number `42`).
- **Request bodies** are validated and reject missing or extra properties.
- **Responses** are validated by default — unknown properties are stripped, and type mismatches produce a 500 error. Disable per module or per handler:

```ts
// Disable response validation for the whole module
const module = implementContract(contract, handlers, { validateResponse: false });

// Or per handler via the closure form
const module = implementContract(contract, (group) => {
  group.implement("listUsers", () => [...users.values()], { validateResponse: false });
  group.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
});
```

#### Route ordering

Routes are sorted by path specificity before registration — literal segments take precedence over `:param` segments at the same position. A contract with `/users/:id` and `/users/me` resolves `/users/me` to the literal handler regardless of endpoint definition order.

### 3. Create a Client

The client is generated directly from the contract — no code generation needed. Each endpoint becomes a typed method on the client object.

```ts
// client.ts
import { createFetchClient } from "@jayalfredprufrock/handshake/client";
import { contract } from "./contract";

const api = createFetchClient(contract, {
  baseUrl: "http://localhost:3000",
  async fetch(url, init) {
    const res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json" },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    return res.json();
  },
});

// All methods are fully typed
const users = await api.listUsers();
const created = await api.createUser({ name: "Alice", email: "alice@example.com" });
const user = await api.getUser({ id: created.id });
await api.deleteUser({ id: created.id });
```

Method signatures adapt to the endpoint definition — endpoints with path params take a params object as the first argument, endpoints with a body take it next, and query/request options are always last.

## Larger Apps

### Splitting contracts across files

For larger apps, define each resource as its own contract and combine them. Use `combineContracts` with a named-object form — the keys become group names used by `implementContract` on the server:

```ts
// contracts/users.ts
import { createContract } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";

export const usersContract = createContract("/users", {
  getUser: {
    method: "GET",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String() }),
  },
  listUsers: {
    method: "GET",
    path: "/",
    response: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  },
});
```

```ts
// contracts/index.ts
import { combineContracts } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";
import { usersContract } from "./users";
import { postsContract } from "./posts";

export const contract = combineContracts(
  { users: usersContract, posts: postsContract },
  { basePath: "/api" },
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

Use the closure form when you need per-group middleware:

```ts
// routes/posts.ts
import { implementContract } from "@jayalfredprufrock/handshake/hono";
import { bearerAuth } from "hono/bearer-auth";
import { contract } from "../contracts";

export const postsModule = implementContract(contract, "posts", (group) => {
  group.use(bearerAuth({ token: process.env.API_TOKEN! }));

  group.implement("getPost", ({ params }) => ({ id: params.id, title: "Hello" }));
  group.implement("listPosts", () => []);
});
```

Assemble the server by importing the modules:

```ts
// server.ts
import { createHonoApp } from "@jayalfredprufrock/handshake/hono";
import { contract } from "./contracts";
import { usersModule } from "./routes/users";
import { postsModule } from "./routes/posts";

const app = createHonoApp(contract, [usersModule, postsModule]);
```

Each module is fully built at import time — there is no shared mutable app instance and no `build()` call needed.

#### Global middleware

`createHonoApp` returns a plain `Hono` instance. To add app-level middleware (logging, CORS, auth, etc.), mount the returned app on your own root Hono using `route("/", ...)`:

```ts
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

const root = new Hono();
root.use("*", logger());
root.use("*", cors());
root.get("/health", (c) => c.json({ ok: true }));

root.route("/", createHonoApp(contract, [usersModule, postsModule]));
```

Middleware registered on `root` runs before all contract routes.

### Error contracts

Declare the errors an endpoint can return using `errors`. On the client, each endpoint gets a typed `isApiError` guard that narrows the error body:

```ts
// contracts/users.ts
import { Type } from "typebox";
import { createContract } from "@jayalfredprufrock/handshake/contract";

export const usersContract = createContract("/users", {
  getUser: {
    method: "GET",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String() }),
    errors: Type.Object({ code: Type.Literal("NOT_FOUND") }),
  },
});
```

On the server, throw an `ApiError` — it is passed through to the client automatically when its body matches the declared errors:

```ts
import { ApiError } from "@jayalfredprufrock/handshake/contract";

group.implement("getUser", ({ params }) => {
  const user = db.find(params.id);
  if (!user) throw new ApiError(404, { code: "NOT_FOUND" });
  return user;
});
```

On the client:

```ts
import { isApiError } from "@jayalfredprufrock/handshake/contract";

try {
  const user = await api.getUser({ id: "42" });
} catch (err) {
  if (api.getUser.isApiError(err)) {
    // err.body is typed as the full error union for this endpoint
  }
  if (api.getUser.isApiError("NOT_FOUND")(err)) {
    // err.body is narrowed to { code: "NOT_FOUND" }
  }
}
```

`isApiError` is also available as a standalone utility for use outside the client:

```ts
if (isApiError(err, "NOT_FOUND")) {
  // err.body.code is typed as "NOT_FOUND"
}
```

#### Global errors

Errors shared across all endpoints (e.g. `UNAUTHORIZED`, `INTERNAL_ERROR`) can be declared once on `combineContracts` (or `createContract`) using `globalErrors`. They are automatically merged into the effective error union for every endpoint:

```ts
export const contract = combineContracts(
  { users: usersContract, posts: postsContract },
  {
    basePath: "/api",
    globalErrors: Type.Object({ code: Type.Literal("UNAUTHORIZED") }),
  },
);
```

Provide an `errorHandler` on `createHonoApp` to convert unexpected errors (those that don't match any declared error schema) into a typed `ApiError`:

```ts
const app = createHonoApp(contract, [usersModule, postsModule], {
  errorHandler: (err) => new ApiError(500, { code: "INTERNAL_ERROR" }),
});
```

The `errorHandler` return type is constrained to `ApiError<Static<typeof globalErrors>>` when global errors are declared, keeping the type system consistent end-to-end.

## License

MIT

## TODO

1. Investigate pnpm catalog system. Remove unnecessary vite catalogs if possible (since we'll manage vite stuff at the monorepo root). But consider using catalogs to keep typebox version in sync across the monorepo.
