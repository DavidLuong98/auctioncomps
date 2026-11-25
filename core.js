// BaT Explorer core: talks to Bring a Trailer's public JSON API from the visitor's browser
// and turns raw auction records into filterable rows. No DOM access here (testable in Node).
(function (root) {
  const API = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data';
  const PER_PAGE = 60;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Retries with exponential backoff (2s, 4s, 8s, 16s, 32s). 403/429/5xx and network errors are
  // treated as throttling; other 4xx mean a bad request and fail immediately.
  async function getJSON(url, params, tries = 6) {
    const u = new URL(url);
    for (const [k, v] of params) u.searchParams.append(k, v);
    for (let i = 0; i < tries; i++) {
      let r;
      try { r = await fetch(u, { credentials: 'omit' }); }
      catch (e) { if (i === tries - 1) throw e; }
      if (r && r.ok) return await r.json();
      if (r && r.status !== 403 && r.status !== 429 && r.status < 500) throw new Error('BaT API returned HTTP ' + r.status);
      if (i < tries - 1) await sleep(2000 * 2 ** i);
    }
    throw new Error('Request failed');
  }

  // --- model lookup ---
  async function autocomplete(term) {
    const d = await getJSON(API + '/autocomplete', [['term', term]]);
    return (d.results || [])
      .filter(r => r.result_type === 'item' && /bringatrailer\.com\/[^/]+\/[^/]+\/?$/.test(r.url) && !/\/partner\//.test(r.url))
      .map(r => ({ id: r.destination, title: r.title, url: r.url, path: new URL(r.url).pathname }));
  }

  function parseModelPath(input) {
    const m = String(input).trim().match(/bringatrailer\.com(\/[a-z0-9-]+\/[a-z0-9-]+)\/?/i);
    return m ? m[1].toLowerCase() + '/' : null;
  }

  // Resolve a pasted model URL (e.g. https://bringatrailer.com/bmw/e46-m3/) to its keyword-page id.
  async function resolveUrl(input) {
    const path = parseModelPath(input);
    if (!path) return null;
    const [make, slug] = path.split('/').filter(Boolean);
    const words = slug.split('-');
    const terms = [words.join(' '), make.replace(/-/g, ' ') + ' ' + words.join(' '), ...words.filter(w => w.length > 1)];
    for (const t of [...new Set(terms)]) {
      const hit = (await autocomplete(t)).find(r => r.path === path);
      if (hit) return hit;
    }
    return null;
  }

  // Umbrella pages (e.g. /mazda/miata/) have no auctions of their own; their generations do.
  // Find sibling models from the same make whose title contains every word of the umbrella title.
  async function subModels(model) {
    const words = model.title.toLowerCase().split(/\s+/);
    const make = model.path.split('/')[1];
    const seen = new Map();
    for (const t of [words.slice(1).join(' '), words[words.length - 1]]) {
      for (const r of await autocomplete(t)) {
        const tw = r.title.toLowerCase();
        if (r.id !== model.id && r.path.split('/')[1] === make && words.every(w => tw.includes(w))) seen.set(r.id, r);
      }
    }
    return [...seen.values()];
  }

  // --- data loading ---
  function baseParams(ids) {
    return [...ids.map(id => ['base_filter[keyword_pages][]', id]), ['base_filter[items_type]', 'model'], ['sort', 'td']];
  }
  async function countFor(ids) {
    const d = await getJSON(API + '/listings-filter', [['page', 1], ['per_page', PER_PAGE], ['get_items', 1], ['get_stats', 0], ...baseParams(ids)]);
    return d.items_total || 0;
  }

  // Pages through every completed auction for the given model ids (60 per request).
  // onPage(page, pages, itemsSoFar) fires after each page so the UI can render progressively.
  async function loadItems(ids, onPage, { delay = 500, signal } = {}) {
    const out = new Map();
    let page = 1, pages = 1;
    while (page <= pages) {
      if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const req = () => getJSON(API + '/listings-filter', [['page', page], ['per_page', PER_PAGE], ['get_items', 1], ['get_stats', 0], ...baseParams(ids)]);
      let d = await req();
      // Throttled: BaT answers 200 with an empty page. Wait longer each time, up to ~75s in total.
      for (let wait = 5000; !(d.items || []).length && d.page_current == null && page > 1 && wait <= 40000; wait *= 2) {
        if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
        await sleep(wait);
        d = await req();
      }
      if (d.pages_total) pages = d.pages_total;
      (d.items || []).forEach(it => out.set(it.id, it));
      onPage && onPage(page, pages, out);
      page++;
      if (page <= pages) await sleep(delay);
    }
    return out;
  }

  // --- parsing (model-agnostic) ---
  const decode = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&rsquo;|&#8217;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&hellip;/g, '…');
  const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?k?)';
  const toNum = t => { t = t.toLowerCase().replace(/,/g, ''); return t.endsWith('k') ? parseFloat(t) * 1000 : parseFloat(t); };

  function parseMiles(title, ex) {
    let m = title.match(new RegExp(NUM + '[- ]mile', 'i'));
    if (m) return { mi: Math.round(toNum(m[1])), src: 'title' };
    m = title.match(new RegExp(NUM + '[- ](?:kilometer|km)', 'i'));
    if (m) return { mi: Math.round(toNum(m[1]) * 0.621371), src: 'title' };
    let best = null;
    for (const x of ex.matchAll(new RegExp(NUM + '\\s*(miles?|kilometers?|km)\\b', 'gi'))) {
      let v = toNum(x[1]); if (/^k/i.test(x[2])) v *= 0.621371;
      if (v < 2000000 && (best == null || v > best)) best = v;   // "added 4k of the 98k miles" -> 98k
    }
    return best == null ? { mi: null, src: null } : { mi: Math.round(best), src: 'description' };
  }

  function parseTrans(t) {
    if (/\b(PDK|DCT|dual[- ]clutch|DSG|S tronic)\b/i.test(t)) return 'Dual-clutch';
    if (/\bSMG\b|sequential manual|F1 (gearbox|transmission)|E-Gear/i.test(t)) return 'Automated manual';
    if (/\b(\d|three|four|five|six|seven)[- ]speed manual|manual transmission|\b[3-7]-speed\b(?! auto)|gated shifter|stick shift/i.test(t)) return 'Manual';
    if (/automatic|tiptronic|\bCVT\b|steptronic|powerglide|hydra-?matic|[3-9]-speed auto/i.test(t)) return 'Automatic';
    return null;
  }

  const BODIES = [['Convertible', /convertible|cabriolet|cabrio\b|drophead|spyder|spider\b|roadster/i], ['Targa', /\btarga\b/i],
    ['Wagon', /wagon|estate|touring\b(?=.*wagon)|shooting brake|avant\b/i], ['Pickup', /pickup|pick-up|\btruck\b/i],
    ['SUV', /\bSUV\b|sport utility/i], ['Sedan', /sedan|saloon|four-door\b/i], ['Hatchback', /hatchback/i], ['Coupe', /coupe|coupé|fastback|hardtop/i]];
  const parseBody = (title, ex) => { for (const [n, re] of BODIES) if (re.test(title)) return n; for (const [n, re] of BODIES) if (re.test(ex.slice(0, 120))) return n; return null; };

  const PARTS = /\b(wheels?|seats?|hardtop|engine|gearbox|transmission|parts|automobilia|sign|literature|tool kit|luggage|steering wheel|memorabilia|model car|scale model|helmet|poster)\b/i;

  function colorGroup(p) {
    if (!p) return null;
    const g = [['Black', /black|onyx|obsidian|ebony/], ['White', /white|ivory|chalk|alabaster|pearl/], ['Silver', /silver|platinum|titanium|aluminum/],
      ['Grey', /gr[ae]y|graphite|gunmetal|slate|anthracite|charcoal|nardo/], ['Blue', /blue|azure|navy|cobalt|aqua|teal|turquoise/],
      ['Red', /red|rosso|maroon|burgundy|crimson|guards|carmine|ruby/], ['Green', /green|verde|british racing|olive|emerald|jade/],
      ['Yellow', /yellow|giallo|gold|amber/], ['Orange', /orange|tangerine|copper/], ['Brown', /brown|bronze|beige|tan|sand|champagne|cream|khaki/], ['Purple', /purple|violet|plum|amethyst/]];
    for (const [n, re] of g) if (re.test(p.toLowerCase())) return n;
    return 'Other';
  }

  // "Sold for USD $20,000 on 11/24/2026" -> 20000
  const priceFrom = st => { const m = st.match(/(?:for|to)\s+[A-Z]{3}\s*[^\d\s]*\s*([\d,]+)/i); return m ? +m[1].replace(/,/g, '') : null; };

  // items: Map of raw listing records from loadItems -> array of flat, filterable rows
  function buildRows(items) {
    const rows = [];
    for (const it of items.values()) {
      if (it.active) continue;
      const st = decode(it.sold_text || '').replace(/<[^>]+>/g, '');
      if (/withdrawn/i.test(st) || !it.current_bid) continue;
      const t = decode(it.title), ex = decode(it.excerpt || '');
      const all = t + ' ' + ex;
      const { mi, src } = parseMiles(t, ex);
      const y = (t.match(/\b(19[0-9]{2}|20[0-4][0-9])\b/) || [])[1];
      const paint = (ex.match(/(?:finished|refinished|repainted|painted|specified|wears(?: a repaint in)?)\s+in\s+([A-Z][\w’'\- ]+?)(?:\s+Metallic| Pearl)?(?=\s+over\b|,|\.| with| and)/) ||
                     ex.match(/\b(?:features?|has|wears|in)\s+(?:an?\s+)?([A-Z][\w’'\-]+(?: [A-Z][\w’'\-]+){0,3})(?: Metallic)? paint\b/) || [])[1] || null;
      const interior = (ex.match(/\bover\s+(?:an?\s+)?([\w\- ]+?)(?:\s+(?:Nappa|leather|upholstery|cloth|vinyl|Alcantara|interior))/i) || [])[1] || null;
      rows.push({
        id: it.id, t, u: it.url, img: (it.thumbnail_url || '').replace(/\?.*$/, '?w=320&h=213&crop=1'),
        p: priceFrom(st) || it.current_bid, cur: (st.match(/\b([A-Z]{3})\s*[^\d\s]*\s*[\d,]+/) || [])[1] || it.currency || 'USD', sold: /^\s*sold\b/i.test(st), ts: it.sold_text_timestamp || it.timestamp_end,
        y: y ? +y : null, mi, ms: src, tr: parseTrans(all), b: parseBody(t, ex),
        nr: !!it.noreserve, cc: it.country_code || null, paint, pc: colorGroup(paint), int: interior,
        mod: /\bmodified\b|supercharg|turbocharg(?!ed (inline|flat|v\d|\d\.\d))|restomod|engine swap|[- ]swapped|track car|roll (bar|cage)|coilovers|lowered/i.test(all),
        car: !PARTS.test(t) || /\b(19|20)\d{2}\b/.test(t),
        ex,
      });
    }
    return rows.sort((a, b) => b.ts - a.ts);
  }

  root.BaT = { autocomplete, resolveUrl, parseModelPath, subModels, countFor, loadItems, buildRows, parseMiles, parseTrans, parseBody };
})(typeof window !== 'undefined' ? window : globalThis);
