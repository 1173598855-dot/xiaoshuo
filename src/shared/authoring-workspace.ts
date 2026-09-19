import { z } from "zod";

import { MemoryContextConfigSchema } from "./memory";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();

export const SceneStatusSchema = z.enum(["planned", "drafting", "reviewing", "accepted", "cut"]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SceneCardSchema = z.object({
  id: UuidSchema,
  chapterNumber: z.number().int().min(1),
  order: z.number().int().min(0),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200),
  participants: z.array(z.string().trim().max(120)).max(50),
  objective: z.string().trim().max(2_000),
  conflict: z.string().trim().max(2_000),
  turn: z.string().trim().max(2_000),
  emotion: z.string().trim().max(200),
  status: SceneStatusSchema,
}).strict();
export type SceneCard = z.infer<typeof SceneCardSchema>;

export const ForeshadowingStatusSchema = z.enum(["planned", "planted", "progressing", "resolved", "dormant"]);
export type ForeshadowingStatus = z.infer<typeof ForeshadowingStatusSchema>;

export const ForeshadowingTrackSchema = z.object({
  id: UuidSchema,
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2_000),
  status: ForeshadowingStatusSchema,
  plantedChapter: z.number().int().min(1).nullable(),
  targetChapter: z.number().int().min(1).nullable(),
  resolvedChapter: z.number().int().min(1).nullable(),
  note: z.string().trim().max(1_000),
}).strict();
export type ForeshadowingTrack = z.infer<typeof ForeshadowingTrackSchema>;

export const AuthorNoteTargetSchema = z.enum(["book", "scene", "plan", "chapter", "candidate"]);
export const AuthorNoteSchema = z.object({
  id: UuidSchema,
  targetType: AuthorNoteTargetSchema,
  targetId: UuidSchema.nullable(),
  content: z.string().trim().min(1).max(8_000),
  resolved: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type AuthorNote = z.infer<typeof AuthorNoteSchema>;

export const WritingGoalSchema = z.object({
  dailyCharacters: z.number().int().min(0).max(100_000),
  todayCharacters: z.number().int().min(0).max(1_000_000),
  streakDays: z.number().int().min(0).max(100_000),
  lastWorkedAt: TimestampSchema.nullable(),
}).strict();
export type WritingGoal = z.infer<typeof WritingGoalSchema>;

export const TermLockSchema = z.object({
  id: UuidSchema,
  term: z.string().trim().min(1).max(120),
  canonical: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500),
  caseSensitive: z.boolean(),
}).strict();
export type TermLock = z.infer<typeof TermLockSchema>;

export const CharacterKnowledgeBoundarySchema = z.object({
  id: UuidSchema,
  characterName: z.string().trim().min(1).max(120),
  knows: z.string().trim().max(4_000),
  doesNotKnow: z.string().trim().max(4_000),
  revealChapter: z.number().int().min(1).nullable(),
}).strict();
export type CharacterKnowledgeBoundary = z.infer<typeof CharacterKnowledgeBoundarySchema>;

export const SeriesProfileSchema = z.object({
  name: z.string().trim().max(160),
  volumeNumber: z.number().int().min(1).max(500),
  description: z.string().trim().max(2_000),
}).strict();
export type SeriesProfile = z.infer<typeof SeriesProfileSchema>;

export const ProductionRecipeSchema = z.object({
  id: UuidSchema,
  name: z.string().trim().min(1).max(120),
  memoryContextConfig: MemoryContextConfigSchema,
  instruction: z.string().trim().max(4_000),
  targetChapterFrom: z.number().int().min(1).nullable(),
  targetChapterTo: z.number().int().min(1).nullable(),
  updatedAt: TimestampSchema,
}).strict();
export type ProductionRecipe = z.infer<typeof ProductionRecipeSchema>;

export const PromptRoleSchema = z.enum(["director", "writer", "reviewer", "repairer"]);
export const PromptVersionSchema = z.object({
  id: UuidSchema,
  role: PromptRoleSchema,
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(20_000),
  active: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const AuthoringWorkspaceSchema = z.object({
  bookId: UuidSchema,
  revision: z.number().int().nonnegative(),
  scenes: z.array(SceneCardSchema).max(2_000),
  foreshadowing: z.array(ForeshadowingTrackSchema).max(500),
  notes: z.array(AuthorNoteSchema).max(2_000),
  writingGoal: WritingGoalSchema,
  termLocks: z.array(TermLockSchema).max(500),
  knowledgeBoundaries: z.array(CharacterKnowledgeBoundarySchema).max(500).default([]),
  series: SeriesProfileSchema.nullable().default(null),
  productionRecipes: z.array(ProductionRecipeSchema).max(100),
  promptVersions: z.array(PromptVersionSchema).max(100),
  updatedAt: TimestampSchema,
}).strict();
export type AuthoringWorkspace = z.infer<typeof AuthoringWorkspaceSchema>;

export const AuthoringWorkspacePayloadSchema = AuthoringWorkspaceSchema.omit({ revision: true, updatedAt: true }).strict();
export type AuthoringWorkspacePayload = z.infer<typeof AuthoringWorkspacePayloadSchema>;

export const SaveAuthoringWorkspaceInputSchema = z.object({
  bookId: UuidSchema,
  expectedRevision: z.number().int().nonnegative(),
  workspace: AuthoringWorkspacePayloadSchema,
}).strict();
export type SaveAuthoringWorkspaceInput = z.infer<typeof SaveAuthoringWorkspaceInputSchema>;

export const AuthoringWorkspaceDefault: AuthoringWorkspacePayload = {
  bookId: "00000000-0000-4000-8000-000000000000",
  scenes: [],
  foreshadowing: [],
  notes: [],
  writingGoal: {
    dailyCharacters: 2_000,
    todayCharacters: 0,
    streakDays: 0,
    lastWorkedAt: null,
  },
  termLocks: [],
  knowledgeBoundaries: [],
  series: null,
  productionRecipes: [],
  promptVersions: [],
};
