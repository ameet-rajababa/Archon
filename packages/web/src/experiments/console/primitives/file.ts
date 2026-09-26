/**
 * Chat attachment limits and client-side filtering. The list is deliberately
 * conservative; the server remains the authoritative upload validator.
 */

export const MAX_FILES = 5;
export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

const ACCEPTED_EXTENSIONS_LIST = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.log',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.sh',
  '.sql',
];

/** Comma-separated string for the file input's `accept` attribute. */
export const ACCEPTED_EXTENSIONS = ACCEPTED_EXTENSIONS_LIST.join(',');

const ACCEPTED_SET = new Set(ACCEPTED_EXTENSIONS_LIST);

/**
 * True if the file looks acceptable. Prefers the reported MIME type; falls back
 * to the extension because many code/config files report an empty MIME type. A
 * file with no extension and a non-text/non-image MIME is rejected.
 */
export function isAcceptedFileType(file: File): boolean {
  // Strip any `;charset=…` parameter — some sources (and Bun's File) append one.
  const mime = (file.type.split(';')[0] ?? '').trim();
  if (mime.startsWith('text/') || mime.startsWith('image/')) return true;
  if (mime === 'application/pdf' || mime === 'application/json') return true;
  const dot = file.name.lastIndexOf('.');
  if (dot <= 0) return false; // no extension, or a dotfile like `.gitignore` (no real ext)
  return ACCEPTED_SET.has(file.name.slice(dot).toLowerCase());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

/**
 * True when a drag carries files.
 *
 * `DataTransfer.types` reports `'Files'` for a file drag, while dragging a text
 * selection out of the composer's own textarea reports `'text/plain'` only.
 * Distinguishing them keeps a text drag from lighting up the drop zone and from
 * being swallowed by the drop handler's `preventDefault`.
 *
 * Reads through `Array.from` because Safari hands back a `DOMStringList` rather
 * than a real array.
 */
export function dragHasFiles(types: DataTransfer['types']): boolean {
  return Array.from(types).includes('Files');
}

/**
 * The image files on a clipboard payload.
 *
 * A copied screenshot rides the clipboard as an `image/*` item rather than as a
 * path, so reading the items is the only way to see it. Everything else is left
 * alone — an ordinary text copy carries `text/plain` and `text/html` items and
 * must keep pasting as text.
 *
 * Reads through `Array.from` because `DataTransferItemList` is array-like
 * rather than an array.
 */
export function imagesFromClipboard(items: DataTransferItemList): File[] {
  const images: File[] = [];
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue;
    // Null when the item is not really a file despite its MIME type.
    const file = item.getAsFile();
    if (file !== null) images.push(file);
  }
  return images;
}

/** The outcome of offering files to an attachment list. */
export interface FileAdmission {
  /** What is attached now: the kept list plus everything admitted. */
  files: File[];
  /** One line naming every refusal and its reason, or null when none were refused. */
  error: string | null;
}

/**
 * Add files to an attachment list, refusing the ones that break a limit.
 *
 * Every surface that attaches files goes through here — the composer and the
 * ask card both — so a refusal reads the same wherever it happens and the
 * limits have exactly one definition. Accumulates every rejection reason rather
 * than only the last, so a mixed pick surfaces all of them.
 */
export function admitFiles(kept: File[], incoming: File[]): FileAdmission {
  const files = [...kept];
  const skipped: string[] = [];
  for (const file of incoming) {
    if (files.length >= MAX_FILES) {
      skipped.push(`${file.name}: over the ${String(MAX_FILES)}-file limit`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      skipped.push(`${file.name}: larger than ${String(MAX_FILE_MB)} MB`);
      continue;
    }
    if (!isAcceptedFileType(file)) {
      skipped.push(`${file.name}: unsupported type`);
      continue;
    }
    files.push(file);
  }
  return {
    files,
    error:
      skipped.length > 0
        ? `Skipped ${String(skipped.length)} file(s) — ${skipped.join('; ')}`
        : null,
  };
}
