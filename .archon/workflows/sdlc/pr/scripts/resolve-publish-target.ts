/**
 * The repository this run's delivery publishes to.
 *
 * The resolution itself is shared (../../.shared/publish-target.ts), because the
 * `implement` guard needs the same answer about the same branch and two derivations of
 * one forge identity is the condition that produced the inversion both used to carry.
 * What belongs here is the policy: nothing this pack does is possible without a target,
 * so a checkout that does not settle the question stops the run rather than choosing.
 */

import { emit, refuse } from '../../.shared/io.ts';
import { resolvePublishTarget } from '../../.shared/publish-target.ts';

const resolution = resolvePublishTarget();
if (resolution.ok) {
  emit(resolution.target);
} else {
  refuse(`resolve-publish-target: ${resolution.reason}`);
}
