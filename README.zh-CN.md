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

搭一个 TypeScript 全栈应用，通常意味着两个开发服务器、一层代理、一个自己拼的容器，再加一个要手动保持同步的客户端。cyrenex 把这些收进一个与框架无关的核心，加上每个框架各自的适配器（目前是 Elysia）：

| 包 / 入口                | 在哪里用          | 内容                                                            |
| ------------------------ | ----------------- | --------------------------------------------------------------- |
| `cyrenex`                | 服务端            | pondi 的全部 API、`warmup`、`dispose`                           |
| `cyrenex/start`          | 服务端            | `start(app)`：预热、静态资源、监听与优雅退出                    |
| `cyrenex/testing`        | 测试              | `override(app, ...)` 替换已导出应用的 provider                  |
| `cyrenex/vite`           | `vite.config.ts`  | 在子进程中运行 `server/main.ts`，转发 `/api` 与 `/ws`，负责构建 |
| `cyrenex/client`         | 浏览器            | `type App`，`treaty<App>()` 不再需要 `../server/app` 这样的导入 |
| `cyrenex/adapter`        | 适配器            | 编写框架适配器所需的基础能力：挂载 Pond、请求作用域             |
| `@cyrenex/elysia`        | 服务端            | Elysia 的 `pondi`、`inject`、`RequestContext`、`start`          |
| `@cyrenex/elysia/node`   | 服务端（Node.js） | 包装 `@elysia/node`，修复了 `app.stop()` 的 adapter             |
| `@cyrenex/elysia/static` | 服务端            | 带 Vite 默认值与 SPA 回退的 `@elysia/static`                    |

## 特性

- **开发期同源**：前端资源和 HMR 由 Vite 处理，匹配的 HTTP 请求与 WebSocket upgrade 转发给应用。
- **真实运行时、真实重启**：应用运行在独立的 Bun 或 Node.js 进程，通过 Vite ModuleRunner 加载，文件变更时整体替换。
- **处处同一个入口**：`server/main.ts` 用 `start(app)` 启动应用，`vp dev`、`vp preview` 和生产环境都运行它；开发服务器只负责代理。
- **干净的重启**：每次重启都会关闭服务器并释放 Pond，按依赖逆序关闭连接。
- **类型化注入**：`inject({ users: UserService })` 把解析好的服务放进 handler 上下文，类型自动推导。
- **请求作用域**：用到注入的请求会得到自己的 `pond.fork()`，响应结束后释放，WebSocket 则在连接关闭时释放；没有注入的路由零开销。
- **启动时失败，而不是第一个请求时**：`eager` 中的 singleton 会在应用开始监听之前创建，开发和生产环境都是如此。
- **可读的 DI 错误**：`PondError` 在开发环境会变成带 code 和依赖路径的 500 响应，生产环境只返回普通 500。
- **原生 Elysia**：没有应用工厂。应用由你创建、adapter 由你传入，再 `.use(pondi(pond))` 即可。
- **Eden 免路径**：自动生成的 `cyrenex-env.d.ts` 注册应用类型，浏览器直接从 `cyrenex/client` 导入。
- **生产环境同一份源码**：同一个入口可在 Bun 和 Node.js 上运行，构建后或直接从源码运行均可；`start()` 托管前端产物并处理 SPA 回退。
- **适配 monorepo**：服务端入口可以放在其他包里，前端产物可以直接输出或复制到那个包。

## 安装

```bash
pnpm add cyrenex @cyrenex/elysia elysia @elysia/eden
pnpm add -D vite-plus

# 使用 Node.js 运行时（通过 @cyrenex/elysia/node 使用）
pnpm add @elysia/node
```

需要 Node.js 22.18+ 和 Vite 8（或 Vite+）。默认运行时是 Bun，需要能在 `PATH` 中找到。

## 快速开始

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()], // server: "server/main.ts", app: "server/app.ts", runtime: "bun"
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

在浏览器中使用官方 Eden 调用：

