import { inject } from "@cyrenex/elysia";
import { Elysia, t } from "elysia";

import { CurrentUser, TodoService } from "../services.ts";

export const todoRoutes = new Elysia({ prefix: "/api/todos" })
  .use(inject({ todos: TodoService, user: CurrentUser }))
  .get("/", ({ todos, user }) => todos.list(user.name))
  .post("/", ({ todos, user, body }) => todos.create(user.name, body.title), {
    body: t.Object({ title: t.String({ minLength: 1 }) }),
  })
  .patch(
    "/:id/toggle",
    ({ todos, user, params, status }) => todos.toggle(user.name, params.id) ?? status(404),
    { params: t.Object({ id: t.Number() }) },
  )
  .delete(
    "/:id",
    ({ todos, user, params, status }) =>
      todos.remove(user.name, params.id) ? { ok: true as const } : status(404),
    { params: t.Object({ id: t.Number() }) },
  );
