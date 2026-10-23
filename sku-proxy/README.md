# sku-proxy — ตัวกลางดึงรายการ SKU จาก Cubic Data Lake API ให้หน้า Stock Request

ทำไมต้องมี: Data API (`data-api-e65n6ojgpa-as.a.run.app`) ไม่ส่ง header CORS เบราว์เซอร์จึงเรียกตรงไม่ได้
และคู่มือ API ห้ามใส่ `X-API-Key` ในหน้าเว็บสาธารณะ → Worker นี้ถือ key ไว้เป็น Secret แล้วตอบรายการ SKU อย่างเดียว
(ข้อมูลที่ส่งออกมีแค่ SKU / ชื่อสินค้า / หมวด ไม่มีข้อมูลลูกค้า)

## Deploy (ทำเองในเครื่อง ต้องล็อกอิน Cloudflare)

```bash
cd "D:\ปรับแก้สำเร็จรูป\stock-request\sku-proxy"
wrangler login
wrangler secret put DATA_API_KEY      # จะถูกถามให้พิมพ์ key (ห้ามใส่ key ในคำสั่งตรงๆ)
wrangler deploy
```

จะได้ URL ประมาณ `https://sku-proxy.<subdomain>.workers.dev`

## ทดสอบหลัง deploy

```bash
curl https://sku-proxy.<subdomain>.workers.dev/version
curl https://sku-proxy.<subdomain>.workers.dev/sku-list
```

`/sku-list` ควรได้ `{"count":N,"updated":"…","skus":["…", …]}` · header `X-Sku-Proxy-Cache: miss` ครั้งแรก แล้ว `hit` ครั้งถัดไป (แคช 6 ชม.)

## เอา URL ไปใส่หน้า Stock Request

ใน `index.html` บรรทัด `const SKU_LIST_URL = '…';` ใส่ `https://sku-proxy.<subdomain>.workers.dev/sku-list`
ถ้า Worker ล่ม/ยังไม่ได้ตั้ง หน้าเว็บจะถอยไปใช้ Google Sheet CSV เดิมเอง

## เส้นทาง

| เส้นทาง | ผล |
|---|---|
| `GET /sku-list` | `{count, updated, skus:[…]}` |
| `GET /sku-list?names=1` | `{count, updated, items:[{sku,name,category}]}` |
| `GET /sku-list?refresh=1&k=<REFRESH_KEY>` | ดึงใหม่ไม่ใช้แคช (ต้องตั้ง Secret `REFRESH_KEY` ก่อน) |
| `GET /version` | `{build, keySet, cacheTtlSec}` |

เงื่อนไขต้นทาง: `real_products_only=true` · `include_deleted=false` · เอาเฉพาะ `sku_status = "ok"` · กัน SKU ซ้ำ · เรียง A→Z แบบตัวเลขธรรมชาติ
