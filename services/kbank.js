/* ==========================================================================
 * FILE: services/kbank.js
 * DESCRIPTION: ตัวเชื่อมต่อ KBank Open API สำหรับระบบชำระเงิน Thai QR Payment
 *              ครอบคลุมการขอ OAuth2 Token, การสร้าง Dynamic QR Code 
 *              และการดึงข้อมูลตรวจสอบสถานะเงินเข้าอัตโนมัติ
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & CONFIGURATION
// ==========================================
const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const cfg = require('../config/payment');

// ==========================================
// SECTION 2: API ENDPOINTS
// ==========================================
const ENDPOINTS = {
  token: '/v2/oauth/token',
  qrRequest: '/v1/qrpayment/request',
  qrInquiry: '/v1/qrpayment/inquiry'
};

// ==========================================
// SECTION 3: HTTPS REQUEST HELPER (mTLS SUPPORT)
// ==========================================

/* ฟังก์ชันยิง HTTPS Request ไปยัง KBank API */
function httpsRequest(method, fullUrl, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(fullUrl); } catch (e) { return reject(e); }

    const body = bodyObj
      ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj))
      : null;

    const options = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: Object.assign({}, headers)
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    // แนบใบรับรอง mTLS ถ้ามีการตั้งค่า certPath/keyPath ใน config
    try {
      if (cfg.kbank.certPath && fs.existsSync(cfg.kbank.certPath)) {
        options.cert = fs.readFileSync(cfg.kbank.certPath);
      }
      if (cfg.kbank.keyPath && fs.existsSync(cfg.kbank.keyPath)) {
        options.key = fs.readFileSync(cfg.kbank.keyPath);
      }
    } catch (e) {
      return reject(new Error('อ่านไฟล์ใบรับรอง KBank ไม่สำเร็จ: ' + e.message));
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : {}; } catch (e) { json = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
        } else {
          reject(new Error('KBank API ' + res.statusCode + ': ' + data.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('KBank API timeout')));
    if (body) req.write(body);
    req.end();
  });
}

// ==========================================
// SECTION 4: OAUTH2 ACCESS TOKEN MANAGEMENT
// ==========================================
let _token = null;
let _tokenExp = 0;

/**
 * ขอ Access Token แบบ OAuth2 (Client Credentials Flow)
 * มีระบบ Memory Cache ในตัวเพื่อนำ Token เดิมมาใช้ซ้ำจนกว่าจะใกล้หมดอายุ
*/
async function getAccessToken() {
  const now = Date.now();
  if (_token && now < _tokenExp - 30000) return _token;

  const basic = Buffer
    .from(cfg.kbank.consumerKey + ':' + cfg.kbank.consumerSecret)
    .toString('base64');

  const res = await httpsRequest(
    'POST',
    cfg.kbank.baseUrl + ENDPOINTS.token,
    {
      'Authorization': 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    'grant_type=client_credentials'
  );

  _token = res.access_token;
  const ttl = (parseInt(res.expires_in, 10) || 300) * 1000;
  _tokenExp = now + ttl;
  if (!_token) throw new Error('ขอ Access Token จาก KBank ไม่สำเร็จ');
  return _token;
}

// ==========================================
// SECTION 5: QR GENERATION & INQUIRY API
// ==========================================

/* ส่งคำขอสร้าง Thai QR Payment (Dynamic QR พร้อมล็อกยอดเงิน) สำหรับ 1 คำสั่งซื้อ */
async function createQr({ amount, reference }) {
  const token = await getAccessToken();
  const partnerTxnUid = 'MALA' + Date.now();

  const payload = {
    partnerTxnUid,
    partnerId: cfg.kbank.partnerId,
    partnerSecret: cfg.kbank.partnerSecret,
    requestDt: new Date().toISOString(),
    merchantId: cfg.kbank.merchantId,
    terminalId: cfg.kbank.terminalId || undefined,
    qrType: '3',                       // 3 = Thai QR Tax (Dynamic QR)
    txnAmount: Number(amount).toFixed(2),
    txnCurrencyCode: 'THB',
    reference1: reference,
    metadata: ''
  };

  const res = await httpsRequest(
    'POST',
    cfg.kbank.baseUrl + ENDPOINTS.qrRequest,
    {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'env': cfg.kbank.enabled ? '' : undefined
    },
    payload
  );

  const qrPayload = res.qrCode || res.qrCodeData || res.qrImage || null;
  if (!qrPayload) throw new Error('KBank ไม่ส่ง QR กลับมา: ' + JSON.stringify(res).slice(0, 200));

  return { qrPayload, partnerTxnUid, raw: res };
}

/* ตรวจสอบสถานะธุรกรรมการชำระเงินกับ KBank */
async function inquire({ partnerTxnUid }) {
  const token = await getAccessToken();

  const payload = {
    partnerTxnUid,
    partnerId: cfg.kbank.partnerId,
    partnerSecret: cfg.kbank.partnerSecret,
    requestDt: new Date().toISOString(),
    merchantId: cfg.kbank.merchantId,
    origPartnerTxnUid: partnerTxnUid
  };

  const res = await httpsRequest(
    'POST',
    cfg.kbank.baseUrl + ENDPOINTS.qrInquiry,
    {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload
  );

  const status = (res.txnStatus || res.status || '').toString().toUpperCase();
  const paid = ['PAID', 'SUCCESS', 'SETTLED', 'COMPLETED'].includes(status);
  return { paid, status, amount: Number(res.txnAmount || 0), raw: res };
}

// ==========================================
// SECTION 6: EXPORTS
// ==========================================
module.exports = { getAccessToken, createQr, inquire, ENDPOINTS };