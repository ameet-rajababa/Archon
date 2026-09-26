/**
 * The repository whose pull requests this run's branch belongs to — the one the
 * implement guard reads a named pull request from before it is allowed to edit.
 *
 * The resolution is shared with the `pr` pack (../../.shared/publish-target.ts); this
 * script owns only how an unresolved checkout is delivered. It reports instead of
 * refusing, and that difference is deliberate: an implement run needs a forge identity
 * only when the work names an existing pull request, so refusing here would stop a run
 * that never touches the forge over push configuration it does not need. The guard that
 * does need it reads `repo`, finds it empty, and stops on `reason` — see
 * ../commands/implement.md. Nothing else in this pack reads either field, so an
 * unresolved checkout costs a run nothing.
 *
 * Both fields are always present and `repo` is empty exactly when `reason` is not:
 * a declared-but-omitted property fails strict structured-output validation, and an
 * absent field fails a consumer's strict `.field` access, so optionality lives in the
 * value rather than in what the schema requires.
 */

import { emit } from '../../.shared/io.ts';
import { resolvePublishTarget } from '../../.shared/publish-target.ts';

const resolution = resolvePublishTarget();
emit(
  resolution.ok
    ? { repo: resolution.target.path, reason: '' }
    : { repo: '', reason: resolution.reason }
);
