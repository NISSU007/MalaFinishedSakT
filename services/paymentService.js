/* ==========================================================================
 * FILE: services/paymentService.js
 * DESCRIPTION: Service Layer สำหรับเลือกและสลับรูปแบบ QR Payment อัตโนมัติ:
 *              1) หากเปิดใช้ KBank -> ใช้ KBank Open API (ยืนยันยอดอัตโนมัติ)
 *              2) หากปิด KBank / ล้มเหลว -> Fallback ไปใช้ PromptPay ทันที
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & DEPENDENCIES
// ==========================================
const QRCode = require('qrcode');
const cfg = require('../config/payment');
const { buildPromptPayPayload } = require('./promptpay');
const kbank = require('./kbank');

// ==========================================
// SECTION 2: TRANSACTION CACHE
// ==========================================
// เก็บจับคู่ระหว่าง Order_ID กับ partnerTxnUid ของ KBank ไว้ตรวจสอบสถานะ
const _kbankTxn = {}; 

// ==========================================
// SECTION 3: QR CODE CREATION SERVICE
// ==========================================

/**
 * สร้างรูปภาพ QR Code สำหรับคำสั่งซื้อ
 * สลับระหว่าง KBank และ PromptPay ตามการตั้งค่าในระบบ
*/
async function createOrderQr(order) {
  const amount = Number(order.Total_Price) || 0;
  const reference = order.Reference_Code || ('ORDER' + order.Order_ID);

  // ----- ทางเลือกที่ 1: KBank Open API -----
  if (cfg.useKbank) {
    try {
      const { qrPayload, partnerTxnUid } = await kbank.createQr({ amount, reference });
      _kbankTxn[order.Order_ID] = partnerTxnUid;
      const qrImage = await QRCode.toDataURL(qrPayload, { width: 320, margin: 1 });
      return {
        provider: 'kbank',
        qrImage,
        payload: qrPayload,
        merchantName: cfg.merchantName,
        autoConfirm: true
      };
    } catch (err) {
      console.error('KBank สร้าง QR ไม่สำเร็จ, สลับไปใช้พร้อมเพย์:', err.message);
    }
  }

  // ----- ทางเลือกที่ 2: พร้อมเพย์ (PromptPay Standard) -----
  const payload = buildPromptPayPayload(cfg.promptpayId, amount);
  const qrImage = await QRCode.toDataURL(payload, {
    width: 320, margin: 1,
    color: { dark: '#8e1a13', light: '#ffffff' }   // ธีมสีแดงร้านหมาล่า
  });
  return {
    provider: 'promptpay',
    qrImage,
    payload,
    promptpayId: cfg.promptpayId,
    merchantName: cfg.merchantName,
    autoConfirm: false   // PromptPay บัญชีทั่วไปต้องอาศัยการยืนยันเงินสด/สลิป
  };
}

// ==========================================
// SECTION 4: PAYMENT VERIFICATION SERVICE
// ==========================================

/* ตรวจสอบสถานะว่าออเดอร์นี้ชำระเงินผ่าน KBank สำเร็จแล้วหรือยัง */
async function isOrderPaidViaKbank(order) {
  if (!cfg.useKbank) return { paid: false, supported: false };
  const partnerTxnUid = _kbankTxn[order.Order_ID];
  if (!partnerTxnUid) return { paid: false, supported: true };
  try {
    const r = await kbank.inquire({ partnerTxnUid });
    return { paid: r.paid, supported: true, status: r.status };
  } catch (err) {
    console.error('KBank inquiry ล้มเหลว:', err.message);
    return { paid: false, supported: true, error: err.message };
  }
}

// ==========================================
// SECTION 5: EXPORTS
// ==========================================
module.exports = { createOrderQr, isOrderPaidViaKbank, config: cfg };