```ts
// web/api.ts
import { treaty } from "@elysia/eden";
import type { App } from "cyrenex/client";

export const api = treaty<App>(location.origin);

const { data } = await api.api.me.get(); // { name: string } | null
```

在服务端入口里启动它。`vp dev` 会运行这个文件，并把 `/api` 和 `/ws` 转发给它；`vp build` 会把它打包用于生产：

```ts
// server/main.ts
import { start } from "@cyrenex/elysia";
import app from "./app.ts";

await start(app);
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
| `singleton` | 根 Pond                | 服务器停止时（`stop()`、信号、开发期重启）           |
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

`start()` 会在开始监听之前创建它们，开发和生产环境都是如此；如果使用自己的监听方式，请在 `.listen()` 之前 `await warmup(app)`。任何一个失败（数据库拒绝连接、缺少实现、循环依赖），启动都会带着错误和依赖路径失败，已经创建的实例会被释放：开发服务器记录错误并在下次文件变更时重试，生产入口则带着错误退出。

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

declare module "vite/types/customEvent.d.ts" {
  interface CustomEventMap {
    /** The app process restarted after a server change. */
    "cyrenex:restart": { runtime: "bun" | "node" };
  }
}

export {};
```

建议提交到仓库并加入 `tsconfig.json` 的 `include`，这样新 clone 的项目在启动开发服务器之前就能通过类型检查。可以用 `dts` 修改位置，或用 `dts: false` 关闭生成并自行编写声明。

> [!TIP]
> 浏览器端只导入了类型，服务端代码在构建时被擦除，不会进入前端产物。但前端的 `tsconfig.json` 仍需要服务端用到的类型（例如 `@types/node`）。

## 测试

直接测试模块导出的应用，通过 Eden 调用，不经过网络。`cyrenex/testing` 的 `override` 会替换 provider，直到被释放，在 Vitest 与 `bun test` 中用法相同：

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

请求会从应用 Pond 的一个 fork 中解析，这个 fork 遮蔽了传入的 ripple：依赖它们的单例（依赖 `Db` 的 `UserService`）会在 fork 中重新创建，真实实例不受影响，恢复时 fork 会被释放。override 可以嵌套，按相反顺序恢复。它作用于该应用的所有请求，所以不要并发运行同一个应用的 override 测试。

只想单独测试某个路由模块时，可以用 fork 出的 Pond 搭一个小应用：

```ts
const app = new Elysia().use(pondi(pond.fork().use(ripple(Db, () => fakeDb)))).use(userRoutes);
```

## Vite 插件

```ts
cyrenex({
  server: "server/main.ts",
  app: "server/app.ts",
  runtime: "bun",
  routes: ["/api", "/ws"],
  watch: ["templates/**"],
  dts: "cyrenex-env.d.ts",
  inspect: false,
  execArgv: [],
  env: {},
  shutdownTimeout: 1000,
  build: { server: { outDir: "dist/server" } },
});
```

