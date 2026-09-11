import { contextBridge, ipcRenderer } from "electron";

import { createPreloadApi } from "./preload-api";
import { createAutoNovelPreloadApiV2 } from "./auto-novel-preload-api-v2";

const legacyApi = createPreloadApi(ipcRenderer);
const autoNovelApi = createAutoNovelPreloadApiV2(ipcRenderer);

contextBridge.exposeInMainWorld("xiaoyi", {
  ...legacyApi,
  autoNovel: autoNovelApi,
});
