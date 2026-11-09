<h1 align="center">cyrenex</h1>

<p align="center">在 Vite 里开发全栈 Elysia。依赖注入交给 <a href="https://github.com/cyrenex/pondi">pondi</a>，端到端类型交给 <a href="https://elysiajs.com/eden/overview">Eden</a>。</p>

<p align="center">
  <a href="https://github.com/cyrenex/core/blob/master/README.md">English</a> · 简体中文 · <a href="https://www.npmjs.com/package/cyrenex">npm</a> · <a href="https://github.com/cyrenex/core/tree/master/playground">Playground</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/dm/cyrenex?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> 一条 `vp dev`，前端和 Elysia API 同源访问。API 跑在独立的 Bun 或 Node.js 进程里，文件变更即重启，退出前释放所有资源。

搭一个 TypeScript 全栈应用，通常意味着两个开发服务器、一层代理、一个自己拼的容器，再加一个要手动保持同步的客户端。cyrenex 把这些收进一个包、五个入口：

| 入口             | 在哪里用          | 内容                                                                 |
| ---------------- | ----------------- | -------------------------------------------------------------------- |
| `cyrenex`        | 服务端            | `pondi`、`inject`、`RequestContext`、`warmup`，以及 pondi 的全部 API |
| `cyrenex/node`   | 服务端（Node.js） | 包装 `@elysia/node`，修复了 `app.stop()` 的 adapter                  |
| `cyrenex/static` | 服务端（生产）    | 带 Vite 默认值与 SPA 回退的 `@elysia/static`                         |
| `cyrenex/vite`   | `vite.config.ts`  | 在子进程中运行应用，转发 `/api` 与 `/ws`，生成类型声明               |
| `cyrenex/client` | 浏览器            | `type App`，`treaty<App>()` 不再需要 `../server/app` 这样的相对路径  |

## 特性

- **开发期同源**：前端资源和 HMR 由 Vite 处理，匹配的 HTTP 请求与 WebSocket upgrade 转发给应用。
- **真实运行时、真实重启**：应用运行在独立的 Bun 或 Node.js 进程，通过 Vite ModuleRunner 加载，文件变更时整体替换。
- **干净的重启**：每次重启都会调用 `app.stop()`，`onStop` 钩子执行，Pond 按依赖逆序释放连接。
- **类型化注入**：`inject({ users: UserService })` 把解析好的服务放进 handler 上下文，类型自动推导。
- **请求作用域**：用到注入的请求会得到自己的 `pond.fork()`，响应结束后释放，WebSocket 则在连接关闭时释放；没有注入的路由零开销。
- **启动时失败，而不是第一个请求时**：`eager` 中的 singleton 会在应用开始监听之前创建，开发和生产环境都是如此。
- **可读的 DI 错误**：`PondError` 在开发环境会变成带 code 和依赖路径的 500 响应，生产环境只返回普通 500。
- **原生 Elysia**：没有应用工厂。应用由你创建、adapter 由你传入，再 `.use(pondi(pond))` 即可。
- **Eden 免路径**：自动生成的 `cyrenex-env.d.ts` 注册应用类型，浏览器直接从 `cyrenex/client` 导入。
- **生产环境同一份源码**：同一个 `app.ts` 可在 Bun 和 Node.js 上运行；`cyrenex/static` 托管前端产物并处理 SPA 回退。

## 安装

```bash
pnpm add cyrenex elysia @elysia/eden
pnpm add -D vite-plus

# 使用 Node.js 运行时（通过 cyrenex/node 使用）
pnpm add @elysia/node
# 通过 cyrenex/static 托管前端产物
pnpm add @elysia/static
```

需要 Node.js 22.18+ 和 Vite 8（或 Vite+）。默认运行时是 Bun，需要能在 `PATH` 中找到。

## 快速开始

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()], // entry: "server/app.ts", runtime: "bun"
});
```

用 pondi 描述服务：

```ts
// server/services.ts
import { pebble, RequestContext, ripple } from "cyrenex";

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
import { inject, Pond, pondi, ripple } from "cyrenex";
import { Elysia } from "elysia";
import { Config, CurrentUser, UserService } from "./services.ts";

const pond = new Pond().use(ripple(Config, () => ({ greeting: "Hello" })));

export default new Elysia()
  .use(pondi(pond))
  .use(inject({ users: UserService, me: CurrentUser }))
  .get("/api/users", ({ users }) => users.list())
  .get("/api/me", ({ me }) => me);
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

### 请求作用域

| mode        | 实例所在               | 释放时机                                             |
| ----------- | ---------------------- | ---------------------------------------------------- |
| `singleton` | 根 Pond                | `app.stop()` / 开发期重启                            |
| `scoped`    | 请求的 `pond.fork()`   | 响应结束后，出错也会释放；WebSocket 在连接关闭时释放 |
| `transient` | 不缓存，每次解析都新建 | 随请求作用域释放                                     |

