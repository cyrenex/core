/** Normalize configured prefixes: no trailing slash, except for the root itself. */
export function normalizeRoutes(routes: readonly string[]): string[] {
  return routes.map((route) => (route === "/" ? route : route.replace(/\/+$/, "")));
}

/** Whether `pathname` falls under one of `routes`, matching whole segments. */
export function matchesRoutes(routes: readonly string[], pathname: string): boolean {
  return routes.some(
    (route) => route === "/" || pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Derive forwarded prefixes from the app's route paths: the first static segment of each.
 * Paths whose first segment is empty, a parameter or a wildcard (`/`, `/:id`, `/*`) would
 * capture every page of the frontend, so they are skipped and reported.
 */
export function prefixesOf(paths: readonly string[]): { prefixes: string[]; skipped: string[] } {
  const prefixes = new Set<string>();
  const skipped = new Set<string>();
  for (const path of paths) {
    const first = path.split("/").find(Boolean);
    if (!first || first.startsWith(":") || /[*?]/.test(first)) skipped.add(path);
    else prefixes.add(`/${first}`);
  }
  return { prefixes: [...prefixes].sort(), skipped: [...skipped] };
}
