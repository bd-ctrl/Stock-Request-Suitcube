# Stock-Request-Suitcube

หน้าเว็บ "Stock Request" ให้สาขาเบิกสินค้า/อุปกรณ์จากคลัง · ใช้งานที่ https://bd-ctrl.github.io/Stock-Request-Suitcube/

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (HTML + CSS + JS ไฟล์เดียว) · ส่งข้อมูลเข้า Lark Base ผ่าน automation webhook · มี `APP_VERSION` อยู่ต้นสคริปต์ |
| `sku-proxy/` | Cloudflare Worker ตัวกลางดึงรายการ SKU จาก Cubic Data Lake API (`/api/v1/storehub/products`) · key เก็บเป็น Secret ฝั่ง Cloudflare |

## รายการ SKU สำหรับ autocomplete มาจากไหน

1. **แหล่งหลัก** Worker `sku-proxy` → `GET /sku-list` คืน `{count, updated, skus:[…]}` (เฉพาะสินค้าจริง ไม่เอาที่ถูกลบ เฉพาะที่มี SKU · แคช 6 ชม. · ต้นทางอัปเดตคืนละครั้งหลัง 03:15)
2. **แหล่งสำรอง** Google Sheet CSV เดิม · ใช้อัตโนมัติเมื่อ `SKU_LIST_URL` ว่างหรือ Worker ตอบไม่สำเร็จ

ตั้งค่าใน `index.html`: `const SKU_LIST_URL = 'https://sku-proxy.<subdomain>.workers.dev/sku-list';`

## Deploy sku-proxy (ทำในเครื่องที่ล็อกอิน Cloudflare)

```bash
cd sku-proxy
wrangler login
wrangler secret put DATA_API_KEY      # จะถามให้พิมพ์ key ของ Data API (ห้ามใส่ key ในคำสั่งหรือในไฟล์ใดๆ)
wrangler deploy
```

ทดสอบ: `curl https://sku-proxy.<subdomain>.workers.dev/version` ต้องได้ `keySet: true` · `curl …/sku-list` ต้องได้รายการ SKU
รายละเอียดเส้นทางทั้งหมดอยู่ใน `sku-proxy/README.md`

## กติกา

- key ของ Data API ห้ามอยู่ในหน้าเว็บหรือใน repo นี้ (เบราว์เซอร์เรียก Data API ตรงไม่ได้อยู่แล้วเพราะไม่มี CORS)
- แก้ `index.html` ทุกครั้งให้เปลี่ยน `APP_VERSION` เป็นวันที่ (`YYYY-MM-DD-n`) · ไฟล์ใช้ขึ้นบรรทัดแบบ CRLF
