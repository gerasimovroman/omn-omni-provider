import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { wrapFetchForExtraCa } from '@oh-my-pi/pi-utils';
import { buildModel } from '@oh-my-pi/pi-catalog/build';
import { CODEX_CLIENT_VERSION } from '@oh-my-pi/pi-catalog/wire/codex';
import { streamOpenAIResponses } from '@oh-my-pi/pi-ai/providers/openai-responses';
import { lookup } from '@oh-my-pi/pi-coding-agent/config/registry';
import { getBundledProviders } from '@oh-my-pi/pi-catalog/models';
import { loadConfig, readApiKey } from './src/config.ts';
import {
  createAllowedFilter,
  groupModels,
  upstreamPayload,
  DEFAULT_FRIENDLY_MODEL_IDS,
} from './src/models.ts';
import type { NormalizedModel, RawModelEntry } from './src/types.ts';

const codexApi = 'omniroute-codex-responses';
const codexModels = new Map<string, unknown>();
let activeAliases: Record<string, string> = {};

interface OmpContext {
  on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void;
  getThinkingLevel: () => string;
  registerProvider: (name: string, provider: unknown) => void;
  pi?: {
    settings?: unknown;
  };
}

interface StreamOptions {
  reasoning?: string;
  disableReasoning?: boolean;
  forceReasoningOff?: boolean;
  reasoningSummary?: null;
  maxTokensExplicit?: boolean;
  maxTokens?: number;
  hideThinkingSummary?: boolean;
  onPayload?: (payload: unknown) => Promise<unknown> | unknown;
}

export default async function registerOmniRoute(pi: OmpContext): Promise<void> {
  const config = loadConfig();
  const { baseUrl, directory, keyPath, exclusions, disableBuiltinProviders } = config;
  const isAllowed = createAllowedFilter(exclusions);

  function runtimeModels(models: NormalizedModel[]): NormalizedModel[] {
    return models.map(model => {
      if (!model.id.startsWith('codex/')) {
        return model;
      }
      const native = buildModel({ ...model, provider: 'omniroute', baseUrl });
      codexModels.set(model.id, native);
      let thinking = model.thinking;
      if (native.thinking && typeof native.thinking === 'object') {
        thinking = native.thinking as typeof model.thinking;
      }
      return {
        ...model,
        api: codexApi,
        thinking,
      };
    });
  }

  function codexStream(model: unknown, context: unknown, options: StreamOptions = {}): unknown {
    const selected = pi.getThinkingLevel();
    const effort = selected === 'auto' ? options.reasoning || 'medium' : selected;

    let modelId = '';
    if (model && typeof model === 'object' && 'id' in model && typeof model.id === 'string') {
      modelId = model.id;
    }
    const nativeModel = codexModels.get(modelId);

    return streamOpenAIResponses(nativeModel, context, {
      ...options,
      reasoning: effort === 'off' ? undefined : effort,
      disableReasoning: effort === 'off',
      forceReasoningOff: false,
      reasoningSummary: options.hideThinkingSummary ? null : undefined,
      maxTokensExplicit: options.maxTokens !== undefined,
      onPayload: async (payload: unknown) => {
        let processed = payload;
        if (options.onPayload) {
          const original = await options.onPayload(payload);
          if (original !== undefined) {
            processed = original;
          }
        }
        return upstreamPayload(processed, model, activeAliases);
      },
    });
  }

  pi.on('before_provider_request', (event: unknown, ctx: unknown) => {
    let payload: unknown = null;
    let model: unknown = null;
    if (event && typeof event === 'object' && 'payload' in event) {
      payload = event.payload;
    }
    if (ctx && typeof ctx === 'object' && 'model' in ctx) {
      model = ctx.model;
    }
    return upstreamPayload(payload, model, activeAliases);
  });

  if (disableBuiltinProviders) {
    const disabled = lookup('disabledProviders');
    if (disabled && pi.pi?.settings) {
      const current = (disabled.get(pi.pi.settings) as string[] | undefined) || [];
      const bundled = getBundledProviders() as string[];
      disabled.override(pi.pi.settings, Array.from(new Set([...current, ...bundled])));
    }
  }

  const fetchModels = async (): Promise<NormalizedModel[]> => {
    const key = readApiKey(keyPath, process.env);

    const response = await wrapFetchForExtraCa(fetch)(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`OmniRoute model discovery: HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) {
      throw new Error('OmniRoute discovery: data must be an array');
    }

    const rawData = payload.data as RawModelEntry[];
    const grouped = groupModels(
      rawData,
      isAllowed,
      CODEX_CLIENT_VERSION,
      DEFAULT_FRIENDLY_MODEL_IDS,
      (m) => buildModel({ ...m, provider: 'omniroute', baseUrl })
    );

    activeAliases = grouped.activeAliases;
    const models = grouped.models;

    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(directory, 'catalog.json'),
      JSON.stringify({ fetchedAt: new Date().toISOString(), baseUrl, models: rawData }, null, 2) + '\n',
      { mode: 0o600 }
    );
    writeFileSync(
      join(directory, 'groups.json'),
      JSON.stringify(
        {
          families: grouped.families,
          contextWindows: grouped.contextWindows,
          friendlyModelIds: DEFAULT_FRIENDLY_MODEL_IDS,
          keptSeparate: grouped.keptSeparate,
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    );
    appendFileSync(
      join(directory, 'discovery.jsonl'),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        status: response.status,
        received: rawData.length,
        groupedModels: models.length,
        idsSha256: createHash('sha256')
          .update(models.map(m => m.id).sort().join('\n'))
          .digest('hex'),
      }) + '\n',
      { mode: 0o600 }
    );

    return runtimeModels(models);
  };

  let initialModels: NormalizedModel[] = [];
  try {
    initialModels = await fetchModels();
  } catch (discoveryError) {
    try {
      const snapshotText = readFileSync(join(directory, 'catalog.json'), 'utf8');
      const snapshot: unknown = JSON.parse(snapshotText);
      if (
        !snapshot
        || typeof snapshot !== 'object'
        || !('models' in snapshot)
        || !Array.isArray(snapshot.models)
      ) {
        throw new Error('Invalid model snapshot');
      }

      if ('baseUrl' in snapshot && typeof snapshot.baseUrl === 'string' && snapshot.baseUrl !== baseUrl) {
        throw new Error(`Snapshot was generated for ${snapshot.baseUrl}, expected ${baseUrl}`);
      }

      const grouped = groupModels(
        snapshot.models as RawModelEntry[],
        isAllowed,
        CODEX_CLIENT_VERSION,
        DEFAULT_FRIENDLY_MODEL_IDS,
        (m) => buildModel({ ...m, provider: 'omniroute', baseUrl })
      );
      activeAliases = grouped.activeAliases;
      initialModels = runtimeModels(grouped.models);

      if (initialModels.length === 0) {
        throw new Error('Empty model snapshot');
      }
      process.stderr.write('OmniRoute discovery unavailable; using the last filtered catalog.\n');
    } catch {
      throw discoveryError;
    }
  }

  const ompApiKey = process.env.OMNIROUTE_API_KEY ? 'OMNIROUTE_API_KEY' : `!cat '${keyPath}'`;

  pi.registerProvider('omniroute', {
    baseUrl,
    api: codexApi,
    streamSimple: (model: unknown, context: unknown, options: unknown) => {
      return codexStream(model, context, (options || {}) as StreamOptions);
    },
    apiKey: ompApiKey,
    authHeader: true,
    models: initialModels,
    fetchDynamicModels: fetchModels,
  });
}
