import { createHash } from "node:crypto";

import type { MemoryContextConfig } from "../shared/memory";
import { selectAuthoringGenerationContext, type AuthoringGenerationContext } from "../shared/authoring-context";
import type { AuthoringWorkspaceRepository } from "./repositories/authoring-workspace-repository";

export function getAuthoringGenerationContext(
  repository: AuthoringWorkspaceRepository | undefined,
  bookId: string,
  chapterNumber: number,
  memoryContextConfig: MemoryContextConfig,
): AuthoringGenerationContext {
  const workspace = repository?.get(bookId);
  if (!workspace) {
    return {
      workspaceRevision: 0,
      chapterNumber,
      termLocks: [],
      knowledgeBoundaries: [],
      promptVersions: [],
      recipe: null,
    };
  }
  return selectAuthoringGenerationContext(workspace, chapterNumber, memoryContextConfig);
}

export function hashAuthoringGenerationContext(context: AuthoringGenerationContext): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