`RequestContext` 是当前请求的 Elysia 上下文。它在每个请求 fork 中以 `scoped` 注册，所以 singleton 依赖它时会抛出 `CAPTIVE_DEPENDENCY`，而不是把某个用户的数据缓存给所有人。

fork 是按需创建的：没有使用 `inject` 的路由完全不会碰到容器。

`pondi(pond)` 要用在根应用上，并放在路由之前。它会在上下文中挂上 `pond`，并注册创建、释放请求作用域的钩子。

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

开发服务器会在开始监听之前创建它们；生产环境请在 `.listen()` 之前 `await warmup(app)`。任何一个失败（数据库拒绝连接、缺少实现、循环依赖），启动都会带着错误和依赖路径失败，已经创建的实例会被释放：开发服务器记录错误并在下次文件变更时重试，生产入口则带着错误退出。

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

## 客户端类型

`cyrenex/vite` 在每次 `dev` 和 `build` 时，把 `cyrenex-env.d.ts` 写到 Vite root 下，内容不变时不会重写：

```ts
// Generated by cyrenex/vite. Do not edit.
declare module "cyrenex/client" {
  interface Register {
    app: typeof import("./server/app.ts").default;
  }
}

export {};
```

建议提交到仓库并加入 `tsconfig.json` 的 `include`，这样新 clone 的项目在启动开发服务器之前就能通过类型检查。可以用 `dts` 修改位置，或用 `dts: false` 关闭生成并自行编写声明。

> [!TIP]
> 浏览器端只导入了类型，服务端代码在构建时被擦除，不会进入前端产物。但前端的 `tsconfig.json` 仍需要服务端用到的类型（例如 `@types/node`）。

## 测试

传入 fork 出的 Pond 来替换实现，再通过 Eden 直接调用应用，不经过网络：

```ts
import { treaty } from "@elysia/eden";
import { pondi, ripple } from "cyrenex";
import { Elysia } from "elysia";

const app = new Elysia().use(pondi(pond.fork().use(ripple(Db, () => fakeDb)))).use(userRoutes);
const api = treaty(app);

expect((await api.api.users.get()).data).toEqual([]);
```

## Vite 插件

```ts
cyrenex({
  entry: "server/app.ts",
  runtime: "bun",
  routes: ["/api", "/ws"],
  watch: ["templates/**"],
  dts: "cyrenex-env.d.ts",
  inspect: false,
  execArgv: [],
  env: {},
  shutdownTimeout: 1000,
});
```

| 配置              | 默认值                                 | 说明                                                           |
| ----------------- | -------------------------------------- | -------------------------------------------------------------- |
| `entry`           | `"server/app.ts"`                      | 默认导出 Elysia 应用的模块，相对 Vite root                     |
| `runtime`         | `process.env.CYRENEX_RUNTIME ?? "bun"` | `"bun"` 或 `"node"`，都运行在子进程中                          |
| `routes`          | `["/api", "/ws"]`                      | 转发的路径前缀，按完整路径段匹配，不改写路径                   |
| `watch`           | `[]`                                   | 额外触发重启的文件、目录或 glob；`false` 关闭自动重启          |
| `dts`             | `"cyrenex-env.d.ts"`                   | `cyrenex/client` 声明的写入位置；`false` 关闭生成              |
| `inspect`         | `false`                                | 开启调试器：`true`（`127.0.0.1:9229`）、端口号或 `"host:port"` |
| `execArgv`        | `[]`                                   | 应用进程额外的运行时参数                                       |
| `env`             | `{}`                                   | 应用进程的环境变量，覆盖 shell 与 `.env` 文件                  |
| `shutdownTimeout` | `1000`                                 | 重启时等待 `app.stop()` 的毫秒数，超时强制结束旧进程           |

入口所在目录和所有经 Vite 加载的模块始终会被监听。`/api` 匹配 `/api` 和 `/api/users`，不匹配 `/apix`。

### 环境变量

应用进程会拿到 Vite `.env` 文件（`envDir` 下的 `.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local`）中的全部变量，而不只是 `VITE_*`：这是服务端代码，不会进入浏览器。与 Vite 一致，shell 中已设置的变量优先。修改 `.env` 会重启开发服务器；`envDir: false` 可关闭加载。

### 调试

`inspect: true` 会以 `--inspect=127.0.0.1:9229` 启动应用，两种运行时都支持。下一个进程启动前端口已被释放，所以重启后端口不变，配置了自动重连的调试器（VS Code attach 配置中的 `"restart": true`）会跟着应用重新连接。Bun 可打开输出的 `debug.bun.sh` 链接或使用 Bun 扩展。

### 重启

