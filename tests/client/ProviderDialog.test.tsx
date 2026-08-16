// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProviderDialog } from "../../src/client/components/ProviderDialog";
import { ApiRequestError } from "../../src/client/api/transport";

const providers = [
  {
    id: "openai" as const,
    kind: "openai" as const,
    name: "OpenAI",
    description: "OpenAI Responses API",
    defaultModel: "gpt-5.6-sol",
    models: [],
    modelEditable: true as const,
    requiresApiKey: true,
  },
];

const optionalKeyProvider = {
  id: "custom" as const,
  kind: "openai-compatible" as const,
  name: "自定义兼容服务",
  description: "自定义 OpenAI-compatible endpoint",
  defaultModel: "custom-model",
  models: [],
  modelEditable: true as const,
  requiresApiKey: false,
  apiKeyOptional: true,
  baseUrlEditable: true,
};

const compatibleProvider = {
  ...optionalKeyProvider,
  defaultModel: "",
};

describe("ProviderDialog", () => {
  it("lists models from the current unsaved compatible form", async () => {
    const onListModels = vi.fn().mockResolvedValue([
      { id: "model-a" },
      { id: "model-b" },
    ]);
    render(
      <ProviderDialog
        open
        platform="desktop"
        providers={[compatibleProvider]}
        settings={null}
        onSave={vi.fn()}
        onListModels={onListModels}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://models.example.test/v1" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-current-form" },
    });
    fireEvent.click(screen.getByRole("button", { name: "拉取模型列表" }));

    await waitFor(() =>
      expect(onListModels).toHaveBeenCalledWith(
        {
          providerId: "custom",
          baseUrl: "https://models.example.test/v1",
          apiKey: "sk-current-form",
        },
        expect.any(AbortSignal),
      ),
    );
    const options = [...document.querySelectorAll("datalist option")].map(
      (option) => option.getAttribute("value"),
    );
    expect(options).toEqual(expect.arrayContaining(["model-a", "model-b"]));
    expect(screen.getByLabelText("模型 ID")).toHaveValue("");
  });

  it("does not show model refresh for native providers", () => {
    render(
      <ProviderDialog
        open
        providers={providers}
        settings={null}
        onSave={vi.fn()}
        onListModels={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "拉取模型列表" }),
    ).not.toBeInTheDocument();
  });

  it("keeps manual input and explains an invalid API prefix", async () => {
    const onListModels = vi.fn().mockRejectedValue(
      new ApiRequestError(
        400,
        "REQUEST_INVALID",
        "模型、端点或请求参数不受当前服务支持。",
      ),
    );
    render(
      <ProviderDialog
        open
        platform="web"
        providers={[compatibleProvider]}
        settings={null}
        onSave={vi.fn()}
        onListModels={onListModels}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://models.example.test" },
    });
    fireEvent.change(screen.getByLabelText("模型 ID"), {
      target: { value: "manual-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "拉取模型列表" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("/v1");
    expect(screen.getByLabelText("模型 ID")).toHaveValue("manual-model");
  });

  it("ignores a model list returned for an old endpoint", async () => {
    const request = deferred<readonly { id: string }[]>();
    render(
      <ProviderDialog
        open
        platform="desktop"
        providers={[compatibleProvider]}
        settings={null}
        onSave={vi.fn()}
        onListModels={() => request.promise}
        onClose={vi.fn()}
      />,
    );
    const baseUrl = screen.getByLabelText("服务地址");
    fireEvent.change(baseUrl, {
      target: { value: "https://a.example.test/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "拉取模型列表" }));
    expect(screen.getByRole("button", { name: "拉取模型列表" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在获取模型列表");

    fireEvent.change(baseUrl, {
      target: { value: "https://b.example.test/v1" },
    });
    request.resolve([{ id: "model-from-a" }]);
    await waitFor(() =>
      expect(
        screen.queryByRole("status"),
      ).not.toBeInTheDocument(),
    );
    expect(
      document.querySelector('datalist option[value="model-from-a"]'),
    ).toBeNull();
  });

  it("moves initial focus to the provider control", async () => {
    render(<DialogHarness />);

    fireEvent.click(screen.getByRole("button", { name: "打开配置" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "服务商" })).toHaveFocus();
    });
  });

  it("closes on Escape and restores focus to its trigger", async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "打开配置" });

    trigger.focus();
    fireEvent.click(trigger);
    const provider = await screen.findByRole("combobox", { name: "服务商" });
    fireEvent.keyDown(provider, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("wraps Tab focus inside the modal", async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "打开配置" }));
    const close = await screen.findByRole("button", {
      name: "关闭模型配置",
    });
    close.focus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });

    expect(screen.getByRole("button", { name: "保存模型配置" })).toHaveFocus();
  });

  it("keeps a desktop key blank while showing only its saved status", async () => {
    const onSave = vi.fn();
    render(
      <ProviderDialog
        open
        platform="desktop"
        providers={providers}
        settings={{
          platform: "desktop",
          providerId: "openai",
          model: "gpt-test",
          hasApiKey: true,
        }}
        onSave={onSave}
        onClearKey={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText("API Key")).toHaveValue("");
    expect(screen.getByText("已安全保存")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));

    expect(onSave).toHaveBeenCalledWith({
      providerId: "openai",
      model: "gpt-test",
    });
  });

  it("lets a web author clear an existing optional session key", async () => {
    const onClearKey = vi.fn(async () => undefined);
    render(
      <ProviderDialog
        open
        platform="web"
        providers={[optionalKeyProvider]}
        settings={{
          platform: "web",
          providerId: "custom",
          model: "custom-model",
          baseUrl: "https://models.example.test/v1",
          hasApiKey: true,
          apiKey: "sk-session-key",
        }}
        onSave={vi.fn()}
        onClearKey={onClearKey}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("当前会话已保存")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除已保存的 API Key" }));

    await waitFor(() => expect(onClearKey).toHaveBeenCalledWith("custom"));
  });

  it("erases a newly typed desktop key after a successful save", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <ProviderDialog
        open
        platform="desktop"
        providers={providers}
        settings={null}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const keyInput = await screen.findByLabelText("API Key");
    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入 API Key。");
    fireEvent.change(keyInput, { target: { value: "sk-erase-after-save" } });
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(keyInput).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(keyInput).toHaveValue("");
      expect(keyInput).toHaveAttribute("type", "password");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it.each([
    ["cancel button", () => {
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
    }],
    ["close button", () => {
      fireEvent.click(screen.getByRole("button", { name: "关闭模型配置" }));
    }],
    ["Escape", () => {
      fireEvent.keyDown(screen.getByLabelText("API Key"), { key: "Escape" });
    }],
    ["backdrop", () => {
      const backdrop = document.querySelector<HTMLElement>(".dialog-backdrop");
      if (!backdrop) throw new Error("Missing dialog backdrop");
      fireEvent.mouseDown(backdrop);
    }],
  ] as const)("erases a newly typed key on %s", async (_name, close) => {
    const onClose = vi.fn();
    render(
      <ProviderDialog
        open
        platform="desktop"
        providers={providers}
        settings={null}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    const keyInput = await screen.findByLabelText("API Key");
    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入 API Key。");
    fireEvent.change(keyInput, { target: { value: "sk-erase-on-close" } });
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(keyInput).toHaveAttribute("type", "text");

    close();

    expect(onClose).toHaveBeenCalledOnce();
    expect(keyInput).toHaveValue("");
    expect(keyInput).toHaveAttribute("type", "password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains a newly typed key when saving fails so the author can retry", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("temporary save failure");
    });
    render(
      <ProviderDialog
        open
        platform="desktop"
        providers={providers}
        settings={null}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const keyInput = await screen.findByLabelText("API Key");
    fireEvent.change(keyInput, { target: { value: "sk-retry-save" } });
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(keyInput).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporary save failure",
    );
    expect(keyInput).toHaveValue("sk-retry-save");
    expect(keyInput).toHaveAttribute("type", "text");
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开配置
      </button>
      <ProviderDialog
        open={open}
        providers={providers}
        settings={null}
        onSave={() => setOpen(false)}
        onClose={() => setOpen(false)}
      />
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
