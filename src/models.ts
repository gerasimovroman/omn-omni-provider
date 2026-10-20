import type {
  Exclusions,
  GroupedModelsResult,
  ModelThinkingConfig,
  NormalizedModel,
  RawModelEntry,
} from './types.js';

export const DEFAULT_FRIENDLY_MODEL_IDS: Record<string, string> = {
  'agy/gemini-3.8-flash-tiered': 'agy/gemini-3.8-flash',
  'agy/gemini-3.1-pro-high': 'agy/gemini-3.1-pro',
  'agy/gemini-4-argon-disabled': 'agy/gemini-4-argon',
};

const supportedEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

export function createAllowedFilter(exclusions: Exclusions) {
  const excludedModelIds = new Set<string>(exclusions.models);
  const excludedModelFamilies = exclusions.modelFamilies;

  return function isModelAllowed(id: unknown): id is string {
    if (typeof id !== 'string' || !/^(codex|agy)\//.test(id)) {
      return false;
    }
    const name = id.slice(id.indexOf('/') + 1);
    for (const family of excludedModelFamilies) {
      if (name === family || name.startsWith(`${family}-`) || name.startsWith(`${family}:`)) {
        return false;
      }
    }
    const base = id.replace(/-(minimal|low|medium|high|xhigh|max|ultra|none|off)$/, '');
    if (excludedModelIds.has(id) || excludedModelIds.has(base)) {
      return false;
    }
    return true;
  };
}

