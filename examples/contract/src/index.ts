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
