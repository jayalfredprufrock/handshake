import { serve } from "@hono/node-server";
import { createHonoApp } from "@jayalfredprufrock/handshake/hono";
import { contract } from "@jayalfredprufrock/handshake-example-contract";
import type { Static } from "typebox/type";

// In-memory store
const users = new Map<string, Static<typeof contract.endpoints.getUser.response>>();
let nextId = 1;

// Seed some data
users.set("1", { id: "1", name: "Alice", email: "alic@example.com" });
users.set("2", { id: "2", name: "Bob", email: "bob@example.com" });
nextId = 3;

const api = createHonoApp(contract);

api.implement("getUser", ({ params }) => {
  const user = users.get(params.id);
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return user;
});

api.implement("listUsers", () => {
  return [...users.values()];
});

api.implement("createUser", ({ body }) => {
  const id = String(nextId++);
  const user = { id, name: body.name, email: body.email };
  users.set(id, user);
  return user;
});

api.implement("deleteUser", ({ params }) => {
  users.delete(params.id);
  return { id: params.id };
});

const app = api.build();

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
