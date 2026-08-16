import { contextBridge, ipcRenderer } from "electron";

import { createPreloadApi } from "./preload-api";

contextBridge.exposeInMainWorld("xiaoyi", createPreloadApi(ipcRenderer));
