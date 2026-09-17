import type { Comment, FileDiff } from "./types";

// How tall a file card is — the threshold that starts one collapsed, and what an unmounted one is
// worth. A placeholder's height holds the scroll position of every card below it and a jump past it
// aims through it, so the estimate has to track what Changed view will actually render.

export const LARGE_FILE_LINES = 500;

// Mirrors styles.css: `--font-size-mono: calc(12.5px + var(--mono-offset))` and the diff table's one
// line-height, `calc(var(--font-size-mono) * 1.52)`. The code size is a user setting spanning
// MIN/MAX_FONT_OFFSET, so a fixed row height is out by two thirds at the ends of that range.
// `fileHeight.test.ts` reads styles.css, so the two can't drift apart.
export const MONO_BASE_PX = 12.5;
export const MONO_LINE_RATIO = 1.52;

export const diffRowHeight = (monoOffset: number) => (MONO_BASE_PX + monoOffset) * MONO_LINE_RATIO;

// Header + borders, which is also all a collapsed card is.
const CARD_CHROME = 44;
// Header + the one-line `noHunksNote`: a rename with no content change, a mode change, an empty add.
const NOTE_CARD = 90;
// A synthetic card opens in Full view on a file whose length nothing here knows.
const UNKNOWN_FILE = 600;
const BINARY = 400;
const THREAD_SHUT = 40;
const THREAD_OPEN = 140;
const THREAD_REPLY = 90;

export const changedLineCount = (f: FileDiff) => f.hunks.reduce((n, h) => n + h.lines.length, 0);

export function estFileHeight(args: {
  file: FileDiff;
  reviewed: boolean;
  comments: readonly Comment[];
  rowH: number;
}): number {
  const { file, reviewed, comments, rowH } = args;
  const lines = changedLineCount(file);
  if (reviewed || file.generated || lines > LARGE_FILE_LINES) return CARD_CHROME;
  if (file.binary) return BINARY;
  // Only a synthetic card is `unchanged`; a real file with no hunks renders the note instead.
  if (file.status === "unchanged") return UNKNOWN_FILE;
  if (file.hunks.length === 0) return NOTE_CARD;
  // One metadata row per hunk — the gap bar carries the `@@` header, so the two never stack — plus
  // the trailing gap after the last one.
  const rows = lines + file.hunks.length + 1;
  const threads = comments.reduce(
    (n, c) => n + (c.resolved ? THREAD_SHUT : THREAD_OPEN + c.replies.length * THREAD_REPLY),
    0
  );
  return rows * rowH + CARD_CHROME + threads;
}
