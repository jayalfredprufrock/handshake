import { createFetchClient } from "@jayalfredprufrock/handshake/client";
import { contract } from "@jayalfredprufrock/handshake-example-contract";
import { setTimeout } from "node:timers/promises";

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

async function main() {
  // give server time to start up
  await setTimeout(1000);

  console.log("--- List users ---");
  const users = await api.listUsers();
  console.log(users);

  console.log("\n--- Create user ---");
  const created = await api.createUser({ name: "Charlie", email: "charliebrown@example.com" });
  console.log(created);

  console.log("\n--- Get user ---");
  const user = await api.getUser({ id: created.id });
  console.log(user);

  console.log("\n--- List users (after create) ---");
  const updatedUsers = await api.listUsers();
  console.log(updatedUsers);

  console.log("\n--- Delete user ---");
  const deleted = await api.deleteUser({ id: created.id });
  console.log(deleted);

  console.log("\n--- List users (after delete) ---");
  const finalUsers = await api.listUsers();
  console.log(finalUsers);
}

main().catch(console.error);
