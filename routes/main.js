/* ==========================================================================
 * FILE: routes/main.js
 * DESCRIPTION: การทำงานหน้าหลักของระบบ จัดการหน้าเลือกบทบาทผู้ใช้ และการสร้าง QR Code ประจำโต๊ะ
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & DEPENDENCIES
// ==========================================
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { dbAll } = require('../config/db');
const { getBaseURL, getTable } = require('../utils/helpers');

// ==========================================
// SECTION 2: LANDING PAGE & ROLE SELECTION
// ==========================================

/* หน้าแรกของระบบสำหรับเลือกบทบาทการใช้งาน (ลูกค้า, พนักงาน, แคชเชียร์ ฯลฯ) */
router.get('/', async (req, res) => {
  try {
    const tables = await dbAll('SELECT * FROM "Table" ORDER BY Table_ID');
    res.render('index', { tables, baseURL: getBaseURL(req) });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 3: TABLE QR CODE GENERATION
// ==========================================

/* แสดงรายการ QR Code ประจำโต๊ะทั้งหมดในร้าน พร้อมแทรก QR สั่งกลับบ้าน */
router.get('/qr', async (req, res) => {
  try {
    const baseURL = getBaseURL(req);
    const tables = await dbAll('SELECT * FROM "Table" ORDER BY Table_ID');
    for (const t of tables) {
      t.fullURL = baseURL + t.QR_Code_URL;
      t.qrImage = await QRCode.toDataURL(t.fullURL, { width: 320, margin: 1 });
    }
    
    // แทรกข้อมูลโต๊ะจำลองสำหรับ "สั่งกลับบ้าน" ไว้ที่ส่วนท้ายของอาร์เรย์ tables
    const takeawayURL = baseURL + '/table/takeaway?type=takeaway';
    tables.push({
      Table_ID: 'takeaway',
      Table_Number: 'กลับบ้าน',
      Table_Name: 'สั่งกลับบ้าน',
      QR_Code_URL: '/table/takeaway?type=takeaway',
      fullURL: takeawayURL,
      qrImage: await QRCode.toDataURL(takeawayURL, { width: 320, margin: 1 })
    });

    res.render('staff/qr', { tables, baseURL, single: false });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* แสดง QR Code ประจำโต๊ะเฉพาะโต๊ะที่ระบุ (รองรับแบบเจาะจง Table_ID หรือสั่งกลับบ้าน) */
router.get('/qr/:tableId', async (req, res) => {
  try {
    const baseURL = getBaseURL(req);
    // กรณีเป็น QR โต๊ะจำลองสำหรับสั่งกลับบ้าน
    if (req.params.tableId === 'takeaway') {
      const takeawayURL = baseURL + '/table/takeaway?type=takeaway';
      const t = {
        Table_ID: 'takeaway',
        Table_Number: 'กลับบ้าน',
        Table_Name: 'สั่งกลับบ้าน',
        QR_Code_URL: '/table/takeaway?type=takeaway',
        fullURL: takeawayURL,
        qrImage: await QRCode.toDataURL(takeawayURL, { width: 480, margin: 1 })
      };
      return res.render('staff/qr', { tables: [t], baseURL, single: true });
    }

    // กรณีเป็นโต๊ะปกติ
    const t = await getTable(req.params.tableId);
    if (!t) return res.status(404).send('ไม่พบโต๊ะ');
    t.fullURL = baseURL + t.QR_Code_URL;
    t.qrImage = await QRCode.toDataURL(t.fullURL, { width: 480, margin: 1 });
    res.render('staff/qr', { tables: [t], baseURL, single: true });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 4: EXPORTS
// ==========================================
module.exports = router;
    
