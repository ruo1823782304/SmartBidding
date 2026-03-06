import OpenAI from "openai";
import { loadConfig, saveConfig, ServerConfig } from "./configStore";

let cachedConfig: ServerConfig | null = null;

function getConfig(): ServerConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function updateConfig(partial: ServerConfig) {
  const current = getConfig();
  const next: ServerConfig = { ...current, ...partial };
  cachedConfig = next;
  saveConfig(next);
}

export function getOpenAIClient(): OpenAI {
  const cfg = getConfig();
  const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 OpenAI API Key，请先在管理界面填写。");
  }
  return new OpenAI({ apiKey });
}

export function getDefaultModel(): string {
  const cfg = getConfig();
  return cfg.openaiModel || process.env.OPENAI_MODEL || "gpt-4o";
}

export const DEFAULT_MODEL = getDefaultModel();


