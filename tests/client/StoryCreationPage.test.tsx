// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoryCreationPage } from "../../src/client/components/StoryCreationPage";

afterEach(() => {
  window.localStorage.clear();
});

function renderPage(overrides: Partial<ComponentProps<typeof StoryCreationPage>> = {}) {
  return render(
    <StoryCreationPage
      busy={false}
      error={null}
      assetDraft={null}
      onSubmit={vi.fn()}
      onBack={vi.fn()}
      onConfigureProvider={vi.fn()}
      onConfigureWorkflow={vi.fn()}
      {...overrides}
    />,
  );
}

describe("StoryCreationPage", () => {
  it("provides a dedicated writing canvas with clear return navigation", () => {
    const onBack = vi.fn();
    renderPage({ onBack });

    expect(screen.getByRole("main")).toHaveClass("story-creation-page");
    expect(screen.getByRole("heading", { name: "写下你想讲的故事" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "故事构思编辑器" })).toContainElement(
      screen.getByRole("textbox", { name: "故事想法" }),
    );
    expect(screen.getByRole("complementary", { name: "构思提示" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "返回故事起点" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("opens the inspiration tools when entered from the idea-book shortcut", async () => {
    const onIdeaToolsOpened = vi.fn();
    renderPage({ openIdeaTools: true, onIdeaToolsOpened });

    await waitFor(() => expect(document.querySelector(".idea-tools-disclosure")).toHaveAttribute("open"));
    expect(onIdeaToolsOpened).toHaveBeenCalledOnce();
  });

  it("writes the latest draft immediately when leaving the creation page", () => {
    const { unmount } = renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "故事想法" }), {
      target: { value: "一间只在下雨时出现的书店" },
    });
    expect(window.localStorage.getItem("xiaoyi.idea-draft.v1")).toContain("一间只在下雨时出现的书店");

    unmount();

    expect(JSON.parse(window.localStorage.getItem("xiaoyi.idea-draft.v1") ?? "{}")).toMatchObject({
      idea: "一间只在下雨时出现的书店",
    });
  });
});
