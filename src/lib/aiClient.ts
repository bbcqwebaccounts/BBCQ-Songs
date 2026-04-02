import { GoogleGenAI } from '@google/genai';
import { AIProvider } from '../types';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2-preview';
const OPENAI_TEXT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

export function getConfiguredAiProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  if (GEMINI_API_KEY) providers.push('gemini');
  if (OPENAI_API_KEY) providers.push('openai');
  return providers;
}

export function getPreferredAiProvider(): AIProvider | null {
  const providers = getConfiguredAiProviders();
  return providers[0] || null;
}

export async function createEmbeddingWithFallback(
  input: string | string[],
): Promise<{ provider: AIProvider; embeddings: number[][] }> {
  const providers = getConfiguredAiProviders();

  if (providers.length === 0) {
    throw new Error('No AI provider configured. Add a Gemini or OpenAI API key.');
  }

  let lastError: unknown;

  for (const provider of providers) {
    try {
      return {
        provider,
        embeddings: await createEmbeddings(provider, input),
      };
    } catch (error) {
      console.warn(`Embedding request failed with ${provider}, trying next provider.`, error);
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All embedding providers failed.');
}

export async function generateJsonWithFallback<T>(
  prompt: string,
): Promise<{ provider: AIProvider; result: T }> {
  const providers = getConfiguredAiProviders();

  if (providers.length === 0) {
    throw new Error('No AI provider configured. Add a Gemini or OpenAI API key.');
  }

  let lastError: unknown;

  for (const provider of providers) {
    try {
      const text = await generateJsonText(provider, prompt);
      const normalizedJson = extractJsonPayload(text);
      return {
        provider,
        result: JSON.parse(normalizedJson) as T,
      };
    } catch (error) {
      console.warn(`Generation request failed with ${provider}, trying next provider.`, error);
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All text-generation providers failed.');
}

export function cosineSimilarity(a: number[], b: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function createEmbeddings(
  provider: AIProvider,
  input: string | string[],
): Promise<number[][]> {
  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.embedContent({
      model: GEMINI_EMBEDDING_MODEL,
      contents: input,
    });
    return result.embeddings.map((item) => item.values);
  }

  const response = await fetchWithFriendlyErrors(`${OPENAI_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input,
    }),
  }, 'OpenAI embeddings');

  if (!response.ok) {
    throw new Error(await extractOpenAIError(response));
  }

  const json = await response.json();
  return Array.isArray(json.data)
    ? json.data.map((item: { embedding: number[] }) => item.embedding)
    : [];
}

async function generateJsonText(provider: AIProvider, prompt: string) {
  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });
    return response.text || '';
  }

  const response = await fetchWithFriendlyErrors(`${OPENAI_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      input: `${prompt}\n\nReturn only valid JSON. Do not wrap the JSON in markdown fences or add commentary.`,
      max_output_tokens: 2500,
      store: false,
    }),
  }, 'OpenAI text generation');

  if (!response.ok) {
    throw new Error(await extractOpenAIError(response));
  }

  const json = await response.json();
  if (typeof json.output_text === 'string' && json.output_text.trim()) {
    return json.output_text;
  }

  const textFromOutput = Array.isArray(json.output)
    ? json.output
        .flatMap((item: any) => item.content || [])
        .map((item: any) => item.text || '')
        .join('')
    : '';

  if (!textFromOutput.trim()) {
    throw new Error('OpenAI returned an empty response.');
  }

  return textFromOutput;
}

async function extractOpenAIError(response: Response) {
  try {
    const json = await response.json();
    return json?.error?.message || `OpenAI request failed with status ${response.status}.`;
  } catch {
    return `OpenAI request failed with status ${response.status}.`;
  }
}

async function fetchWithFriendlyErrors(
  input: RequestInfo | URL,
  init: RequestInit,
  context: string,
) {
  try {
    return await fetch(input, init);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown network error';

    throw new Error(
      `${context} failed to reach the API. ${message}. This is usually a browser/network block rather than a Firebase issue. If you are using Brave, disable Shields for this site or allow requests to api.openai.com, then retry.`,
    );
  }
}

function extractJsonPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('AI provider returned an empty response.');
  }

  const deFenced = stripMarkdownFences(trimmed);
  if (deFenced !== trimmed) {
    try {
      JSON.parse(deFenced);
      return deFenced;
    } catch {
      // Keep trying additional salvage strategies below.
    }
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue and try to salvage a fenced or prefixed JSON block.
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    JSON.parse(candidate);
    return candidate;
  }

  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  const startCandidates = [firstBrace, firstBracket].filter((value) => value >= 0);

  if (startCandidates.length > 0) {
    const start = Math.min(...startCandidates);
    const lastBrace = trimmed.lastIndexOf('}');
    const lastBracket = trimmed.lastIndexOf(']');
    const end = Math.max(lastBrace, lastBracket);

    if (end > start) {
      const candidate = trimmed.slice(start, end + 1);
      JSON.parse(candidate);
      return candidate;
    }
  }

  throw new Error(`AI provider returned invalid JSON: ${trimmed.slice(0, 200)}`);
}

function stripMarkdownFences(text: string) {
  let value = text.trim();

  if (value.startsWith('```')) {
    value = value.replace(/^```[a-zA-Z]*\s*/, '');
  }

  if (value.endsWith('```')) {
    value = value.replace(/\s*```$/, '');
  }

  return value.trim();
}
