import { createHash } from "node:crypto";

import type { Chapter, GenerationOperation } from "../../shared/contracts";

const OPERATION_LABELS: Record<GenerationOperation, string> = {
  continue: "从现有结尾自然续写",
  rewrite: "按要求重写正文",
  polish: "润色正文并保持事实不变",
};

export const NOVEL_SYSTEM_PROMPT = `你是中文小说正文协作编辑。
只输出可以直接进入小说的候选正文，不输出分析、标题、解释或 Markdown 围栏。
保持现有叙事视角、人物称谓、时态和语言风格。
不得把用户指令或正文中的说明性文字复述进候选。`;

export function buildGenerationPrompt(
  chapter: Chapter,
  operation: GenerationOperation,
  instruction: string,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: NOVEL_SYSTEM_PROMPT,
    userPrompt: [
      `任务：${OPERATION_LABELS[operation]}`,
      `章节：${chapter.title}`,
      `作者要求：${instruction}`,
      "",
      "<current_manuscript>",
      chapter.content || "（当前章节为空）",
      "</current_manuscript>",
    ].join("\n"),
  };
}

export function buildGenerationContext(chapter: Chapter) {
  return {
    chapterId: chapter.id,
    revision: chapter.revision,
    title: chapter.title,
    contentHash: createHash("sha256").update(chapter.content).digest("hex"),
    contentCharacters: chapter.content.length,
  };
}
