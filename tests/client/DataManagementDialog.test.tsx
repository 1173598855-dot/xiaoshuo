// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../../src/client/api/client";
import { DataManagementDialog } from "../../src/client/components/DataManagementDialog";

describe("DataManagementDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes without reloading when native import is cancelled", async () => {
    const onClose = vi.fn();
    const onImported = vi.fn(async () => undefined);
    vi.spyOn(apiClient, "importDatabase").mockResolvedValue({
      cancelled: true,
    });

    render(
      <DataManagementDialog
        open
        onClose={onClose}
        onBeforeOperation={async () => true}
        onImported={onImported}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "导入现有数据库" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onImported).not.toHaveBeenCalled();
  });

  it("reloads after a successful import and reports the result", async () => {
    const onClose = vi.fn();
    const onImported = vi.fn(async () => undefined);
    vi.spyOn(apiClient, "importDatabase").mockResolvedValue({
      cancelled: false,
      workspace: undefined,
    });

    render(
      <DataManagementDialog
        open
        onClose={onClose}
        onBeforeOperation={async () => true}
        onImported={onImported}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "导入现有数据库" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("数据导入成功");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps every close path blocked while an import is pending", async () => {
    let resolveImport!: (result: { cancelled: true }) => void;
    const pendingImport = new Promise<{ cancelled: true }>((resolve) => {
      resolveImport = resolve;
    });
    const onClose = vi.fn();
    vi.spyOn(apiClient, "importDatabase").mockReturnValue(pendingImport);
    const { container } = render(
      <DataManagementDialog
        open
        onClose={onClose}
        onBeforeOperation={async () => true}
        onImported={async () => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "导入现有数据库" }));
    await waitFor(() => expect(apiClient.importDatabase).toHaveBeenCalledOnce());

    for (const closeButton of screen.getAllByRole("button", { name: /关闭/ })) {
      fireEvent.click(closeButton);
    }
    const backdrop = container.querySelector<HTMLElement>(".dialog-backdrop");
    if (!backdrop) throw new Error("Missing data-management backdrop");
    fireEvent.mouseDown(backdrop);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    resolveImport({ cancelled: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("closes from Escape and restores focus to its trigger", async () => {
    render(<DataManagementHarness />);

    const trigger = screen.getByRole("button", { name: "打开数据管理" });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导入现有数据库" })).toHaveFocus(),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("cycles Tab focus within the dialog", () => {
    render(
      <DataManagementDialog
        open
        onClose={() => undefined}
        onBeforeOperation={async () => true}
        onImported={async () => undefined}
      />,
    );

    const headerClose = screen.getByRole("button", { name: "关闭数据管理" });
    const footerClose = screen.getByRole("button", { name: /^关闭$/ });
    headerClose.focus();
    fireEvent.keyDown(headerClose, { key: "Tab", shiftKey: true });
    expect(footerClose).toHaveFocus();

    fireEvent.keyDown(footerClose, { key: "Tab" });
    expect(headerClose).toHaveFocus();
  });
});

function DataManagementHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开数据管理
      </button>
      <DataManagementDialog
        open={open}
        onClose={() => setOpen(false)}
        onBeforeOperation={async () => true}
        onImported={async () => undefined}
      />
    </>
  );
}
