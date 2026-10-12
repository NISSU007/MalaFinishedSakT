/* ==========================================================================
 * FILE: routes/counter.js
 * DESCRIPTION: การทำงานฝั่งหน้าเคาน์เตอร์ ระบบจัดการออเดอร์พร้อมเสิร์ฟ การส่งสัญญาณเรียกรับอาหาร
 *              และการคืนสถานะโต๊ะเป็น "ว่าง" เมื่อเสิร์ฟเสร็จสิ้น
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & DEPENDENCIES
// ==========================================
const express = require('express');
const router = express.Router();
const { dbGet, dbRun } = require('../config/db');
const { STATUS, notifyCount, orderNo, getOrderFull, getOrdersByStatus, getEmployee } = require('../utils/helpers');

// ==========================================
// SECTION 2: COUNTER DASHBOARD & API POLLING
// ==========================================

/* แสดงออเดอร์ที่เคาน์เตอร์ (แบ่งแท็บ: กำลังเตรียม / ปรุงเสร็จ / เสร็จสิ้น) */
router.get('/counter', async (req, res) => {
  try {
    const tab = req.query.tab || 'cooked';
    const q = (req.query.q || '').trim();

    const preparing = await getOrdersByStatus([STATUS.PREPARING], q);
    const cooked = await getOrdersByStatus([STATUS.COOKED], q);
    const ready = await getOrdersByStatus([STATUS.READY], q);

    const doneToday = await dbGet(
      `SELECT COUNT(*) AS n FROM "Order" WHERE Order_Status IN (?, ?)
       AND date(Order_Date_Time, 'localtime') = date('now', 'localtime')`,
      [STATUS.READY, STATUS.DONE]
    );

    let list = cooked;
    if (tab === 'preparing') list = preparing;
    if (tab === 'cooked') list = cooked;

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

    let selected = null;
    if (req.query.id) selected = await getOrderFull(req.query.id);

    const employee = await getEmployee('หน้าเคาน์เตอร์');

    res.render('counter/index', {
      tab, q, list, selected, employee,
      counts: {
        preparing: preparing.length,
        cooked: cooked.length,
        ready: ready.length,
        done: doneToday.n
      },
      page: 'ready',
      success: req.query.success
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* API Polling สำหรับอัปเดตหน้าจอหลักของเคาน์เตอร์แบบ Real-time */
router.get('/counter/api', async (req, res) => {
  try {
    const tab = req.query.tab || 'cooked';
    const q = (req.query.q || '').trim();

    const preparing = await getOrdersByStatus([STATUS.PREPARING], q);
    const cooked = await getOrdersByStatus([STATUS.COOKED], q);
    const ready = await getOrdersByStatus([STATUS.READY], q);

    const doneToday = await dbGet(
      `SELECT COUNT(*) AS n FROM "Order" WHERE Order_Status IN (?, ?)
       AND date(Order_Date_Time, 'localtime') = date('now', 'localtime')`,
      [STATUS.READY, STATUS.DONE]
    );

    let list = cooked;
    if (tab === 'preparing') list = preparing;
    if (tab === 'cooked') list = cooked;

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

    res.json({
      counts: {
        preparing: preparing.length,
        cooked: cooked.length,
        ready: ready.length,
        done: doneToday.n
      },
      list
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SECTION 3: READY FOR SERVING STATUS
// ==========================================

/* แสดงรายการอาหารที่ปรุงเสร็จเพื่อรอเปลี่ยนสถานะเป็น "พร้อมเสิร์ฟ" */
router.get('/counter/status', async (req, res) => {
  try {
    const list = await getOrdersByStatus([STATUS.COOKED]);
    const readyList = await getOrdersByStatus([STATUS.READY]);
    
    let selected = null;
    const id = req.query.id || (list[0] ? list[0].Order_ID : null);
    if (id) selected = await getOrderFull(id);
    const employee = await getEmployee('หน้าเคาน์เตอร์');
    
    res.render('counter/status', {
      list, selected, employee,
      counts: { cooked: list.length, ready: readyList.length },
      page: 'status',
      success: req.query.success
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* API Polling สำหรับหน้าเปลี่ยนสถานะออเดอร์ */
router.get('/counter/status/api', async (req, res) => {
  try {
    const list = await getOrdersByStatus([STATUS.COOKED]);
    const readyList = await getOrdersByStatus([STATUS.READY]);
    
    res.json({
      counts: { cooked: list.length, ready: readyList.length },
      list
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* อัปเดตสถานะออเดอร์จาก 'ปรุงเสร็จสิ้น' เป็น 'พร้อมเสิร์ฟ' */
router.post('/counter/status/:orderId', async (req, res) => {
  try {
    const r = await dbRun('UPDATE "Order" SET Order_Status = ? WHERE Order_ID = ? AND Order_Status = ?',
      [STATUS.READY, req.params.orderId, STATUS.COOKED]);
    if (r.changes > 0) notifyCount[req.params.orderId] = 1;
    const o = await dbGet('SELECT Reference_Code FROM "Order" WHERE Order_ID = ?', [req.params.orderId]);
    
    res.redirect('/counter?tab=cooked&success=' + encodeURIComponent(orderNo(o ? o.Reference_Code : '')));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 4: NOTIFICATION & ORDER COMPLETION
// ==========================================

/* แสดงหน้าส่งสัญญาณแจ้งเตือนการรับอาหารไปยังลูกค้า */
router.get('/counter/notify', async (req, res) => {
  try {
    const list = await getOrdersByStatus([STATUS.READY]);
    const cookedList = await getOrdersByStatus([STATUS.COOKED]);
    
    let selected = null;
    const id = req.query.id || (list[0] ? list[0].Order_ID : null);
    if (id) selected = await getOrderFull(id);
    if (selected) selected.notify = notifyCount[selected.Order_ID] || 0;
    
    const employee = await getEmployee('หน้าเคาน์เตอร์');
    
    res.render('counter/notify', {
      list, selected, employee,
      counts: { cooked: cookedList.length, ready: list.length },
      page: 'notify',
      message: req.query.message
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* API Polling สำหรับหน้าส่งสัญญาณแจ้งเตือน */
router.get('/counter/notify/api', async (req, res) => {
  try {
    const list = await getOrdersByStatus([STATUS.READY]);
    const cookedList = await getOrdersByStatus([STATUS.COOKED]);
    
    res.json({
      counts: { cooked: cookedList.length, ready: list.length },
      list
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* สั่งส่งสัญญาณแจ้งเตือนเรียกให้ลูกค้ารับอาหารซ้ำ (Re-notify) */
router.post('/counter/notify/:orderId', (req, res) => {
  const id = req.params.orderId;
  notifyCount[id] = (notifyCount[id] || 0) + 1;
  res.redirect('/counter/notify?id=' + id + '&message=renotify');
});

/* ยืนยันการรับอาหาร/เสิร์ฟเสร็จสิ้น เปลี่ยนสถานะออเดอร์เป็น 'เสร็จสิ้น' (DONE) และเปลี่ยนสถานะโต๊ะกลับเป็น "ว่าง" */
router.post('/counter/complete/:orderId', async (req, res) => {
  try {
    // 1. อัปเดตสถานะออเดอร์เป็น DONE
    await dbRun('UPDATE "Order" SET Order_Status = ? WHERE Order_ID = ? AND Order_Status = ?',
      [STATUS.DONE, req.params.orderId, STATUS.READY]);
    
    // 2. คืนสถานะโต๊ะเป็น "ว่าง" เมื่อจบกระบวนการสั่งอาหาร
    const order = await dbGet('SELECT Table_ID FROM "Order" WHERE Order_ID = ?', [req.params.orderId]);
    if (order && order.Table_ID) {
      await dbRun('UPDATE "Table" SET Table_Status = ? WHERE Table_ID = ?', ['ว่าง', order.Table_ID]);
    }

    delete notifyCount[req.params.orderId];
    res.redirect('/counter/notify?message=done');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 5: EXPORTS
// ==========================================
module.exports = router;