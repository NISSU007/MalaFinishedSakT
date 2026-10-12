# ระบบสั่งหม่าล่า Self Service 🏮

ระบบสั่งหม่าล่าหน้าร้านแบบ Self-Service (ธีมจีนโทนแดง-ทอง) พร้อมชำระเงินผ่าน QR Code จริง

## วิธีติดตั้งและรัน
1. ติดตั้ง Node.js
2. เปิด Terminal ในโฟลเดอร์นี้ แล้วพิมพ์
   ```
   npm install
   npm start
   ```
3. เปิดเบราว์เซอร์ไปที่ http://localhost:3000
4. ถ้าต้องการล้างข้อมูลออเดอร์กลับเป็นข้อมูลตัวอย่าง : `npm run seed`

---

## 💳 การชำระเงินด้วย QR Code (ของจริง)

QR ในหน้าชำระเงินเป็น **Thai QR / พร้อมเพย์ (มาตรฐาน EMVCo)** ที่ลูกค้าสแกนด้วย
แอปธนาคารไทยได้จริงทุกแอป (K PLUS, SCB EASY, Krungthai NEXT ฯลฯ) และจะ
**แสดงยอดเงินของออเดอร์นั้นให้อัตโนมัติ** เมื่อสแกน เงินเข้าบัญชีที่ผูกเลขพร้อมเพย์ไว้

### ตั้งค่าเลขพร้อมเพย์ (สำคัญ — ใช้ได้ทั้งบัญชีส่วนตัวและร้านค้า)
1. คัดลอกไฟล์ตั้งค่า :  `cp .env.example .env`
2. เปิดไฟล์ `.env` แล้วแก้ค่า `PROMPTPAY_ID` เป็น **เบอร์มือถือ** หรือ **เลขบัตรประชาชน**
   ที่ผูกพร้อมเพย์ของคุณ เช่น
   ```
   PROMPTPAY_ID=0812345678
   MERCHANT_NAME=ร้านหม่าล่าของฉัน
   ```
   > ⚠️ ค่าเริ่มต้นเป็นเบอร์ตัวอย่าง (0812345678) **ต้องแก้เป็นเลขจริงของคุณ**
   > ไม่งั้นเงินจะไม่เข้าบัญชีคุณ

เมื่อไม่ได้ตั้งค่า KBank API ระบบจะใช้พร้อมเพย์นี้โดยอัตโนมัติ และลูกค้ายืนยันการชำระ
ด้วยปุ่ม **"ฉันโอนเงินเรียบร้อยแล้ว"** (หรือให้พนักงานแคชเชียร์กดยืนยันเมื่อเห็นเงินเข้า)

### โหมดทดสอบ (Demo)
ค่าเริ่มต้น `PAYMENT_DEMO_MODE=true` จะมีปุ่ม **"จำลองว่าชำระแล้ว"** ไว้ทดสอบระบบ
โดยไม่ต้องโอนจริง — เมื่อขึ้นใช้งานจริงให้ตั้งเป็น `false`

---

## 🏦 เชื่อมต่อ KBank Open API (ไม่บังคับ — ยืนยันเงินเข้าอัตโนมัติ)

ถ้าคุณมี **บัญชีร้านค้า KBank** และสมัคร KBank Developer Portal แล้ว ระบบจะ
สร้าง QR ผ่าน KBank และ **ตรวจเงินเข้าแบบอัตโนมัติ** (ลูกค้าไม่ต้องกดยืนยันเอง —
พอจ่ายเสร็จ ออเดอร์จะเด้งเข้าครัวทันที)