export function normalize(entry: RawModelEntry, codexVersion?: string): NormalizedModel {
  const caps = entry.capabilities || {};
  const isCodex = typeof entry.id === 'string' && entry.id.startsWith('codex/');

  let input: string[] = ['text'];
  if (Array.isArray(entry.input_modalities)) {
    input = entry.input_modalities.filter(item => item === 'text' || item === 'image');
  } else if (caps.vision === true) {
    input = ['text', 'image'];
  }

  const efforts: string[] = [];
  if (Array.isArray(caps.effort_tiers)) {
    for (const tier of caps.effort_tiers) {
      if (['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(tier)) {
        efforts.push(tier);
      }
    }
  }

  const supportsOff = Array.isArray(caps.effort_tiers)
    && caps.effort_tiers.some(item => item === 'none' || item === 'off');

  const headers: Record<string, string> = {};
  if (isCodex && codexVersion) {
    headers.version = codexVersion;
  }

  const normalized: NormalizedModel = {
    id: entry.id,
    name: typeof entry.name === 'string' ? entry.name : entry.id,
    api: isCodex ? 'openai-responses' : 'openai-completions',
    compat: {
      supportsReasoningEffort: true,
      omitReasoningEffort: false,
      ...(isCodex ? {
        statefulResponses: false,
        supportsConfigurationUpdate: false,
        supportsStrictMode: true,
      } : {}),
      ...(supportsOff ? { reasoningDisableMode: 'none-effort' } : {}),
    },
    reasoning: typeof caps.reasoning === 'boolean'
      ? caps.reasoning
      : (caps.thinking === true || caps.supportsThinking === true),
    input,
    contextWindow: parsePositiveNumber(entry.context_length ?? entry.max_input_tokens),
    maxTokens: parsePositiveNumber(entry.max_output_tokens),
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  };

  if (Object.keys(headers).length > 0) {
    normalized.headers = headers;
  }

  if (typeof caps.tool_calling === 'boolean') {
    normalized.supportsTools = caps.tool_calling;
  }

  if (efforts.length > 0) {
    normalized.thinking = {
      mode: 'effort',
      efforts,
      requiresEffort: !supportsOff,
    };
  }

  return normalized;
}

export function presentModels(
  models: NormalizedModel[],
  friendlyAliases: Record<string, string> = DEFAULT_FRIENDLY_MODEL_IDS,
  buildModelFn?: (model: NormalizedModel) => { thinking?: ModelThinkingConfig }
): { models: NormalizedModel[]; activeAliases: Record<string, string> } {
  const existingIds = new Set(models.map(model => model.id));
  const aliases: Record<string, string> = {};

  const transformed = models.map(model => {
    const aliasId = friendlyAliases[model.id];
    if (!aliasId || existingIds.has(aliasId)) {
      return model;
    }
    aliases[aliasId] = model.id;

    let thinking = model.thinking;
    if (!thinking && buildModelFn) {
      thinking = buildModelFn(model).thinking;
    }

    let defaultRoutes: Record<string, string> | undefined;
    if (thinking) {
      defaultRoutes = { off: model.id };
      for (const effort of thinking.efforts) {
        defaultRoutes[effort] = model.id;
      }
    }

    const updatedThinking = thinking ? {
      ...thinking,
      effortRouting: {
        ...defaultRoutes,
        ...thinking.effortRouting,
      },
    } : undefined;

    return {
      ...model,
      id: aliasId,
      name: aliasId.slice(aliasId.indexOf('/') + 1),
      ...(updatedThinking ? { thinking: updatedThinking } : {}),
    };
  });

  return {
    models: transformed,
    activeAliases: aliases,
  };
}

export function upstreamPayload(
  payload: unknown,
  model: unknown,
  activeAliases: Record<string, string>
): unknown {
  if (payload === null || typeof payload !== 'object') {
    return payload;
  }
  if (model === null || typeof model !== 'object') {
    return payload;
  }

  const modelRecord = model as Record<string, unknown>;
  if (modelRecord.provider !== 'omniroute') {
    return payload;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const modelId = typeof modelRecord.id === 'string' ? modelRecord.id : '';
  const thinking = modelRecord.thinking as ModelThinkingConfig | undefined;

  let routed: string | undefined;
  if (modelId.startsWith('codex/') && thinking?.effortRouting) {
    const reasoning = payloadRecord.reasoning as Record<string, unknown> | undefined;
    const effort = typeof reasoning?.effort === 'string' ? reasoning.effort : 'off';
    routed = thinking.effortRouting[effort];
  }

  const requestedModel = typeof payloadRecord.model === 'string' ? payloadRecord.model : undefined;
  const alias = requestedModel ? activeAliases[requestedModel] : undefined;
  const wire = routed || alias;

  if (wire) {
    return {
      ...payloadRecord,
      model: wire,
    };
  }

  return payload;
}

function computeSignature(model: NormalizedModel): string {
  return JSON.stringify({
    reasoning: model.reasoning,
    input: model.input,
    supportsTools: model.supportsTools,
    maxTokens: model.maxTokens,
    cost: model.cost,
    thinking: model.thinking,
  });
}

export function groupModels(
  entries: RawModelEntry[],
  allowed: (id: unknown) => id is string,
  codexVersion?: string,
  friendlyAliases: Record<string, string> = DEFAULT_FRIENDLY_MODEL_IDS,
  buildModelFn?: (model: NormalizedModel) => { thinking?: ModelThinkingConfig }
): GroupedModelsResult & { activeAliases: Record<string, string> } {
  const allowedEntries = entries.filter(item => allowed(item?.id));
  const uniqueMap = new Map<string, RawModelEntry>();
  for (const entry of allowedEntries) {
    uniqueMap.set(entry.id, entry);
  }
  const unique = Array.from(uniqueMap.values());

  const rawById = new Map<string, RawModelEntry>();
  for (const entry of unique) {
    rawById.set(entry.id, entry);
  }

  const models = new Map<string, NormalizedModel>();
  for (const entry of unique) {
    models.set(entry.id, normalize(entry, codexVersion));
  }

  const consumed = new Set<string>();
  const families = new Map<string, Record<string, string>>();
  const contextWindows = new Map<string, Record<string, number>>();
  const keptSeparate: Array<{ id: string; reason: string }> = [];

  for (const entry of unique) {
    const match = /^(.*)-(minimal|low|medium|high|xhigh|max|ultra)$/.exec(entry.id);
    if (!match) {
      continue;
    }
    const [, stem, effort] = match;
    const base = rawById.get(stem) || rawById.get(`${stem}-tiered`);
    if (!base) {
      continue;
    }
    if (!supportedEfforts.includes(effort)) {
      keptSeparate.push({ id: entry.id, reason: 'Effort not supported by this OMP version' });
      continue;
    }

    const baseModel = models.get(base.id);
    const variantModel = normalize(entry, codexVersion);
    const baseNormalized = normalize(base, codexVersion);

    const compatibleContext = baseNormalized.contextWindow === variantModel.contextWindow
      || (baseNormalized.contextWindow !== null && variantModel.contextWindow !== null);

    const baseHasEffort = baseModel?.thinking?.efforts.includes(effort) ?? false;
    const matchSignature = computeSignature(baseNormalized) === computeSignature(variantModel);

    if (!baseHasEffort || !compatibleContext || !matchSignature) {
      keptSeparate.push({
        id: entry.id,
        reason: 'Different advertised limits/capabilities, or effort not advertised by base',
      });
      continue;
    }

    const routes = families.get(base.id) || {};
    routes[effort] = entry.id;
    families.set(base.id, routes);

    if (baseNormalized.contextWindow !== null && variantModel.contextWindow !== null) {
      const limits = contextWindows.get(base.id) || { [base.id]: baseNormalized.contextWindow };
      limits[entry.id] = variantModel.contextWindow;
      contextWindows.set(base.id, limits);
    }
    consumed.add(entry.id);
  }

  for (const [id, routes] of families.entries()) {
    const model = models.get(id);
    if (model && model.thinking) {
      model.thinking = {
        ...model.thinking,
        effortRouting: routes,
      };
      const limits = contextWindows.get(id);
      if (limits) {
        model.contextWindow = Math.min(...Object.values(limits));
      }
    }
  }

  const remainingModels = Array.from(models.values()).filter(model => !consumed.has(model.id));
  const presented = presentModels(remainingModels, friendlyAliases, buildModelFn);

  return {
    models: presented.models,
    activeAliases: presented.activeAliases,
    families: Object.fromEntries(families),
    contextWindows: Object.fromEntries(contextWindows),
    keptSeparate,
  };
}
