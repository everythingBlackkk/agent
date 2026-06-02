// Build the right Client from the parsed Config.

import type { Config } from '../config/config.js';
import type { Client } from './client.js';
import { CodexCliClient, assertCodexCliAvailable } from './codexCli.js';
import { CopilotCliClient, assertCopilotCliAvailable } from './copilotCli.js';
import { GeminiCliClient, assertGeminiCliAvailable } from './geminiCli.js';
import { OllamaClient } from './ollama.js';
import { OpenAIClient } from './openai.js';

export function newFromConfig(cfg: Config): Client {
  switch (cfg.backend) {
    case 'ollama':
    case '':
      return new OllamaClient(cfg.base_url, cfg.model);
    case 'lmstudio':
      return OpenAIClient.lmStudio(cfg.base_url, cfg.model);
    case 'openai-compat':
      if (!cfg.base_url) {
        throw new Error('openai-compat backend requires base_url');
      }
      return new OpenAIClient(cfg.base_url, cfg.api_key, cfg.model, 'openai-compat');
    case 'codex-cli':
      assertCodexCliAvailable(cfg.codexCli.command);
      return new CodexCliClient(cfg);
    case 'gemini-cli':
      assertGeminiCliAvailable(cfg.geminiCli.command);
      return new GeminiCliClient(cfg);
    case 'copilot-cli':
      assertCopilotCliAvailable(cfg.copilotCli.command);
      return new CopilotCliClient(cfg);
    default: {
      const _exhaustive: never = cfg.backend;
      throw new Error(`unknown backend: ${String(_exhaustive)}`);
    }
  }
}
