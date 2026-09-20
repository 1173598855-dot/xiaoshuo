// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceLayout } from "../../src/client/components/WorkspaceLayout";

describe("WorkspaceLayout", () => {
  it("restores sidebar choices and preserves the editor through focus mode", () => {
    render(<WorkspaceLayout navigation="章节目录" context="章节目标"><textarea aria-label="草稿" defaultValue="未保存的故事" /></WorkspaceLayout>);
    fireEvent.click(screen.getByRole("button", { name: "章节" }));
    fireEvent.click(screen.getByRole("button", { name: "专注模式" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "草稿" })).toHaveValue("未保存的故事");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByRole("complementary", { name: "章节上下文" })).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "作品章节" })).not.toBeInTheDocument();
  });
});
