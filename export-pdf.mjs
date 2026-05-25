/**
 * MAF Booklet → Print-ready PDF
 * Usage: node export-pdf.mjs
 * Output: MAF-Sponsorship-Booklet-2025.pdf  (same folder)
 */

import puppeteer from 'puppeteer';
import fs        from 'fs';
import path      from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const URL_BASE   = 'http://localhost:3003';
const OUT_DIR    = path.join(__dirname, '_pdf_frames');
const PDF_OUT    = path.join(__dirname, 'MAF-Sponsorship-Booklet-2025.pdf');
// Native deck page size
const PAGE_W     = 1240;
const PAGE_H     = 1754;

const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

console.log('Launching browser…');
const browser = await puppeteer.launch({
  headless: true,
  args: [`--window-size=${PAGE_W},${PAGE_H}`, '--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: 2 });

console.log(`Loading ${URL_BASE} …`);
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await sleep(3000);

// Hide sidebar / nav — expose only the slide canvas
await page.addStyleTag({ content: `
  .sidebar, [class*="sidebar"], [class*="nav"], button,
  .deck-counter, [class*="counter"], [class*="reset"] { display:none !important; }
  body, html { background:#000 !important; margin:0; padding:0; overflow:hidden; }
` });
await sleep(500);

// Count total slides
const total = await page.evaluate(() => {
  const stage = document.querySelector('deck-stage');
  if (stage && typeof stage.total !== 'undefined') return stage.total;
  return document.querySelectorAll('section[data-screen-label]').length;
});
console.log(`Total slides: ${total}`);

const frames = [];

for (let i = 0; i < total; i++) {
  await page.evaluate(idx => {
    const stage = document.querySelector('deck-stage');
    if (stage && stage.goTo) stage.goTo(idx);
  }, i);

  await sleep(1500); // let images settle

  const outFile = path.join(OUT_DIR, `slide-${String(i).padStart(3,'0')}.png`);

  // Try to screenshot just the .page element
  const pageEl = await page.$('.page');
  if (pageEl) {
    await pageEl.screenshot({ path: outFile });
  } else {
    await page.screenshot({ path: outFile, clip: { x:0, y:0, width:PAGE_W, height:PAGE_H } });
  }

  frames.push(outFile);
  process.stdout.write(`  Captured slide ${i+1}/${total}\r`);
}

await browser.close();
console.log(`\nAll ${total} slides captured. Building PDF with Python…`);

// Python img2pdf: stitch PNGs → PDF (img2pdf preserves lossless quality)
const pyScript = `
import img2pdf, os, glob, sys, shutil

files = ${JSON.stringify(frames)}
out   = r"${PDF_OUT.replace(/\\/g, '\\\\')}"

with open(out, "wb") as f:
    f.write(img2pdf.convert(files))

sys.stdout.write("Saved %d-page PDF: %s (%d KB)\\n" % (len(files), out, os.path.getsize(out)//1024))
shutil.rmtree(r"${OUT_DIR.replace(/\\/g, '\\\\')}", ignore_errors=True)
`;

const pyFile = path.join(OUT_DIR, 'stitch.py');
fs.writeFileSync(pyFile, pyScript);
execSync(`python "${pyFile}"`, { stdio: 'inherit' });

console.log('Done! →', PDF_OUT);
