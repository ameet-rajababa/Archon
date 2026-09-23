import { Paperclip } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  dragHasFiles,
  formatBytes,
  imagesFromClipboard,
  isAcceptedFileType,
} from '../primitives/file';

/** What the user has typed and attached but not yet sent, for one conversation. */
export interface ChatDraft {
  text: string;
  files: File[];
}

interface ChatComposerProps {
  onSend: (message: string, files?: File[]) => void;
  /**
   * The draft is owned by the page and keyed by conversation, so it survives
   * switching chats instead of following the user between them.
   *
   * `draft.text` seeds this component and is not read again — while mounted,
   * the local copy is authoritative. The page must therefore give the composer
   * a `key` that changes with the conversation, so switching chats remounts it
   * and reseeds from the right draft.
   */
  draft: ChatDraft;
  onDraftChange: (next: ChatDraft) => void;
  disabled: boolean;
  disabledReason?: string;
}

const MAX_HEIGHT = 200;

/**
 * Console-native chat composer. Auto-growing textarea, Enter sends,
 * Shift+Enter newline, Escape blurs. Attach files with the paperclip icon, by
 * dropping them anywhere on the composer, or by pasting a copied image (the
 * send skill builds the multipart upload).
 *
 * Written for the console rather than shared with the old chat's MessageInput,
 * which no longer exists — #3402 retired the classic UI and deleted it.
 *
 * Direction-B `cbox` shell: rounded card with `:focus-within` magenta ring,
 * paperclip attach + decorative `/` lead buttons, gradient `.brand-bar` Send
 * button + glow, kbd-hint row beneath. Attached files render as removable
 * chips above.
 */
