/**
 * Zod schemas for codebase API endpoints.
 */
import { z } from '@hono/zod-openapi';
import { codebaseRowSchema } from '@archon/core/schemas/codebase';

/** A codebase record (wire shape with ISO string dates). */
export const codebaseSchema = codebaseRowSchema
  .extend({
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('Codebase');

/** GET /api/codebases response. */
export const codebaseListResponseSchema = z.array(codebaseSchema).openapi('CodebaseListResponse');

/** Path params for routes with :id (codebase ID). */
export const codebaseIdParamsSchema = z.object({ id: z.string() });

/** POST /api/codebases request body. Exactly one of url or path must be provided. */
export const addCodebaseBodySchema = z
  .object({
    url: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
  })
  .refine(b => (b.url !== undefined) !== (b.path !== undefined), {
    message: 'Provide either "url" or "path", not both and not neither',
  })
  .openapi('AddCodebaseBody');

/** DELETE /api/codebases/:id response. */
export const deleteCodebaseResponseSchema = z
  .object({ success: z.boolean() })
  .openapi('DeleteCodebaseResponse');

/** Response for GET /api/codebases/:id/env — returns only keys, never values */
export const codebaseEnvVarsResponseSchema = z
  .object({
    keys: z.array(z.string()),
  })
  .openapi('CodebaseEnvVarsResponse');

/** Body for PUT /api/codebases/:id/env — upsert one key-value pair */
export const setEnvVarBodySchema = z
  .object({
    key: z.string().min(1).max(255),
    value: z.string(),
  })
  .openapi('SetEnvVarBody');

/** Path params for routes with :id/:key */
export const codebaseEnvVarParamsSchema = z.object({
  id: z.string(),
  key: z.string(),
});

/** Response for PUT/DELETE /api/codebases/:id/env */
export const envVarMutationResponseSchema = z
  .object({ success: z.boolean() })
  .openapi('EnvVarMutationResponse');

// =========================================================================
// Files tab — reading a project's checkout (#23)
// =========================================================================

/**
 * `?path=` rather than a wildcard route. A wildcard is not representable in
 * OpenAPI, which is why the artifact route had to drop out of the generated
 * types; a query parameter keeps these two endpoints on the typed path and in
 * `api.generated.d.ts`.
 *
 * Empty means the project root. The server owns validation — a path is
 * caller-supplied input, so nothing here is trusted beyond "it is a string".
 */
export const codebaseFilePathQuerySchema = z.object({ path: z.string().optional() });

/**
 * One directory entry. `size` is null for anything that is not a regular file,
 * because a directory's byte size answers a question nobody asked.
 */
export const codebaseFileEntrySchema = z
  .object({
    name: z.string(),
    kind: z.enum(['file', 'dir', 'other']),
    size: z.number().nullable(),
  })
  .openapi('CodebaseFileEntry');

/** Response for GET /api/codebases/:id/files — one directory level, never a walk. */
export const codebaseFilesResponseSchema = z
  .object({
    /** Normalised path of the directory listed, relative to the project root. */
    path: z.string(),
    entries: z.array(codebaseFileEntrySchema),
  })
  .openapi('CodebaseFilesResponse');

/** Response for GET /api/codebases/:id/file — one file's text. */
export const codebaseFileResponseSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    size: z.number(),
  })
  .openapi('CodebaseFileResponse');
