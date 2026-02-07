interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

interface OpenRouterOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

import { fetchWithRetry } from './fetchWithRetry.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  options: OpenRouterOptions = {},
): Promise<{ content: string; usage?: OpenRouterResponse['usage'] }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }

  const { temperature = 0.2, maxTokens = 4096, timeoutMs = 120_000 } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithRetry(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://truffles.internal',
        'X-Title': 'Truffles',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, usage: data.usage };
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeVideoFrames(
  model: string,
  frames: Array<{ base64: string; mimeType: string }>,
  prompt: string,
  options?: OpenRouterOptions,
): Promise<{ content: string; usage?: OpenRouterResponse['usage'] }> {
  const imageBlocks = frames.map((frame) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` },
  }));

  const messages: OpenRouterMessage[] = [
    {
      role: 'user',
      content: [
        ...imageBlocks,
        { type: 'text' as const, text: prompt },
      ],
    },
  ];

  return callOpenRouter(model, messages, {
    ...options,
    maxTokens: options?.maxTokens ?? 8192,
    timeoutMs: options?.timeoutMs ?? 180_000,
  });
}

export async function analyzeText(
  model: string,
  prompt: string,
  options?: OpenRouterOptions,
): Promise<{ content: string; usage?: OpenRouterResponse['usage'] }> {
  const messages: OpenRouterMessage[] = [
    { role: 'user', content: prompt },
  ];

  return callOpenRouter(model, messages, options);
}
