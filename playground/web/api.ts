import { treaty } from "@elysia/eden";
import type { App } from "cyrenex/client";

// Same origin in development (Vite forwards /api and /ws) and in production (server/main.ts).
export const api = treaty<App>(location.origin);
