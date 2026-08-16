import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const serverPort = readPort("XIAOYI_SERVER_PORT", 4310);
const webPort = readPort("XIAOYI_WEB_PORT", 5173);

export default defineConfig({
  base: "./",
  plugins: [react(), rendererCspPlugin()],
  root: ".",
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});

function rendererCspPlugin(): Plugin {
  return {
    name: "xiaoyi-renderer-csp",
    transformIndexHtml(html, context) {
      const isDevelopment = context.server !== undefined;
      const scriptSource = isDevelopment
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self'";
      const styleSource = isDevelopment
        ? "style-src 'self' 'unsafe-inline'"
        : "style-src 'self'";
      const connectSource = isDevelopment
        ? `connect-src 'self' http://127.0.0.1:${serverPort} ws://127.0.0.1:${webPort}`
        : "connect-src 'self'";
      const csp = [
        "default-src 'self'",
        scriptSource,
        styleSource,
        "img-src 'self' data:",
        "font-src 'self' data:",
        connectSource,
        "object-src 'none'",
        "base-uri 'self'",
      ].join("; ");

      return html.replace(
        "<head>",
        "<head>\n    <meta http-equiv=\"Content-Security-Policy\" content=\"" +
          csp +
          "\" />",
      );
    },
  };
}

function readPort(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : fallback;
}