| 配置              | 默认值                                 | 说明                                                           |
| ----------------- | -------------------------------------- | -------------------------------------------------------------- |
| `server`          | `"server/main.ts"`                     | 启动应用的服务端入口，相对 Vite root；可以位于其他包           |
| `app`             | `"server/app.ts"`                      | 默认导出应用的模块，仅用于 `cyrenex/client` 的类型             |
| `runtime`         | `process.env.CYRENEX_RUNTIME ?? "bun"` | `"bun"` 或 `"node"`，都运行在子进程中                          |
| `routes`          | `["/api", "/ws"]`                      | 转发的路径前缀，按完整路径段匹配，不改写路径；或 `"auto"`      |
| `watch`           | `[]`                                   | 额外触发重启的文件、目录或 glob；`false` 关闭自动重启          |
| `dts`             | `"cyrenex-env.d.ts"`                   | `cyrenex/client` 声明的写入位置；`false` 关闭生成              |
| `inspect`         | `false`                                | 开启调试器：`true`（`127.0.0.1:9229`）、端口号或 `"host:port"` |
| `execArgv`        | `[]`                                   | 应用进程额外的运行时参数                                       |
| `env`             | `{}`                                   | 应用进程的环境变量，覆盖 shell 与 `.env` 文件                  |
| `shutdownTimeout` | `1000`                                 | 重启时等待应用停止的毫秒数，超时强制结束旧进程                 |
| `build`           | 见[服务端构建](#服务端构建)            | `vp build` 的产物；`false` 交给 Vite 处理（只构建前端）        |

服务端入口通过 Vite ModuleRunner 运行。`start(app)` 会把端口报告给开发服务器；以其他方式监听的入口会拿到一个空闲的 `PORT`（以及 `HOST`），开发服务器通过探测该端口找到它。入口所在目录和所有经 Vite 加载的模块始终会被监听。`/api` 匹配 `/api` 和 `/api/users`，不匹配 `/apix`。

设为 `routes: "auto"` 时，转发前缀取自应用所定义路由的第一个路径段（`/api/users/:id` → `/api`），每次重启都会重新读取，所以新增 `/rpc` 路由无需改配置。第一个路径段为空、为参数或通配符的路由（`/`、`/:slug`、`*`）会接管前端的所有页面，因此会被跳过并给出警告。

### 环境变量

应用进程会拿到 Vite `.env` 文件（`envDir` 下的 `.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local`）中的全部变量，而不只是 `VITE_*`：这是服务端代码，不会进入浏览器。与 Vite 一致，shell 中已设置的变量优先。修改 `.env` 会重启开发服务器；`envDir: false` 可关闭加载。服务端入口属于其他包时，应用在那个包的目录下运行，并读取那个包的 `.env` 文件。

### 调试

`inspect: true` 会以 `--inspect=127.0.0.1:9229` 启动应用，两种运行时都支持。下一个进程启动前端口已被释放，所以重启后端口不变，配置了自动重连的调试器（VS Code attach 配置中的 `"restart": true`）会跟着应用重新连接。Bun 可打开输出的 `debug.bun.sh` 链接或使用 Bun 扩展。

### 重启

- 文件变更以 100ms 去抖并进入串行队列，重启期间到达的请求会等待新进程就绪。
- 旧进程收到关闭消息后，关闭 `start()` 启动的服务器（会执行 Elysia 的 `onStop` 钩子）并释放 Pond，超过 `shutdownTimeout`（默认 1 秒）会被强制结束。
- 应用不可用时 HTTP 返回 `503`，转发异常返回 `502`。
- 重启会断开业务 WebSocket，客户端需在 `close` 时自行重连；Vite 的 HMR 连接不受影响。
- 每次重启后，页面会收到 `cyrenex:restart` HMR 事件，类型由 `cyrenex-env.d.ts` 提供：

  ```ts
  import.meta.hot?.on("cyrenex:restart", ({ runtime }) => refetch());
  ```

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

`server/main.ts` 同时也是生产入口。可以让 `vp build` 把它和前端一起打包，也可以直接从源码运行：

```bash
vp build                     # dist/client + dist/server/main.mjs，并提示如何启动

node dist/server/main.mjs    # 构建产物
bun dist/server/main.mjs
bun server/main.ts           # 或直接运行源码
node server/main.ts
```

`@cyrenex/elysia` 的 `start`（对任何带 `fetch` 的应用，也可以用 `cyrenex/start` 的 `start`）依次完成服务端入口都需要做的事：

1. 创建 `eager` 中的 singleton（`warmup(app)`），失败则在监听之前 reject。
2. 监听 `PORT`（默认 `3000`）与 `HOST`，或 `port`、`hostname` 选项：`@cyrenex/elysia` 用 Elysia 自己的 adapter，`cyrenex/start` 用 srvx 承载 `fetch`。传入 `listen` 可以换成其他服务器。
3. 在你的路由之后托管前端产物，并提供 SPA 回退。在 `vp dev` 下不托管任何文件，前端由 Vite 提供。
4. 收到 `SIGINT` / `SIGTERM` 时关闭服务器并释放 Pond，然后退出。传入 `signals: false` 可自行处理信号。

它返回 `{ port, url, stop }`。在 `vp dev` 和 `vp preview` 下，它会监听开发或预览服务器转发的目标端口，并把重启交给它们处理。

### 监听方式

`@cyrenex/elysia` 的 `start` 会等待 Elysia 的异步插件注册完成，用应用自己的 adapter 监听（所以 WebSocket、`onStart` / `onStop` 和 handler 里的 `server` 都能用），用前端产物响应没有匹配到路由的请求，并在 `close` 时停止应用；在 Bun 上也会等待 `onStop` 钩子执行完毕。

`cyrenex/start` 的 `start` 只需要 `app.fetch`，而 fetch 不支持 WebSocket。需要其他服务器时，传入一个 `listen` 函数，由它启动服务器并返回端口和 `close`：

```ts
import { start } from "cyrenex/start";

// 任何接受 fetch handler 的服务器；传入的 `fetch` 已经带上了前端产物的回退。
await start(app, {
  listen: ({ port, hostname, fetch }) => {
    const server = Bun.serve({ port, hostname, fetch, websocket });
    return { port: server.port!, close: () => server.stop(true) };
  },
});
```

### 静态资源

| `static` 选项 | 默认值                  | 说明                                                      |
| ------------- | ----------------------- | --------------------------------------------------------- |
| `dir`         | 见下文                  | 前端产物目录，相对工作目录，或一个 `URL`                  |
| `prefix`      | `"/"`                   | 文件的 URL 前缀，与 Vite `base` 保持一致                  |
| `spa`         | `true`                  | 对没有匹配的页面导航返回 `index.html`；API 请求仍返回 404 |
| 其他          | srvx `staticMiddleware` | `maxAge`、`immutable`、`encodings`、`compress`、`etag` 等 |

`static` 也可以直接传目录，或传 `false` 只提供 API。默认情况下，构建后的服务端会在自身旁边找到前端产物，因此可以在任意工作目录运行；从源码运行时为工作目录下的 `dist/client` 或 `dist`，都不存在时跳过。以源码形式部署的服务端，建议相对于自身指定目录：`static: new URL("./public", import.meta.url)`。

只有接受 `text/html` 的 `GET` 请求会回退，所以 `fetch("/api/missing")` 和缺失的 `/assets/app.js` 仍然返回 404。

### 服务端构建

存在 `server/main.ts` 时，`vp build` 会构建两个环境：前端输出到 `dist/client`，服务端输出到 `dist/server/main.mjs`。产物和源码一样从 `node_modules` 导入依赖，所以部署时带上 `package.json` 并安装生产依赖即可。在你的入口执行之前，构建后的服务端会：

- 从工作目录加载 `.env.production.local`、`.env.local`、`.env.production` 和 `.env`，不覆盖已经设置的变量；
- 将 `NODE_ENV` 默认设为 `production`；
- 让 `start()` 指向自身旁边的前端产物。

从源码运行时，Bun 会自动读取 `.env` 文件；Node.js 请使用 `node --env-file-if-exists=.env server/main.ts`。

| `build` 选项 | 默认值                      | 说明                                                         |
| ------------ | --------------------------- | ------------------------------------------------------------ |
| `server`     | `{ outDir: "dist/server" }` | 把服务端入口打包到 `outDir/main.mjs`；`false` 以源码形式部署 |
| `client`     | Vite 的 `build.outDir`      | 前端输出目录，或 `{ outDir, copyTo }`，额外复制到其他位置    |
| `start`      | 用运行时直接执行入口        | 你的启动命令（如 `"pnpm start"`），构建后打印出来            |

打包服务端时，如果你没有设置前端 `outDir`，前端会改为输出到 `dist/client`；如果服务端输出会落在前端输出目录内（从而被当作静态文件公开），构建会失败。构建使用所配置 `runtime` 的导出条件；服务端相关的 Vite 配置写在 `environments.server` 下。构建完成后，cyrenex 会打印各部分的输出位置以及启动服务端的命令。

### 以源码形式部署服务端

如果要直接部署 TypeScript 源码（`bun server/main.ts`），或者用你自己的工具构建服务端，可以关闭服务端构建，并把前端输出到服务端托管它的位置：

```ts
cyrenex({ build: { server: false, client: "server/public" } });
```

```ts
// server/main.ts
await start(app, { static: new URL("./public", import.meta.url) });
```

以源码形式运行的服务端不经过 Vite：在 `vp dev` 下能用的别名、`import.meta.env` 等 Vite 专有特性，它都用不了。

### Monorepo

服务端可以放在独立的包里。把 `server`（以及用于客户端类型的 `app`）指向它，再把前端输出到那个包，或者复制过去：

```ts
// apps/web/vite.config.ts
cyrenex({
  server: "../api/src/main.ts",
  app: "../api/src/app.ts",
  build: { server: false, client: { outDir: "dist", copyTo: "../api/public" } },
});
```

- `vp dev` 在服务端包的目录下运行入口，并读取那个包的 `.env` 文件。
- `vp build` 输出前端、完成复制，并打印启动服务端的命令：默认是 `cd ../api && bun src/main.ts`，也可以用 `build.start: "pnpm --filter @acme/api start"` 换成你自己的命令。cyrenex 只负责打印。
- `vp preview` 在那个包里直接运行源码入口。

Vite root 之外的目录会在写入前被清空，所以 `client` 和 `copyTo` 不接受包的根目录（`../api`），请使用包内的子目录（`../api/public`）。

### 预览

`vp preview` 会用所配置的运行时启动服务端（`dist/server/main.mjs`，以源码部署时则是入口本身），并把所有请求和 WebSocket 转发给它。前端产物由服务端自己托管，所以预览看到的就是部署后的样子：相同的路由、相同的静态文件、相同的 SPA 回退。`start()` 会把端口报告给预览服务器；其他服务器则从预览服务器获得 `PORT` 与 `HOST`。没有服务端时，预览只提供前端。

> [!TIP]
> Node.js 通过剥离类型来运行 TypeScript，所以开启 `erasableSyntaxOnly` 并使用显式的 `.ts` 扩展名，同一份源码就能不经构建在两种运行时上运行。

`@cyrenex/elysia/static` 仍然保留，供需要自行给 Elysia 添加静态文件的应用使用：它包装了 `@elysia/static`（需自行安装），提供适合 Vite 的默认值（`assets: "dist"`、`prefix: "/"`）和同样的 SPA 回退。

## Adapter

adapter 由应用自己决定，cyrenex 不会注入。Bun 不需要 adapter；在 Node.js 上，自行安装 `@elysia/node`，并传入 `@cyrenex/elysia/node` 提供的 adapter：

```ts
import { node } from "@cyrenex/elysia/node";

export default new Elysia({ adapter: node() }).use(pondi(pond));
```

它包装了 `@elysia/node`，并修好了 `app.stop()`：上游既不设置 `app.server`，也没有实现 `stop`，所以 `app.stop()` 会直接报错，`onStop` 钩子永远不会执行。如果你自行使用原版 `@elysia/node`，`start` 仍会自行关闭服务器并执行这些钩子，但你自己代码里的 `app.stop()` 会报错。

想让同一个应用在两种运行时上运行，可以在启动时选择：

```ts
export const adapter =
  "Bun" in globalThis ? undefined : (await import("@cyrenex/elysia/node")).node();
```

## 已知限制

- 在 Node.js 上，Elysia 只会在使用了支持 WebSocket 的 adapter 的实例上注册 `.ws()` 路由，所以定义 `.ws()` 的插件也要传入 adapter。
- 在 Node.js 上，带 body schema 的 WebSocket 消息可能需要显式配置 `parse`。

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
