import type { ProviderConfig } from "../../shared/contracts";
import type { ProviderResolver } from "../providers/resolver";
import type { TextGenerationProvider } from "./types";

export class AutoNovelDeterministicProviderResolver implements ProviderResolver {
  resolve(config: ProviderConfig): TextGenerationProvider {
    return {
      kind: config.kind,
      async generate(input) {
        if (input.systemPrompt.includes("局部精修编辑")) {
          const selected = input.userPrompt.match(/待精修选段：([\s\S]*?)\n选段后文：/)?.[1]?.trim() || "这段内容";
          return {
            text: JSON.stringify({ alternatives: [
              { label: "更凝练", text: selected.replace(/，/g, "、").slice(0, 3_900), rationale: "保留原意，压紧表达。" },
              { label: "增强动作感", text: `他停顿片刻，${selected}`, rationale: "用动作承接当前语气。" },
              { label: "加强悬念", text: `${selected} 可那句话并非全部。`, rationale: "在段尾增加一个可追查的余波。" },
            ] }),
            usage: { inputTokens: 30, outputTokens: 45 },
          };
        }
        if (input.systemPrompt.includes("章纲兑现核对员")) {
          const passage = input.userPrompt.match(/候选正文：\n([\s\S]*?)\n\n待核对事项：/)?.[1] ?? "";
          const sentence = passage.split(/(?<=[。！？])/u).find((item) => item.trim())?.trim() ?? "";
          const lastSentence = passage.split(/(?<=[。！？])/u).filter((item) => item.trim()).at(-1)?.trim() ?? sentence;
          return {
            text: JSON.stringify({ criteria: [
              { key: "objective", status: sentence ? "fulfilled" : "uncertain", evidenceQuote: sentence || null, explanation: sentence ? "确定性演示：正文包含可定位的行动依据。" : "没有可定位的正文依据。" },
              { key: "hook", status: lastSentence ? "partial" : "uncertain", evidenceQuote: lastSentence || null, explanation: lastSentence ? "确定性演示：已定位章节结尾供作者核对。" : "没有可定位的正文依据。" },
              { key: "foreshadowing:0", status: "uncertain", evidenceQuote: null, explanation: "确定性演示不自动推断伏笔回收。" },
            ] }),
            usage: { inputTokens: 36, outputTokens: 28 },
          };
        }
        if (input.systemPrompt.includes("自动导演")) {
          const requestedCount = Number(input.systemPrompt.match(/(?:恰好|给出)\s*(\d+)\s*(?:套|种)/)?.[1] ?? 3);
          return {
            text: JSON.stringify({
              directions: Array.from({ length: requestedCount }, (_, index) => index + 1).map((rank) => ({
                title: `自动方向 ${rank}`,
                logline: `围绕想法展开的主线 ${rank}`,
                genre: "都市悬疑",
                promise: `每章都有新的线索 ${rank}`,
                centralConflict: `主角必须解决核心冲突 ${rank}`,
                endingDirection: `主角在终局做出选择 ${rank}`,
                outlinePreview: [`异常出现 ${rank}`, `真相靠近 ${rank}`],
                rank,
              })),
            }),
            usage: { inputTokens: 12, outputTokens: 36 },
          };
        }
        if (input.systemPrompt.includes("总策划")) {
          return {
            text: JSON.stringify({
              worldRules: ["每个秘密都会留下可追溯的物证"],
              characters: [
                {
                  name: "主角",
                  role: "追查者",
                  motivation: "查明异常来源",
                  arc: "从旁观到主动选择",
                },
              ],
              locations: [
                {
                  name: "旧城区的移动站台",
                  description: "只在凌晨出现、会改变入口位置的临时站台。",
                  significance: "主角追查异常物件来源的关键地点。",
                  rules: ["每次只允许一人进入", "离开后必须留下可追溯物证"],
                },
              ],
              styleGuide: "紧张、克制、用动作推进情节。",
              facts: ["故事从一个异常物件开始"],
            }),
            usage: { inputTokens: 10, outputTokens: 30 },
          };
        }
        if (input.systemPrompt.includes("架构师")) {
          return {
            text: JSON.stringify({
              plans: Array.from({ length: 3 }, (_, index) => ({
                volumeNumber: 1,
                volumeTitle: "第一卷",
                chapterNumber: index + 1,
                title: `第${index + 1}章 异常回声`,
                summary: `主角在第${index + 1}章发现新的异常。`,
                objective: "推进主线并留下下一章钩子。",
                hook: "新的线索指向主角自己。",
                foreshadowing: ["异常物件"],
              })),
            }),
            usage: { inputTokens: 15, outputTokens: 45 },
          };
        }
        if (input.systemPrompt.includes("审稿人")) {
          return {
            text: JSON.stringify({ status: "passed", findings: [] }),
            usage: { inputTokens: 10, outputTokens: 4 },
          };
        }
        return {
          text: "主角握紧那件异常物件，门后的脚步声停在了自己的名字上。",
          usage: { inputTokens: 18, outputTokens: 20 },
        };
      },
    };
  }
}
