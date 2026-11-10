<h1 align="center">@cyrenex/orpc</h1>

<p align="center">用 <a href="https://github.com/cyrenex/core">cyrenex</a> 开发全栈 <a href="https://orpc.dev">oRPC</a>。依赖注入交给 <a href="https://github.com/cyrenex/pondi">pondi</a>，端到端类型交给 oRPC。</p>

<p align="center">
  <a href="https://github.com/cyrenex/core/blob/master/packages/orpc/README.md">English</a> · 简体中文 · <a href="https://www.npmjs.com/package/@cyrenex/orpc">npm</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyrenex/orpc"><img src="https://img.shields.io/npm/v/@cyrenex/orpc?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/@cyrenex/orpc"><img src="https://img.shields.io/npm/dm/@cyrenex/orpc?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> cyrenex 的 oRPC 适配器，面向 oRPC v2。开发服务器、构建、`start` 的选项和测试见 [cyrenex 文档](https://github.com/cyrenex/core/blob/master/README.zh-CN.md)；本页只介绍 oRPC 特有的部分。

## 特性

- **类型化注入**：`inject({ users: UserService })` 是一个 oRPC 中间件，把解析好的服务放进过程的上下文，类型自动推导。
- **请求作用域**：每个请求都有自己的 `pond.fork()`，响应发送完毕后释放，所以流式输出（event iterator）在结束前都能使用 scoped 服务。
- **可读的 DI 错误**：`PondError` 在开发环境会变成带 code 和依赖路径的 `INTERNAL_SERVER_ERROR`，生产环境只返回普通的同名错误。
- **原生 oRPC**：过程和 router 都由你自己定义；`rpc(router, pond)` 可以配合任意 oRPC fetch handler 提供服务。
- **类型化客户端免路径**：`RouterClient<App["router"]>` 直接从 `cyrenex/client` 拿到 router 类型。

## 安装

```bash
pnpm add cyrenex @cyrenex/orpc @orpc/server@beta @orpc/client@beta
pnpm add -D vite-plus
```

## 快速开始

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex({ routes: ["/rpc"] })],
});
```

用 pondi 描述服务：

```ts
// server/services.ts
import { RequestContext } from "@cyrenex/orpc";
import { ripple } from "cyrenex";

export const Db = ripple("db", async () => {
  const pool = await connect(process.env.DATABASE_URL);
  return { pool, [Symbol.asyncDispose]: () => pool.end() };
});

export const UserService = ripple("user:service", [Db], (db) => ({
  list: () => db.pool.query("select * from users"),
}));

// 每个请求一个实例
export const CurrentUser = ripple(
  "user:current",
  [RequestContext],
  ({ request }) => ({ name: request.headers.get("x-user") ?? "guest" }),
  { mode: "scoped" },
);
```

把服务注入过程，再导出由 `rpc` 提供服务的 router：

```ts
// server/app.ts
import { inject, rpc } from "@cyrenex/orpc";
import type { PondiContext } from "@cyrenex/orpc";
import { os } from "@orpc/server";
import { Pond } from "cyrenex";
import { CurrentUser, UserService } from "./services.ts";

const base = os.$context<PondiContext>();

const router = {
  users: base.use(inject({ users: UserService })).handler(({ context }) => context.users.list()),
  me: base.use(inject({ me: CurrentUser })).handler(({ context }) => context.me),
};

export default rpc(router, new Pond());
```

在服务端入口里启动它：

```ts
// server/main.ts
import { start } from "@cyrenex/orpc";
import app from "./app.ts";

await start(app);
```

在浏览器中使用 oRPC 客户端调用：

```ts
// web/api.ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { App } from "cyrenex/client";

export const api = createORPCClient<RouterClient<App["router"]>>(
  new RPCLink({ origin: location.origin, url: "/rpc" }),
);

const me = await api.me(); // { name: string }
```

```bash
vp dev
```

## 注入

`inject` 接收一个 token 映射，在 handler 执行前完成解析。token 可以是 ripple、pebble 或字符串 key，与 pondi 完全一致。它是一个中间件，可以和你自己的中间件组合；用到它的过程要把 `PondiContext` 声明为初始上下文：

```ts
const base = os.$context<PondiContext>();

