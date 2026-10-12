/* ==========================================================================
 * FILE: utils/helpers.js
 * DESCRIPTION: รวบรวมค่าคงที่ (Constants), ฟังก์ชันแปลงรูปแบบข้อมูล (Formatters),
 *              และฟังก์ชันช่วยดึง/อัปเดตฐานข้อมูล (Database Helpers)
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & DEPENDENCIES
// ==========================================
const os = require('os');
const { dbAll, dbGet, dbRun } = require('../config/db');

// ==========================================
// SECTION 2: SYSTEM CONSTANTS & DICTIONARIES
// ==========================================

/* สถานะของคำสั่งซื้อในระบบ */
const STATUS = {
  CART: 'ตะกร้า',
  WAIT_PAY: 'รอชำระเงิน',
  PREPARING: 'กำลังเตรียมอาหาร',
  COOKED: 'ปรุงเสร็จสิ้น',
  READY: 'พร้อมเสิร์ฟ',
  DONE: 'เสร็จสิ้น'
};

/** ตัวเลือกระดับความเผ็ด */
const SPICE_LEVELS = ['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดกลาง', 'เผ็ดมาก'];

/** ช่องทางการชำระเงิน */
const PAY_METHOD = { QR: 'สแกน QR Code', CASH: 'เงินสด' };   

/** เวลาหมดอายุของการชำระเงิน (นาที) */
const PAYMENT_TIMEOUT_MIN = 15;

/** ตัวแประบบสำหรับนับจำนวนสัญญาณแจ้งเตือนเสิร์ฟอาหาร */
const notifyCount = {};

/** ไอคอนประจำหมวดหมู่อาหารสำหรับแสดงผลใน UI */
const CATEGORY_ICON = {
  'ซุป': '🍲', 'เนื้อสัตว์': '🥩', 'ซีฟู้ด': '🦐', 'ผัก': '🥬',
  'ลูกชิ้นและของแปรรูป': '🍢', 'เส้น': '🍜', 'อื่นๆ': '🥚',
  'ของทานเล่น': '🥟', 'เครื่องดื่ม': '🥤'
};

// ==========================================
// SECTION 3: FORMATTING & UTILITY FUNCTIONS
// ==========================================

/* แปลง Reference Code ให้เป็นรหัสออเดอร์แบบไม่มีเครื่องหมายขีด (เช่น 01-001 -> 01001) */
function orderNo(ref) {
  return ref ? ref.replace('-', '') : '-';
}

