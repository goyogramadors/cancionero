// Convierte build/svg/*.svg en build/fig/*.png (ancho ~1200 px) con Chromium.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const src = path.join(__dirname, 'build/svg'), dst = path.join(__dirname, 'build/fig');
  fs.mkdirSync(dst, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ deviceScaleFactor: 1 });
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(src, f), 'utf8');
    const w = +svg.match(/width="(\d+)"/)[1], h = +svg.match(/height="(\d+)"/)[1];
    const k = f === "portada.svg" ? 1 : Math.min(1200 / w, 2), W = Math.round(w * k), H = Math.round(h * k);
    await p.setViewportSize({ width: W, height: H });
    await p.setContent(`<body style="margin:0;background:#fff">${svg.replace(/width="\d+" height="\d+"/, `width="${W}" height="${H}"`)}</body>`);
    await p.screenshot({ path: path.join(dst, f.replace('.svg', '.png')) });
  }
  await b.close();
})();
