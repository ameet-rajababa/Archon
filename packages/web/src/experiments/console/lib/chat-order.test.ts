import { describe, test, expect } from 'bun:test';
import {
  applyChatOrder,
  chatOrderKey,
  dropIndexAt,
  mergeChatOrder,
  previewShift,
  readChatOrder,
  reorder,
  rowBoxes,
} from './chat-order';

const list = (...ids: string[]) => ids.map(id => ({ id }));
const ids = (items: { id: string }[]) => items.map(i => i.id);

describe('chatOrderKey', () => {
  test('is scoped per project and namespaced', () => {
    expect(chatOrderKey('a')).not.toBe(chatOrderKey('b'));
    expect(chatOrderKey('a')).toStartWith('archon.console.');
  });
});

describe('applyChatOrder', () => {
  test('the order decides, not recency', () => {
    // Every id is in the order, which is the state the rail keeps itself in.
    expect(ids(applyChatOrder(list('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  test('a row created since goes on top, not under the arranged ones', () => {
    // Appended to the tail it would be buried by an order that predates it.
    expect(ids(applyChatOrder(list('new', 'a', 'b'), ['b', 'a']))).toEqual(['new', 'b', 'a']);
  });

  test('several new rows keep the incoming order among themselves', () => {
    expect(ids(applyChatOrder(list('newer', 'older', 'a'), ['a']))).toEqual([
      'newer',
      'older',
      'a',
    ]);
  });

  test('ids in the order that no longer exist are ignored', () => {
    expect(ids(applyChatOrder(list('a', 'b'), ['gone', 'b']))).toEqual(['a', 'b']);
  });

  test('no order leaves recency untouched', () => {
    expect(ids(applyChatOrder(list('a', 'b', 'c'), []))).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeChatOrder', () => {
  test('rearranges the displayed rows without moving the ones out of view', () => {
    // 'x' is hidden by the current search. Dragging 'c' to the top must not
    // cost 'x' its slot between 'a' and 'b'.
    expect(mergeChatOrder(['a', 'x', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'b']);
  });

  test('a filtered list that shares no ids with the order leaves it intact', () => {
    // The reported bug: dragging while a query matched nothing already
    // arranged used to erase every other row's place. The matches take their
    // own slots; the arrangement behind them stands.
    expect(mergeChatOrder(['a', 'b'], ['y', 'x'])).toEqual(['y', 'x', 'a', 'b']);
  });

  test('an id the order has never seen takes a slot at the top', () => {
    expect(mergeChatOrder(['a', 'b'], ['new', 'a', 'b'])).toEqual(['new', 'a', 'b']);
  });

  test('re-merging what is already stored changes nothing', () => {
    // Idempotent, so a render that merges without a drag cannot churn the
    // stored order.
    expect(mergeChatOrder(['a', 'x', 'b'], ['a', 'b'])).toEqual(['a', 'x', 'b']);
  });

  test('a duplicated id does not push another off the end', () => {
    // A hand-edited value would otherwise claim two slots for one row.
    expect(mergeChatOrder(['a', 'a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
  });

  test('an empty order takes the displayed arrangement whole', () => {
    expect(mergeChatOrder([], ['b', 'a'])).toEqual(['b', 'a']);
  });

  test('showing nothing leaves the order alone', () => {
    expect(mergeChatOrder(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('reorder', () => {
  test('moves the dragged chat to the target position', () => {
    expect(reorder(list('a', 'b', 'c'), 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorder(list('a', 'b', 'c'), 'a', 'c')).toEqual(['b', 'c', 'a']);
  });

  test('dropping a chat on itself changes nothing', () => {
    expect(reorder(list('a', 'b'), 'a', 'a')).toEqual(['a', 'b']);
  });

  test('an unknown id is a no-op rather than a corrupted order', () => {
    expect(reorder(list('a', 'b'), 'ghost', 'a')).toEqual(['a', 'b']);
  });
});

/**
 * The project rail's own loop, composed from the calls it makes: draw the
 * filtered list with `applyManualOrder`, and fold a drop back in with
 * `reorder` then `mergeManualOrder`.
 *
 * Written as one sequence because the bug was never in a single call — it was
 * searching, dragging, and clearing the search in that order. (The chat rail
 * runs the same rule against a position column on the row; see
 * `byArrangement` and `nextOrderSlots`.)
 */
describe('a rail arranged by hand', () => {
  /** Stands in for localStorage, which is where the project order lives. */
  let order: string[] = [];

  /** One render. `visible` is what the current search leaves on screen. */
  const show = (...visible: string[]): string[] => ids(applyChatOrder(list(...visible), order));

  const drag = (shown: string[], dragId: string, targetId: string): void => {
    order = mergeChatOrder(order, reorder(list(...shown), dragId, targetId));
  };

  test('stays where it was put, through a search and out the other side', () => {
    order = [];

    // Four projects, nothing arranged yet: the incoming order stands.
    expect(show('d', 'c', 'b', 'a')).toEqual(['d', 'c', 'b', 'a']);

    drag(['d', 'c', 'b', 'a'], 'a', 'd');
    expect(show('d', 'c', 'b', 'a')).toEqual(['a', 'd', 'c', 'b']);

    // A search hides 'a' and 'd'. Arranging what is left is what used to
    // erase the places of everything the query hid.
    expect(show('c', 'b')).toEqual(['c', 'b']);
    drag(['c', 'b'], 'b', 'c');

    // Clear the search: 'b' and 'c' swapped, 'a' and 'd' did not move.
    expect(show('d', 'c', 'b', 'a')).toEqual(['a', 'd', 'b', 'c']);

    // A project added now leads, rather than being buried under the order.
    expect(show('n', 'd', 'c', 'b', 'a')).toEqual(['n', 'a', 'd', 'b', 'c']);
  });
});

describe('readChatOrder', () => {
  test('a non-array or malformed value reads as no order', () => {
    // A hand-edited value must not take the rail down.
    expect(readChatOrder('never-written-to')).toEqual([]);
  });
});

describe('rowBoxes', () => {
  test('a slot runs to the next row top, so the boxes tile without holes', () => {
    const boxes = rowBoxes(
      [
        { top: 0, bottom: 40 },
        { top: 42, bottom: 90 },
      ],
      2
    );
    expect(boxes).toEqual([
      { top: 0, height: 42 },
      { top: 42, height: 50 },
    ]);
  });

  test('no rows measures to no boxes', () => {
    expect(rowBoxes([], 2)).toEqual([]);
  });
});

describe('dropIndexAt', () => {
  const boxes = rowBoxes(
    [
      { top: 100, bottom: 140 },
      { top: 142, bottom: 182 },
      { top: 184, bottom: 224 },
    ],
    2
  );

  test('finds the row the cursor is inside', () => {
    expect(dropIndexAt(boxes, 150)).toBe(1);
  });

  test('the gap between two rows belongs to the row above it', () => {
    expect(dropIndexAt(boxes, 141)).toBe(0);
  });

  test('above the list clamps to the first row, below it to the last', () => {
    expect(dropIndexAt(boxes, -999)).toBe(0);
    expect(dropIndexAt(boxes, 999)).toBe(2);
  });

  test('scrolling during the drag is corrected for, not ignored', () => {
    // The list scrolled down 50px, so the row captured at 184 now draws at 134.
    expect(dropIndexAt(boxes, 134, 50)).toBe(2);
  });

  test('an empty list has no row to drop on', () => {
    expect(dropIndexAt([], 10)).toBe(-1);
  });
});

describe('previewShift', () => {
  // Deliberately unequal heights: a chat with a summary chip is taller than one
  // without, so a preview built on a single row height would drift.
  const boxes = rowBoxes(
    [
      { top: 0, bottom: 8 },
      { top: 10, bottom: 28 },
      { top: 30, bottom: 58 },
      { top: 60, bottom: 98 },
    ],
    2
  );
  const at = (from: number, to: number): number[] =>
    boxes.map((b, i) => b.top + previewShift(boxes, from, to, i));

  test('dragging down moves the passed rows up by the dragged row height', () => {
    expect(boxes.map((_, i) => previewShift(boxes, 0, 2, i))).toEqual([50, -10, -10, 0]);
  });

  test('dragging up moves the passed rows down by the dragged row height', () => {
    expect(boxes.map((_, i) => previewShift(boxes, 3, 1, i))).toEqual([0, 40, 40, -50]);
  });

  test('nothing moves before a target is picked, or onto itself', () => {
    expect(boxes.map((_, i) => previewShift(boxes, 1, 1, i))).toEqual([0, 0, 0, 0]);
    expect(boxes.map((_, i) => previewShift(boxes, 1, -1, i))).toEqual([0, 0, 0, 0]);
  });

  test('the previewed layout is the order the drop actually commits', () => {
    const displayed = list('a', 'b', 'c', 'd');
    for (let from = 0; from < 4; from++) {
      for (let to = 0; to < 4; to++) {
        const tops = at(from, to);
        const previewed = displayed
          .map((item, i) => ({ id: item.id, top: tops[i] ?? 0 }))
          .sort((x, y) => x.top - y.top)
          .map(x => x.id);
        expect(previewed).toEqual(reorder(displayed, displayed[from]!.id, displayed[to]!.id));
      }
    }
  });
});
