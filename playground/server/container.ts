import { Pond, ripple } from "cyrenex";

import { Config } from "./services.ts";

export const pond = new Pond().use(
  ripple(Config, () => ({ greeting: process.env.GREETING ?? "Hello from Elysia" })),
);
