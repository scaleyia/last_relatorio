import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFromPrints, listModels, identifyImage } from './lib/extract.js';
import { buildHtml, reportFilename } from './lib/report.js';
import { htmlToPdf, closeBrowser } from './lib/pdf.js';
import { readSettings, writeSettings, clearApiKey, getApiKey, getModel, maskKey } from './lib/settings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLIENTS_FILE = path.join(HERE, 'data', 'clients.json');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(HERE, 'public')));
app.use('/assets', express.static(path.join(HERE, 'assets')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB por print
});

// ---- Aviso se a chave não estiver configurada ----
if (!getApiKey()) {
  console.warn(
    '\n⚠️  Sem chave da OpenAI ainda. Cole sua API key direto na interface (painel "Configurações").\n'
  );
}

// ---------- Configurações (chave + modelo) ----------
app.get('/api/settings', (_req, res) => {
  const s = readSettings();
  const key = getApiKey();
  res.json({
    hasKey: !!key,
    keyMasked: maskKey(key),
    keyFromEnv: !s.apiKey && !!process.env.OPENAI_API_KEY,
    model: getModel(),
  });
});

app.post('/api/settings', (req, res) => {
  const { apiKey, model } = req.body || {};
  writeSettings({ apiKey, model });
  const key = getApiKey();
  res.json({ hasKey: !!key, keyMasked: maskKey(key), model: getModel() });
});

// Remove a chave salva (settings.json). Se houver chave no .env, ela continua valendo.
app.delete('/api/settings/key', (_req, res) => {
  clearApiKey();
  const s = readSettings();
  const key = getApiKey();
  res.json({
    hasKey: !!key,
    keyMasked: maskKey(key),
    keyFromEnv: !s.apiKey && !!process.env.OPENAI_API_KEY,
    model: getModel(),
  });
});

// Lista de modelos disponíveis (da conta do usuário, com fallback)
app.get('/api/models', async (_req, res) => {
  const result = await listModels();
  res.json({ ...result, current: getModel() });
});

// ---------- Clientes ----------
function readClients() {
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}
function writeClients(list) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(list, null, 2));
}

app.get('/api/clients', (_req, res) => {
  res.json(readClients());
});

// Cria ou atualiza um cliente (por nome). Body: {nome, gestor, semCustoPorConversao}
app.post('/api/clients', (req, res) => {
  const { nome, gestor, semCustoPorConversao } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
  const list = readClients();
  const i = list.findIndex((c) => c.nome.toLowerCase() === nome.trim().toLowerCase());
  const entry = {
    nome: nome.trim(),
    gestor: (gestor || '').trim(),
    semCustoPorConversao: !!semCustoPorConversao,
  };
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  writeClients(list);
  res.json(entry);
});

app.delete('/api/clients/:nome', (req, res) => {
  const nome = decodeURIComponent(req.params.nome);
  const list = readClients().filter((c) => c.nome.toLowerCase() !== nome.toLowerCase());
  writeClients(list);
  res.json({ ok: true });
});

// ---------- Extração dos prints ----------
app.post('/api/extract', upload.array('prints', 2), async (req, res) => {
  try {
    if (!getApiKey()) {
      return res.status(500).json({ error: 'Cole sua API key da OpenAI no painel "Configurações" antes de ler os prints.' });
    }
    const files = req.files || [];
    if (files.length < 2) {
      return res.status(400).json({ error: 'Envie os 2 prints (visão geral + tabela de leilão).' });
    }
    const cliente = req.body.cliente || '';
    const semCustoPorConversao = req.body.semCustoPorConversao === 'true';

    const dados = await extractFromPrints({ files, cliente, semCustoPorConversao });
    res.json(dados);
  } catch (err) {
    console.error('Erro na extração:', err);
    res.status(500).json({ error: err.message || 'Falha ao ler os prints.' });
  }
});

// ---------- Identificação de 1 print (geração em massa) ----------
app.post('/api/identify', upload.single('print'), async (req, res) => {
  try {
    if (!getApiKey()) {
      return res.status(500).json({ error: 'Configure a API key no painel "Configurações".' });
    }
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
    const data = await identifyImage({ file: req.file });
    res.json(data);
  } catch (err) {
    console.error('Erro na identificação:', err);
    res.status(500).json({ error: err.message || 'Falha ao identificar o print.' });
  }
});

// ---------- Geração do PDF ----------
app.post('/api/generate', async (req, res) => {
  try {
    const cfg = req.body;
    if (!cfg || !cfg.cliente || !cfg.metricas || !cfg.leilao) {
      return res.status(400).json({ error: 'Dados incompletos para gerar o relatório.' });
    }
    const html = buildHtml(cfg);
    const pdf = await htmlToPdf(html);
    const filename = reportFilename(cfg);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="relatorio.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(pdf);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    res.status(500).json({ error: err.message || 'Falha ao gerar o PDF.' });
  }
});

// Pré-visualização HTML (útil para conferir o layout sem baixar o PDF)
app.post('/api/preview', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildHtml(req.body));
  } catch (err) {
    res.status(500).send(String(err));
  }
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, hasKey: !!getApiKey(), model: getModel() })
);

const server = app.listen(PORT, () => {
  console.log(`\n✅ Gerador de Relatórios LastOne rodando em  http://localhost:${PORT}\n`);
});

process.on('SIGINT', async () => {
  await closeBrowser();
  server.close(() => process.exit(0));
});