กรอกค่าต่อไปนี้ในไฟล์ `.env` :
```
KBANK_ENABLED=true
KBANK_BASE_URL=https://openapi-sandbox.kasikornbank.com   # ของจริงเปลี่ยนเป็น production URL
KBANK_CONSUMER_KEY=xxxxxxxx
KBANK_CONSUMER_SECRET=xxxxxxxx
KBANK_PARTNER_ID=xxxxxxxx
KBANK_PARTNER_SECRET=xxxxxxxx
KBANK_MERCHANT_ID=xxxxxxxx
KBANK_TERMINAL_ID=xxxxxxxx
KBANK_CERT_PATH=./certs/kbank-cert.pem   # ถ้า KBank กำหนดให้ใช้ใบรับรอง mTLS
KBANK_KEY_PATH=./certs/kbank-key.pem
```
> โค้ดส่วนเชื่อมต่ออยู่ที่ `services/kbank.js` (ขอ token / สร้าง QR / เช็คสถานะ)
> ถ้า path ของ endpoint ในแพ็กเกจ API ที่ได้รับจาก KBank ต่างออกไป ปรับได้ที่ตัวแปร
> `ENDPOINTS` ในไฟล์นั้น

เมื่อกรอกครบและถูกต้อง ระบบจะสลับไปใช้ KBank อัตโนมัติ — ถ้า KBank ล่ม จะ fallback
กลับมาใช้พร้อมเพย์ให้เอง เพื่อไม่ให้ลูกค้าจ่ายไม่ได้

---

## ไฟล์สำคัญที่เพิ่ม/แก้ในเวอร์ชันนี้
| ไฟล์ | หน้าที่ |
|---|---|
| `services/promptpay.js` | สร้าง payload พร้อมเพย์ (EMVCo) + CRC16 — ผ่าน test vector มาตรฐาน |
| `services/kbank.js` | เชื่อมต่อ KBank Open API (OAuth token, สร้าง QR, เช็คสถานะ) |
| `services/paymentService.js` | เลือกใช้ KBank หรือพร้อมเพย์อัตโนมัติ + เรนเดอร์รูป QR |
| `config/payment.js` | ศูนย์รวมการตั้งค่าการชำระเงิน (อ่านจาก `.env`) |
| `.env.example` | ตัวอย่างไฟล์ตั้งค่า |
| `routes/customer.js` | ใช้ QR จริง + endpoint `/api/payment/:id/status` ตรวจเงินเข้าอัตโนมัติ |
| `views/customer/payment.ejs` | หน้าชำระเงินใหม่ (Thai QR + ยืนยัน/ตรวจอัตโนมัติ) |
| `public/css/base.css`, `customer.css` | ธีมจีนโทนแดง-ทองใหม่ทั้งหมด |

---

## หน้าจอทั้งหมด
| หน้า | URL | Use Case |
|---|---|---|
| หน้าแรก | `/` | - |
| QR Code ประจำโต๊ะ | `/qr` , `/qr/5` | - |
| เมนูอาหาร (ลูกค้า) | `/table/5/menu` | UC01 |
| เลือก/ปรับแต่งเมนู | `/table/5/item/:menuId` | UC02 |
| ตะกร้าสินค้า | `/table/5/cart` | UC03 |
| สรุปรายการสั่งซื้อ | `/table/5/summary` | UC04 |
| ชำระเงิน | `/table/5/payment/:orderId` | UC05 |
| ติดตามสถานะออเดอร์ | `/table/5/order/:orderId` | UC07, UC11 |
| แคชเชียร์ | `/cashier` | UC06 |
| ครัว | `/kitchen` , `/kitchen/status` | UC08, UC09 |
| หน้าเคาน์เตอร์ | `/counter` , `/counter/status` , `/counter/notify` | UC10, UC09, UC11 |

## ให้มือถือคนอื่นสแกนเข้าใช้งาน
- คอมที่รันเซิร์ฟเวอร์กับมือถือต้องต่อ Wi-Fi เดียวกัน
- เปิดหน้า `/qr` ระบบจะสร้าง QR ด้วย IP ของเครื่องให้อัตโนมัติ (เช่น http://192.168.1.23:3000)
- ถ้า Windows ถามเรื่อง Firewall ให้กด Allow
- ถ้า Wi-Fi ของห้องบล็อกการเชื่อมต่อระหว่างเครื่อง ให้ใช้ ngrok (`ngrok http 3000`) แล้วเอาลิงก์ที่ได้ไปใส่ในช่องที่อยู่บนหน้า `/qr`
"# MalaFinishedSakT" 
