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
import { makeContract } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";

export const contract = makeContract("/api", {
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

The first argument to `makeContract` is an optional base path that prefixes all endpoint paths. Omit it to default to `"/"`.

### 2. Create a Server

Use the Hono adapter to bind handlers to the contract. Every endpoint must have a handler registered before the app can be built — if you miss one, `build()` throws at startup.

```ts
// server.ts
import { serve } from "@hono/node-server";
import { createHonoApp } from "@jayalfredprufrock/handshake/hono";
import { contract } from "./contract";

const users = new Map<string, { id: string; name: string; email: string }>();
let nextId = 1;

const api = createHonoApp(contract);

api.implement("getUser", ({ params }) => {
  const user = users.get(params.id);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }
  return user;
});

api.implement("listUsers", () => [...users.values()]);

api.implement("createUser", ({ body }) => {
  const id = String(nextId++);
  const user = { id, ...body };
  users.set(id, user);
  return user;
});

api.implement("deleteUser", ({ params }) => {
  users.delete(params.id);
  return { id: params.id };
});

const app = api.build();

serve({ fetch: app.fetch, port: 3000 });
```

Handler inputs are fully typed — `params`, `body`, and `query` are inferred from the contract. Handlers can return plain objects (automatically serialized as JSON) or raw `Response` objects for full control.

The adapter validates incoming requests automatically:

- **Path params** and **query params** are coerced to match the schema (e.g. string `"42"` becomes number `42`).
- **Request bodies** are validated and reject missing or extra properties.
- **Responses** are validated by default — unknown properties are stripped, and type mismatches produce a 500 error. This can be disabled globally or per-handler:

```ts
// Disable response validation globally
const api = createHonoApp(contract, { validateResponse: false });

// Or per-handler
api.implement("listUsers", () => [...users.values()], { validateResponse: false });
```

#### Bringing your own Hono app

Pass an existing `Hono` instance as the first argument to register the contract routes on it. This is the way to attach middleware or non-contract routes, and the app's `Env` generic (Bindings/Variables) is threaded through to `c` in every handler so `c.env` and `c.var` are fully typed.

```ts
import { Hono } from "hono";
import { logger } from "hono/logger";

type Env = { Variables: { user: { id: string } } };

const hono = new Hono<Env>();
hono.use("*", logger());
hono.get("/health", (c) => c.json({ ok: true }));

const api = createHonoApp(hono, contract);

api.implement("getUser", ({ c, params }) => {
  const user = c.var.user; // typed from Env
  return { id: params.id, name: user.id };
});
```

#### Splitting contracts across files

For larger apps, split the contract into one file per resource and implement each independently with `implementContract`. Pass the resulting route modules to `createHonoApp` as an array — each is mounted as an isolated Hono sub-app at the contract's `basePath`, so per-module middleware stays scoped to its own routes.

Authoring convention: give each sub-contract a `basePath` (e.g. `"/users"`) and write endpoint paths relative to it (e.g. `"/:id"`). The `basePath` is what the sub-app is mounted at.

```ts
// contracts/users.ts — pure, no server imports
import { Type } from "typebox";
import { makeContract } from "@jayalfredprufrock/handshake/contract";

export const usersContract = makeContract("/users", {
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
// routes/users.ts — object form: concise, type-checked for completeness
import { implementContract } from "@jayalfredprufrock/handshake/hono";
import { usersContract } from "../contracts/users";

export const usersRoute = implementContract(usersContract, {
  getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
  listUsers: () => [],
});
```

Missing a handler for any contract key is a type error. Use the closure form when you need middleware or direct access to the Hono sub-app:

```ts
// routes/posts.ts — closure form: middleware + handlers
import { implementContract } from "@jayalfredprufrock/handshake/hono";
import { bearerAuth } from "hono/bearer-auth";
import { postsContract } from "../contracts/posts";

export const postsRoute = implementContract(postsContract, (app) => {
  app.use("*", bearerAuth({ token: process.env.API_TOKEN! }));

  app.implement("getPost", ({ params }) => ({ id: params.id, title: "Hello" }));
});
```

Assemble the server by passing the route modules to `createHonoApp`:

```ts
// server.ts
import { Hono } from "hono";
import { logger } from "hono/logger";
import { createHonoApp } from "@jayalfredprufrock/handshake/hono";
import { usersRoute } from "./routes/users";
import { postsRoute } from "./routes/posts";

const root = new Hono();
root.use("*", logger()); // root-level middleware applies to every route

const app = createHonoApp(root, [usersRoute, postsRoute]);
```

For the client, compose a single contract with a plain object spread:

```ts
// contracts/index.ts
import { makeContract } from "@jayalfredprufrock/handshake/contract";
import { usersContract } from "./users";
import { postsContract } from "./posts";

export const contract = makeContract("/api", {
  ...usersContract.endpoints,
  ...postsContract.endpoints,
});
```

This barrel has zero server dependencies — safe to import from client bundles.

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

## License

MIT

## TODO

1. Investigate pnpm catalog system. Remove unnecessary vite catalogs if possible (since we'll manage vite stuff at the monorepo root). But consider using catalogs to keep typebox version in sync across the monorepo.
