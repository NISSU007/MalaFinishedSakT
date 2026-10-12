// ============================================================================
// config/payment.js
// ศูนย์รวมการตั้งค่าการชำระเงินทั้งหมด (พร้อมเพย์ + KBank API)
//
// วิธีแก้ค่า: แก้ที่ไฟล์ .env (คัดลอกจาก .env.example) หรือแก้ค่า default ด้านล่างตรง ๆ
// ค่าใน .env จะทับค่า default เสมอ
// ============================================================================

const fs = require('fs');
const path = require('path');

// ---- ตัวอ่านไฟล์ .env แบบง่าย (ไม่ต้องติดตั้งไลบรารีเพิ่ม) ----
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    });
  } catch (e) {
    console.warn('อ่านไฟล์ .env ไม่สำเร็จ:', e.message);
  }
})();

const env = process.env;

const config = {
  // ========================================================================
  // 1) พร้อมเพย์ (PromptPay) — ใช้ได้ทั้งบัญชีส่วนตัวและร้านค้า
  //    QR ที่สร้างจากเลขนี้จะ "สแกนได้จริง" และโชว์ยอดเงินทันทีในทุกแอปธนาคาร
  //    *** แก้เป็นเบอร์มือถือ/เลขบัตรประชาชนที่ผูกพร้อมเพย์ของคุณ ***
  // ========================================================================
  promptpayId: env.PROMPTPAY_ID || '0988588573',   // ← ตัวอย่าง: แก้เป็นเลขพร้อมเพย์จริงของร้าน
  merchantName: env.MERCHANT_NAME || 'ร้านหม่าล่า Self Service',

  // ========================================================================
  // 2) KBank Open API (ไม่บังคับ)
  //    ถ้ากรอกครบ ระบบจะใช้ KBank สร้าง QR + ยืนยันเงินเข้าอัตโนมัติ
  //    ถ้าเว้นว่าง ระบบจะใช้พร้อมเพย์ด้านบนแทน (ยืนยันการชำระด้วยมือ)
  //    ต้องมี: บัญชีร้านค้า KBank + Consumer Key/Secret + ใบรับรอง (certificate)
  // ========================================================================
  kbank: {
    enabled: String(env.KBANK_ENABLED || 'false').toLowerCase() === 'true',
    baseUrl: env.KBANK_BASE_URL || 'https://openapi-sandbox.kasikornbank.com',
    consumerKey: env.KBANK_CONSUMER_KEY || '',
    consumerSecret: env.KBANK_CONSUMER_SECRET || '',
    partnerId: env.KBANK_PARTNER_ID || '',
    partnerSecret: env.KBANK_PARTNER_SECRET || '',
    merchantId: env.KBANK_MERCHANT_ID || '',
    terminalId: env.KBANK_TERMINAL_ID || '',
    // path ไปยังไฟล์ใบรับรอง mTLS (ถ้า KBank กำหนดให้ใช้)
    certPath: env.KBANK_CERT_PATH || '',
    keyPath: env.KBANK_KEY_PATH || ''
  },

  // ========================================================================
  // 3) โหมดจำลอง (Demo)
  //    true  = แสดงปุ่ม "จำลองว่าชำระแล้ว" ไว้ทดสอบระบบโดยไม่ต้องโอนจริง
  //    false = ซ่อนปุ่มจำลอง (ใช้ตอนขึ้นใช้งานจริง)
  // ========================================================================
  demoMode: String(env.PAYMENT_DEMO_MODE || 'true').toLowerCase() === 'true',

  // เวลาหมดอายุของ QR (วินาที) สำหรับฝั่งแสดงผล
  qrTimeoutSec: parseInt(env.QR_TIMEOUT_SEC || '900', 10)
};

// ใช้ KBank จริงก็ต่อเมื่อเปิดใช้งานและกรอก key ครบ
config.useKbank = !!(config.kbank.enabled && config.kbank.consumerKey && config.kbank.consumerSecret);

module.exports = config;
