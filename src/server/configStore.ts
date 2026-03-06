import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

export interface ServerConfig {
  openaiApiKey?: string;
  openaiModel?: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadConfig(): ServerConfig {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as ServerConfig;
  } catch (err) {
    console.warn("[configStore] 读取 config.json 失败，将使用空配置：", err);
    return {};
  }
}

export function saveConfig(config: ServerConfig) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

