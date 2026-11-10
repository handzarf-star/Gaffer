// Renders the SVG logo to the PNG icons the web manifest needs. Run: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const logo = (size, pad, bleed) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15b877"/><stop offset="1" stop-color="#075f3d"/></linearGradient></defs>
  ${bleed ? '<rect width="64" height="64" fill="url(#g)"/>' : '<rect width="64" height="64" rx="16" fill="url(#g)"/>'}
  <g transform="translate(${32 - 32 * pad} ${32 - 32 * pad}) scale(${pad})">
    <g fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".95"><path d="M10 32h44"/><circle cx="32" cy="32" r="10"/></g>
    <circle cx="32" cy="32" r="3.6" fill="#ffd54a"/>
  </g></svg>`;

const jobs = [
  ['icon-192.png', 192, 1, false],
  ['icon-512.png', 512, 1, false],
  ['icon-maskable-512.png', 512, 0.66, true],
  // iOS rounds the corners itself and paints transparent pixels black, so this one is full-bleed
  ['apple-touch-icon.png', 180, 0.8, true],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, pad, bleed] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${logo(size, pad, bleed)}</body>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  fs.writeFileSync(`public/${file}`, buf);
  console.log('wrote', file, buf.length, 'bytes');
}
await browser.close();
