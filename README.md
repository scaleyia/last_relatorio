# Gerador de Relatórios LastOne

Interface web que lê **2 prints do Google Ads** com a OpenAI API, extrai os números e gera o **PDF no padrão LastOne** (a mesma skill `relatorio-google-ads-lastone`, com template, logo e layout idênticos).

Fluxo por cliente: seleciona o cliente → sobe os 2 prints → confere os dados extraídos → clica em **Gerar Relatório** → baixa o PDF. Menos de 1 minuto por cliente, sem abrir o Claude manualmente.

---

## 1. Rodar

```bash
npm install      # já feito; rode de novo se mudar de máquina
npm start
```

Abra **http://localhost:3000** no navegador.

> `npm run dev` reinicia o servidor automaticamente ao editar arquivos.

## 2. Configurar a IA (direto na interface)

No painel **⚙ Configurações da IA** no topo da página:

1. **Cole sua API key da OpenAI** (pegue em https://platform.openai.com/api-keys) e clique em **Salvar chave**. A chave fica guardada em `data/settings.json` (fora do git) — você só digita uma vez.
2. **Escolha o modelo** no seletor. Assim que a chave é salva, o sistema busca a lista de **modelos da sua própria conta** OpenAI. Use o `↻` para atualizar a lista.

> Alternativa: dá pra deixar a chave no `.env` (`cp .env.example .env`) em vez da interface — o que estiver salvo na interface tem prioridade.

---

## Como usar

1. **Cliente & período** — escolha um cliente salvo (ou “➕ Novo cliente”), confira mês/ano e gestor.
   - Marque **“sem custo por conversão”** se o cliente preferir o card de *Cliques* no lugar.
   - **💾 Salvar preferências** guarda gestor + preferência por cliente (em `data/clients.json`), pra não redigitar nos próximos meses.
2. **Prints** — arraste os 2 prints (visão geral + tabela de leilão). A ordem não importa.
3. **Ler prints com a IA** — a Claude lê as imagens e preenche tudo.
4. **Confira os dados** — todos os campos são editáveis (métricas, gráfico por semana, tabela de leilão, próximos passos). Avisos de transparência aparecem em destaque.
   - Use **👁 Pré-visualizar** para ver o relatório antes de baixar.
5. **📄 Gerar Relatório (PDF)** — baixa `Relatório <Mês> - <Cliente>.pdf`.

---

## Como funciona por baixo

| Parte | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JS puro (`public/`) — sem build |
| Leitura dos prints | OpenAI API (`gpt-5.4-mini`) com visão + `response_format` json_schema strict (JSON estruturado garantido) — `lib/extract.js` |
| Montagem do relatório | Porte fiel do `generate_report.py` da skill — `lib/report.js` (mesmo HTML/CSS/SVG) |
| PDF | Puppeteer + Chromium (`lib/pdf.js`), renderiza o HTML em A4 |
| Servidor | Express (`server.js`) |

### Estrutura

```
server.js              API: /api/extract, /api/generate, /api/preview, /api/clients
lib/extract.js         chamada de visão à OpenAI (regras da skill no system prompt)
lib/report.js          construtor do HTML do relatório (idêntico à skill)
lib/pdf.js             HTML → PDF (Puppeteer)
assets/                template_head.html, logo.png, logo_b64.txt  ← cópia da skill
public/                index.html, app.js, styles.css  ← interface
data/clients.json      lista de clientes + preferências
```

---

## Notas

- **Modelo:** `gpt-5.4-mini` (configurável via `OPENAI_MODEL` no `.env`). Cada leitura usa ~2 imagens; o custo é de centavos por relatório — os 49 clientes/mês ficam entre ~R$1 e ~R$11 dependendo do modelo. Se a IA errar números, suba para `gpt-5.4`; para economizar ao máximo, use `gpt-5.4-nano`.
- **Sem internet para o PDF:** a logo e o template são locais; só a leitura dos prints chama a API.
- **Chromium:** o Puppeteer baixa o próprio Chromium no `npm install`. Se a primeira extração falhar com erro de “Framework not found” (problema do extrator de zip no macOS), rode:
  ```bash
  rm -rf ~/.cache/puppeteer/chrome
  V=$(node -e "console.log(require('puppeteer').PUPPETEER_REVISIONS?.chrome||'')")
  npx puppeteer browsers install chrome
  ```
  Em último caso, aponte para o Chrome do sistema definindo `PUPPETEER_EXECUTABLE_PATH` no `.env`.
- **49 clientes:** salve cada cliente uma vez (gestor + preferência) e nos meses seguintes é só selecionar → subir prints → gerar.
