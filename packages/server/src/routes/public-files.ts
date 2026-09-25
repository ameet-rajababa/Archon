import type { OpenAPIHono } from '@hono/zod-openapi';
import { getArchonPublicPath } from '@archon/paths';

/**
 * Files published by a session, served at `/files/<project>/<chatId>/<name>`.
 *
 * WHY THIS EXISTS. Published images used to be written into the web build
 * output, which lives inside the Docker image — and every deploy rebuilds that
 * image from the Dockerfile. Anything written there at runtime survived until
 * the next deploy and no longer, so a chat transcript's pictures broke roughly
 * daily. ARCHON_HOME is a mounted volume, so it outlives image rebuilds,
 * upgrades and container replacement.
 *
 * WHAT IS PUBLIC. Everything in the directory, to anyone who can reach the
 * console. There is no per-file authorization and deliberately so: the
 * deployment's own gate is the gate, and a second auth system over the same
 * content would add a set of rules to keep in step with the first without
 * protecting anything it does not already protect. It is a publishing
 * directory — `getArchonTempPath()` is the scratch space.
 *
 * WHY NOT UNDER `/assets`. That prefix is content-hashed build output served
 * `immutable` for a year, because a changed file there is a different URL.
 * These names are chosen by hand and a replaced file keeps its name, so the
 * same caching would serve stale bytes until the cache expired.
 *
 * REGISTERED BEFORE THE SPA CATCH-ALL, and outside the production-only block
 * that serves the web build: these are not build output and exist in
 * development too. A request that reached the catch-all would be answered with
 * index.html — a 200 of HTML where an image was asked for, which reads to the
 * browser as a corrupt file rather than as a missing one.
 *
 * `root` is injectable for the test only. Production reads ARCHON_HOME, and a
 * caller that passes a root is choosing one deliberately rather than
 * inheriting the environment.
 */
export async function registerPublicFiles(app: OpenAPIHono, root?: string): Promise<void> {
  const { serveStatic } = await import('hono/bun');
  // Resolved once, not per request: ARCHON_HOME does not change while the
  // process runs, and reading it per request would let a later env mutation
  // silently move where files are served from.
  const publicRoot = root ?? getArchonPublicPath();

  app.use('/files/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-cache');
  });
  // `serveStatic` resolves the rewritten path within `root` and refuses to
  // escape it, which is what makes `/files/../../etc/passwd` a miss rather
  // than a disclosure. `public-files.test.ts` asserts that rather than
  // trusting it.
  app.use(
    '/files/*',
    serveStatic({ root: publicRoot, rewriteRequestPath: p => p.replace(/^\/files/, '') })
  );
}
