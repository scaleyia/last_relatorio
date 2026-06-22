// Configurações persistidas (chave da OpenAI + modelo escolhido).
// Guardadas em data/settings.json. Tem prioridade sobre as variáveis de ambiente.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'data', 'settings.json');

const DEFAULT_MODEL = 'gpt-5.4-mini';

// Lista de fallback (quando ainda não há chave para consultar a conta).
export const FALLBACK_MODELS = [
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-4o',
];

export function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return {};
  }
}

// No Vercel/serverless o disco é somente-leitura (a chave vem da env var),
// então as gravações são tolerantes a falha.
export const READONLY_FS = !!(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
);

function safeWrite(obj) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
    return true;
  } catch {
    return false; // disco só-leitura (Vercel) — ignora
  }
}

export function writeSettings(patch) {
  const cur = readSettings();
  const next = { ...cur };
  // só sobrescreve a chave se vier uma não-vazia
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    next.apiKey = patch.apiKey.trim();
  }
  if (typeof patch.model === 'string' && patch.model.trim()) {
    next.model = patch.model.trim();
  }
  safeWrite(next);
  return next;
}

export function clearApiKey() {
  const cur = readSettings();
  delete cur.apiKey;
  safeWrite(cur);
  return cur;
}

export function getApiKey() {
  return readSettings().apiKey || process.env.OPENAI_API_KEY || '';
}

export function getModel() {
  return readSettings().model || process.env.OPENAI_MODEL || process.env.MODEL || DEFAULT_MODEL;
}

export function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '••••';
  return k.slice(0, 6) + '••••••' + k.slice(-4);
}
