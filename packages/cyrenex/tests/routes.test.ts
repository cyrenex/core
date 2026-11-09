import { describe, expect, test } from "vite-plus/test";

import { matchesRoutes, normalizeRoutes, prefixesOf } from "../src/vite/routes.ts";

describe("routes", () => {
  test("match whole segments", () => {
    const routes = normalizeRoutes(["/api/", "/ws"]);
    expect(routes).toEqual(["/api", "/ws"]);
    expect(matchesRoutes(routes, "/api")).toBe(true);
    expect(matchesRoutes(routes, "/api/users")).toBe(true);
    expect(matchesRoutes(routes, "/apix")).toBe(false);
    expect(matchesRoutes(normalizeRoutes(["/"]), "/anything")).toBe(true);
  });

  test("derive prefixes from the first static segment", () => {
    expect(
      prefixesOf(["/api/users", "/api/users/:id", "/ws", "/health", "/", "/:slug", "/*"]),
    ).toEqual({ prefixes: ["/api", "/health", "/ws"], skipped: ["/", "/:slug", "/*"] });
  });
});
