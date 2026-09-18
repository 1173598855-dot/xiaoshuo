import { expect, test } from "@playwright/test";

test("registers from the real invitation-gated web entry", async ({ page, request }) => {
  const invitationResponse = await request.post("/api/admin/invitations", {
    headers: { authorization: "Bearer e2e-auth-admin-token-123456789" },
    data: { maxUses: 1 },
  });
  expect(invitationResponse.status()).toBe(201);
  const invitation = await invitationResponse.json() as { code: string };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
  await page.getByRole("button", { name: "没有账号？使用邀请码注册" }).click();
  await expect(page.getByRole("heading", { name: "注册工作台" })).toBeVisible();
  await page.getByPlaceholder("用户名").fill("e2e-writer");
  await page.getByPlaceholder("密码（至少 12 位）").fill("e2e-auth-password-123");
  await page.getByPlaceholder("邀请码").fill(invitation.code);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("textbox", { name: "故事想法" })).toBeVisible();
});
