// Live check that Bring a Trailer still works the way core.js expects: model search returns a known
// model, and the first page of its completed auctions parses into rows with price, date, title and URL.
// Makes two requests. Exits 1 with a short reason on failure. Run with: node scripts/health.mjs
import { createRequire } from 'node:module';

const UA = 'AuctionComps-health-check (+https://github.com/DavidLuong98/auctioncomps)';
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => realFetch(url, { ...opts, headers: { ...opts.headers, 'user-agent': UA } });

createRequire(import.meta.url)('../core.js');
const { BaT } = globalThis;

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

let model;
try {
  const results = await BaT.autocomplete('e46 m3');
  model = results.find(r => r.path === '/bmw/e46-m3/');
  if (!model) fail(`model search for "e46 m3" did not return /bmw/e46-m3/ (got ${results.length} results)`);
} catch (e) { fail('model search request failed: ' + e.message); }
console.log(`search ok: ${model.title} (id ${model.id})`);

// Load only the first page: abort as soon as it arrives.
let firstPage = new Map();
const ctl = new AbortController();
try {
  await BaT.loadItems([model.id], (page, pages, got) => { firstPage = new Map(got); ctl.abort(); }, { signal: ctl.signal, delay: 0 });
} catch (e) {
  if (e.name !== 'AbortError') fail('completed auctions request failed: ' + e.message);
}
if (!firstPage.size) fail('first page of completed auctions came back empty');

const rows = BaT.buildRows(firstPage);
if (!rows.length) fail(`first page had ${firstPage.size} records but none parsed into rows`);
const bad = rows.filter(r => !(r.p > 0 && r.ts > 0 && r.t && /^https:\/\/bringatrailer\.com\//.test(r.u)));
if (bad.length > rows.length / 2) {
  fail(`${bad.length} of ${rows.length} rows are missing price, date, title or URL. First one: ${JSON.stringify(bad[0]).slice(0, 300)}`);
}
console.log(`listings ok: ${rows.length} rows parsed from page 1 (${firstPage.size} records)`);
