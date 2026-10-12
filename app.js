/* ==========================================================================
 * FILE: app.js
 * DESCRIPTION: ไฟล์หลักในการตั้งค่า Express Server, Middleware, Routes 
 *              และ Background Job สำหรับระบบตัดออเดอร์อัตโนมัติ
 * ========================================================================== */

// ==========================================
// SECTION 1: MODULE IMPORTS & CONFIGURATIONS
// ==========================================
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');

// นำเข้า Database Connection และ Utility Helpers
const { orderNo, baht, STATUS, CATEGORY_ICON, getLocalIP, PAYMENT_TIMEOUT_MIN } = require('./utils/helpers');
const { dbAll, dbRun } = require('./config/db');

// ==========================================
// SECTION 2: EXPRESS APP SETUP & MIDDLEWARE
// ==========================================
const app = express();
const PORT = 3000;

// ตั้งค่า View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static Files & Request Body Parsers
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ตั้งค่า Cookie Session สำหรับจดจำสถานะผู้ใช้งาน
app.use(
  cookieSession({
    name: 'mala_session',
    keys: ['mala-secret-key-1', 'mala-secret-key-2'],
    maxAge: 24 * 60 * 60 * 1000 // หมดอายุภายใน 24 ชั่วโมง
  })
);

// ==========================================
// SECTION 3: EJS GLOBAL LOCALS
// ==========================================
// ประกาศตัวแปร/ฟังก์ชันเพื่อให้ทุกหน้า EJS สามารถเรียกใช้งานได้ทันที
app.locals.orderNo = orderNo;
app.locals.baht = baht;
app.locals.STATUS = STATUS;
app.locals.CATEGORY_ICON = CATEGORY_ICON;

// ==========================================
// SECTION 4: ROUTE REGISTRATION (ACTOR ROUTING)
// ==========================================
const mainRoutes = require('./routes/main');
const customerRoutes = require('./routes/customer');
const cashierRoutes = require('./routes/cashier');
const kitchenRoutes = require('./routes/kitchen');
const counterRoutes = require('./routes/counter');

app.use('/', mainRoutes);
app.use('/', customerRoutes);
app.use('/', cashierRoutes);
app.use('/', kitchenRoutes);
app.use('/', counterRoutes);

// ==========================================
// SECTION 5: BACKGROUND PROCESS (AUTO-CANCEL TASK)
// DESCRIPTION: ทำงานอัตโนมัติตามเวลาที่กำหนด (ทุก 1 นาที) เพื่อกวาดล้าง
//              ออเดอร์หมดอายุ (ตะกร้า 30 นาที / รอชำระ 15 นาที) และคืนสถานะโต๊ะ
// ==========================================
setInterval(async () => {
  try {
    // 5.1 ค้นหาออเดอร์สถานะ "รอชำระเงิน" (WAIT_PAY) ที่เกินเวลา (15 นาที)
    const expiredWaitPay = await dbAll(
      `SELECT Order_ID, Table_ID FROM "Order"
       WHERE Order_Status = ?
       AND (julianday('now') - julianday(Order_Date_Time)) * 24 * 60 > ?`,
      [STATUS.WAIT_PAY, PAYMENT_TIMEOUT_MIN]
    );

    // 5.2 ค้นหาออเดอร์สถานะ "ตะกร้า" (CART) ที่ไม่มีการอัปเดตเกิน 30 นาที
    const expiredCart = await dbAll(
      `SELECT Order_ID, Table_ID FROM "Order"
       WHERE Order_Status = ?
       AND (julianday('now') - julianday(Order_Date_Time)) * 24 * 60 > ?`,
      [STATUS.CART, 30]
    );

    const allExpired = [...expiredWaitPay, ...expiredCart];

    // 5.3 ยกเลิกออเดอร์และ คืนสถานะโต๊ะกลับเป็น "ว่าง"
    if (allExpired.length > 0) {
      for (const order of allExpired) {
        await dbRun('UPDATE "Order" SET Order_Status = ? WHERE Order_ID = ?', ['ยกเลิก', order.Order_ID]);
        if (order.Table_ID) {
          await dbRun('UPDATE "Table" SET Table_Status = ? WHERE Table_ID = ?', ['ว่าง', order.Table_ID]);
        }
      }
      console.log(`[Auto-Cancel] ยกเลิกออเดอร์หมดอายุและคืนโต๊ะอัตโนมัติ จำนวน ${allExpired.length} รายการ`);
    }
  } catch (err) {
    console.error('[Auto-Cancel Error]:', err.message);
  }
}, 60000); // รันทุก 1 นาที (60,000 ms)

// ==========================================
// SECTION 6: SERVER START
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('เปิดบนเครื่องนี้  : http://localhost:' + PORT);
  console.log('ให้มือถือสแกนผ่าน : http://' + getLocalIP() + ':' + PORT + '/qr');
});