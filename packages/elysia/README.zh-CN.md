<h1 align="center">@cyrenex/elysia</h1>

<p align="center">用 <a href="https://github.com/cyrenex/core">cyrenex</a> 开发全栈 <a href="https://elysiajs.com">Elysia</a>。依赖注入交给 <a href="https://github.com/cyrenex/pondi">pondi</a>，端到端类型交给 <a href="https://elysiajs.com/eden/overview">Eden</a>。</p>

<p align="center">
  <a href="https://github.com/cyrenex/core/blob/master/packages/elysia/README.md">English</a> · 简体中文 · <a href="https://www.npmjs.com/package/@cyrenex/elysia">npm</a> · <a href="https://github.com/cyrenex/core/tree/master/playground">Playground</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyrenex/elysia"><img src="https://img.shields.io/npm/v/@cyrenex/elysia?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/@cyrenex/elysia"><img src="https://img.shields.io/npm/dm/@cyrenex/elysia?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> cyrenex 的 Elysia 适配器。开发服务器、构建、`start` 的选项和测试见 [cyrenex 文档](https://github.com/cyrenex/core/blob/master/README.zh-CN.md)；本页只介绍 Elysia 特有的部分。

## 特性

- **类型化注入**：`inject({ users: UserService })` 把解析好的服务放进 handler 上下文，类型自动推导。
- **请求作用域**：用到注入的请求会得到自己的 `pond.fork()`，响应结束后释放，WebSocket 则在连接关闭时释放；没有注入的路由零开销。
- **可读的 DI 错误**：`PondError` 在开发环境会变成带 code 和依赖路径的 500 响应，生产环境只返回普通 500。
- **原生 Elysia**：没有应用工厂。应用由你创建、adapter 由你传入，再 `.use(pondi(pond))` 即可。
- **Elysia 自己的服务器**：`start` 用应用自己的 adapter 监听，所以 WebSocket、`onStart` / `onStop` 和 handler 里的 `server` 在开发和生产环境都能用。
- **Eden 免路径**：`treaty<App>()` 直接从 `cyrenex/client` 拿到应用类型。

## 安装

```bash
pnpm add cyrenex @cyrenex/elysia elysia @elysia/eden
pnpm add -D vite-plus

# 使用 Node.js 运行时（通过 @cyrenex/elysia/node 使用）
pnpm add @elysia/node
```

## 快速开始

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()],
});
```

用 pondi 描述服务：

```ts
// server/services.ts
import { RequestContext } from "@cyrenex/elysia";
import { pebble, ripple } from "cyrenex";

export const Config = pebble<{ greeting: string }>("app:config");

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
  (ctx) => ({ name: ctx.request.headers.get("x-user") ?? "guest" }),
  { mode: "scoped" },
);
```

用 `pondi` 挂上 Pond，把服务注入路由，导出应用，**不要**调用 `.listen()`：

```ts
// server/app.ts
import { inject, pondi } from "@cyrenex/elysia";
import { Pond, ripple } from "cyrenex";
import { Elysia } from "elysia";
import { Config, CurrentUser, UserService } from "./services.ts";

const pond = new Pond().use(ripple(Config, () => ({ greeting: "Hello" })));

export default new Elysia()
  .use(pondi(pond))
  .use(inject({ users: UserService, me: CurrentUser }))
  .get("/api/users", ({ users }) => users.list())
  .get("/api/me", ({ me }) => me);
```

在服务端入口里启动它：

```ts
// server/main.ts
import { start } from "@cyrenex/elysia";
import app from "./app.ts";

await start(app);
```

在浏览器中使用官方 Eden 调用：

```ts
// web/api.ts
import { treaty } from "@elysia/eden";
import type { App } from "cyrenex/client";

export const api = treaty<App>(location.origin);

const { data } = await api.api.me.get(); // { name: string } | null
```

```bash
vp dev
```

## 注入

`inject` 接收一个 token 映射，在 handler 执行前完成解析。token 可以是 ripple、pebble 或字符串 key，与 pondi 完全一致。

```ts
export const userRoutes = new Elysia({ prefix: "/api/users" })
  .use(inject({ users: UserService, me: CurrentUser }))
  .get("/", ({ users }) => users.list())
  .get("/me", ({ me }) => me);
```

路由模块仍是普通的 Elysia 实例，`typeof app` 对 Eden 来说完全静态。Pond 在请求时从应用上获取，因此测试时可以整体替换。

`pondi(pond)` 要用在根应用上，并放在路由之前。它会在上下文中挂上 `pond`，并注册创建、释放请求作用域的钩子。

### 请求作用域

`scoped` 服务位于请求的 `pond.fork()` 中，响应结束后释放，出错也会释放；各个 mode 的说明见[服务](https://github.com/cyrenex/core/blob/master/README.zh-CN.md#服务)。

`RequestContext` 是当前请求的 Elysia 上下文。它在每个请求 fork 中以 `scoped` 注册，所以 singleton 依赖它时会抛出 `CAPTIVE_DEPENDENCY`，而不是把某个用户的数据缓存给所有人。

### WebSocket

在 WebSocket 路由中，注入的值位于 `ws.data`，作用域与连接同生命周期：每条消息拿到的都是同一批实例，并在你的 `close` handler 执行后释放。如果升级被拒绝（钩子或 handler 返回错误状态），作用域会随响应一起释放。

```ts
const Session = ripple("session", [RequestContext], (ctx) => openSession(ctx.headers), {
  mode: "scoped",
});

