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

  it("serializes an explicit flush behind an in-flight save", async () => {
    const first = deferred<Chapter>();
    const second = deferred<Chapter>();
    const save = vi
      .fn<(content: string, expectedRevision: number) => Promise<Chapter>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<Harness save={save} />);
    const editor = screen.getByRole("textbox", { name: "测试正文" });
    fireEvent.change(editor, { target: { value: "第一次编辑" } });
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: "保存中的新编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "立即保存" }));
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ ...chapter, content: "第一次编辑", revision: 1 });
      await first.promise;
      await Promise.resolve();
    });
    expect(save).toHaveBeenNthCalledWith(2, "保存中的新编辑", 1);

    await act(async () => {
      second.resolve({ ...chapter, content: "保存中的新编辑", revision: 2 });
      await second.promise;
    });
    expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
  });

  it("ignores an old chapter save when a new identity becomes active", async () => {
    const oldSave = deferred<Chapter>();
    const save = vi
      .fn<(content: string, expectedRevision: number) => Promise<Chapter>>()
      .mockReturnValueOnce(oldSave.promise)
      .mockResolvedValueOnce({
        ...chapter,
        id: "25475167-42c7-4722-b3fa-c0e23359db16",
        content: "第二章的新编辑",
        revision: 4,
      });

    render(<IdentityHarness save={save} />);
    fireEvent.change(screen.getByRole("textbox", { name: "身份正文" }), {
      target: { value: "第一章在途编辑" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole("button", { name: "切换身份" }));

    await act(async () => {
      oldSave.resolve({ ...chapter, content: "第一章在途编辑", revision: 1 });
      await oldSave.promise;
    });
    fireEvent.change(screen.getByRole("textbox", { name: "身份正文" }), {
      target: { value: "第二章的新编辑" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(save).toHaveBeenNthCalledWith(2, "第二章的新编辑", 3);
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
  const { status, flush } = useAutosave({
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
      <button type="button" onClick={() => void flush()}>
        立即保存
      </button>
    </>
  );
}

function IdentityHarness({
  save,
}: {
  save: (content: string, expectedRevision: number) => Promise<Chapter>;
}) {
  const secondChapter: Chapter = {
    ...chapter,
    id: "25475167-42c7-4722-b3fa-c0e23359db16",
    title: "第二章",
    content: "第二章正文",
    revision: 3,
  };
  const [activeChapter, setActiveChapter] = useState(chapter);
  const [content, setContent] = useState(chapter.content);
  const { status } = useAutosave({
    identity: activeChapter.id,
    content,
    revision: activeChapter.revision,
    delay: 800,
    save,
    onSaved: () => undefined,
    onConflict: () => undefined,
  });

  return (
    <>
      <textarea
        aria-label="身份正文"
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          setActiveChapter(secondChapter);
          setContent(secondChapter.content);
        }}
      >
        切换身份
      </button>
      <span data-testid="identity-status">{status}</span>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
