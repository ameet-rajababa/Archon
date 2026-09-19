#!/usr/bin/env bun
/**
 * Layout smoke test for a page in a real browser.
 *
 * jsdom and happy-dom do no layout — every height is zero, so they cannot see
 * an overflow bug. This drives the chromium already on the box.
 *
 * Usage: bun /home/appuser/.tools/pw/smoke.mjs <url> [waitForSelector]
 * Exit 0 when the page fits its viewport; 1 when the document scrolls.
 */
import { chromium } from 'playwright-core';

const url = process.argv[2];
const waitFor = process.argv[3] ?? 'body';
if (!url) {
  console.error('usage: smoke.mjs <url> [waitForSelector]');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
let failed = false;
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector(waitFor, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const de = document.scrollingElement;
    window.scrollTo(0, 5000);
    const moved = window.scrollY;
    window.scrollTo(0, 0);
    // Name the offender rather than just reporting a number.
    let worst = null;
    for (const e of document.querySelectorAll('*')) {
      const b = e.getBoundingClientRect().bottom;
      if (!worst || b > worst.bottom) worst = { bottom: b, tag: e.tagName.toLowerCase(), cls: String(e.className || '').slice(0, 60) };
    }
    return { scrollHeight: de.scrollHeight, clientHeight: de.clientHeight, moved, worst };
  });

  const scrolls = r.moved > 0;
  console.log(`${url}`);
  console.log(`  document ${r.scrollHeight} vs viewport ${r.clientHeight}`);
  console.log(`  page scrolls: ${scrolls ? 'YES' : 'no'}`);
  if (scrolls) {
    console.log(`  furthest element: <${r.worst.tag}> bottom=${Math.round(r.worst.bottom)} | ${r.worst.cls}`);
    failed = true;
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
