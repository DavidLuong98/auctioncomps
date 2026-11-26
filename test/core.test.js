// Unit tests for the parsing in core.js. Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/listings.json');
require('../core.js');
const { BaT } = globalThis;

test('parseMiles reads "29k-Mile" from the title', () => {
  assert.deepEqual(BaT.parseMiles('29k-Mile 2003 BMW M3', ''), { mi: 29000, src: 'title' });
});

test('parseMiles converts kilometers in the title to miles', () => {
  assert.deepEqual(BaT.parseMiles('12,500-Kilometer 1995 Porsche 911', ''), { mi: 7767, src: 'title' });
});

test('parseMiles picks the largest figure in the description', () => {
  assert.deepEqual(BaT.parseMiles('2003 BMW M3', 'The seller added 28k of the 53k miles shown.'), { mi: 53000, src: 'description' });
  assert.deepEqual(BaT.parseMiles('2003 BMW M3', 'Bought at 12k miles, it now shows 53,000 miles.'), { mi: 53000, src: 'description' });
});

test('parseMiles converts kilometers in the description', () => {
  assert.deepEqual(BaT.parseMiles('2001 BMW M3', 'The odometer shows 80,000 km.'), { mi: 49710, src: 'description' });
});

test('parseMiles returns null when no mileage is given', () => {
  assert.deepEqual(BaT.parseMiles('2001 BMW M3', 'Nothing about distance here.'), { mi: null, src: null });
});

test('parseTrans recognizes each transmission type', () => {
  assert.equal(BaT.parseTrans('paired with a six-speed manual transaxle'), 'Manual');
  assert.equal(BaT.parseTrans('7-speed PDK'), 'Dual-clutch');
  assert.equal(BaT.parseTrans('SMG II gearbox'), 'Automated manual');
  assert.equal(BaT.parseTrans('five-speed automatic'), 'Automatic');
  assert.equal(BaT.parseTrans('no gearbox mentioned'), null);
});

test('parseBody reads the title first, then the start of the description', () => {
  assert.equal(BaT.parseBody('2004 BMW M3 Convertible', 'This coupe'), 'Convertible');
  assert.equal(BaT.parseBody('2002 BMW M3', 'This coupe is finished in black.'), 'Coupe');
  assert.equal(BaT.parseBody('2002 BMW M3', 'No body style here.'), null);
});

test('buildRows turns fixture records into rows', () => {
  const rows = BaT.buildRows(new Map(fixtures.map(r => [r.id, r])));
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));

  // live auctions and withdrawn listings are skipped
  assert.equal(byId[1003], undefined);
  assert.equal(byId[1004], undefined);
  assert.deepEqual(rows.map(r => r.id), [1001, 1002, 1005], 'sorted newest first');

  const sold = byId[1001];
  assert.equal(sold.sold, true);
  assert.equal(sold.p, 20000, 'price comes from the sold text, not current_bid');
  assert.equal(sold.cur, 'USD');
  assert.equal(sold.mi, 29000);
  assert.equal(sold.ms, 'title');
  assert.equal(sold.y, 2003);
  assert.equal(sold.tr, 'Manual');
  assert.equal(sold.b, 'Coupe');
  assert.equal(sold.paint, 'Laguna Seca Blue');
  assert.equal(sold.pc, 'Blue');
  assert.equal(sold.nr, true);
  assert.equal(sold.car, true);
  assert.match(sold.img, /\?w=320&h=213&crop=1$/);

  const unsold = byId[1002];
  assert.equal(unsold.sold, false, '"Bid to" means reserve not met');
  assert.equal(unsold.p, 15500);
  assert.equal(unsold.mi, 53000);
  assert.equal(unsold.ms, 'description');
  assert.equal(unsold.tr, 'Automated manual');
  assert.equal(unsold.b, 'Convertible');
  assert.equal(unsold.paint, 'Jet Black');
  assert.equal(unsold.pc, 'Black');

  assert.equal(byId[1005].car, false, 'parts lots are flagged');
});

test('parseModelPath accepts model page URLs only', () => {
  assert.equal(BaT.parseModelPath('https://bringatrailer.com/BMW/e46-m3/'), '/bmw/e46-m3/');
  assert.equal(BaT.parseModelPath('bringatrailer.com/porsche/996-gt3'), '/porsche/996-gt3/');
  assert.equal(BaT.parseModelPath('e46 m3'), null);
});
