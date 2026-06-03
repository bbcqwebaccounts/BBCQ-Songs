type Env = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBEDDING_MODEL?: string;
};

const OPENAI_API_BASE = 'https://api.openai.com/v1';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

async function readOpenAIError(response: Response) {
  try {
    const json = await response.json();
    return json?.error?.message || `OpenAI request failed with status ${response.status}.`;
  } catch {
    return `OpenAI request failed with status ${response.status}.`;
  }
}

async function forwardOpenAIRequest(
  env: Env,
  endpoint: 'responses' | 'embeddings',
  payload: Record<string, unknown>,
) {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse(
      { error: 'OPENAI_API_KEY is not configured in Cloudflare Pages.' },
      { status: 500 },
    );
  }

  const response = await fetch(`${OPENAI_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return jsonResponse({ error: await readOpenAIError(response) }, { status: response.status });
  }

  return jsonResponse(await response.json());
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}) {
  let body: any;

  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (body?.type === 'responses') {
    const input = typeof body.input === 'string' ? body.input : '';
    if (!input.trim()) {
      return jsonResponse({ error: 'Responses requests require a non-empty input.' }, { status: 400 });
    }

    return forwardOpenAIRequest(context.env, 'responses', {
      model: context.env.OPENAI_MODEL || body.model || 'gpt-4.1-mini',
      input,
      max_output_tokens: Number(body.max_output_tokens || 2500),
      store: false,
    });
  }

  if (body?.type === 'embeddings') {
    const input = body.input;
    if (
      typeof input !== 'string' &&
      !(Array.isArray(input) && input.every((item) => typeof item === 'string'))
    ) {
      return jsonResponse(
        { error: 'Embedding requests require input as a string or string array.' },
        { status: 400 },
      );
    }

    return forwardOpenAIRequest(context.env, 'embeddings', {
      model: context.env.OPENAI_EMBEDDING_MODEL || body.model || 'text-embedding-3-small',
      input,
    });
  }

  return jsonResponse({ error: 'Unknown OpenAI proxy request type.' }, { status: 400 });
}
