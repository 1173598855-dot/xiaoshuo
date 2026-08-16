import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isTrustedDesktopIpcSender,
  resolveDesktopRuntimeConfig,
} from "../../src/desktop/runtime-policy";

const rendererFile = "C:\\app\\dist\\client\\index.html";

describe("desktop runtime policy", () => {
  it("ignores development and automation overrides in packaged builds", () => {
    const config = resolveDesktopRuntimeConfig({
      isPackaged: true,
      defaultUserDataDirectory: "C:\\Users\\author\\AppData\\Roaming\\Xiaoyi",
      rendererFile,
      environment: {
        XIAOYI_RENDERER_URL: "https://attacker.example/renderer",
        XIAOYI_USER_DATA_DIR: "C:\\attacker-controlled",
        XIAOYI_FAKE_PROVIDER: "1",
        XIAOYI_DESKTOP_SMOKE: "1",
        XIAOYI_UPDATE_FEED_URL: " https://updates.example.test/xiaoyi ",
      },
    });

    expect(config).toMatchObject({
      userDataDirectory: "C:\\Users\\author\\AppData\\Roaming\\Xiaoyi",
      useFakeProvider: false,
      desktopSmoke: false,
      updateFeedUrl: "https://updates.example.test/xiaoyi",
      renderer: {
        kind: "file",
        url: pathToFileURL(rendererFile).href,
      },
    });
    expect(config.renderer.isTrustedUrl(pathToFileURL(rendererFile).href)).toBe(
      true,
    );
    expect(
      config.renderer.isTrustedUrl(
        pathToFileURL("C:\\app\\dist\\client\\other.html").href,
      ),
    ).toBe(false);
    expect(
      config.renderer.isTrustedUrl("https://attacker.example/renderer"),
    ).toBe(false);
  });

  it("accepts only an explicit loopback HTTP renderer during development", () => {
    const config = resolveDesktopRuntimeConfig({
      isPackaged: false,
      defaultUserDataDirectory: "C:\\default-user-data",
      rendererFile,
      environment: {
        XIAOYI_RENDERER_URL: "http://127.0.0.1:5173/",
        XIAOYI_USER_DATA_DIR: "C:\\test-user-data",
        XIAOYI_FAKE_PROVIDER: "1",
        XIAOYI_DESKTOP_SMOKE: "1",
        XIAOYI_UPDATE_FEED_URL: "https://updates.example.test/xiaoyi",
      },
    });

    expect(config).toMatchObject({
      userDataDirectory: "C:\\test-user-data",
      useFakeProvider: true,
      desktopSmoke: true,
      updateFeedUrl: undefined,
      renderer: {
        kind: "url",
        url: "http://127.0.0.1:5173/",
      },
    });
    expect(
      config.renderer.isTrustedUrl("http://127.0.0.1:5173/chapter?id=1"),
    ).toBe(true);
    expect(
      config.renderer.isTrustedUrl("http://localhost:5173/"),
    ).toBe(false);
    expect(
      config.renderer.isTrustedUrl("http://127.0.0.1:5174/"),
    ).toBe(false);
  });

  it.each([
    "http://example.test:5173/",
    "https://127.0.0.1:5173/",
    "file:///C:/untrusted.html",
    "data:text/html,untrusted",
    "http://127.0.0.1/",
  ])("rejects an untrusted development renderer URL: %s", (rendererUrl) => {
    expect(() =>
      resolveDesktopRuntimeConfig({
        isPackaged: false,
        defaultUserDataDirectory: "C:\\default-user-data",
        rendererFile,
        environment: { XIAOYI_RENDERER_URL: rendererUrl },
      }),
    ).toThrow(/renderer url/i);
  });

  it("requires the active window, its main frame, and the trusted frame URL", () => {
    const config = resolveDesktopRuntimeConfig({
      isPackaged: true,
      defaultUserDataDirectory: "C:\\default-user-data",
      rendererFile,
      environment: {},
    });
    const mainFrame = { url: config.renderer.url };
    const webContents = { mainFrame };
    const window = { isDestroyed: () => false, webContents };

    expect(
      isTrustedDesktopIpcSender(
        { sender: webContents, senderFrame: mainFrame },
        window,
        config.renderer,
      ),
    ).toBe(true);
    expect(
      isTrustedDesktopIpcSender(
        {
          sender: webContents,
          senderFrame: { url: "file:///C:/untrusted.html" },
        },
        window,
        config.renderer,
      ),
    ).toBe(false);
    expect(
      isTrustedDesktopIpcSender(
        { sender: { mainFrame }, senderFrame: mainFrame },
        window,
        config.renderer,
      ),
    ).toBe(false);
  });
});
