# OmniRoute Provider for Oh My Pi (OMP)

OmniRoute provider plugin and extension for **Oh My Pi (OMP)**. It integrates an OmniRoute gateway directly into OMP, exposing models from the `codex/` and `agy/` families with automatic effort-tier grouping, reasoning routing, and resilient catalog caching.

## Features

- **Dual API routing:** Uses OpenAI Responses API for `codex/` models and Chat Completions for `agy/` (Antigravity/Gemini) models.
- **Effort-tier grouping:** Combines advertised effort variants (`-minimal`, `-low`, `-medium`, `-high`, `-xhigh`, `-max`) into a canonical base model. `codex/` routes to effort-specific IDs; `agy/` sends the selected model's upstream ID with a separate `reasoning_effort`, avoiding synthetic tier IDs rejected by Antigravity's live catalog.
- **Safe context window calculation:** In groups with differing variant capacities, automatically adopts the minimum advertised context length to prevent prompt overflows.
- **Resilient catalog cache:** Discovers available models on startup and caches them locally. If the gateway is temporarily offline, OMP boots cleanly using the last filtered catalog snapshot.
- **Strict configuration & security:** No hardcoded endpoints or credentials. Zero telemetry leaks. Supports custom local LAN Root CAs via standard `NODE_EXTRA_CA_CERTS`.

## Installation

### From GitHub

```sh
omp plugin install github:gerasimovroman/omn-omni-provider
```

### Local Development / From Source

```sh
git clone https://github.com/gerasimovroman/omn-omni-provider.git
cd omn-omni-provider
omp plugin link "$PWD"
```

Restart OMP after linking or updating files.

## Configuration

The extension requires an OmniRoute gateway URL and an API key.

### 1. Gateway Base URL

Set the base URL (including `/v1`) using either:
- The `OMNIROUTE_BASE_URL` environment variable:
  ```sh
  export OMNIROUTE_BASE_URL="https://192.168.1.67:444/v1"
  ```
- Or a `config.json` file in `~/.omp/agent/omniroute/config.json`:
  ```json
  {
    "baseUrl": "https://192.168.1.67:444/v1"
  }
  ```

### 2. API Key

Set the API key using either:
- The `OMNIROUTE_API_KEY` environment variable:
  ```sh
  export OMNIROUTE_API_KEY="your-omniroute-api-key"
  ```
- Or a key file at `~/.omp/secrets/omniroute.key` (permission `0600`):
  ```sh
  mkdir -p ~/.omp/secrets
  echo "your-omniroute-api-key" > ~/.omp/secrets/omniroute.key
  chmod 600 ~/.omp/secrets/omniroute.key
  ```
- Or point to a custom key file path via `OMNIROUTE_API_KEY_FILE`.

### 3. Optional Model Exclusions

To exclude specific models or entire model families, create `excluded-models.json` inside `~/.omp/agent/omniroute/`:

```json
{
  "models": [
    "codex/model-id-to-exclude"
  ],
  "modelFamilies": [
    "gpt-5.6"
  ]
}
```

- `models`: Excludes exact model IDs and their effort aliases (e.g., `-high`, `-medium`).
- `modelFamilies`: Excludes any model name beginning with the specified prefix (e.g., `gpt-5.6`).

### 4. Custom State Directory

By default, discovery logs and catalog snapshots are stored in `~/.omp/agent/omniroute`. Override this by setting `OMNIROUTE_STATE_DIR`.

## Usage

Once installed and configured, verify available models in OMP:

```sh
# Refresh models from the gateway
omp models refresh

# List discovered OmniRoute models
omp models omniroute

# Launch OMP with an OmniRoute model
omp --model omniroute/codex/gpt-6.1-sol --thinking medium
```

## Running Tests

Unit tests run using Node's built-in test runner without external dependencies:

```sh
npm test
```

## Compatibility

- Tested with **Oh My Pi (OMP)** `v18.12.3` and `v18.12.4`.
- Requires Node.js `>= 22.18.0`.

## License

MIT
