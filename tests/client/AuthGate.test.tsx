// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { AuthGate, type AuthStatus } from "../../src/client/components/AuthGate";

function renderGate(status: AuthStatus = "idle") {
  const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  const props = {
    mode: "register" as const,
    status,
    username: "writer",
    password: "strong-password-123",
    invitationCode: "xiaoyi-code",
    error: null,
    onModeChange: vi.fn(),
    onUsernameChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onInvitationCodeChange: vi.fn(),
    onSubmit,
  };
  const result = render(<AuthGate {...props} />);
  return { onSubmit, props, rerender: result.rerender };
}

describe("AuthGate", () => {
  it("provides interactive registration feedback and password visibility", () => {
    const { onSubmit } = renderGate();

    expect(screen.getByRole("heading", { name: "注册工作台" })).toBeVisible();
    expect(screen.getByText("密码强度足够")).toBeVisible();
    expect(screen.getByRole("button", { name: "显示密码" })).toBeVisible();
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");
    fireEvent.submit(screen.getByRole("button", { name: "注册并登录" }).closest("form")!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("exposes submitting, error, and mode-switch states", () => {
    const { props, rerender } = renderGate("submitting");
    expect(screen.getByRole("button", { name: "正在验证…" })).toBeDisabled();
    expect(screen.getByLabelText("用户名")).toBeDisabled();

    rerender(<AuthGate {...props} status="idle" error="邀请码已过期，请重新获取。" />);
    expect(screen.getByRole("alert")).toHaveTextContent("邀请码已过期");
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(props.onModeChange).toHaveBeenCalledWith("login");
  });
});
