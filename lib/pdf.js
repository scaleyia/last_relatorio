// Renderiza o HTML do relatório em PDF A4 com fidelidade total de cores,
// usando o Chromium embutido no Puppeteer. Equivale ao passo Playwright da skill.

import puppeteer from 'puppeteer';

let browserPromise = null;

// Reaproveita uma única instância do Chromium entre requisições (mais rápido
// para os 49 clientes — não sobe/derruba o browser a cada relatório).
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

export async function htmlToPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return pdf;
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
