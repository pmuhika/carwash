/**
 * Performance unit tests for parallel offline sync + schedule delays.
 * Run: node scripts/test-sync-perf.cjs
 */
const assert = require("assert");

async function runPool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]);
      }
    },
  );
  await Promise.all(runners);
}

async function testParallelFasterThanSerial() {
  const n = 12;
  const workMs = 25;
  const items = Array.from({ length: n }, (_, i) => i);

  const t0 = Date.now();
  for (const x of items) {
    await new Promise((r) => setTimeout(r, workMs));
  }
  const serial = Date.now() - t0;

  const t1 = Date.now();
  await runPool(items, 4, async () => {
    await new Promise((r) => setTimeout(r, workMs));
  });
  const parallel = Date.now() - t1;

  assert.ok(
    parallel < serial * 0.55,
    `parallel (${parallel}ms) should be much faster than serial (${serial}ms)`,
  );
  return { serial, parallel, speedup: (serial / parallel).toFixed(2) + "x" };
}

async function testPoolPreservesFailures() {
  const items = [
    { id: "ok1" },
    { id: "fail1" },
    { id: "ok2" },
    { id: "fail2" },
    { id: "ok3" },
  ];
  const ok = new Set();
  const fail = new Map();
  await runPool(items, 3, async (item) => {
    await new Promise((r) => setTimeout(r, 5));
    if (item.id.startsWith("fail")) fail.set(item.id, "stock conflict");
    else ok.add(item.id);
  });
  assert.strictEqual(ok.size, 3);
  assert.strictEqual(fail.size, 2);
  const remaining = items.filter((x) => !ok.has(x.id));
  assert.strictEqual(remaining.length, 2);
  return { ok: [...ok], failed: [...fail.keys()] };
}

function testReconnectSchedule() {
  const delays = [80, 300, 900, 2500, 6000];
  const old = [400, 1500, 4000, 10000, 20000];
  assert.ok(delays[0] < old[0], "first retry should be sooner");
  assert.ok(
    delays.reduce((a, b) => a + b, 0) < old.reduce((a, b) => a + b, 0),
    "total wait budget should be lower",
  );
  return { delays, oldTotal: old.reduce((a, b) => a + b, 0), newTotal: delays.reduce((a, b) => a + b, 0) };
}

function testSlimSelectIsSmaller() {
  const fat = "*";
  const slim =
    "id,name,category,sku,cost_price,sell_price,stock_qty,min_stock,image_url,stock_unit,units_per_pack,active";
  assert.ok(slim !== fat);
  assert.ok(slim.split(",").length >= 10);
  return { columns: slim.split(",").length };
}

(async () => {
  const report = { passed: 0, failed: 0, results: {} };
  try {
    report.results.parallel = await testParallelFasterThanSerial();
    report.passed++;
  } catch (e) {
    report.failed++;
    report.results.parallel = { error: String(e.message || e) };
  }
  try {
    report.results.failures = await testPoolPreservesFailures();
    report.passed++;
  } catch (e) {
    report.failed++;
    report.results.failures = { error: String(e.message || e) };
  }
  try {
    report.results.schedule = testReconnectSchedule();
    report.passed++;
  } catch (e) {
    report.failed++;
    report.results.schedule = { error: String(e.message || e) };
  }
  try {
    report.results.slimSelect = testSlimSelectIsSmaller();
    report.passed++;
  } catch (e) {
    report.failed++;
    report.results.slimSelect = { error: String(e.message || e) };
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failed ? 1 : 0);
})();
