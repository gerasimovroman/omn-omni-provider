import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Exclusions, OmniRouteConfig } from './types.js';

export function readExclusions(path: string): Exclusions {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return {
        models: [],
        modelFamilies: [],
      };
    }
    throw new Error(`OmniRoute: cannot read exclusions file ${path}`);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`OmniRoute: invalid JSON in ${path}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`OmniRoute: exclusions in ${path} must be a JSON object`);
  }

  const container = parsed as Record<string, unknown>;
  const models: string[] = [];
  if ('models' in container && container.models !== undefined) {
    if (!Array.isArray(container.models) || container.models.some((item: unknown) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`OmniRoute: models in ${path} must be an array of non-empty strings`);
    }
    for (const item of container.models) {
      models.push(item as string);
    }
  }

  const modelFamilies: string[] = [];
  if ('modelFamilies' in container && container.modelFamilies !== undefined) {
    if (!Array.isArray(container.modelFamilies) || container.modelFamilies.some((item: unknown) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`OmniRoute: modelFamilies in ${path} must be an array of non-empty strings`);
    }
    for (const item of container.modelFamilies) {
      modelFamilies.push(item as string);
    }
  }

  return {
    models,
    modelFamilies,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, home = homedir()): OmniRouteConfig {
  const customStateDir = env.OMNIROUTE_STATE_DIR;
  const directory = resolve(customStateDir || join(home, '.omp', 'agent', 'omniroute'));
  const configPath = join(directory, 'config.json');

  let localConfig: Record<string, unknown> = {};
  try {
    const rawLocal: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    if (typeof rawLocal === 'object' && rawLocal !== null && !Array.isArray(rawLocal)) {
      localConfig = rawLocal as Record<string, unknown>;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') {
      throw new Error(`OmniRoute: cannot parse configuration ${configPath}`);
    }
  }

  const configuredUrl = typeof localConfig.baseUrl === 'string' ? localConfig.baseUrl : undefined;
  const rawUrl = env.OMNIROUTE_BASE_URL || configuredUrl;
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      `OmniRoute: set OMNIROUTE_BASE_URL environment variable (including /v1) or baseUrl in ${configPath}`
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error(`OmniRoute: base URL must be an absolute HTTP(S) URL, received: ${rawUrl}`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`OmniRoute: base URL must use HTTP or HTTPS protocol, received: ${parsedUrl.protocol}`);
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error('OmniRoute: base URL must not contain credentials, query parameters, or fragments');
  }

  const baseUrl = parsedUrl.href.replace(/\/+$/, '');
  const customKeyFile = env.OMNIROUTE_API_KEY_FILE;
  const keyPath = resolve(customKeyFile || join(home, '.omp', 'secrets', 'omniroute.key'));
  const disableBuiltinProviders = env.OMNIROUTE_DISABLE_BUILTIN_PROVIDERS === '1'
    || localConfig.disableBuiltinProviders === true;

  const exclusions = readExclusions(join(directory, 'excluded-models.json'));

  return {
    baseUrl,
    directory,
    keyPath,
    disableBuiltinProviders,
    exclusions,
  };
}

export function readApiKey(keyPath: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.OMNIROUTE_API_KEY !== undefined) {
    const key = env.OMNIROUTE_API_KEY.trim();
    if (!key) {
      throw new Error('OmniRoute: OMNIROUTE_API_KEY environment variable is set but empty');
    }
    return key;
  }

  let key = '';
  try {
    key = readFileSync(keyPath, 'utf8').trim();
  } catch {
    throw new Error(
      `OmniRoute: set OMNIROUTE_API_KEY environment variable or provide a readable key file at ${keyPath}`
    );
  }

  if (!key) {
    throw new Error(`OmniRoute: key file is empty: ${keyPath}`);
  }

  return key;
}
