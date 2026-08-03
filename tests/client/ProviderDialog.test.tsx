// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ProviderDialog } from "../../src/client/components/ProviderDialog";

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

describe("ProviderDialog", () => {
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
