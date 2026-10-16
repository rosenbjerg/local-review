import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./components/Markdown";
import { CommentIdsContext } from "./commentRef";

const refs = (el: HTMLElement) => el.querySelectorAll("a.comment-ref").length;

test("a body links the review's ids from context, and picks up an id that arrives later", () => {
  const ui = (ids: number[], commentRefs = true) => (
    <CommentIdsContext.Provider value={new Set(ids)}>
      <Markdown source="see #42 and #43" commentRefs={commentRefs} />
    </CommentIdsContext.Provider>
  );
  const { container, rerender } = render(ui([42]));
  expect(refs(container)).toBe(1);

  rerender(ui([42, 43]));
  expect(refs(container)).toBe(2);

  rerender(ui([42, 43], false));
  expect(refs(container)).toBe(0);
});
