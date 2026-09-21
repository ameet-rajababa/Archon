import { useState, type ReactElement } from 'react';
import { Glyph } from '../lib/glyph';
import {
  setAssistantIdentity,
  useActiveAssistant,
  useAssistantIdentity,
} from '../lib/assistant-identity';
import { useStreamContext } from '../lib/stream-context';
import { IdentityPicker } from './IdentityPicker';

interface AgentAvatarProps {
  size?: number;
}

/**
 * The assistant's mark: a ring in its color around its glyph, and a click
 * target for changing both.
 *
 * It was a fixed brand gradient around `/favicon.png`. The gradient left a
 * chosen color nowhere to go and the PNG could not be tinted, so both gave way
 * to the vocabulary the rail already uses — a lucide glyph stroked in the
 * chosen color, which means all 245 icons work in every color for free.
 *
 * Which assistant it shows is whichever one answers where it is drawn: the
 * chat's own provider inside a chat (recorded on the conversation row, so it
 * is provenance rather than a guess), and the configured default in the rail
 * head, which belongs to no chat.
 */
export function AgentAvatar({ size = 30 }: AgentAvatarProps): ReactElement {
  const declared = useStreamContext().assistant;
  const configured = useActiveAssistant();
  const assistant = declared ?? configured;
  const { identity, color } = useAssistantIdentity(assistant);
  // The button rather than a ref, so the panel is placed against the live rect
  // — and so `null` cannot be mistaken for "closed" (the bug that silently
  // stopped the project picker opening at all).
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        ref={setButton}
        onClick={() => {
          setOpen(v => !v);
        }}
        title={`Change the ${assistant} icon and color…`}
        aria-label={`Change the ${assistant} icon and color`}
        aria-expanded={open}
        className="flex shrink-0 items-center justify-center rounded-full transition-colors"
        style={{
          width: size,
          height: size,
          // The ring, the gap and the mark, in that order: a 1.6px border, a
          // background that matches the card behind it, and a glyph at half
          // the box. Punching the hole with a border rather than a second SVG
          // circle is what lets the color be a plain CSS value.
          border: `1.6px solid ${color}`,
          background: 'var(--surface-elevated)',
        }}
      >
        <Glyph seed={assistant} glyph={identity.glyph} color={color} size={Math.round(size / 2)} />
      </button>
      {open && button !== null ? (
        <IdentityPicker
          identity={identity}
          color={color}
          anchor={button}
          onPick={patch => {
            // No `settled` branch: this is one localStorage write, so there is
            // nothing expensive to defer to the end of a drag.
            setAssistantIdentity(assistant, patch);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