export function ChatComposer({
  onSend,
  draft,
  onDraftChange,
  disabled,
  disabledReason,
}: ChatComposerProps): ReactElement {
  /**
   * The in-flight text is LOCAL. It used to live on the page, so every
   * keystroke ran setState there and re-rendered the whole chat tree — the
   * rail, the transcript, every tool card — to produce about nine DOM changes.
   * Measured at 333ms per key against 34ms for every other input in the
   * console; the composer was the only box in the app that could not keep up
   * with typing.
   *
   * Files stay on the page. They change a handful of times per draft, never
   * per keystroke, so they cost nothing where they are.
   */
  const [value, setValue] = useState(draft.text);
  const files = draft.files;

  // Read by commit(), which must send the CURRENT text without being
  // reconstructed on every keystroke (that would defeat the point).
  const valueRef = useRef(value);
  valueRef.current = value;
  const filesRef = useRef(files);
  filesRef.current = files;
  const committedRef = useRef(draft.text);

  /**
   * Push the local text up to the page's per-conversation record. Called on
   * blur, on send, on any file change, and on unmount — which is what makes
   * switching chats keep what you had typed. Never called per keystroke.
   */
  const commit = useCallback((): void => {
    if (valueRef.current === committedRef.current) return;
    committedRef.current = valueRef.current;
    onDraftChange({ text: valueRef.current, files: filesRef.current });
  }, [onDraftChange]);

  // Unmount is the chat switch: the page re-keys this component, so the
  // callback captured here still belongs to the conversation being left.
  useEffect(() => commit, [commit]);

  const setFiles = (next: File[]): void => {
    // A file change commits the text alongside it — one call, so neither
    // field can undo the other.
    committedRef.current = valueRef.current;
    onDraftChange({ text: valueRef.current, files: next });
  };
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next.toString()}px`;
    el.style.overflowY = next >= MAX_HEIGHT ? 'auto' : 'hidden';
  };

  const addFiles = (incoming: File[]): void => {
    const next: File[] = [...files];
    // Accumulate every rejection reason (not just the last) so a mixed pick
    // surfaces all of them.
    const skipped: string[] = [];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) {
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
      next.push(file);
    }
    setFiles(next);
    setFileError(
      skipped.length > 0
        ? `Skipped ${String(skipped.length)} file(s) — ${skipped.join('; ')}`
        : null
    );
  };

  const removeFile = (index: number): void => {
    setFiles(files.filter((_, i) => i !== index));
    setFileError(null);
  };

  // A file drag must be cancelled on both dragover and drop. Without
  // `preventDefault` the browser handles the drop itself and navigates the tab
  // to the dropped file, which tears down the whole single-page app and loses
  // the conversation. That is true while the composer is disabled too, so a
  // disabled composer still cancels the event — it just refuses the files
  // instead of ignoring the drop.
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!dragHasFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    if (!disabled) setDragging(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    // Also fires when the pointer crosses into a child, so only clear once it
    // has left the composer entirely.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!dragHasFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) addFiles(Array.from(e.dataTransfer.files));
  };

  // Unlike a drop, an uncancelled paste is harmless, so a disabled composer can
  // simply ignore it.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (disabled) return;
    const images = imagesFromClipboard(e.clipboardData.items);
    if (images.length === 0) return;
    addFiles(images);
    // Cancel only an image-only payload. Copying a web-page selection that
    // holds both an image and its text puts both on the clipboard, and
    // preventDefault would attach the image while silently eating the text.
    if (e.clipboardData.getData('text/plain').length === 0) e.preventDefault();
  };

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed, files.length > 0 ? [...files] : undefined);
    setValue('');
    committedRef.current = '';
    onDraftChange({ text: '', files: [] });
    setFileError(null);
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
    if (textareaRef.current !== null) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  };

  const idlePlaceholder = disabled ? (disabledReason ?? 'Waiting…') : 'Message the agent…';
  const placeholder = dragging ? 'Drop files to attach…' : idlePlaceholder;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Don't submit while an IME composition is in progress (Japanese,
    // Chinese, Korean, etc. — the first Enter accepts a candidate).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className="shrink-0 border-t border-border bg-surface px-[var(--chat-pad)] py-[var(--bubble-y)]"
      title={disabledReason}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mx-auto max-w-[940px]">
        {files.length > 0 ? (
          <div className="mb-[10px] flex flex-wrap gap-[0.375rem]">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${String(i)}`}
                className="flex items-center gap-[0.375rem] rounded-[var(--radius-card)] border bg-[color:var(--surface-elevated)] py-[0.25rem] pl-[9px] pr-[5px] text-[length:var(--text-small)]"
                style={{ borderColor: 'var(--border-bright)' }}
              >
                <span className="max-w-[180px] truncate text-text-primary">{f.name}</span>
                <span className="font-mono text-[length:var(--text-micro)] text-text-tertiary">
                  {formatBytes(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeFile(i);
                  }}
                  aria-label={`Remove ${f.name}`}
                  className="rounded p-[0.0625rem] text-text-tertiary transition-colors hover:bg-[color:var(--surface-hover)] hover:text-text-primary"
                >
                  <span aria-hidden className="text-[length:var(--text-micro)] leading-none">
                    ✕
                  </span>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {fileError !== null ? (
          <div className="mb-[8px] font-mono text-[length:var(--text-micro)] text-error">
            {fileError}
          </div>
        ) : null}
        <div
          className={`flex items-end gap-[0.625rem] rounded-[var(--radius-panel)] border bg-[color:var(--surface-elevated)] py-[0.5rem] pl-[14px] pr-[8px] transition-[border-color,box-shadow] focus-within:border-[color:color-mix(in_oklch,var(--accent),transparent_40%)] focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent),transparent_92%)]${
            dragging ? ' shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent),transparent_92%)]' : ''
          }`}
          style={{
            // Inline, because the inline border-color would otherwise win over
            // any class-based drag state.
            borderColor: dragging
              ? 'color-mix(in oklch, var(--accent), transparent 40%)'
              : 'var(--border-bright)',
          }}
        >
          <div className="flex shrink-0 items-end gap-[0.375rem] pb-[7px] text-text-tertiary">
            <button
              type="button"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              aria-label="Attach files"
              disabled={disabled || files.length >= MAX_FILES}
              title="Attach files"
              className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-text-primary disabled:cursor-default disabled:opacity-50"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS}
              className="hidden"
              onChange={e => {
                if (e.target.files !== null) addFiles(Array.from(e.target.files));
              }}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label="Commands"
              disabled
              title="Commands (coming soon)"
              className="flex h-[22px] items-center justify-center rounded-md px-[0.125rem] text-[length:var(--text-large)] leading-none transition-colors hover:bg-[color:var(--surface-hover)] hover:text-text-primary disabled:cursor-default disabled:opacity-50"
            >
              /
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => {
              setValue(e.target.value);
              grow(e.target);
            }}
            onKeyDown={onKeyDown}
            onBlur={commit}
            onPaste={onPaste}
            rows={1}
            placeholder={placeholder}
            className="min-h-0 flex-1 resize-none bg-transparent py-[0.4375rem] text-[length:var(--text-medium)] leading-[1.5] text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
            style={{ maxHeight: `${MAX_HEIGHT.toString()}px` }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            title="Send · Enter"
            className="brand-bar flex h-[36px] shrink-0 items-center gap-[0.4375rem] rounded-[var(--radius-panel)] px-[var(--bubble-x)] text-[length:var(--text-body)] font-bold text-white shadow-[0_6px_18px_-8px_color-mix(in_oklch,var(--accent),transparent_30%)] transition-[filter,transform] hover:brightness-110 active:translate-y-[1px] disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100"
          >
            Send
            <span aria-hidden className="font-mono text-[length:var(--text-micro)] opacity-70">
              ↵
            </span>
          </button>
        </div>
        <div className="mt-[9px] flex items-center justify-between px-[0.125rem] font-mono text-[length:var(--text-micro)] text-text-tertiary">
          <span />
          <span>
            <span
              className="mr-1 inline-flex items-center rounded border px-[0.3125rem] py-[0.0625rem] font-mono text-[length:var(--text-micro)] text-text-secondary"
              style={{ borderColor: 'var(--border-bright)' }}
            >
              ↵
            </span>
            send{' '}
            <span
              className="ml-1 inline-flex items-center rounded border px-[0.3125rem] py-[0.0625rem] font-mono text-[length:var(--text-micro)] text-text-secondary"
              style={{ borderColor: 'var(--border-bright)' }}
            >
              ⇧↵
            </span>{' '}
            newline
          </span>
        </div>
      </div>
    </div>
  );
}