/* จัดรูปแบบตัวเลขเงินบาทให้มีคอมมาตามมาตรฐานไทย (เช่น 1500 -> 1,500) */
function baht(n) {
  return Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

/* จัดกลุ่มหมวดหมู่อาหารออกเป็นประเภทหลักเพื่อใช้เลือก UI แท็บ */
function groupOf(categoryName) {
  if (categoryName === 'ซุป') return 'soup';
  if (categoryName === 'ของทานเล่น') return 'snack';
  if (categoryName === 'เครื่องดื่ม') return 'drink';
  return 'raw';
}

/* ค้นหาและคืนค่า IP Address (IPv4) ของเครื่องเซิร์ฟเวอร์ในเครือข่าย LAN */
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

/* สร้าง Base URL สำหรับระบบ */
function getBaseURL(req, port = 3000) {
  if (req.query.base) return req.query.base.replace(/\/$/, '');
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  return 'http://' + getLocalIP() + ':' + port;
}

// ==========================================
// SECTION 4: DATABASE HELPER QUERIES (TABLE & CART)
// ==========================================

/* ดึงข้อมูลโต๊ะจาก Table_ID (รองรับการสั่งกลับบ้าน) */
async function getTable(tableId) {
  if (tableId === 'takeaway') {
    return { Table_ID: 'takeaway', Table_Number: 'กลับบ้าน', Table_Name: 'สั่งกลับบ้าน', Table_Status: 'ว่าง' };
  }
  return dbGet('SELECT * FROM "Table" WHERE Table_ID = ?', [tableId]);
}

/* ดึงออเดอร์ปัจจุบันที่สถานะยังเป็น 'ตะกร้า' ของโต๊ะนั้น */
async function getCart(tableId) {
  // 🟢 แปลง takeaway เป็น null แล้วใช้เช็คแบบ IS NULL สำหรับสั่งกลับบ้าน
  const dbTableId = tableId === 'takeaway' ? null : tableId;
  
  if (dbTableId === null) {
      return dbGet(
        'SELECT * FROM "Order" WHERE Table_ID IS NULL AND Order_Status = ? ORDER BY Order_ID DESC LIMIT 1',
        [STATUS.CART]
      );
  } else {
      return dbGet(
        'SELECT * FROM "Order" WHERE Table_ID = ? AND Order_Status = ? ORDER BY Order_ID DESC LIMIT 1',
        [dbTableId, STATUS.CART]
      );
  }
}

/* ดึงตะกร้าปัจจุบัน หากยังไม่มีจะสร้างออเดอร์ตะกร้าใหม่พร้อมระบุ Order_type */
async function getOrCreateCart(tableId, orderType = 'ทานที่ร้าน') {
  let cart = await getCart(tableId);
  if (!cart) {
    // 🟢 แปลง takeaway เป็น null ก่อน Insert
    const dbTableId = tableId === 'takeaway' ? null : tableId;
    
    const r = await dbRun(
      'INSERT INTO "Order" (Table_ID, Total_Price, Order_Status, Order_type, Order_Date_Time) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [dbTableId, 0, STATUS.CART, orderType]
    );
    cart = await dbGet('SELECT * FROM "Order" WHERE Order_ID = ?', [r.lastID]);
  }
  return cart;
}

/* ดึงรายการอาหารทั้งหมดภายในออเดอร์ พร้อมคำนวณราคารวมย่อย (Subtotal) */
async function getOrderItems(orderId) {
  return dbAll(
    `SELECT d.*, d.Quantity * d.Unit_Price AS Subtotal, m.Menu_Name, m.Image_URL, c.Category_Name
     FROM Order_Detail d
     JOIN Menu m ON d.Menu_ID = m.Menu_ID
     LEFT JOIN Category c ON m.Category_ID = c.Category_ID
     WHERE d.Order_ID = ?
     ORDER BY d.Order_Detail_ID`,
    [orderId]
  );
}

/* คำนวณราคารวมของออเดอร์ใหม่ พร้อมอัปเดต Order_Date_Time เพื่อรีเซ็ตเวลาหมดอายุตะกร้า (30 นาที) */
async function recalcTotal(orderId) {
  const row = await dbGet('SELECT IFNULL(SUM(Quantity * Unit_Price), 0) AS total FROM Order_Detail WHERE Order_ID = ?', [orderId]);
  await dbRun('UPDATE "Order" SET Total_Price = ?, Order_Date_Time = CURRENT_TIMESTAMP WHERE Order_ID = ?', [row.total, orderId]);
  return row.total;
}

// ==========================================
// SECTION 5: DATABASE HELPER QUERIES (ORDERS & EMPLOYEES)
// ==========================================

/* ดึงข้อมูลออเดอร์ฉบับเต็ม พร้อมข้อมูลโต๊ะ รายการอาหาร และการชำระเงิน */
async function getOrderFull(orderId) {
  const order = await dbGet(
    `SELECT o.*, t.Table_Number,
       strftime('%H:%M', o.Order_Date_Time, 'localtime') AS Order_Time,
       strftime('%d/%m/%Y', o.Order_Date_Time, 'localtime') AS Order_Date,
       p.Payment_ID, p.Payment_Method, p.Payment_Amount, p.Change_Amount, p.Payment_Status, p.Transaction_Ref
     FROM "Order" o
     LEFT JOIN "Table" t ON o.Table_ID = t.Table_ID
     LEFT JOIN Payment p ON p.Order_ID = o.Order_ID
     WHERE o.Order_ID = ?`,
    [orderId]
  );
  if (!order) return null;
  order.items = await getOrderItems(orderId);
  return order;
}

/* ดึงรายการออเดอร์ตามกลุ่มสถานะที่กำหนด (ใช้สำหรับหน้าจอเคาน์เตอร์/ห้องครัว) */
async function getOrdersByStatus(statusList, search) {
  const marks = statusList.map(() => '?').join(',');
  let sql = `SELECT o.*, t.Table_Number,
       strftime('%H:%M', o.Order_Date_Time, 'localtime') AS Order_Time,
       (SELECT COUNT(*) FROM Order_Detail d WHERE d.Order_ID = o.Order_ID) AS Item_Count
     FROM "Order" o
     LEFT JOIN "Table" t ON o.Table_ID = t.Table_ID
     WHERE o.Order_Status IN (${marks})`;
  const params = [...statusList];
  if (search) {
    sql += ` AND REPLACE(o.Reference_Code, '-', '') LIKE ?`;
    params.push('%' + search.replace('-', '') + '%');
  }
  sql += ' ORDER BY o.Order_Date_Time ASC';
  const orders = await dbAll(sql, params);
  for (const o of orders) o.items = await getOrderItems(o.Order_ID);
  return orders;
}

/* รันเลขรหัสอ้างอิงออเดอร์ (เช่น 01-001 หรือ TK-001 สำหรับกลับบ้าน) */
async function makeReferenceCode(table) {
  const prefix = table.Table_ID === 'takeaway' ? 'TK' : table.Table_Number;
  
  // ค้นหาเลขรันนิ่งล่าสุดของวันนี้จาก Reference_Code (Prefix) โดยตรง
  const row = await dbGet(
    `SELECT MAX(CAST(SUBSTR(Reference_Code, INSTR(Reference_Code, '-') + 1) AS INTEGER)) AS n
     FROM "Order"
     WHERE Reference_Code LIKE ?
       AND date(Order_Date_Time, '+7 hours') = date('now', '+7 hours')`,
    [prefix + '-%']
  );

  return prefix + '-' + String((row.n || 0) + 1).padStart(3, '0');
}

/* ดึงข้อมูลพนักงานตามตำแหน่ง/บทบาท (Role) */
async function getEmployee(role) {
  return dbGet('SELECT * FROM Employee WHERE Role = ? LIMIT 1', [role]);
}

// ==========================================
// SECTION 6: EXPORTS
// ==========================================
module.exports = {
  STATUS, SPICE_LEVELS, PAY_METHOD, PAYMENT_TIMEOUT_MIN, notifyCount, CATEGORY_ICON,
  orderNo, baht, groupOf, getLocalIP, getBaseURL,
  getTable, getCart, getOrCreateCart, getOrderItems, recalcTotal,
  getOrderFull, getOrdersByStatus, makeReferenceCode, getEmployee
};