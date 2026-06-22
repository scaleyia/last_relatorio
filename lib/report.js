// Construtor do HTML do relatório — porte fiel de scripts/generate_report.py
// da skill `relatorio-google-ads-lastone`. Mesmo layout, gráfico e tabela.
// O CONFIG (cfg) tem exatamente a mesma forma do dicionário CONFIG em Python.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');

// Escolhe um topo "redondo" e 4 divisões para o eixo Y.
function niceAxis(vmax) {
  if (vmax <= 0) vmax = 1;
  const cands = new Set();
  for (let exp = 0; exp < 6; exp++) {
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) {
      cands.add(m * 10 ** exp);
    }
  }
  const sorted = [...cands].sort((a, b) => a - b);
  const ymax = sorted.find((c) => c >= vmax * 1.1) ?? vmax * 1.1;
  const step = ymax / 4.0;
  const lines = [0, 1, 2, 3, 4].map((i) => step * i);
  return { ymax, lines };
}

function fmtNum(v) {
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return v.toFixed(1).replace('.', ',');
}

function smoothPath(pts, t = 0.5) {
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[0];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < n ? pts[i + 2] : pts[i + 1];
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * t * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * t * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * t * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * t * 2;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function buildChartSvg(g) {
  const vals = g.valores;
  const labels = g.labels;
  const n = vals.length;
  const vmax = Math.max(...vals);
  let ymax, lines;
  if (g.ymax != null && g.gridlines != null) {
    ymax = Number(g.ymax);
    lines = g.gridlines.map(Number);
  } else {
    ({ ymax, lines } = niceAxis(vmax));
  }
  const top = 35.0;
  const bottom = 255.0;
  const y = (v) => bottom - (v / ymax) * (bottom - top);

  const [left, right] = n <= 3 ? [140, 820] : [80, 860];
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(left + ((right - left) * i) / (n - 1));
  const pts = xs.map((x, i) => [x, y(vals[i])]);
  const line = smoothPath(pts);
  const area = `${line} L ${pts[n - 1][0].toFixed(1)},${bottom.toFixed(1)} L ${pts[0][0].toFixed(1)},${bottom.toFixed(1)} Z`;

  const grid = lines
    .map((v) => `<line x1="70" y1="${y(v).toFixed(1)}" x2="880" y2="${y(v).toFixed(1)}"/>`)
    .join('');
  const ylab = lines
    .map((v) => `<text x="60" y="${(y(v) + 4).toFixed(1)}">${fmtNum(v)}</text>`)
    .join('');
  let dots = '';
  pts.forEach(([px, py], i) => {
    if (i === n - 1) {
      dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" stroke="#fff" stroke-width="2"/>`;
    } else {
      dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5"/>`;
    }
  });
  const vlab = pts
    .map((p, i) => `<text x="${p[0].toFixed(1)}" y="${(p[1] - 12).toFixed(1)}">${vals[i]}</text>`)
    .join('');
  const xlab = pts
    .map((p, i) => `<text x="${p[0].toFixed(1)}" y="280">${labels[i]}</text>`)
    .join('');

  return `      <svg viewBox="0 0 900 300" width="100%">
        <g stroke="#EEF1EA" stroke-width="1">${grid}</g>
        <g fill="#9AA197" font-size="14" font-family="DejaVu Sans" text-anchor="end">${ylab}</g>
        <path d="${area}" fill="url(#g1)" stroke="none"/>
        <path d="${line}" fill="none" stroke="#5DAA16" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
        <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#5DAA16" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="#5DAA16" stop-opacity="0"/>
        </linearGradient></defs>
        <g fill="#5DAA16">${dots}</g>
        <g fill="#15401E" font-size="15" font-family="DejaVu Sans" font-weight="bold" text-anchor="middle">${vlab}</g>
        <g fill="#7E867D" font-size="14" font-family="DejaVu Sans" text-anchor="middle">${xlab}</g>
      </svg>`;
}

function buildMetrics(metricas) {
  let out = '';
  for (const m of metricas) {
    const cur = m.cur ? '<span class="cur">R$</span>' : '';
    out += `      <div class="metric">
        <div class="label">${m.label}</div>
        <div class="vrow"><span class="value">${cur}${m.value}</span></div>
        <div class="prev">${m.sub}</div>
      </div>
`;
  }
  return out;
}

function buildAuction(rows) {
  let out = '';
  for (const r of rows) {
    // Aceita array [dom, a, b, c, d, you] ou objeto {dominio, parcela, sobreposicao, posicaoAcima, topo, ehVoce}
    const dom = Array.isArray(r) ? r[0] : r.dominio;
    const a = Array.isArray(r) ? r[1] : r.parcela;
    const b = Array.isArray(r) ? r[2] : r.sobreposicao;
    const c = Array.isArray(r) ? r[3] : r.posicaoAcima;
    const d = Array.isArray(r) ? r[4] : r.topo;
    const you = Array.isArray(r) ? r[5] : r.ehVoce;
    const cls = you ? ' class="you"' : '';
    const mk = you ? 'var(--leaf)' : '#C2C9BC';
    out += `          <tr${cls}>
            <td class="l"><span class="mk" style="background:${mk}"></span>${dom}</td>
            <td>${a}</td><td>${b}</td><td>${c}</td><td>${d}</td>
          </tr>
`;
  }
  return out;
}

function buildSteps(passos) {
  let out = '';
  passos.forEach((p, idx) => {
    const i = idx + 1;
    const tag = Array.isArray(p) ? p[0] : p.tag;
    const titulo = Array.isArray(p) ? p[1] : p.titulo;
    const texto = Array.isArray(p) ? p[2] : p.texto;
    const num = String(i).padStart(2, '0');
    out += `      <div class="step-card">
        <div class="chip">${num}</div>
        <div class="b">
          <div class="tag">${tag}</div>
          <h4>${titulo}</h4>
          <p>${texto}</p>
        </div>
      </div>
`;
  });
  return out;
}

export function buildHtml(cfg) {
  const head = fs.readFileSync(path.join(ASSETS, 'template_head.html'), 'utf-8');
  const logo =
    'data:image/png;base64,' +
    fs.readFileSync(path.join(ASSETS, 'logo_b64.txt'), 'utf-8').trim();
  const titulo = `Resumo da Conta &middot; ${cfg.mes} / ${cfg.ano}`;
  const short = `${cfg.cliente} &middot; ${cfg.mes} / ${cfg.ano}`;
  const nRows = cfg.leilao.length;
  const pad = nRows <= 8 ? 11 : nRows <= 11 ? 9 : nRows <= 13 ? 7.5 : 6.5;

  const body = `<body>
<style>tbody td{padding:${pad}px 0;}</style>

<div class="page">
  <div class="topbar">
    <div class="brand"><img src="${logo}" alt="Logo"></div>
    <div class="doc-meta">
      <div><strong>Relatório Google Ads</strong></div>
      <div>Gerado em ${cfg.gerado_em}</div>
    </div>
  </div>
  <div class="title-block">
    <div class="eyebrow">Relatório de Performance</div>
    <h1>${titulo}</h1>
  </div>
  <div class="meta-strip">
    <div class="cell"><div class="k">Cliente</div><div class="v">${cfg.cliente}</div></div>
    <div class="cell"><div class="k">Período</div><div class="v">${cfg.periodo}</div></div>
    <div class="cell"><div class="k">Canal</div><div class="v">Google Ads</div></div>
    <div class="cell"><div class="k">Gestor</div><div class="v">${cfg.gestor}</div></div>
  </div>
  <div class="section">
    <div class="section-label"><span class="idx">01</span><h2>Resultados do Período</h2><span class="rule"></span></div>
    <div class="metric-grid">
${buildMetrics(cfg.metricas)}    </div>
    <div class="panel" style="margin-top:13px;">
      <div class="p-title">Evolução de Conversões</div>
      <div class="p-sub">${cfg.grafico.subtitulo}</div>
${buildChartSvg(cfg.grafico)}
    </div>
  </div>
  <div class="footer">
    <img src="${logo}" alt="">
    <span>Gestor: ${cfg.gestor} &middot; Relatório confidencial</span>
    <span>Página 1 / 2</span>
  </div>
</div>

<div class="page">
  <div class="topbar lite">
    <div class="brand"><img src="${logo}" alt="Logo"></div>
    <div class="doc-meta"><div><strong>${short}</strong></div></div>
  </div>
  <div class="section" style="margin-top:20px;">
    <div class="section-label"><span class="idx">02</span><h2>Informações de Leilão</h2><span class="rule"></span></div>
    <div class="tbl-card">
      <table>
        <colgroup><col class="c-name"><col><col><col><col></colgroup>
        <thead><tr>
          <th class="l">Concorrente</th>
          <th>Parcela de impressões</th><th>Sobreposição</th>
          <th>Posição acima</th><th>Topo da página</th>
        </tr></thead>
        <tbody>
${buildAuction(cfg.leilao)}        </tbody>
      </table>
    </div>
    <p class="note">Parcela de impressões: percentual obtido frente ao total disponível &middot; Sobreposição: frequência com que o concorrente apareceu junto com a sua conta &middot; "&lt; 10%" conforme reportado pelo Google Ads.</p>
  </div>
  <div class="section">
    <div class="section-label"><span class="idx">03</span><h2>Próximos Passos &amp; Otimizações</h2><span class="rule"></span></div>
    <div class="steps-grid">
${buildSteps(cfg.passos)}    </div>
  </div>
  <div class="footer">
    <img src="${logo}" alt="">
    <span>Gestor: ${cfg.gestor} &middot; Relatório confidencial</span>
    <span>Página 2 / 2</span>
  </div>
</div>
</body>
</html>`;

  return head + '\n' + body;
}

// Nome de arquivo obrigatório: "Relatório <Mês> - <Cliente>.pdf"
export function reportFilename(cfg) {
  return `Relatório ${cfg.mes} - ${cfg.cliente}.pdf`;
}
