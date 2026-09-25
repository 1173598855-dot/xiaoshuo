import { describe, expect, it, vi } from "vitest";

import { AnthropicAdapter } from "../../src/server/providers/anthropic-adapter";
import { GoogleAdapter } from "../../src/server/providers/google-adapter";
import { normalizeProviderError } from "../../src/server/providers/normalize-error";
import { OpenAIAdapter } from "../../src/server/providers/openai-adapter";
import { OpenAICompatibleAdapter } from "../../src/server/providers/openai-compatible-adapter";
import { NormalizedProviderError } from "../../src/server/providers/types";

const input = {
  model: "model-under-test",
  systemPrompt: "只输出正文",
  userPrompt: "继续这一章",
  maxOutputTokens: 4_096,
};

describe("provider adapters", () => {
  it("uses OpenAI Responses and extracts output text and usage", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "  候选正文  ",
      usage: { input_tokens: 21, output_tokens: 8 },
    });
    const signal = new AbortController().signal;
    const adapter = new OpenAIAdapter(
      { kind: "openai", model: input.model, apiKey: "secret" },
      { responses: { create } } as never,
    );

    await expect(adapter.generate(input, signal)).resolves.toEqual({
      text: "候选正文",
      usage: { inputTokens: 21, outputTokens: 8 },
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: input.model,
        instructions: input.systemPrompt,
        input: input.userPrompt,
        max_output_tokens: input.maxOutputTokens,
      },
      { signal },
    );
  });

  it("uses Anthropic Messages and narrows text content blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
      ],
      usage: { input_tokens: 31, output_tokens: 13 },
    });
    const signal = new AbortController().signal;
    const adapter = new AnthropicAdapter(
      { kind: "anthropic", model: input.model, apiKey: "secret" },
      { messages: { create } } as never,
    );

    await expect(adapter.generate(input, signal)).resolves.toEqual({
      text: "第一段\n第二段",
      usage: { inputTokens: 31, outputTokens: 13 },
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: input.model,
        max_tokens: input.maxOutputTokens,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.userPrompt }],
      },
      { signal },
    );
  });

  it("uses Google generateContent with request cancellation", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Gemini 候选",
      usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 6 },
    });
    const signal = new AbortController().signal;
    const adapter = new GoogleAdapter(
      { kind: "google", model: input.model, apiKey: "secret" },
      { models: { generateContent } } as never,
    );

    await expect(adapter.generate(input, signal)).resolves.toEqual({
      text: "Gemini 候选",
      usage: { inputTokens: 17, outputTokens: 6 },
    });
    expect(generateContent).toHaveBeenCalledWith({
      model: input.model,
      contents: input.userPrompt,
      config: {
        systemInstruction: input.systemPrompt,
        maxOutputTokens: input.maxOutputTokens,
        abortSignal: signal,
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    });
  });

  it("uses Chat Completions for compatible endpoints", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "兼容端点候选" } }],
      usage: { prompt_tokens: 11, completion_tokens: 5 },
    });
    const signal = new AbortController().signal;
    const adapter = new OpenAICompatibleAdapter(
      {
        kind: "openai-compatible",
        model: input.model,
        apiKey: "secret",
        baseUrl: "https://models.example.test/v1",
      },
      { chat: { completions: { create } } } as never,
    );

    await expect(adapter.generate(input, signal)).resolves.toEqual({
      text: "兼容端点候选",
      usage: { inputTokens: 11, outputTokens: 5 },
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        max_tokens: input.maxOutputTokens,
      },
      { signal },
    );
  });

  it("maps reasoning level and cache usage when the provider exposes them", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "带思考的候选" } }],
      usage: { prompt_tokens: 20, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 8 } },
    });
    const adapter = new OpenAICompatibleAdapter({ kind: "openai-compatible", model: input.model, apiKey: "secret", baseUrl: "https://models.example.test/v1" }, { chat: { completions: { create } } } as never);
    await expect(adapter.generate({ ...input, reasoningLevel: "high" })).resolves.toMatchObject({ usage: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 8 } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: "high" }), expect.anything());
  });

  it("normalizes status errors without exposing upstream messages", () => {
    const normalized = normalizeProviderError({
      status: 401,
      message: "invalid sk-secret-value",
    });

    expect(normalized).toBeInstanceOf(NormalizedProviderError);
    expect(normalized).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: "模型服务拒绝了当前凭据。",
    });
    expect(normalized.message).not.toContain("sk-secret-value");
    expect(normalized.cause).toBeUndefined();
  });
});
