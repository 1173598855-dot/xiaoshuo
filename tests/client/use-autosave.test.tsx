// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chapter } from "../../src/shared/contracts";
import { ApiRequestError } from "../../src/client/api/client";
import { useAutosave } from "../../src/client/hooks/use-autosave";

const chapter: Chapter = {
  id: "7f2ced6d-5744-4db5-975b-f236c3b96b68",
  projectId: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
  title: "第一章",
  content: "旧正文",
  status: "draft",
  position: 0,
  revision: 0,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the latest draft after the debounce window", async () => {
    const save = vi.fn().mockResolvedValue({
      ...chapter,
      content: "新正文",
      revision: 1,
    });
    const onSaved = vi.fn();

    render(<Harness save={save} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "测试正文" }), {
      target: { value: "新正文" },
    });

    await act(() => vi.advanceTimersByTimeAsync(799));
    expect(save).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledWith("新正文", 0);
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ content: "新正文", revision: 1 }),
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
  });

  it("keeps the draft and reports revision conflicts", async () => {
    const conflict = new ApiRequestError(
      409,
      "REVISION_CONFLICT",
      "章节已更新",
    );
    const save = vi.fn().mockRejectedValue(conflict);
    const onConflict = vi.fn();

    render(<Harness save={save} onConflict={onConflict} />);
    const editor = screen.getByRole("textbox", { name: "测试正文" });
    fireEvent.change(editor, { target: { value: "不会丢失的本地草稿" } });

    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(editor).toHaveValue("不会丢失的本地草稿");
    expect(onConflict).toHaveBeenCalledWith(conflict);
    expect(screen.getByTestId("save-status")).toHaveTextContent("conflict");
  });
});

function Harness({
  save,
  onSaved = () => undefined,
  onConflict = () => undefined,
}: {
  save: (content: string, expectedRevision: number) => Promise<Chapter>;
  onSaved?: (saved: Chapter) => void;
  onConflict?: (error: ApiRequestError) => void;
}) {
  const [content, setContent] = useState(chapter.content);
  const { status } = useAutosave({
    identity: chapter.id,
    content,
    revision: chapter.revision,
    delay: 800,
    save,
    onSaved,
    onConflict,
  });

  return (
    <>
      <label>
        测试正文
        <textarea
          aria-label="测试正文"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <span data-testid="save-status">{status}</span>
    </>
  );
}