export const users = base
  .use(inject({ users: UserService, me: CurrentUser }))
  .use(auth)
  .handler(({ context }) => context.users.list());
```

### 请求作用域

`rpc` 会在前缀匹配后，为每个请求创建自己的 `pond.fork()`，放在 `context.pond` 中。`scoped` 服务位于其中，响应发送完毕后释放，出错也会释放；各个 mode 的说明见[服务](https://github.com/cyrenex/core/blob/master/README.zh-CN.md#服务)。同一个请求中的所有 `inject`，以及批量请求中的所有过程，共用这个 fork。

`RequestContext` 是 `{ request }`，即当前的 `Request`。它在每个请求 fork 中以 `scoped` 注册，所以 singleton 依赖它时会抛出 `CAPTIVE_DEPENDENCY`，而不是把某个用户的数据缓存给所有人。

### 流式输出

返回 event iterator 的过程会以流的形式响应；fork 会一直保留到流结束或客户端断开，所以每个事件都能使用 scoped 服务：

```ts
export const feed = base.use(inject({ me: CurrentUser })).handler(async function* ({ context }) {
  for await (const item of watch(context.me)) yield item;
});
```

### 错误

解析过程中抛出的 `PondError`（缺少实现、循环依赖、captive dependency）会变成 `ORPCError`：

```ts
{ code: "INTERNAL_SERVER_ERROR", message: 'No provider for "app:config" (db -> app:config)',
  data: { code: "MISSING_PROVIDER", path: ["db", "app:config"] } }
```

`NODE_ENV` 为 `production` 时隐藏细节并改为写日志，可以通过 `rpc(router, pond, { exposeErrors })` 覆盖。

## 提供服务

| `rpc` 选项     | 默认值                               | 说明                                                     |
| -------------- | ------------------------------------ | -------------------------------------------------------- |
| `prefix`       | `"/rpc"`                             | 过程的 URL 前缀，与客户端的 `url` 保持一致               |
| `handler`      | `(router) => new RPCHandler(router)` | oRPC fetch handler，例如 `OpenAPIHandler` 或带插件的实例 |
| `eager`        | `[]`                                 | 在应用开始监听前创建的 singleton                         |
| `exposeErrors` | `NODE_ENV !== "production"`          | 是否在错误响应中包含 `PondError` 的细节                  |

`rpc` 返回一个带 `fetch` 的应用，过程之外的请求返回 `404`，所以 `start` 可以像对待任何 fetch 应用一样启动它：即 [cyrenex 的 `start`](https://github.com/cyrenex/core/blob/master/README.zh-CN.md#生产环境)，本包也重新导出了它。开发时用 `routes: ["/rpc"]` 转发它的前缀，或者用 `routes: "auto"` 从应用上读取。

要挂载到其他服务器中时，`app.handle(request)` 会返回响应；没有匹配的过程时返回 `undefined`。

## 测试

通过一个 `fetch` 指向应用的 link 在进程内调用过程，并用 [`override`](https://github.com/cyrenex/core/blob/master/README.zh-CN.md#测试) 替换 provider：

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { ripple } from "cyrenex";
import { override } from "cyrenex/testing";
import app from "../server/app.ts";
import { Db } from "../server/services.ts";

const api = createORPCClient<RouterClient<typeof app.router>>(
  new RPCLink({
    origin: "http://localhost",
    url: "/rpc",
    fetch: (url, init) => app.fetch(new Request(url, init)),
  }),
);

test("lists users", async () => {
  await using _ = override(
    app,
    ripple(Db, () => fakeDb),
  );
  expect(await api.users()).toEqual([]);
});
```

不经过 HTTP 时，oRPC 的 `createRouterClient` 由你直接传入上下文：传一个 Pond 的 fork，用完后释放它。

```ts
const pond = basePond.fork();
const client = createRouterClient(router, { context: { pond } });
```

## License

[MIT](https://github.com/cyrenex/core/blob/master/LICENSE)
