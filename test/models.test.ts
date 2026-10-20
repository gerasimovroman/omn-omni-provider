import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAllowedFilter,
  normalize,
  groupModels,
  upstreamPayload,
  DEFAULT_FRIENDLY_MODEL_IDS,
} from '../src/models.ts';
import type { RawModelEntry } from '../src/types.ts';

test('createAllowedFilter filters models correctly', () => {
  const allowed = createAllowedFilter({
    models: ['codex/blocked-model'],
    modelFamilies: ['gpt-5.6'],
  });

  assert.equal(allowed('codex/gpt-6.1-sol'), true);
  assert.equal(allowed('agy/gemini-3.8-flash'), true);
  assert.equal(allowed('openai/gpt-4o'), false);
  assert.equal(allowed('anthropic/claude-3-opus'), false);
  assert.equal(allowed('codex/blocked-model'), false);
  assert.equal(allowed('codex/blocked-model-high'), false);
  assert.equal(allowed('codex/gpt-5.6-turbo'), false);
  assert.equal(allowed('codex/gpt-5.6:latest'), false);
});

test('normalize configures codex responses and agy completions', () => {
  const codexEntry: RawModelEntry = {
    id: 'codex/test-model',
    name: 'Codex Test',
    capabilities: {
      tool_calling: true,
      vision: true,
      effort_tiers: ['low', 'medium', 'high'],
    },
    context_length: 128000,
    max_output_tokens: 4096,
  };

  const normalizedCodex = normalize(codexEntry, '1.2.3');
  assert.equal(normalizedCodex.api, 'openai-responses');
  assert.equal(normalizedCodex.headers?.version, '1.2.3');
  assert.equal(normalizedCodex.thinking?.requiresEffort, true);
  assert.deepEqual(normalizedCodex.thinking?.efforts, ['low', 'medium', 'high']);
  assert.equal(normalizedCodex.contextWindow, 128000);
  assert.equal(normalizedCodex.maxTokens, 4096);
  assert.deepEqual(normalizedCodex.input, ['text', 'image']);

  const agyEntry: RawModelEntry = {
    id: 'agy/gemini-flash',
    capabilities: {
      tool_calling: false,
      effort_tiers: ['off', 'low', 'high'],
    },
  };
  const normalizedAgy = normalize(agyEntry);
  assert.equal(normalizedAgy.api, 'openai-completions');
  assert.equal(normalizedAgy.thinking?.requiresEffort, false);
  assert.equal(normalizedAgy.compat.reasoningDisableMode, 'none-effort');
});

test('groupModels combines sibling efforts and calculates minimum context window', () => {
  const allowed = createAllowedFilter({ models: [], modelFamilies: [] });
  const entries: RawModelEntry[] = [
    {
      id: 'codex/gpt-test',
      capabilities: {
        reasoning: true,
        tool_calling: true,
        effort_tiers: ['low', 'medium', 'high'],
      },
      context_length: 200000,
      max_output_tokens: 8192,
    },
    {
      id: 'codex/gpt-test-low',
      capabilities: {
        reasoning: true,
        tool_calling: true,
        effort_tiers: ['low', 'medium', 'high'],
      },
      context_length: 180000,
      max_output_tokens: 8192,
    },
    {
      id: 'codex/gpt-test-high',
      capabilities: {
        reasoning: true,
        tool_calling: true,
        effort_tiers: ['low', 'medium', 'high'],
      },
      context_length: 190000,
      max_output_tokens: 8192,
    },
    {
      id: 'codex/gpt-test-ultra',
      capabilities: {
        reasoning: true,
        tool_calling: true,
        effort_tiers: ['low', 'medium', 'high'],
      },
      context_length: 200000,
      max_output_tokens: 8192,
    },
  ];

  const result = groupModels(entries, allowed);
  assert.equal(result.models.length, 2);

  const base = result.models.find(model => model.id === 'codex/gpt-test');
  assert.ok(base);
  assert.equal(base.contextWindow, 180000);
  assert.deepEqual(base.thinking?.effortRouting, {
    low: 'codex/gpt-test-low',
    high: 'codex/gpt-test-high',
  });

  const ultra = result.models.find(model => model.id === 'codex/gpt-test-ultra');
  assert.ok(ultra);
  assert.equal(result.keptSeparate.length, 1);
  assert.equal(result.keptSeparate[0].id, 'codex/gpt-test-ultra');
});

test('upstreamPayload routes codex reasoning effort and friendly aliases', () => {
  const activeAliases = {
    'agy/gemini-3.8-flash': 'agy/gemini-3.8-flash-tiered',
  };

  const codexModel = {
    provider: 'omniroute',
    id: 'codex/gpt-test',
    thinking: {
      mode: 'effort',
      efforts: ['low', 'high'],
      requiresEffort: true,
      effortRouting: {
        low: 'codex/gpt-test-low',
        high: 'codex/gpt-test-high',
      },
    },
  };

  const codexPayload = {
    model: 'codex/gpt-test',
    reasoning: { effort: 'high' },
  };

  const routedCodex = upstreamPayload(codexPayload, codexModel, activeAliases);
  assert.ok(routedCodex && typeof routedCodex === 'object' && 'model' in routedCodex);
  assert.equal(routedCodex.model, 'codex/gpt-test-high');

  const agyModel = {
    provider: 'omniroute',
    id: 'agy/gemini-3.8-flash',
  };
  const agyPayload = {
    model: 'agy/gemini-3.8-flash',
    messages: [],
  };

  const routedAgy = upstreamPayload(agyPayload, agyModel, activeAliases);
  assert.ok(routedAgy && typeof routedAgy === 'object' && 'model' in routedAgy);
  assert.equal(routedAgy.model, 'agy/gemini-3.8-flash-tiered');

  const externalModel = {
    provider: 'anthropic',
    id: 'claude-3-opus',
  };
  const externalPayload = {
    model: 'claude-3-opus',
  };
  const untouched = upstreamPayload(externalPayload, externalModel, activeAliases);
  assert.deepEqual(untouched, externalPayload);
});
