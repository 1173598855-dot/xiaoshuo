// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetLibraryPanel } from "../../src/client/components/AssetLibraryPanel";

afterEach(() => window.localStorage.clear());

describe("AssetLibraryPanel", () => {
  it("saves a reusable asset and brings it back into the author entry", () => {
    const onUseAsset = vi.fn();
    render(<AssetLibraryPanel onClose={vi.fn()} onUseAsset={onUseAsset} />);

    fireEvent.click(screen.getByRole("button", { name: "新建资产" }));
    fireEvent.change(screen.getByLabelText("资产名称"), { target: { value: "雨夜车站" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "只在雨夜出现的旧车站。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资产" }));

    expect(screen.getByText("雨夜车站")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "带入想法" }));
    expect(onUseAsset).toHaveBeenCalledWith(expect.objectContaining({ name: "雨夜车站", content: "只在雨夜出现的旧车站。" }));
  });
});
