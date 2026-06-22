// Lê os 2 prints do Google Ads com a OpenAI API (visão) e devolve os dados
// já estruturados no formato do relatório LastOne. As regras vêm da skill
// `relatorio-google-ads-lastone`.

import OpenAI from 'openai';
import { getApiKey, getModel, FALLBACK_MODELS } from './settings.js';

// Cria o cliente com a chave atual (das configurações ou do ambiente).
function makeClient() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Chave da OpenAI não configurada.');
  return new OpenAI({ apiKey });
}

// Lista os modelos da conta do usuário, filtrando para os de chat/visão.
// Cai no fallback se não houver chave ou a consulta falhar.
export async function listModels() {
  const apiKey = getApiKey();
  if (!apiKey) return { models: FALLBACK_MODELS, source: 'fallback' };
  try {
    const client = new OpenAI({ apiKey });
    const res = await client.models.list();
    const skip = /(embedding|tts|whisper|audio|realtime|image|moderation|search|transcribe|dall|sora|babbage|davinci|ada|curie)/i;
    const ids = res.data
      .map((m) => m.id)
      .filter((id) => /^(gpt-|o\d|chatgpt)/i.test(id) && !skip.test(id))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    return { models: ids.length ? ids : FALLBACK_MODELS, source: ids.length ? 'account' : 'fallback' };
  } catch (e) {
    return { models: FALLBACK_MODELS, source: 'fallback', error: e.message };
  }
}

// JSON Schema (strict) que força a resposta a sair parseável e no formato certo.
// No modo strict da OpenAI, TODO objeto precisa de additionalProperties:false
// e de todas as chaves em "required".
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    periodo: {
      type: 'string',
      description: 'Período exato como aparece no print, ex.: "1 a 31 mai. 2026" ou "13–31 Maio 2026".',
    },
    metricas: {
      type: 'array',
      description: 'Sempre 4 cards, na ordem padrão.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          value: { type: 'string', description: 'Número exato do print, ex.: "284" ou "7,67". Sem o "R$".' },
          cur: { type: 'boolean', description: 'true coloca "R$" antes do número.' },
          sub: { type: 'string', description: 'Linha pequena de contexto factual. Nunca invente comparativo.' },
        },
        required: ['label', 'value', 'cur', 'sub'],
      },
    },
    grafico: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subtitulo: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        valores: { type: 'array', items: { type: 'number' } },
      },
      required: ['subtitulo', 'labels', 'valores'],
    },
    leilao: {
      type: 'array',
      description: 'Todos os concorrentes do print, na mesma ordem (já vem ordenado por parcela de impressões).',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dominio: { type: 'string' },
          parcela: { type: 'string', description: 'Parcela de impressões, ex.: "48,72%" ou "< 10%".' },
          sobreposicao: { type: 'string' },
          posicaoAcima: { type: 'string', description: 'Taxa de posição superior.' },
          topo: { type: 'string', description: 'Taxa da parte superior da página.' },
          ehVoce: { type: 'boolean', description: 'true na linha do cliente (fica destacada em verde).' },
        },
        required: ['dominio', 'parcela', 'sobreposicao', 'posicaoAcima', 'topo', 'ehVoce'],
      },
    },
    passos: {
      type: 'array',
      description: 'Sempre 4 passos, baseados nos números reais.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tag: { type: 'string', description: 'Ex.: "Impacto alto", "Escala", "Posicionamento", "Eficiência", "Concorrência".' },
          titulo: { type: 'string' },
          texto: { type: 'string', description: '2 a 3 linhas, citando números reais.' },
        },
        required: ['tag', 'titulo', 'texto'],
      },
    },
    avisos: {
      type: 'array',
      description: 'Ressalvas de transparência para mostrar ao usuário (gráfico estimado, valor calculado, sem comparativo).',
      items: { type: 'string' },
    },
  },
  required: ['periodo', 'metricas', 'grafico', 'leilao', 'passos', 'avisos'],
};

