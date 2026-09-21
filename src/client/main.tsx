import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/workbench-refresh.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
