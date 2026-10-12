/* ==========================================================================
 * FILE: services/promptpay.js
 * DESCRIPTION: คำนวณและสร้าง Payload สตริงมาตรฐาน Thai QR Payment (EMVCo)
 *              สำหรับพร้อมเพย์ สามารถใช้แอปธนาคารสแกนได้จริง
 * ========================================================================== */

// ==========================================
// SECTION 1: EMVCO TLV & CRC16 UTILITIES
// ==========================================

/* ประกอบข้อมูล 1 ฟิลด์ตามมาตรฐาน TLV (Tag-Length-Value) ของ EMVCo */
function field(id, value) {
  const v = String(value);
  const len = String(v.length).padStart(2, '0');
  return id + len + v;
}

/**
 * คำนวณค่าตรวจสอบความถูกต้อง CRC16-CCITT (False)
 * Polynomial: 0x1021, Initial value: 0xFFFF
*/
function crc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ==========================================
// SECTION 2: PROMPTPAY TARGET SANITIZATION & FORMATTING
// ==========================================

/* ทำความสะอาดตัวเลขโดยการลบตัวอักษรที่ไม่ใช่ตัวเลขออกทั้งหมด */
function sanitize(id) {
  return String(id || '').replace(/[^0-9]/g, '');
}

/* จัดรูปแบบบัญชีพร้อมเพย์เป้าหมายให้อยู่ในโครงสร้าง EMVCo Sub-Tag ที่ถูกต้อง: */
function formatTarget(promptpayId) {
  const id = sanitize(promptpayId);

  // กรณีเบอร์มือถือ 10 หลัก
  if (id.length === 10 && id.startsWith('0')) {
    const intl = '66' + id.substring(1);
    return { subTag: '01', value: intl.padStart(13, '0') };
  }
  // กรณีเลขบัตรประชาชน / เลขผู้เสียภาษี 13 หลัก
  if (id.length === 13) {
    return { subTag: '02', value: id };
  }
  // กรณี e-Wallet 15 หลัก
  if (id.length === 15) {
    return { subTag: '03', value: id };
  }
  // กรณีสำรอง (Fallback)
  const fallback = id.startsWith('66') ? id : ('66' + id.replace(/^0/, ''));
  return { subTag: '01', value: fallback.padStart(13, '0') };
}

// ==========================================
// SECTION 3: EMVCO THAI QR PAYLOAD BUILDER
// ==========================================

/* สร้าง Payload สตริงฉบับเต็มตามมาตรฐาน EMVCo / Thai QR Payment */
function buildPromptPayPayload(promptpayId, amount) {
  const target = formatTarget(promptpayId);
  const hasAmount = amount !== undefined && amount !== null && Number(amount) > 0;

  // Tag 29: Merchant Account Information (PromptPay)
  const AID = 'A000000677010111'; // Application ID ของพร้อมเพย์ประเทศไทย
  const merchantAccount =
    field('00', AID) +
    field(target.subTag, target.value);

  let payload = '';
  payload += field('00', '01');
  payload += field('01', '11');
  payload += field('29', merchantAccount);
  payload += field('58', 'TH');
  payload += field('53', '764');
  if (hasAmount) {
    payload += field('54', Number(amount).toFixed(2));
  }

  // Tag 63: CRC16 Calculation
  const toCheck = payload + '6304';
  payload = toCheck + crc16(toCheck);
  return payload;
}

// ==========================================
// SECTION 4: EXPORTS
// ==========================================
module.exports = { buildPromptPayPayload, crc16, formatTarget };