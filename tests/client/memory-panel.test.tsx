// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemoryPanel } from "../../src/client/components/MemoryPanel";
import { ApiRequestError } from "../../src/client/api/transport";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";

const bookId = "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c";
const worldId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
const characterId = "b2fcea89-9d4e-4f45-84d2-a0e40d86f706";
const timestamp = "2026-09-12T00:00:00.000Z";

function createApi() {
  const world = {
    id: worldId,
    bookId,
    kind: "world_rule" as const,
    subject: "城市会移动",
    content: { summary: "移动规则", rule: "城市每天凌晨向北移动一公里" },
    status: "active" as const,
    importance: 5,
    locked: false,
    sourceChapterNumber: null,
    sourceCandidateId: null,
    source: "foundation" as const,
    validFromChapter: 1,
    validToChapter: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const character = {
    ...world,
    id: characterId,
    kind: "character_state" as const,
    subject: "林默",
    content: { name: "林默", goal: "找回妹妹", relationships: [], state: "还在调查" },
    importance: 4,
  };
  const snapshot = {
    bookId,
    bookRevision: 4,
    memoryRevision: 1,
    entries: [world, character],
  };
  const api = {
    listMemory: vi.fn().mockResolvedValue(snapshot),
    getMemoryContext: vi.fn().mockResolvedValue({
      entries: [world],
      memoryRevision: 1,
      contextHash: "a".repeat(64),
      characterCount: 300,
    }),
    getMemoryHistory: vi.fn(),
    updateMemory: vi.fn().mockResolvedValue({ ...world, locked: true, revision: 2 }),
    refreshMemory: vi.fn().mockResolvedValue(snapshot),
  } as unknown as AutoNovelApi;
  return { api, snapshot, world };
}

describe("MemoryPanel", () => {
  it("defaults to chapter-relevant memory and supports type filtering and locking", async () => {
    const { api, world } = createApi();
    render(<MemoryPanel bookId={bookId} chapterNumber={1} api={api} onClose={vi.fn()} />);

    expect(await screen.findByText("城市会移动")).toBeInTheDocument();
    expect(screen.getByText("第 1 章将注入 1 条记忆")).toBeInTheDocument();
    expect(screen.queryByText("林默")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "记忆类型" }), { target: { value: "character_state" } });
    expect(screen.getByText("林默")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "锁定" }));
    await waitFor(() => expect(api.updateMemory).toHaveBeenCalledWith({
      entryId: world.id === characterId ? world.id : characterId,
      expectedBookRevision: 4,
      expectedEntryRevision: 1,
      locked: true,
    }));
  });

  it("keeps manual JSON content when an optimistic revision save fails", async () => {
    const { api } = createApi();
    (api.updateMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiRequestError(409, "MEMORY_REVISION_CONFLICT", "记忆已在其他位置更新，请重新加载后再保存。"),
    );
    render(<MemoryPanel bookId={bookId} chapterNumber={1} api={api} onClose={vi.fn()} />);
    await screen.findByText("城市会移动");
    fireEvent.click(screen.getByRole("button", { name: "修正" }));
    const editor = screen.getByRole("textbox", { name: "城市会移动 内容" });
    fireEvent.change(editor, { target: { value: '{"summary":"保留草稿","rule":"手动修改"}' } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("记忆已在其他位置更新");
    expect(screen.getByRole("textbox", { name: "城市会移动 内容" })).toHaveValue('{"summary":"保留草稿","rule":"手动修改"}');
  });

  it("shows the latest revision source instead of inferring it from candidate id", async () => {
    const { api, snapshot, world } = createApi();
    (api.listMemory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...snapshot,
      entries: [{ ...world, source: "manual_edit" }],
    });
    render(<MemoryPanel bookId={bookId} chapterNumber={1} api={api} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "记忆类型" }), { target: { value: "world_rule" } });
    expect(await screen.findByText(/手动修正/)).toBeInTheDocument();
  });
});
