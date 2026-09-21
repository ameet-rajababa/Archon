import { Fragment, type ReactElement } from 'react';
import { MessageItem } from './MessageItem';
import { ConsoleWorkflowResultCard } from './ConsoleWorkflowResultCard';
import { isSystemCategory, type Message } from '../primitives/message';

interface ChatStreamProps {
  messages: Message[];
  /** Send an answer to an ask block. Omitted where the stream is read-only. */
  onAnswer?: (text: string) => void;
}

/**
 * Message-only stream for the chat view. A pure chat has no RunEvent[] to merge
 * (unlike RunStream); each message renders as a MessageItem.
 *
 * Tool calls and framework chatter never render here. They belong to the turn,
 * not to the conversation, so ChatStatusStrip lists them under its own
 * disclosure instead — one place that answers "what is it doing", rather than a
 * switch that turns the whole transcript into a log. The full per-tool cards,
 * inputs and outputs included, remain on the run detail page.
 *
 * Wrap in <StreamContextProvider> upstream (ChatPage) so StreamCard timestamps
 * resolve — pass runStartedAt: null for wall-clock display.
 */
export function ChatStream({ messages, onAnswer }: ChatStreamProps): ReactElement {
  // `workflow_result` messages are normally swept up by `isSystemCategory` (the
  // `workflow_` prefix), but they carry the run summary + a completion card — let
  // them through explicitly. Other `workflow_*` narration stays suppressed.
  const visible = messages.filter(
    m =>
      m.category === 'workflow_result' ||
      (!isSystemCategory(m.category) && m.content.trim().length > 0)
  );

  return (
    <div className="flex flex-col gap-[14px]">
      {visible.map(message => (
        <Fragment key={message.id}>
          {message.category === 'workflow_result' && message.workflowResult !== null ? (
            <ConsoleWorkflowResultCard
              runId={message.workflowResult.runId}
              workflowName={message.workflowResult.workflowName}
              summary={message.content}
            />
          ) : (
            <MessageItem message={message} onAnswer={onAnswer} />
          )}
        </Fragment>
      ))}
    </div>
  );
}