- 文件变更以 100ms 去抖并进入串行队列，重启期间到达的请求会等待新进程就绪。
- 旧进程收到关闭消息后执行 `app.stop()`（触发 `onStop` 与 `pond.dispose()`），超过 `shutdownTimeout`（默认 1 秒）会被强制结束。
- 应用不可用时 HTTP 返回 `503`，转发异常返回 `502`。
- 重启会断开业务 WebSocket，客户端需在 `close` 时自行重连；Vite 的 HMR 连接不受影响。
- 启动失败后，修正文件即可再次启动。错误同时会显示在 Vite 的错误浮层中，之后打开的页面也会显示；应用启动成功后浮层关闭，页面自动刷新。

想在命令行切换运行时，可以把 Vite mode 映射过去：

```ts
export default defineConfig(({ mode }) => ({
  plugins: [cyrenex({ runtime: mode === "node" ? "node" : "bun" })],
}));
```

```bash
vp dev              # Bun
vp dev --mode node  # Node.js
```

## 生产环境

`vp build` 构建前端，服务端入口由你用原生 Elysia 自己编写：

```ts
// server/main.ts
import { fileURLToPath } from "node:url";
import { warmup } from "cyrenex";
import { staticPlugin } from "cyrenex/static";
import app from "./app.ts";

await warmup(app); // 创建 `eager` 中的 singleton，失败则中止启动

app
  .use(await staticPlugin({ assets: fileURLToPath(new URL("../dist", import.meta.url)) }))
  .listen(Number(process.env.PORT ?? 3000));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.stop().finally(() => process.exit(0)));
}
```

```bash
bun server/main.ts
node server/main.ts
```

`app.stop()` 会执行 `onStop` 钩子并释放 Pond；在 Node.js 上需要使用 `cyrenex/node` adapter。

### 静态资源

`cyrenex/static` 为 Vite 产物包装了 `@elysia/static`（需自行安装）。它接受上游的全部配置，并提供适合 Vite 的默认值和 SPA 回退：

| 配置     | 默认值   | 说明                                                        |
| -------- | -------- | ----------------------------------------------------------- |
| `assets` | `"dist"` | 前端产物目录，相对当前工作目录                              |
| `prefix` | `"/"`    | 静态资源的 URL 前缀，应与 Vite `base` 一致                  |
| `spa`    | `true`   | 未匹配任何路由的页面导航返回 `index.html`；API 请求保留 404 |

只有接受 `text/html` 的 `GET` 请求才会回退，所以 `fetch("/api/missing")` 和缺失的 `/assets/app.js` 仍然返回 404。

> [!TIP]
> Node.js 通过类型剥离运行 TypeScript。开启 `erasableSyntaxOnly` 并在导入时写明 `.ts` 扩展名，同一份源码无需构建即可在两种运行时上运行。

## Adapter

adapter 由应用自己决定，cyrenex 不会注入。Bun 不需要 adapter；在 Node.js 上，自行安装 `@elysia/node`，并传入 `cyrenex/node` 提供的 adapter：

```ts
import { node } from "cyrenex/node";

export default new Elysia({ adapter: node() }).use(pondi(pond));
```

它包装了 `@elysia/node`，并修好了 `app.stop()`：上游既不设置 `app.server`，也没有实现 `stop`，所以 `app.stop()` 会直接报错，`onStop` 钩子（包括 `pond.dispose()`）永远不会执行。如果你自行使用原版 `@elysia/node`，开发服务器仍会自行关闭服务器并执行这些钩子，但你自己入口里的 `app.stop()` 会报错。

想让同一个应用在两种运行时上运行，可以在启动时选择：

```ts
export const adapter = "Bun" in globalThis ? undefined : (await import("cyrenex/node")).node();
```

## 已知限制

- 在 Node.js 上，Elysia 只会在使用了支持 WebSocket 的 adapter 的实例上注册 `.ws()` 路由，所以定义 `.ws()` 的插件也要传入 adapter。
- 在 Node.js 上，带 body schema 的 WebSocket 消息可能需要显式配置 `parse`。
- 开发插件只用于开发。除了写入 `cyrenex-env.d.ts`，`vp build` 只构建前端，服务端入口与部署由应用自行管理。

## 本地开发

```bash
vp install
pnpm dev        # 构建 cyrenex，然后用 Bun 运行 playground
pnpm dev:node   # ……用 Node.js 运行
pnpm test
vp check
```

playground 通过 `cyrenex-source` 导出条件解析 `cyrenex`（见 `playground/vite.config.ts` 与 `tsconfig.json`），修改 `packages/cyrenex/src` 会直接重启应用，无需重新构建。只有修改 Vite 插件本身时才需要运行 `vp run cyrenex#build`。

## License

[MIT](./LICENSE)

## 特别感谢

感谢所有为 cyrenex 做出贡献的人 ❤️

<a href="https://github.com/cyrenex/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=cyrenex/core" />
</a>

## Star 历史

<a href="https://star-history.dera.page/#cyrenex/core&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=cyrenex/core&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=cyrenex/core&type=Date" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=cyrenex/core&type=Date" />
  </picture>
</a>
