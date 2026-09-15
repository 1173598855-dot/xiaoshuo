const accessToken = process.env.XIAOYI_ACCESS_TOKEN?.trim();
if (
  !accessToken ||
  accessToken.length < 16 ||
  accessToken === "replace-with-a-random-token-at-least-16-characters"
) {
  console.error("XIAOYI_ACCESS_TOKEN must contain at least 16 non-placeholder characters.");
  process.exit(1);
}

await import("../dist/server/index.js");
