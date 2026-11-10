import { RequestContext } from "@cyrenex/elysia";
import { asyncDispose, init, pebble, ripple } from "cyrenex";

export interface Todo {
  id: number;
  title: string;
  done: boolean;
  owner: string;
}

export interface AppConfig {
  greeting: string;
}

/** Contract only; provided in container.ts (and replaceable in tests via `pond.fork()`). */
export const Config = pebble<AppConfig>("app:config");

/** Stands in for a real connection pool: async init, disposed on every dev restart. */
export class Db {
  #todos = new Map<number, Todo>();
  #seq = 0;

  async [init]() {
    console.log(`[db] connected (pid ${process.pid})`);
  }

  async [asyncDispose]() {
    console.log(`[db] closed (pid ${process.pid})`);
  }

  insert(todo: Omit<Todo, "id">): Todo {
    const row = { ...todo, id: ++this.#seq };
    this.#todos.set(row.id, row);
    return row;
  }

  all(): Todo[] {
    return [...this.#todos.values()];
  }

  get(id: number): Todo | undefined {
    return this.#todos.get(id);
  }

  delete(id: number): boolean {
    return this.#todos.delete(id);
  }
}

export const DbRipple = ripple.class("db", Db);

export const TodoService = ripple("todo:service", [DbRipple], (db) => ({
  list: (owner: string) => db.all().filter((todo) => todo.owner === owner),
  create: (owner: string, title: string) => db.insert({ title, owner, done: false }),
  toggle(owner: string, id: number) {
    const todo = db.get(id);
    if (!todo || todo.owner !== owner) return undefined;
    todo.done = !todo.done;
    return todo;
  },
  remove: (owner: string, id: number) => db.get(id)?.owner === owner && db.delete(id),
}));

/** One instance per request: reads the caller from the request headers. */
export const CurrentUser = ripple(
  "user:current",
  [RequestContext],
  (ctx) => ({ name: ctx.request.headers.get("x-user") ?? "guest" }),
  { mode: "scoped" },
);
