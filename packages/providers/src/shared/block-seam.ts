/**
 * The join between two consecutive assistant text chunks.
 *
 * A provider yields one chunk per text block, not per token, so two adjacent
 * chunks are two separate blocks of the model's own output — never two halves
 * of one line. Every consumer that rebuilds a whole reply from those chunks
 * therefore has to supply the boundary the stream dropped.
 *
 * Concatenating raw is what fused a closing ``` onto the heading that followed
 * it: the fence never closed, the ask block inside it stopped parsing, and the
 * reader got a wall of JSON instead of a card. The seam belongs here, next to
 * the contract that produced it, so the chat path and the workflow path cannot
 * disagree about it.
 *
 * Only a seam with no whitespace on either side is repaired, and it is repaired
 * with a blank line — the boundary markdown needs before a heading, a fence or a
 * list can start one. Whitespace already at the seam means the two sides were
 * meant to run on, so they are left exactly as they arrived.
 */
export function blockSeam(before: string, after: string): string {
  if (before.length === 0 || after.length === 0) return '';
  if (/\s$/.test(before) || /^\s/.test(after)) return '';
  return '\n\n';
}
