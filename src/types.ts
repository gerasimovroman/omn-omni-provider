export interface Exclusions {
  models: string[];
  modelFamilies: string[];
}

export interface OmniRouteConfig {
  baseUrl: string;
  directory: string;
  keyPath: string;
  disableBuiltinProviders: boolean;
  exclusions: Exclusions;
}

export interface RawModelCapability {
  vision?: boolean;
  tool_calling?: boolean;
  reasoning?: boolean;
  thinking?: boolean;
  supportsThinking?: boolean;
  effort_tiers?: string[];
}

export interface RawModelEntry {
  id: string;
  name?: string;
  capabilities?: RawModelCapability;
  input_modalities?: string[];
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
}

export interface ModelThinkingConfig {
  mode: 'effort';
  efforts: string[];
  requiresEffort: boolean;
  effortRouting?: Record<string, string>;
}

export interface NormalizedModel {
  id: string;
  name: string;
  api: 'openai-responses' | 'openai-completions';
  headers?: Record<string, string>;
  compat: {
    supportsReasoningEffort: boolean;
    omitReasoningEffort: boolean;
    statefulResponses?: boolean;
    supportsConfigurationUpdate?: boolean;
    supportsStrictMode?: boolean;
    reasoningDisableMode?: string;
  };
  reasoning: boolean;
  thinking?: ModelThinkingConfig;
  input: string[];
  supportsTools?: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface GroupedModelsResult {
  models: NormalizedModel[];
  families: Record<string, Record<string, string>>;
  contextWindows: Record<string, Record<string, number>>;
  keptSeparate: Array<{ id: string; reason: string }>;
}