app.use(inject({ session: Session })).ws("/ws", {
  message(ws, message) {
    ws.data.session.track(message);
  },
});
```

### 预热 singleton

singleton 默认在第一次使用时才创建。可以把必须在接收流量前就绪的那些列出来：

```ts
new Elysia().use(pondi(pond, { eager: [Db, Cache] }));
```

`start` 会在开始监听之前创建它们，开发和生产环境都是如此；如果使用自己的监听方式，请在 `.listen()` 之前 `await warmup(app)`。任何一个失败（数据库拒绝连接、缺少实现、循环依赖），启动都会带着错误和依赖路径失败，已经创建的实例会被释放：开发服务器记录错误并在下次文件变更时重试，生产入口则带着错误退出。

只接受 singleton。没有调用 `warmup(app)` 时，`onStart` 钩子仍会创建它们，但无法阻止启动，失败时只会记录日志。

### 错误

解析过程中抛出的 `PondError`（缺少实现、循环依赖、captive dependency）会变成 500 响应：

```json
{
  "error": "PondError",
  "code": "MISSING_PROVIDER",
  "message": "No provider for \"app:config\" (db -> app:config)",
  "path": ["db", "app:config"]
}
```

`NODE_ENV` 为 `production` 时隐藏细节并改为写日志，可以通过 `pondi(pond, { exposeErrors })` 覆盖。其他错误仍交给 Elysia 处理。

## 启动

`@cyrenex/elysia` 的 `start` 接受 [cyrenex `start`](https://github.com/cyrenex/core/blob/master/README.zh-CN.md#生产环境) 的全部选项，但用 Elysia 自己的 adapter 监听，而不是只承载 `fetch`：它会等待异步插件注册完成，用应用自己的 adapter 监听，用前端产物响应没有匹配到路由的请求；停止时执行 `onStop` 钩子（在 Bun 上也会等待它们完成）并释放 Pond。

Elysia 应用同样有 `fetch`，所以也可以用 `cyrenex/start` 的 `start` 启动，只是没有 WebSocket 和 Elysia 的生命周期钩子。

## 测试

直接测试模块导出的应用，通过 Eden 调用，不经过网络；用 [`override`](https://github.com/cyrenex/core/blob/master/README.zh-CN.md#测试) 替换 provider：

```ts
import { treaty } from "@elysia/eden";
import { ripple } from "cyrenex";
import { override } from "cyrenex/testing";
import app from "../server/app.ts";
import { Db } from "../server/services.ts";

const api = treaty(app);

test("lists users", async () => {
  await using _ = override(
    app,
    ripple(Db, () => fakeDb),
  );
  expect((await api.api.users.get()).data).toEqual([]);
});
```

只想单独测试某个路由模块时，可以用 fork 出的 Pond 搭一个小应用：

```ts
const app = new Elysia().use(pondi(pond.fork().use(ripple(Db, () => fakeDb)))).use(userRoutes);
```

## Node.js

adapter 由应用自己决定，cyrenex 不会注入。Bun 不需要 adapter；在 Node.js 上，自行安装 `@elysia/node`，并传入 `@cyrenex/elysia/node` 提供的 adapter：

```ts
import { node } from "@cyrenex/elysia/node";

export default new Elysia({ adapter: node() }).use(pondi(pond));
```

它包装了 `@elysia/node`，修好了 `app.stop()`，并去掉文件响应上相互冲突的响应头：上游既不设置 `app.server`，也没有实现 `stop`，所以 `app.stop()` 会直接报错，`onStop` 钩子永远不会执行。如果你自行使用原版 `@elysia/node`，`start` 仍会自行关闭服务器并执行这些钩子，但你自己代码里的 `app.stop()` 会报错。

想让同一个应用在两种运行时上运行，可以在启动时选择：

```ts
export const adapter =
  "Bun" in globalThis ? undefined : (await import("@cyrenex/elysia/node")).node();
```

## 已知限制

- 在 Node.js 上，Elysia 只会在使用了支持 WebSocket 的 adapter 的实例上注册 `.ws()` 路由，所以定义 `.ws()` 的插件也要传入 adapter。
- 在 Node.js 上，带 body schema 的 WebSocket 消息可能需要显式配置 `parse`。

## License

[MIT](https://github.com/cyrenex/core/blob/master/LICENSE)
