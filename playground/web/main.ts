import { api } from "./api.ts";

const field = (form: HTMLFormElement, name: string) => {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value.trim() : "";
};

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const userInput = $<HTMLInputElement>("#user");
const headers = () => ({ "x-user": userInput.value || "guest" });

async function hello() {
  const { data, error } = await api.api.hello.get();
  $("#hello").textContent = error
    ? `error ${String(error.status)}`
    : `${data.message} — ${data.runtime} pid ${data.pid}`;
}

async function renderTodos() {
  const { data } = await api.api.todos.get({ headers: headers() });
  const list = $("#todos");
  list.replaceChildren(
    ...(data ?? []).map((todo) => {
      const item = document.createElement("li");
      item.className = todo.done ? "done" : "";

      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = todo.done;
      toggle.onchange = async () => {
        await api.api.todos({ id: todo.id }).toggle.patch(undefined, { headers: headers() });
        await renderTodos();
      };

      const title = document.createElement("span");
      title.textContent = todo.title;

      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.onclick = async () => {
        await api.api.todos({ id: todo.id }).delete(undefined, { headers: headers() });
        await renderTodos();
      };

      item.append(toggle, title, remove);
      return item;
    }),
  );
}

$<HTMLFormElement>("#add").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const title = field(form, "title");
  if (!title) return;
  const { error } = await api.api.todos.post({ title }, { headers: headers() });
  if (error) return alert(`error ${String(error.status)}`);
  form.reset();
  await renderTodos();
};
userInput.onchange = () => renderTodos();

// The dev server restarts the app process on server changes, which closes business sockets.
// Eden's subscribe() returns a plain WebSocket wrapper, so reconnecting is up to the app.
const log = $("#ws-log");
let chat = connect();

function connect() {
  const socket = api.ws.subscribe();
  socket.subscribe(({ data }) => {
    log.textContent = `${JSON.stringify(data)}\n${log.textContent}`;
  });
  socket.on("close", () => setTimeout(() => (chat = connect()), 500));
  return socket;
}

$<HTMLFormElement>("#ws-form").onsubmit = (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  chat.send(field(form, "message"));
  form.reset();
};

await Promise.all([hello(), renderTodos()]);
