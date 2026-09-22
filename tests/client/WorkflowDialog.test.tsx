// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkflowDialog } from "../../src/client/components/WorkflowDialog";

const provider = {
  id: "custom" as const,
  kind: "openai-compatible" as const,
  name: "本地兼容服务",
  description: "测试服务",
  defaultModel: "writer-model",
  models: [],
  modelEditable: true as const,
  requiresApiKey: false,
  apiKeyOptional: true,
  baseUrl: "http://127.0.0.1:9000/v1",
  baseUrlEditable: true,
};

const ollamaProvider = {
  id: "ollama" as const,
  kind: "openai-compatible" as const,
  name: "Ollama",
  description: "本地服务",
  defaultModel: "qwen3:8b",
  models: [],
  modelEditable: true as const,
  requiresApiKey: false,
  baseUrl: "http://127.0.0.1:11434/v1",
};

describe("WorkflowDialog", () => {
  it("lets keyboard users switch into collaborative mode", () => {
    render(
      <WorkflowDialog
        open
        platform="web"
        providers={[provider]}
        settings={{ platform: "web", providerId: "custom", model: "writer-model", apiKey: "", hasApiKey: false, baseUrl: provider.baseUrl }}
        value={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const mode = screen.getByRole("combobox", { name: "模型工作流模式" });
    fireEvent.keyDown(mode, { key: "ArrowDown" });
    expect(mode).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(mode).toHaveAttribute("aria-expanded", "false");
  });

  it("creates a four-role collaborative workflow from the renderer", () => {
    const onSave = vi.fn();
    render(
      <WorkflowDialog
        open
        platform="web"
        providers={[provider]}
        settings={{ platform: "web", providerId: "custom", model: "writer-model", apiKey: "", hasApiKey: false, baseUrl: provider.baseUrl }}
        value={null}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "模型工作流模式" }));
    fireEvent.click(screen.getByRole("option", { name: /多模型协作/ }));
    fireEvent.click(screen.getByRole("button", { name: "应用工作流" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ mode: "collaborative" });
    expect(onSave.mock.calls[0][0].assignments).toHaveLength(4);
  });

  it("allows a no-key fixed endpoint to collaborate with the current provider", async () => {
    const onSave = vi.fn();
    render(
      <WorkflowDialog
        open
        platform="web"
        providers={[provider, ollamaProvider]}
        settings={{ platform: "web", providerId: "custom", model: "writer-model", apiKey: "", hasApiKey: false, baseUrl: provider.baseUrl }}
        value={null}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "模型工作流模式" }));
    fireEvent.click(screen.getByRole("option", { name: /多模型协作/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "内容审核服务商" }));
    fireEvent.click(screen.getByRole("option", { name: "Ollama" }));
    fireEvent.click(screen.getByRole("button", { name: "应用工作流" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.assignments.find((assignment: { role: string }) => assignment.role === "reviewer").provider).toMatchObject({ apiKey: "", baseUrl: ollamaProvider.baseUrl });
  });
});
