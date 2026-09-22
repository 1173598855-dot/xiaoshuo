// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeSelect } from "../../src/client/components/ThemeSelect";

const options = [
  { value: "paper", label: "典藏纸张" },
  { value: "compact", label: "紧凑审校" },
] as const;

describe("ThemeSelect", () => {
  it("opens an in-page themed listbox and selects an option", () => {
    const onChange = vi.fn();
    render(<ThemeSelect aria-label="排版模板" value="paper" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: "排版模板" }));
    expect(screen.getByRole("listbox", { name: "排版模板选项" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "紧凑审校" }));

    expect(onChange).toHaveBeenCalledWith("compact");
    expect(screen.queryByRole("listbox", { name: "排版模板选项" })).not.toBeInTheDocument();
  });

  it("supports keyboard navigation and escape without invoking a native select", () => {
    const onChange = vi.fn();
    render(<ThemeSelect aria-label="排版模板" value="paper" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "排版模板" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "紧凑审校" })).toHaveClass("is-active");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("compact");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "排版模板选项" })).not.toBeInTheDocument();
  });
});
