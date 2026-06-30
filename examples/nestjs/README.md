# handshake NestJS example

A standard NestJS app (built with the Nest CLI) that serves the shared
[`handshake-example-contract`](../contract) through the handshake NestJS adapter.

```sh
npm install
npm run build       # nest build (SWC) — transpile-only, verifies it compiles
npm run start:dev   # nest start --watch
```

> This example is built with the Nest [SWC builder](https://docs.nestjs.com/recipes/swc)
> (`nest-cli.json` → `compilerOptions.builder: "swc"`), which transpiles without
> type-checking. It is a standalone sample and is intentionally excluded from the
> library's type-aware lint.

Then:

```sh
curl http://localhost:3000/api/users
curl http://localhost:3000/api/users/1
curl -X POST http://localhost:3000/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
```

Highlights:

- The contract owns the routes — controllers use `@Controller()` with no prefix.
- `@HandshakeHandler(contract, "name")` registers the route and enforces the
  handler's return type against the response schema (no manual annotation).
- `@HandshakeReq()` injects the parsed, validated request input.
- `HandshakeModule.forRoot({ contracts: [...] })` wires the interceptor + filter.
- Dependency injection, guards, interceptors, and pipes all work as usual.
