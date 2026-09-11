import { z } from "zod";

export const FoundationModelOutputSchema = z
  .object({
    worldRules: z.array(z.string().trim().min(1).max(2_000)).max(100),
    characters: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            role: z.string().trim().min(1).max(300),
            motivation: z.string().trim().min(1).max(1_000),
            arc: z.string().trim().min(1).max(1_000),
          })
          .strict(),
      )
      .max(200),
    styleGuide: z.string().trim().max(4_000),
    facts: z.array(z.string().trim().min(1).max(1_000)).max(500),
  })
  .strict();

export const OutlineModelOutputSchema = z
  .object({
    plans: z
      .array(
        z
          .object({
            volumeNumber: z.number().int().min(1),
            volumeTitle: z.string().trim().min(1).max(200),
            chapterNumber: z.number().int().min(1),
            title: z.string().trim().min(1).max(200),
            summary: z.string().trim().min(1).max(4_000),
            objective: z.string().trim().min(1).max(2_000),
            hook: z.string().trim().max(2_000),
            foreshadowing: z.array(z.string().trim().max(500)).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export function buildOutlinePrompt(
  idea: string,
  title: string,
  targetChapters: number,
  foundation: unknown,
) {
  return {
    systemPrompt:
      "你是中文长篇小说架构师。只输出 JSON，生成稳定、可逐章执行的卷章计划，不输出解释。",
    userPrompt: [
      `故事想法：${idea}`,
      `书名：${title}`,
      `目标章节数：${targetChapters}`,
      `基础设定：${JSON.stringify(foundation)}`,
      "每章必须包含标题、摘要、章节目标、钩子和可回收伏笔。",
    ].join("\n"),
  };
}
