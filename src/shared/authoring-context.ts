import { z } from "zod";

import type { MemoryContextConfig } from "./memory";
import type { AuthoringWorkspace } from "./authoring-workspace";

const UuidSchema = z.string().uuid();

export const AuthoringRecipeContextSchema = z.object({
  id: UuidSchema,
  name: z.string().trim().min(1).max(120),
  instruction: z.string().trim().max(4_000),
}).strict();
export type AuthoringRecipeContext = z.infer<typeof AuthoringRecipeContextSchema>;

export const AuthoringGenerationContextSchema = z.object({
  workspaceRevision: z.number().int().nonnegative(),
  chapterNumber: z.number().int().min(1),
  termLocks: z.array(z.object({
    term: z.string().trim().min(1).max(120),
    canonical: z.string().trim().min(1).max(120),
    caseSensitive: z.boolean(),
  }).strict()).max(500),
  knowledgeBoundaries: z.array(z.object({
    characterName: z.string().trim().min(1).max(120),
    knows: z.string().trim().max(4_000),
    doesNotKnow: z.string().trim().max(4_000),
    revealChapter: z.number().int().min(1).nullable(),
  }).strict()).max(500),
  promptVersions: z.array(z.object({
    role: z.enum(["director", "writer", "reviewer", "repairer"]),
    name: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(20_000),
  }).strict()).max(100),
  recipe: AuthoringRecipeContextSchema.nullable(),
}).strict();
export type AuthoringGenerationContext = z.infer<typeof AuthoringGenerationContextSchema>;

/**
 * Select only the authoring rules that are safe and relevant for one chapter.
 * This projection is shared by the renderer explanation and server prompt
 * path so the UI never claims that a rule was applied when it was not.
 */
export function selectAuthoringGenerationContext(
  workspace: AuthoringWorkspace,
  chapterNumber: number,
  memoryContextConfig: MemoryContextConfig,
): AuthoringGenerationContext {
  const recipe = workspace.productionRecipes
    .filter((candidate) => sameMemoryConfig(candidate.memoryContextConfig, memoryContextConfig))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
  return AuthoringGenerationContextSchema.parse({
    workspaceRevision: workspace.revision,
    chapterNumber,
    termLocks: workspace.termLocks.map(({ term, canonical, caseSensitive }) => ({ term, canonical, caseSensitive })),
    knowledgeBoundaries: workspace.knowledgeBoundaries
      .filter(({ revealChapter }) => revealChapter === null || revealChapter <= chapterNumber)
      .map(({ characterName, knows, doesNotKnow, revealChapter }) => ({ characterName, knows, doesNotKnow, revealChapter })),
    promptVersions: workspace.promptVersions
      .filter(({ active }) => active)
      .map(({ role, name, content }) => ({ role, name, content })),
    recipe: recipe
      ? { id: recipe.id, name: recipe.name, instruction: recipe.instruction }
      : null,
  });
}

function sameMemoryConfig(
  left: MemoryContextConfig,
  right: MemoryContextConfig,
): boolean {
  if (left.mode !== right.mode || left.entryIds.length !== right.entryIds.length) return false;
  const rightIds = new Set(right.entryIds);
  return left.entryIds.every((entryId) => rightIds.has(entryId));
}