const SYSTEM = `Você extrai dados de prints do Google Ads para o relatório mensal no padrão da agência LastOne (farmácias de manipulação). Leia os DOIS prints e devolva os números EXATAMENTE como aparecem.

Os prints normalmente são:
1. Visão geral / Resumo da performance — cards no topo (Conversões, Cliques, Custo/conv., CPC méd., Custo) + o período.
2. Informações do leilão — tabela com Domínio, Parcela de impressões, Taxa de sobreposição, Taxa de posição superior, Taxa da parte superior da página.

REGRAS DOS 4 CARDS DE MÉTRICA (sempre 4, nesta ordem por padrão):
Padrão: Conversões Totais · Custo por Conversão · CPC Médio · Investimento (Custo).
- Use os números EXATOS do print. cur=true coloca "R$" antes; conversões e cliques são cur=false.
- O Google às vezes mostra "R$ 1,73 mil" — converta para o valor cheio. A forma mais segura: Investimento = Custo/conversão × Conversões (ex.: 7,67 × 284 = 2.178; value "2.178").
- Se o print NÃO tiver card de CPC médio: calcule CPC = Custo ÷ Cliques e no sub escreva quantos cliques (ex.: "798 cliques no período"). Marque isso em "avisos".
- A linha sub é contexto factual ("média do período", "verba total aplicada", "conversões no período"). NUNCA invente comparativo "vs. período anterior".
- Labels sugeridas: "Conversões Totais", "Custo por Conversão", "CPC Médio", "Investimento (Custo)".

GRÁFICO — conversões por semana:
- O total das semanas DEVE somar o total de conversões do mês.
- Se o print não detalhar por semana, distribua o total de forma aproximada seguindo o formato da curva do print (3 a 5 blocos) e registre em "avisos" que é estimativa.
- Labels: mês cheio → "Semana 1".."Semana 4"; período parcial (ex.: 13–31) → faixas de data ("13–19 mai", "20–26 mai", "27–31 mai").
- subtitulo no formato "Conversões por semana — <período>".

INFORMAÇÕES DE LEILÃO:
- Liste TODOS os concorrentes do print, na MESMA ordem (já vem por parcela de impressões).
- A linha do cliente: dominio = "<Cliente> (você)" e ehVoce=true. O cliente nem sempre é o 1º.
- Copie 4 colunas: Parcela de impressões, Taxa de sobreposição (sobreposicao), Taxa de posição superior (posicaoAcima), Taxa da parte superior da página (topo).
- Use "—" onde o print mostra travessão e "< 10%" quando aparecer assim.

PRÓXIMOS PASSOS & OTIMIZAÇÕES (sempre 4): escreva COM BASE nos números reais, não genéricos.
- Parcela baixa / não é o 1º → "crescer/assumir a parcela de impressões" (tag "Impacto alto"), citando os líderes.
- 1ª posição / Topo baixos vs. concorrentes → "ganhar topo e 1ª posição" (tag "Posicionamento").
- CPC alto → "reduzir o CPC" (tag "Eficiência"). CPA (custo/conv.) alto → "otimizar o custo por conversão".
- CPA saudável + bom volume → "escalar mantendo a eficiência" (tag "Escala").
- Alta sobreposição de concorrentes → "monitorar concorrentes / defender termos de marca" (tag "Concorrência").
Textos curtos (2–3 linhas), citando números reais.

Devolva sempre os números no formato brasileiro (vírgula decimal) como no print.`;

function imageBlock(file) {
  const b64 = file.buffer.toString('base64');
  return {
    type: 'image_url',
    image_url: { url: `data:${file.mimetype || 'image/png'};base64,${b64}`, detail: 'high' },
  };
}

export async function extractFromPrints({ files, cliente, semCustoPorConversao, model }) {
  const prefPart = semCustoPorConversao
    ? 'PREFERÊNCIA DO CLIENTE: NÃO usar "Custo por Conversão". Troque esse 2º card por "Cliques" (label "Cliques", cur=false, sub "cliques no período").'
    : 'Use o card padrão "Custo por Conversão" como 2º card.';

  const userContent = [
    {
      type: 'text',
      text: `Cliente (farmácia): ${cliente || '(não informado — use o que aparecer no print)'}.
${prefPart}

Leia os dois prints anexados e devolva os dados estruturados conforme o schema. Em "leilao", a linha do cliente deve ter dominio "${cliente || '<Cliente>'} (você)" e ehVoce=true.`,
    },
    ...files.map(imageBlock),
  ];

  const resp = await makeClient().chat.completions.create({
    model: model || getModel(),
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userContent },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'relatorio_lastone', strict: true, schema: SCHEMA },
    },
  });

  const msg = resp.choices?.[0]?.message;
  if (msg?.refusal) {
    throw new Error('A IA recusou processar as imagens: ' + msg.refusal);
  }
  if (!msg?.content) throw new Error('A IA não retornou conteúdo.');
  return parseJson(msg.content);
}

// Identifica, em UM print, o nome do cliente e o tipo (visão geral / leilão).
// Usado na geração em massa para agrupar os prints por cliente sem depender do
// nome do arquivo.
const ID_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cliente: {
      type: 'string',
      description:
        'Nome da farmácia/cliente/conta exibido na imagem (ex.: no topo, no nome da conta do Google Ads, ou na linha "(você)" da tabela de leilão). Use o nome mais limpo possível. Vazio se realmente não aparecer.',
    },
    tipo: {
      type: 'string',
      enum: ['visao', 'leilao', 'outro'],
      description:
        "'visao' = tela de visão geral/resumo de performance (cards de Conversões/Custo/CPC); 'leilao' = tabela de Informações de leilão (concorrentes, parcela de impressões); 'outro' caso contrário.",
    },
  },
  required: ['cliente', 'tipo'],
};

const ID_SYSTEM = `Você recebe UM print do Google Ads de uma agência que atende farmácias de manipulação. Sua tarefa é só identificar:
1) cliente: o nome da farmácia/cliente/conta que aparece na imagem (cabeçalho da conta, título, ou a linha "<nome> (você)" na tabela de leilão). Devolva o nome curto e limpo (ex.: "Biothera", não "Biothera Farmácia de Manipulação Ltda" — mas mantenha o nome principal).
2) tipo: 'visao' (resumo de performance / cards) ou 'leilao' (tabela de informações de leilão) ou 'outro'.
Não invente: se o nome não aparecer, devolva cliente vazio.`;

export async function identifyImage({ file, model }) {
  const resp = await makeClient().chat.completions.create({
    model: model || getModel(),
    messages: [
      { role: 'system', content: ID_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Identifique o cliente e o tipo deste print.' },
          imageBlock(file),
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'identificacao', strict: true, schema: ID_SCHEMA },
    },
  });
  const msg = resp.choices?.[0]?.message;
  if (!msg?.content) throw new Error('Sem resposta na identificação.');
  return parseJson(msg.content);
}

// Parsing tolerante: lida com cercas ```json e texto residual ao redor do JSON.
function parseJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('Não consegui interpretar a resposta da IA como JSON.');
  }
}
