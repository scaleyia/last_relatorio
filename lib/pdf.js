// Renderiza o HTML do relatório em PDF A4.
// - No Vercel/Lambda (serverless): usa @sparticuz/chromium + puppeteer-core.
// - No local (dev): usa o Chrome/Chromium instalado na máquina.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.AWS_REGION ||
  process.env.NOW_REGION
);

// Caminhos comuns do Chrome para desenvolvimento local.
function localChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return undefined;
}

let browserPromise = null;

async function launch() {
  if (isServerless) {
    const { default: chromium } = await import('@sparticuz/chromium');
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  const executablePath = localChromePath();
  if (!executablePath) {
    throw new Error(
      'Chrome não encontrado para gerar o PDF. Instale o Google Chrome ou defina PUPPETEER_EXECUTABLE_PATH no .env.'
    );
  }
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

function getBrowser() {
  if (!browserPromise) browserPromise = launch();
  return browserPromise;
}

export async function htmlToPdf(html) {
  let browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    // se a instância do browser morreu (comum em serverless), recria
    browserPromise = null;
    browser = await getBrowser();
  }
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {}
    browserPromise = null;
  }
}
