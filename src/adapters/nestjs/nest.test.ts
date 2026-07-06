import "reflect-metadata";
import { Controller, Injectable, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { CanActivate, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as T from "typebox";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createApi, createContract } from "../../contract";
import type { HandshakeModuleOptions } from "./index";
import { ApiHandler, ApiInput, HandshakeModule } from "./index";

const contract = createContract({
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String(), name: T.String() }),
  },
  createUser: {
    method: "POST",
    path: "/users",
    body: T.Object({ name: T.String() }),
    response: T.Object({ id: T.String(), name: T.String() }),
  },
  teapot: {
    method: "GET",
    path: "/teapot",
    responseCode: 201,
    response: T.Object({ ok: T.Boolean() }),
  },
});

const api = createApi("/api", { users: contract }, { errors: { NOT_FOUND: { status: 404 } } });

// A getUser-only api for the guard controllers below: the bootstrap scan requires
// every endpoint of a registered api to have a bound @ApiHandler, and those
// controllers only implement getUser. It still declares NOT_FOUND so a known-code
// ApiError thrown in a guard (before the interceptor runs) is recognized.
const guardContract = createContract({
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String(), name: T.String() }),
  },
});

const guardApi = createApi(
  "/api",
  { users: guardContract },
  { errors: { NOT_FOUND: { status: 404 } } },
);

// A normal Nest provider, injected by type into the controller's constructor.
@Injectable()
class UserService {
  private readonly users = new Map([["1", { id: "1", name: "Alice" }]]);
  find(id: string): { id: string; name: string } | undefined {
    return this.users.get(id);
  }
}

class ThrownByService extends Error {}

@Controller()
class UserController {
  constructor(private readonly users: UserService) {}

  @ApiHandler(api, "getUser")
  getUser(@ApiInput() req: ApiInput<typeof api, "getUser">) {
    const user = this.users.find(req.params.id);
    if (!user) throw api.error("NOT_FOUND", "user not found");
    return user;
  }

  @ApiHandler(api, "createUser")
  createUser(@ApiInput() req: ApiInput<typeof api, "createUser">) {
    if (req.body.name === "explode") throw new ThrownByService("boom");
    return { id: "2", name: req.body.name };
  }

  @ApiHandler(api, "teapot")
  teapot() {
    return { ok: true };
  }
}

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException("denied");
  }
}

@Injectable()
class ApiErrorGuard implements CanActivate {
  canActivate(): boolean {
    throw guardApi.error("NOT_FOUND", "blocked by guard");
  }
}

@Controller()
class GuardedController {
  @UseGuards(DenyGuard)
  @ApiHandler(guardApi, "getUser")
  getUser(@ApiInput() req: ApiInput<typeof guardApi, "getUser">) {
    return { id: req.params.id, name: "never" };
  }
}

@Controller()
class ApiErrorGuardedController {
  @UseGuards(ApiErrorGuard)
  @ApiHandler(guardApi, "getUser")
  getUser(@ApiInput() req: ApiInput<typeof guardApi, "getUser">) {
    return { id: req.params.id, name: "never" };
  }
}

const apps: INestApplication[] = [];

afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
});

async function bootstrap(
  controllers: (new (...args: any[]) => unknown)[],
  options: HandshakeModuleOptions = { apis: [api] },
  providers: any[] = [UserService],
): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    imports: [HandshakeModule.forRoot(options)],
    controllers: controllers as any,
    providers,
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0, "127.0.0.1");
  apps.push(app);
  return app.getUrl();
}

describe("nestjs adapter", () => {
  test("injects providers by type and serves the handler (DI canary)", async () => {
    const base = await bootstrap([UserController]);
    const res = await fetch(`${base}/api/users/1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Alice" });
  });

  test("serializes an api.error into the handshake envelope", async () => {
    const base = await bootstrap([UserController]);
    const res = await fetch(`${base}/api/users/missing`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "NOT_FOUND",
      status: 404,
      message: "user not found",
      details: undefined,
    });
  });

  test("applies responseCode, overriding Nest's default", async () => {
    const base = await bootstrap([UserController]);
    const res = await fetch(`${base}/api/teapot`);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("a Nest HttpException keeps its status and is not a handshake envelope", async () => {
    const base = await bootstrap([GuardedController], { apis: [guardApi] });
    const res = await fetch(`${base}/api/users/1`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty("kind");
  });

  test("a known-code ApiError thrown in a guard is serialized as the envelope", async () => {
    const base = await bootstrap([ApiErrorGuardedController], { apis: [guardApi] });
    const res = await fetch(`${base}/api/users/1`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ kind: "HANDSHAKE", code: "NOT_FOUND" });
  });

  test("onError maps an unknown error to a typed contract error", async () => {
    const base = await bootstrap([UserController], {
      apis: [api],
      onError: (err) =>
        err instanceof ThrownByService ? api.error("NOT_FOUND", "mapped") : undefined,
    });
    const res = await fetch(`${base}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "explode" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND", message: "mapped" });
  });

  test("an unmapped error becomes UNKNOWN_ERROR (500) with the cause hidden", async () => {
    const base = await bootstrap([UserController]);
    const res = await fetch(`${base}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "explode" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      kind: "HANDSHAKE",
      code: "UNKNOWN_ERROR",
      status: 500,
      message: "Unknown error",
      details: undefined,
    });
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
