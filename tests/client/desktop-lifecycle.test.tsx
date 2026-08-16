// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "../../src/desktop/preload-api";
import type { DesktopCommand } from "../../src/shared/contracts";

const projectId = "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c";
const chapterId = "7f2ced6d-5744-4db5-975b-f236c3b96b68";
const generationId = "21c59db8-bb0e-4d95-9f00-2ff504cc03ab";

const chapter = {
  id: chapterId,
  projectId,
  title: "第一章",
  content: "雨落在旧车站。",
  status: "draft" as const,
  position: 0,
  revision: 0,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

const workspace = {
  project: {
    id: projectId,
    title: "雾都来信",
    description: "",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  chapters: [chapter],
};

const providers = [
  {
    id: "openai" as const,
    kind: "openai" as const,
    name: "OpenAI",
    description: "OpenAI Responses API",
    defaultModel: "gpt-test",
    models: [],
    modelEditable: true as const,
    requiresApiKey: true,
  },
];

describe("desktop renderer lifecycle", () => {
  let api: DesktopApi;
  let commandListener: ((command: DesktopCommand) => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    commandListener = undefined;
    api = {
      platform: "desktop",
      workspace: {
        get: vi.fn(async () => ({ ok: true as const, data: workspace })),
      },
      project: {
        create: vi.fn(async () => ({ ok: true as const, data: workspace.project })),
      },
      chapter: {
        create: vi.fn(async () => ({ ok: true as const, data: chapter })),
        update: vi.fn(async (_id, input) => ({
          ok: true as const,
          data: { ...chapter, ...input, revision: chapter.revision + 1 },
        })),
      },
      provider: {
        list: vi.fn(async () => ({ ok: true as const, data: providers })),
        listModels: vi.fn(async () => ({ ok: true as const, data: [] })),
        getSettings: vi.fn(async () => ({
          ok: true as const,
          data: {
            providerId: "openai" as const,
            model: "gpt-test",
            hasApiKey: true,
          },
        })),
        saveSettings: vi.fn(async (input) => ({
          ok: true as const,
          data: {
            providerId: input.providerId,
            model: input.model,
            hasApiKey: Boolean(input.apiKey),
          },
        })),
        clearKey: vi.fn(async () => ({ ok: true as const, data: null })),
      },
      generation: {
        create: vi.fn(async () => ({
          ok: true as const,
          data: {
            id: generationId,
            chapterId,
            baseRevision: 0,
            providerId: "openai" as const,
            provider: "openai" as const,
            model: "gpt-test",
            operation: "continue" as const,
            instruction: "继续",
            candidate: "门外传来三声叩响。",
            status: "completed" as const,
            usage: null,
            error: null,
            createdAt: "2026-08-03T00:01:00.000Z",
            acceptedAt: null,
          },
        })),
        cancel: vi.fn(async () => ({ ok: true as const, data: undefined })),
        accept: vi.fn(async () => ({
          ok: true as const,
          data: { generation: {} as never, chapter },
        })),
        discard: vi.fn(async () => ({ ok: true as const, data: {} as never })),
      },
      database: {
        status: vi.fn(async () => ({
          ok: true as const,
          data: { isDesktop: true, isFirstRun: false },
        })),
        import: vi.fn(async () => ({ ok: true as const, data: { cancelled: true } })),
        export: vi.fn(async () => ({ ok: true as const, data: { cancelled: true } })),
      },
      lifecycle: {
        resolveClose: vi.fn(async () => ({ ok: true as const, data: undefined })),
        onCommand: vi.fn((listener) => {
          commandListener = listener;
          return vi.fn();
        }),
      },
    } as unknown as DesktopApi;
    window.xiaoyi = api;
  });

  afterEach(() => {
    delete window.xiaoyi;
    vi.restoreAllMocks();
  });

  it("fails closed when a partial desktop bridge is injected", async () => {
    vi.resetModules();
    window.xiaoyi = { platform: "desktop" } as DesktopApi;

    await expect(import("../../src/client/api/client")).rejects.toThrow(
      "The desktop bridge is incomplete",
    );
  });

  it("keeps desktop keys out of renderer storage and generation IPC", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(await screen.findByLabelText("API Key")).toHaveValue("");
    expect(screen.getByText("已安全保存")).toBeInTheDocument();
    expect(sessionStorage).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "继续" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));

    await waitFor(() => expect(api.generation.create).toHaveBeenCalledOnce());
    const request = vi.mocked(api.generation.create).mock.calls[0]?.[0];
    expect(request.input).not.toHaveProperty("provider");
    expect(request.input).not.toHaveProperty("apiKey");
  });

  it("routes native provider-settings and import commands to renderer dialogs", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    commandListener?.({ type: "provider-settings" });
    expect(await screen.findByRole("dialog", { name: "模型配置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭模型配置" }));

    act(() => {
      commandListener?.({ type: "import" });
    });
    expect(await screen.findByRole("dialog", { name: "数据管理" })).toBeInTheDocument();
  });

  it("keeps native provider and data-management dialogs mutually exclusive", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    act(() => {
      commandListener?.({ type: "provider-settings" });
    });
    await screen.findByRole("dialog", { name: "模型配置" });
    act(() => {
      commandListener?.({ type: "import" });
    });
    expect(
      screen.queryByRole("dialog", { name: "数据管理" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭模型配置" }));
    act(() => {
      commandListener?.({ type: "export" });
    });
    await screen.findByRole("dialog", { name: "数据管理" });
    act(() => {
      commandListener?.({ type: "provider-settings" });
    });
    expect(
      screen.queryByRole("dialog", { name: "模型配置" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the first native dialog command when commands arrive in one React batch", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    act(() => {
      commandListener?.({ type: "provider-settings" });
      commandListener?.({ type: "import" });
    });
    await screen.findByRole("dialog", { name: "模型配置" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "关闭模型配置" }));
    act(() => {
      commandListener?.({ type: "export" });
      commandListener?.({ type: "provider-settings" });
    });
    await screen.findByRole("dialog", { name: "数据管理" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("clears a completed candidate when import replaces a same-ID chapter", async () => {
    const importedChapter = {
      ...chapter,
      content: "导入工作区中同一章节的新正文。",
      revision: 4,
    };
    api.workspace.get = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, data: workspace })
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          ...workspace,
          project: { ...workspace.project, title: "导入的工作区" },
          chapters: [importedChapter],
        },
      });
    api.database.import = vi.fn(async () => ({
      ok: true as const,
      data: { cancelled: false },
    }));

    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "继续" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));
    await screen.findByRole("region", { name: "候选审阅" });

    act(() => {
      commandListener?.({ type: "import" });
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "导入现有数据库" }),
    );

    await waitFor(() =>
      expect(
        within(
          screen.getByRole("dialog", { name: "数据管理" }),
        ).getByRole("status"),
      ).toHaveTextContent("数据导入成功"),
    );
    fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "数据管理" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue(
        importedChapter.content,
      ),
    );
    expect(
      screen.queryByRole("region", { name: "候选审阅" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the first-run data dialog mounted while import selects a chapter", async () => {
    const importedWorkspace = {
      ...workspace,
      chapters: [{ ...chapter, content: "导入后的首章正文" }],
    };
    api.workspace.get = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        data: { ...workspace, chapters: [] },
      })
      .mockResolvedValueOnce({ ok: true as const, data: importedWorkspace });
    api.database.status = vi.fn(async () => ({
      ok: true as const,
      data: { isDesktop: true, isFirstRun: true },
    }));
    api.database.import = vi.fn(async () => ({
      ok: true as const,
      data: { cancelled: false },
    }));

    const { App } = await import("../../src/client/App");
    render(<App />);
    const initialDialog = await screen.findByRole("dialog", {
      name: "数据管理",
    });
    fireEvent.click(
      within(initialDialog).getByRole("button", { name: "导入现有数据库" }),
    );

    await waitFor(() => expect(api.workspace.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog", { name: "数据管理" })).toBe(
      initialDialog,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭数据管理" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "数据管理" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not autosave imported content when the chapter revision is unchanged", async () => {
    const importedChapter = {
      ...chapter,
      content: "imported database content",
      revision: chapter.revision,
    };
    api.workspace.get = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, data: workspace })
      .mockResolvedValueOnce({
        ok: true as const,
        data: { ...workspace, chapters: [importedChapter] },
      });
    api.database.import = vi.fn(async () => ({
      ok: true as const,
      data: { cancelled: false },
    }));

    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    act(() => {
      commandListener?.({ type: "import" });
    });
    fireEvent.click(await screen.findByRole("button", { name: /导入/ }));

    await waitFor(() => expect(api.workspace.get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog", { name: "数据管理" })).getByRole(
          "status",
        ),
      ).toHaveTextContent("数据导入成功"),
    );
    fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "数据管理" }),
      ).not.toBeInTheDocument(),
    );
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(api.chapter.update).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue(
      importedChapter.content,
    );
  });

  it("keeps the import success state visible after an asynchronous workspace reload", async () => {
    const importedWorkspace = {
      ...workspace,
      chapters: [{ ...chapter, content: "从备份恢复的正文。", revision: 3 }],
    };
    let resolveReload!: (value: {
      readonly ok: true;
      readonly data: typeof importedWorkspace;
    }) => void;
    api.workspace.get = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, data: workspace })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReload = resolve;
          }),
      );
    api.database.import = vi.fn(async () => ({
      ok: true as const,
      data: { cancelled: false },
    }));

    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    act(() => {
      commandListener?.({ type: "import" });
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "导入现有数据库" }),
    );
    await waitFor(() => expect(api.workspace.get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "数据管理" }),
      ).toHaveAttribute("aria-busy", "true"),
    );

    await act(async () => {
      resolveReload({ ok: true, data: importedWorkspace });
    });

    await waitFor(() =>
      expect(
        within(
          screen.getByRole("dialog", { name: "数据管理" }),
        ).getByRole("status"),
      ).toHaveTextContent("数据导入成功"),
    );
  });

  it("shows a sanitized available-update outcome", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    commandListener?.({ type: "update-available" });
    expect(
      await screen.findByRole("status", { name: "更新状态" }),
    ).toHaveTextContent("发现可用更新");
  });

  it("shows a sanitized update-check failure", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    commandListener?.({ type: "update-failed" });
    expect(
      await screen.findByRole("alert", { name: "更新状态" }),
    ).toHaveTextContent("更新检查失败");
  });

  it("lets the author dismiss an update notification", async () => {
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    commandListener?.({ type: "update-available" });
    await screen.findByRole("status", { name: "更新状态" });
    fireEvent.click(screen.getByRole("button", { name: "关闭更新通知" }));

    expect(
      screen.queryByRole("status", { name: "更新状态" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["import", "导入现有数据库"],
    ["export", "导出数据库"],
  ] as const)(
    "blocks native %s when the current draft cannot be saved",
    async (commandType, buttonName) => {
      api.chapter.update = vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "REVISION_CONFLICT",
          message: "章节已在其他位置更新，请重新加载后再保存。",
        },
      }));
      const databaseOperation =
        commandType === "import" ? api.database.import : api.database.export;
      const { App } = await import("../../src/client/App");
      render(<App />);
      const editor = await screen.findByRole("textbox", { name: "章节正文" });

      fireEvent.change(editor, { target: { value: "尚未保存的本地草稿" } });
      commandListener?.({ type: commandType });
      fireEvent.click(await screen.findByRole("button", { name: buttonName }));

      await waitFor(() => expect(api.chapter.update).toHaveBeenCalledOnce());
      expect(databaseOperation).not.toHaveBeenCalled();
      expect(editor).toHaveValue("尚未保存的本地草稿");
      expect(screen.getByRole("alert")).toBeInTheDocument();
    },
  );

  it("allows shutdown when a loaded workspace has no chapter or draft", async () => {
    api.workspace.get = vi.fn(async () => ({
      ok: true as const,
      data: { ...workspace, chapters: [] },
    }));
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("main", { name: "空章节工作区" });

    commandListener?.({
      type: "shutdown-requested",
      requestId: "03173c84-2305-4a1c-9ebc-d65bbdc792e4",
    });

    await waitFor(() =>
      expect(api.lifecycle.resolveClose).toHaveBeenCalledWith({
        requestId: "03173c84-2305-4a1c-9ebc-d65bbdc792e4",
        canClose: true,
      }),
    );
  });

  it("creates the first chapter from a native command in an empty workspace", async () => {
    const firstChapter = { ...chapter, content: "", position: 0, revision: 0 };
    api.workspace.get = vi.fn(async () => ({
      ok: true as const,
      data: { ...workspace, chapters: [] },
    }));
    api.chapter.create = vi.fn(async () => ({
      ok: true as const,
      data: firstChapter,
    }));
    const { App } = await import("../../src/client/App");
    render(<App />);
    await screen.findByRole("main", { name: "空章节工作区" });

    commandListener?.({ type: "new-chapter" });

    await waitFor(() => expect(api.chapter.create).toHaveBeenCalledOnce());
    expect(api.chapter.update).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("textbox", { name: "章节正文" }),
    ).toHaveValue("");
  });
});
