import { createApi, createContract } from "@jayalfredprufrock/handshake/contract";
import { Type } from "typebox";

const User = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
});

// A resource contract — endpoints relative to the group's base path.
export const users = createContract("/users", {
  getUser: {
    method: "GET",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: User,
  },
  listUsers: {
    method: "GET",
    path: "/",
    response: Type.Array(User),
  },
  createUser: {
    method: "POST",
    path: "/",
    body: Type.Object({ name: Type.String(), email: Type.String() }),
    response: User,
  },
  deleteUser: {
    method: "DELETE",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String() }),
  },
});

// The composed api — the single unit the server adapters, client, and OpenAPI consume.
// Routes resolve to /api/users, /api/users/:id, etc.
export const api = createApi("/api", { users });
