/* ==========================================================================
 * FILE: routes/kitchen.js
 * DESCRIPTION: การทำงานฝั่งห้องครัว จัดการรายการอาหารที่ต้องปรุง พิมพ์ตั๋วสั่งอาหาร และอัปเดตสถานะการปรุง
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & DEPENDENCIES
// ==========================================
const express = require('express');
const router = express.Router();
const { dbGet, dbRun } = require('../config/db');
const { STATUS, orderNo, getOrderFull, getOrdersByStatus, getEmployee } = require('../utils/helpers');

// ==========================================
// SECTION 2: KITCHEN DASHBOARD & PRINTING
// ==========================================

/*แสดงรายการออเดอร์ที่ต้องปรุงในห้องครัว (แท็บ: กำลังเตรียม / ปรุงเสร็จ / เสร็จสิ้น)*/
router.get('/kitchen', async (req, res) => {
  try {
    const tab = req.query.tab || 'preparing';
    const q = (req.query.q || '').trim();

    const preparing = await getOrdersByStatus([STATUS.PREPARING], q);
    const cooked = await getOrdersByStatus([STATUS.COOKED], q);
    const doneToday = await dbGet(
      `SELECT COUNT(*) AS n FROM "Order" WHERE Order_Status IN (?, ?)
       AND date(Order_Date_Time, 'localtime') = date('now', 'localtime')`,
      [STATUS.READY, STATUS.DONE]
    );

    let list = preparing;
    if (tab === 'cooked') list = cooked;
    
    // กรองเฉพาะออเดอร์ของ "วันนี้"
    if (tab === 'done') {
      const allDone = await getOrdersByStatus([STATUS.READY, STATUS.DONE], q);
      
      const todayOrders = await dbGet(
        `SELECT GROUP_CONCAT(Order_ID) AS ids FROM "Order" 
         WHERE Order_Status IN (?, ?) 
         AND date(Order_Date_Time, 'localtime') = date('now', 'localtime')`,
        [STATUS.READY, STATUS.DONE]
      );
      
      const todayIds = todayOrders && todayOrders.ids ? todayOrders.ids.split(',').map(String) : [];
      list = allDone.filter(o => todayIds.includes(String(o.Order_ID)));
    }

    if (tab === 'all') {
      list = await getOrdersByStatus([STATUS.PREPARING, STATUS.COOKED, STATUS.READY, STATUS.DONE], q);
    }

    let selected = null;
    if (req.query.id) selected = await getOrderFull(req.query.id);

    const employee = await getEmployee('ครัว');
    res.render('kitchen/index', {
      tab, q, list, selected, employee,
      counts: { preparing: preparing.length, cooked: cooked.length, done: doneToday.n },
      success: req.query.success
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* พิมพ์ใบตั๋วสั่งอาหารสำหรับส่งให้แม่ครัว/พ่อครัว */
router.get('/kitchen/print/:orderId', async (req, res) => {
  try {
    const order = await getOrderFull(req.params.orderId);
    if (!order) return res.status(404).send('ไม่พบออเดอร์');
    res.render('kitchen/print', { order });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 3: COOKING STATUS UPDATE
// ==========================================

/* หน้าอัปเดตสถานะการปรุงอาหาร */
router.get('/kitchen/status', async (req, res) => {
  try {
    const list = await getOrdersByStatus([STATUS.PREPARING]);
    let selected = null;
    const id = req.query.id || (list[0] ? list[0].Order_ID : null);
    if (id) selected = await getOrderFull(id);
    const employee = await getEmployee('ครัว');
    res.render('kitchen/status', { list, selected, employee, success: req.query.success });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* อัปเดตสถานะออเดอร์จาก 'กำลังเตรียมอาหาร' เป็น 'ปรุงเสร็จสิ้น' */
router.post('/kitchen/status/:orderId', async (req, res) => {
  try {
    await dbRun('UPDATE "Order" SET Order_Status = ? WHERE Order_ID = ? AND Order_Status = ?',
      [STATUS.COOKED, req.params.orderId, STATUS.PREPARING]);
    const o = await dbGet('SELECT Reference_Code FROM "Order" WHERE Order_ID = ?', [req.params.orderId]);
    res.redirect('/kitchen?success=' + encodeURIComponent(orderNo(o ? o.Reference_Code : '')));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 4: EXPORTS
// ==========================================
module.exports = router;