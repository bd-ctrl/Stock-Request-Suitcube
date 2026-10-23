// sku-proxy — Cloudflare Worker
// ตัวกลางระหว่างหน้า Stock Request (GitHub Pages) กับ Cubic Data Lake API
// เหตุผล: (1) Data API ไม่ส่ง header CORS → เบราว์เซอร์เรียกตรงไม่ได้
//         (2) คู่มือ API ห้ามใส่ X-API-Key ในหน้าเว็บสาธารณะ → key อยู่ที่นี่เป็น Secret เท่านั้น
//
// เส้นทาง (GET เท่านั้น):
//   /sku-list            → { count, updated, skus: ["SKU", ...] }          (ใช้กับ autocomplete)
//   /sku-list?names=1    → { count, updated, items: [{sku, name, category}, ...] }
//   /version             → ข้อมูลเวอร์ชัน (ไม่เรียก API ต้นทาง)
//
// ต้นทาง: GET /api/v1/storehub/products?real_products_only=true&include_deleted=false&limit=5000
//         วนตาม next_cursor จนหมด · เก็บเฉพาะแถวที่ sku_status = "ok" (มี SKU จริง)
// แคช: Cache API ของ Cloudflare 6 ชั่วโมง (ข้อมูลต้นทางอัปเดตคืนละครั้งหลัง 03:15)
//      บังคับดึงใหม่: /sku-list?refresh=1&k=<REFRESH_KEY>   (ตั้ง REFRESH_KEY เป็น Secret ถ้าต้องการ)

const BUILD = 'sku-proxy-2026-10-23-1';
const UPSTREAM = 'https://data-api-e65n6ojgpa-as.a.run.app/api/v1/storehub/products';
const CACHE_TTL_SEC = 6 * 60 * 60;
const PAGE_LIMIT = 5000;
const MAX_PAGES = 10; // กันวนไม่รู้จบ (8,729 สินค้า = 2 หน้า)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

async function fetchAllProducts(apiKey) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(UPSTREAM);
    u.searchParams.set('real_products_only', 'true');
    u.searchParams.set('include_deleted', 'false');
    u.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) u.searchParams.set('cursor', cursor);

    const r = await fetch(u.toString(), { headers: { 'X-API-Key': apiKey } });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`upstream ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = await r.json();
    for (const p of j.data || []) {
      if (p.sku_status !== 'ok') continue; // ไม่มี SKU ใน StoreHub → ไม่เอา
      const sku = String(p.sku || '').trim();
      if (!sku) continue;
      items.push({ sku, name: p.product_name || '', category: p.category || '' });
    }
    cursor = j.next_cursor || null;
    if (!cursor) break;
  }
  // กันซ้ำ (SKU เดียวกันหลาย product_id) และเรียงตามตัวอักษร
  const seen = new Set();
  const unique = items.filter((it) => (seen.has(it.sku) ? false : (seen.add(it.sku), true)));
  unique.sort((a, b) => a.sku.localeCompare(b.sku, 'en', { numeric: true }));
  return unique;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    if (url.pathname === '/version') {
      return json({ build: BUILD, keySet: Boolean(env.DATA_API_KEY), cacheTtlSec: CACHE_TTL_SEC });
    }

    if (url.pathname !== '/sku-list') return json({ error: 'not_found' }, 404);

    if (!env.DATA_API_KEY) {
      return json({ error: 'key_not_set', hint: 'wrangler secret put DATA_API_KEY' }, 500);
    }

    const wantNames = url.searchParams.get('names') === '1';
    const forceRefresh =
      url.searchParams.get('refresh') === '1' &&
      env.REFRESH_KEY &&
      url.searchParams.get('k') === env.REFRESH_KEY;

    // แคชทั้งก้อน (รวมชื่อ) ไว้ key เดียว แล้วค่อยตัดรูปแบบตอนตอบ
    const cache = caches.default;
    const cacheKey = new Request('https://sku-proxy.cache/products-all', { method: 'GET' });

    let payload = null;
    if (!forceRefresh) {
      const hit = await cache.match(cacheKey);
      if (hit) payload = await hit.json();
    }

    let fromCache = Boolean(payload);
    if (!payload) {
      try {
        const items = await fetchAllProducts(env.DATA_API_KEY);
        payload = { count: items.length, updated: new Date().toISOString(), items };
      } catch (e) {
        return json({ error: 'upstream_failed', detail: String(e.message || e) }, 502);
      }
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_SEC}` },
          })
        )
      );
    }

    const body = wantNames
      ? { count: payload.count, updated: payload.updated, items: payload.items }
      : { count: payload.count, updated: payload.updated, skus: payload.items.map((it) => it.sku) };

    return json(body, 200, {
      'Cache-Control': `public, max-age=${CACHE_TTL_SEC}`,
      'X-Sku-Proxy-Cache': fromCache ? 'hit' : 'miss',
      'X-Sku-Proxy-Build': BUILD,
    });
  },
};
