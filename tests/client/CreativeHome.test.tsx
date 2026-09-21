// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreativeHome } from "../../src/client/components/CreativeHome";

afterEach(() => {
  window.localStorage.clear();
});

function renderHome() {
  return render(
    <CreativeHome
      books={[]}
      busy={false}
      error={null}
      onCreateIdea={vi.fn()}
      onOpenBook={vi.fn()}
      onConfigureProvider={vi.fn()}
      onConfigureWorkflow={vi.fn()}
    />,
  );
}

describe("CreativeHome author entry", () => {
  it("restores an unfinished idea draft from local storage", async () => {
    window.localStorage.setItem("xiaoyi.idea-draft.v1", JSON.stringify({ idea: "一封会回信的信", directionCount: 5, selectedPresetId: null }));
    renderHome();

    await waitFor(() => expect(screen.getByRole("textbox", { name: "故事想法" })).toHaveValue("一封会回信的信"));
    expect(screen.getByRole("status")).toHaveTextContent("已恢复上次未完成的草稿");
    expect(screen.getByRole("spinbutton", { name: "方向数量" })).toHaveValue(5);
  });

  it("saves a custom preset without leaving the story form", async () => {
    renderHome();
    fireEvent.change(screen.getByRole("textbox", { name: "故事想法" }), { target: { value: "一座只在雨夜出现的车站" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为预设" }));
    fireEvent.change(screen.getByRole("textbox", { name: "预设名称" }), { target: { value: "雨夜车站" } });
    fireEvent.click(screen.getByRole("button", { name: "保存预设" }));

    expect(screen.getByRole("button", { name: "雨夜车站" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("xiaoyi.idea-presets.v1") ?? "[]")).toEqual(expect.arrayContaining([expect.objectContaining({ label: "雨夜车站" })]));
  });

  it("explains the path from an idea to an approved manuscript", () => {
    renderHome();

    expect(screen.getByRole("heading", { name: "从一句话，走到正式正文" })).toBeInTheDocument();
    expect(screen.getByText("选择方向")).toBeInTheDocument();
    expect(screen.getByText("逐章生产")).toBeInTheDocument();
    expect(screen.getByText("审核成书")).toBeInTheDocument();
  });
});
