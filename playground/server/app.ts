import { inject, pondi } from "cyrenex";
import { Elysia } from "elysia";

import { adapter } from "./adapter.ts";

import { pond } from "./container.ts";
import { todoRoutes } from "./modules/todo.ts";
import { Config, DbRipple } from "./services.ts";

// Export the app without calling .listen(): `cyrenex/vite` runs it in development,
// server/main.ts serves it in production. Its type reaches the browser via `cyrenex/client`.
export default new Elysia({ adapter })
  .use(pondi(pond, { eager: [DbRipple] }))
  .use(inject({ config: Config }))
  .get("/api/hello", ({ config }) => ({
    message: config.greeting,
    runtime: "Bun" in globalThis ? "bun" : "node",
    pid: process.pid,
  }))
  .use(todoRoutes)
  .ws("/ws", {
    message(ws, message) {
      ws.send({ echo: message, at: Date.now() });
    },
  });
