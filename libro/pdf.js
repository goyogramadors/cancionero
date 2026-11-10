// Arma build/teoria-musical.pdf desde build/libro.html (tamaño carta) con Chromium.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'build/libro.html'));
  await p.pdf({
    path: path.join(__dirname, 'build/teoria-musical.pdf'), format: 'Letter', printBackground: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;font-family:sans-serif"><span class="pageNumber"></span></div>',
    margin: { top: '20mm', bottom: '22mm', left: '20mm', right: '20mm' },
  });
  await b.close();
})();
