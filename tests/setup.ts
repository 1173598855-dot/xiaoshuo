import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Full-suite Windows runs can queue lazy React/Suspense work behind parallel
// jsdom workers; keep async assertions deterministic without changing product
// behavior or masking test timeouts indefinitely.
configure({ asyncUtilTimeout: 3_000 });

afterEach(() => {
  cleanup();
});
