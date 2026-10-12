/* ==========================================================================
 * FILE: routes/customer.js
 * DESCRIPTION: เส้นทางบริการและตรรกะการทำงานฝั่งลูกค้า ดูเมนู, เลือก/ปรับแต่งอาหาร, 
 *              จัดการตะกร้า (ผ่าน Express Session), ยืนยันออเดอร์, ชำระเงิน และ ติดตามสถานะอาหาร
 * ========================================================================== */

// ==========================================
// SECTION 1: IMPORTS & DEPENDENCIES
// ==========================================
const express = require('express');
const router = express.Router();
const { dbAll, dbGet, dbRun } = require('../config/db');
const paymentService = require('../services/paymentService');
const payConfig = require('../config/payment');
const {
  STATUS, SPICE_LEVELS, PAY_METHOD, PAYMENT_TIMEOUT_MIN, notifyCount,
  groupOf, getTable, getOrderItems, recalcTotal, getOrderFull, makeReferenceCode
} = require('../utils/helpers');

// ==========================================
// SECTION 2: CONFIGURATIONS & SQL QUERIES
// ==========================================

/** จำนวนชิ้นสูงสุดต่อรายการอาหารที่อนุญาตให้สั่งได้ในครั้งเดียว */
const MAX_QTY = 20;

/** SQL Query พื้นฐานสำหรับดึงรายการเมนูพร้อมคำนวณวัตถุดิบคงเหลือในคลัง */
const MENU_SELECT = `
  SELECT m.*, c.Category_Name,
         (SELECT i.In_Stock_Quantity
            FROM Menu_Ingredient mi
            JOIN Inventory i ON i.Ingredient_ID = mi.Ingredient_ID
           WHERE mi.Menu_ID = m.Menu_ID
           ORDER BY i.In_Stock_Quantity / mi.Quantity_Used
           LIMIT 1) AS Stock_Left,
         CASE WHEN EXISTS (SELECT 1
                             FROM Menu_Ingredient mi
                             JOIN Inventory i ON i.Ingredient_ID = mi.Ingredient_ID
                            WHERE mi.Menu_ID = m.Menu_ID
                              AND i.In_Stock_Quantity < mi.Quantity_Used)
              THEN 1 ELSE 0 END AS OutOfStock
  FROM Menu m
  LEFT JOIN Category c ON m.Category_ID = c.Category_ID`;

// ==========================================
// SECTION 3: UTILITY HELPER FUNCTIONS
// ==========================================

/* ตรวจสอบว่าเมนูหมดหรือไม่ (ปิดการขาย หรือ วัตถุดิบในสต็อกไม่พอ) */
function isSoldOut(m) {
  return m.Is_Available === 0 || m.OutOfStock === 1;
}

/* ตรวจสอบว่า Error ที่เกิดขึ้นมาจาก Constraint สต็อกวัตถุดิบไม่พอหรือไม่ */
function isStockError(err) {
  return !!(err && err.message && err.message.indexOf('In_Stock_Quantity') !== -1);
}

/* ตรวจสอบความเป็นเจ้าของออเดอร์ (รองรับทั้งออเดอร์ปกติและกลับบ้าน) */
function ownsOrder(table, order) {
  if (!table || !order) return false;
  if (table.Table_ID === 'takeaway' && order.Table_ID === null) return true;
  return String(order.Table_ID) === String(table.Table_ID);
}

// ==========================================
// SECTION 4: ROUTE MIDDLEWARE
// ==========================================

/* Middleware สำหรับจดจำ Table_ID และ Order_type ลงใน Session ผู้ใช้ */
router.use('/table/:tableId', (req, res, next) => {
  if (req.params.tableId) {
    if (req.session.tableId && req.session.tableId !== req.params.tableId) {
      req.session.cart = [];
    }

    req.session.tableId = req.params.tableId;
    if (req.params.tableId === 'takeaway' || req.query.type === 'takeaway') {
      req.session.orderType = 'กลับบ้าน';
    } else if (!req.session.orderType) {
      req.session.orderType = 'ทานที่ร้าน';
    }
  }
  next();
});

// ==========================================
// SECTION 5: UC01 - MENU DISPLAY
// ==========================================

/* Redirect จาก Path หลักไปหน้าแสดงรายการอาหาร */
router.get('/table/:tableId', (req, res) => {
  res.redirect('/table/' + req.params.tableId + '/menu');
});

/* แสดงรายการอาหารทั้งหมด แบ่งตามหมวดหมู่ พร้อมคำนวณตะกร้าจาก Session */
router.get('/table/:tableId/menu', async (req, res) => {
  try {
    const table = await getTable(req.params.tableId);
    if (!table) return res.status(404).send('ไม่พบโต๊ะนี้ กรุณาสแกน QR Code ใหม่');

    // เปลี่ยนสถานะโต๊ะเป็น "มีลูกค้า" เมื่อสแกนเข้ามาครั้งแรกใน Session (ข้ามกรณีกลับบ้าน)
    if (table.Table_ID !== 'takeaway' && req.session.visitedTable !== table.Table_ID) {
      await dbRun('UPDATE "Table" SET Table_Status = ? WHERE Table_ID = ?', ['มีลูกค้า', table.Table_ID]);
      req.session.visitedTable = table.Table_ID;
    }

    const tab = req.query.tab || 'all';
    const categories = await dbAll('SELECT * FROM Category ORDER BY Category_ID');
    categories.forEach((c) => (c.group = groupOf(c.Category_Name)));

    const menus = await dbAll(MENU_SELECT + ' ORDER BY m.Category_ID, m.Menu_ID');
    menus.forEach((m) => {
      m.group = groupOf(m.Category_Name);
      m.soldOut = isSoldOut(m);
    });

    const rawCats = categories.filter((c) => c.group === 'raw');
    const selectedCat = Number(req.query.cat) || (rawCats[0] ? rawCats[0].Category_ID : 0);

    // 🟢 คำนวณจำนวนและราคารวมจาก Session Cart แยกตามเครื่อง
    const cartItems = req.session.cart || [];
    const cartCount = cartItems.reduce((sum, it) => sum + (it.Quantity || 0), 0);
    const cartTotal = cartItems.reduce((sum, it) => sum + (it.Subtotal || 0), 0);

    res.render('customer/menu', {
      table, tab, categories, rawCats, selectedCat, menus,
      cartCount, cartTotal,
      added: req.query.added,
      error: req.query.error,
      orderType: req.session.orderType
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 6: UC02 & UC03 - ITEM CUSTOMIZATION & CART MANAGEMENT
// ==========================================

/* แสดงหน้าเลือก/ปรับแต่งรายละเอียดอาหาร */
router.get('/table/:tableId/item/:menuId', async (req, res) => {
  try {
    const table = await getTable(req.params.tableId);
    const menu = await dbGet(MENU_SELECT + ' WHERE m.Menu_ID = ?', [req.params.menuId]);
    if (!table || !menu) return res.status(404).send('ไม่พบรายการ');
    menu.soldOut = isSoldOut(menu);
    menu.isSoup = menu.Category_Name === 'ซุป';

    let editItem = null;
    if (req.query.edit) {
      const cartItems = req.session.cart || [];
      editItem = cartItems.find(it => String(it.Order_Detail_ID) === String(req.query.edit)) || null;
    }

    res.render('customer/item', {
      table, menu, editItem,
      spiceLevels: SPICE_LEVELS,
      error: req.query.error,
      backTab: groupOf(menu.Category_Name)
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* เพิ่มหรืออัปเดตรายการอาหารลงตะกร้าใน Session */
router.post('/table/:tableId/cart/add', async (req, res) => {
  const tableId = req.params.tableId;
  let backURL = '/table/' + tableId + '/menu';
  try {
    const { menuId, spice, note, detailId, soup1, soup2 } = req.body;
    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(req.body.qty, 10) || 1));
    const menu = await dbGet(MENU_SELECT + ' WHERE m.Menu_ID = ?', [menuId]);
    if (!menu) return res.redirect('/table/' + tableId + '/menu');

    backURL = '/table/' + tableId + '/item/' + menuId + (detailId ? '?edit=' + detailId + '&' : '?');

    if (isSoldOut(menu)) {
      return res.redirect(backURL + 'error=soldout');
    }

    const isSoup = menu.Category_Name === 'ซุป';
    if (isSoup && !SPICE_LEVELS.includes(spice)) {
      return res.redirect(backURL + 'error=spice');
    }

    const isTwoSoups = isSoup && menu.Menu_Name.includes('2');
    if (isTwoSoups && (!soup1 || !soup2)) {
      return res.redirect(backURL + 'error=soup');
    }
    
    if (isTwoSoups && (soup1 === soup2)) {
      return res.redirect(backURL + 'error=samesoup');
    }

    const spiceValue = isSoup ? spice : null;
    let soupValue = isSoup ? menu.Menu_Name : null;
    if (isTwoSoups) soupValue = soup1 + ' + ' + soup2;

    const noteValue = (note || '').trim();
    const finalQty = isSoup ? 1 : qty;

    if (!req.session.cart) {
      req.session.cart = [];
    }

    // 🟢 กรณีเป็นการแก้ไขรายการเดิมในตะกร้า
    if (detailId) {
      const itemIndex = req.session.cart.findIndex(it => String(it.Order_Detail_ID) === String(detailId));
      if (itemIndex !== -1) {
        req.session.cart[itemIndex].Quantity = finalQty;
        req.session.cart[itemIndex].Unit_Price = menu.Price;
        req.session.cart[itemIndex].Spiciness_Level = spiceValue;
        req.session.cart[itemIndex].Soup_Type = soupValue;
        req.session.cart[itemIndex].Special_Note = noteValue;
        req.session.cart[itemIndex].Subtotal = finalQty * menu.Price;
      }
      return res.redirect('/table/' + tableId + '/cart');
    }

    // 🟢 ตรวจสอบว่ามีรายการที่ออปชันเหมือนกันในตะกร้าของเครื่องนี้แล้วหรือไม่
    const sameItem = req.session.cart.find(it => 
      it.Menu_ID === menu.Menu_ID &&
      (it.Spiciness_Level || '') === (spiceValue || '') &&
      (it.Soup_Type || '') === (soupValue || '') &&
      (it.Special_Note || '') === noteValue
    );

    if (sameItem && !isSoup) {
      sameItem.Quantity = Math.min(MAX_QTY, sameItem.Quantity + finalQty);
      sameItem.Subtotal = sameItem.Quantity * sameItem.Unit_Price;
    } else {
      const newItem = {
        Order_Detail_ID: 'detail_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        Menu_ID: menu.Menu_ID,
        Menu_Name: menu.Menu_Name,
        Image_URL: menu.Image_URL,
        Category_Name: menu.Category_Name,
        Quantity: finalQty,
        Unit_Price: menu.Price,
        Subtotal: finalQty * menu.Price,
        Spiciness_Level: spiceValue,
        Soup_Type: soupValue,
        Special_Note: noteValue
      };
      req.session.cart.push(newItem);
    }

    res.redirect('/table/' + tableId + '/menu?tab=' + groupOf(menu.Category_Name) + '&cat=' + menu.Category_ID + '&added=' + encodeURIComponent(menu.Menu_Name));
  } catch (err) {
    if (isStockError(err)) return res.redirect(backURL + 'error=soldout');
    res.status(500).send(err.message);
  }
});

/* แสดงรายการอาหารในตะกร้าสินค้าจาก Session */
router.get('/table/:tableId/cart', async (req, res) => {
  try {
    const table = await getTable(req.params.tableId);
    if (!table) return res.status(404).send('ไม่พบโต๊ะ');
    
    const items = req.session.cart || [];
    const total = items.reduce((sum, it) => sum + (it.Subtotal || 0), 0);

    const hasIngredient = items.some(it => groupOf(it.Category_Name) === 'raw' || it.Category_Name === 'วัตถุดิบ');
    const hasSoup = items.some(it => groupOf(it.Category_Name) === 'soup' || it.Category_Name === 'ซุป' || !!it.Soup_Type);
    const missingSoup = hasIngredient && !hasSoup;

    res.render('customer/cart', { table, cart: { Total_Price: total }, items, total, missingSoup, error: req.query.error });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* เพิ่มหรือลดจำนวนรายการอาหารในตะกร้า Session */
router.post('/table/:tableId/cart/update/:detailId', async (req, res) => {
  const tableId = req.params.tableId;
  try {
    if (!req.session.cart) req.session.cart = [];
    const itemIndex = req.session.cart.findIndex(it => String(it.Order_Detail_ID) === String(req.params.detailId));
    
    if (itemIndex !== -1) {
      const item = req.session.cart[itemIndex];
      if (item.Soup_Type) {
        return res.redirect('/table/' + tableId + '/cart?error=soupqty');
      }
      const newQty = req.body.action === 'plus' ? item.Quantity + 1 : item.Quantity - 1;
      if (newQty <= 0) {
        req.session.cart.splice(itemIndex, 1);
      } else if (newQty <= MAX_QTY) {
        item.Quantity = newQty;
        item.Subtotal = item.Quantity * item.Unit_Price;
      }
    }
    res.redirect('/table/' + tableId + '/cart');
  } catch (err) {
    if (isStockError(err)) return res.redirect('/table/' + tableId + '/cart?error=stock');
    res.status(500).send(err.message);
  }
});

/* ลบรายการอาหารออกจากตะกร้า Session */
router.post('/table/:tableId/cart/delete/:detailId', async (req, res) => {
  const tableId = req.params.tableId;
  try {
    if (req.session.cart) {
      req.session.cart = req.session.cart.filter(it => String(it.Order_Detail_ID) !== String(req.params.detailId));
    }
    res.redirect('/table/' + tableId + '/cart');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 7: UC04 - ORDER CONFIRMATION & SUMMARY
// ==========================================

/* ตรวจสอบเงื่อนไขตะกร้าก่อนเข้าสู่หน้าสรุป */
router.post('/table/:tableId/cart/confirm', async (req, res) => {
  const tableId = req.params.tableId;
  try {
    const items = req.session.cart || [];
    if (items.length === 0) return res.redirect('/table/' + tableId + '/cart?error=empty');

    const hasIngredient = items.some(it => groupOf(it.Category_Name) === 'raw' || it.Category_Name === 'วัตถุดิบ');
    const hasSoup = items.some(it => groupOf(it.Category_Name) === 'soup' || it.Category_Name === 'ซุป' || !!it.Soup_Type);
    
    if (hasIngredient && !hasSoup) {
      return res.redirect('/table/' + tableId + '/cart?error=nosoup');
    }

    res.redirect('/table/' + tableId + '/summary');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* แสดงหน้าสรุปรายการสั่งซื้อก่อนชำระเงิน */
router.get('/table/:tableId/summary', async (req, res) => {
  try {
    const table = await getTable(req.params.tableId);
    if (!table) return res.status(404).send('ไม่พบโต๊ะ');
    
    const items = req.session.cart || [];
    if (items.length === 0) return res.redirect('/table/' + req.params.tableId + '/cart?error=empty');
    const total = items.reduce((sum, it) => sum + (it.Subtotal || 0), 0);

    res.render('customer/summary', { table, cart: { Total_Price: total }, items, total });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ยืนยันคำสั่งซื้อ: สร้าง Order และ Order_Detail ใน DB จริง และล้าง Session Cart */
router.post('/table/:tableId/checkout', async (req, res) => {
  const tableId = req.params.tableId;
  try {
    const table = await getTable(tableId);
    if (!table) return res.status(404).send('ไม่พบโต๊ะ');
    
    const items = req.session.cart || [];
    if (items.length === 0) return res.redirect('/table/' + tableId + '/cart?error=empty');

    const ref = await makeReferenceCode(table);
    const total = items.reduce((sum, it) => sum + (it.Subtotal || 0), 0);
    const orderType = req.session.orderType || 'ทานที่ร้าน';
    const dbTableId = tableId === 'takeaway' ? null : tableId;

    // 1. สร้าง Record ออเดอร์ในฐานข้อมูล
    const r = await dbRun(
      'INSERT INTO "Order" (Table_ID, Total_Price, Order_Status, Order_type, Reference_Code, Order_Date_Time) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [dbTableId, total, STATUS.WAIT_PAY, orderType, ref]
    );
    const orderId = r.lastID;

    // 2. บันทึกรายการอาหารจาก Session ลงใน Order_Detail ในฐานข้อมูล
    for (const item of items) {
      await dbRun(
        'INSERT INTO Order_Detail (Order_ID, Menu_ID, Quantity, Unit_Price, Spiciness_Level, Soup_Type, Special_Note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, item.Menu_ID, item.Quantity, item.Unit_Price, item.Spiciness_Level, item.Soup_Type, item.Special_Note]
      );
    }

    // 3. สร้าง Record ชำระเงินเบื้องต้น
    await dbRun(
      'INSERT INTO Payment (Order_ID, Payment_Method, Payment_Amount, Change_Amount, Payment_Status) VALUES (?, ?, ?, ?, ?)',
      [orderId, PAY_METHOD.CASH, 0, 0, 'รอชำระ']
    );

    // 4. เคลียร์ตะกร้าใน Session ให้ว่างเปล่าสำหรับสั่งรอบถัดไป
    req.session.cart = [];

    res.redirect('/table/' + tableId + '/payment/' + orderId);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// SECTION 8: UC05 - PAYMENT PROCESSING & TIMEOUT
// ==========================================

/* Helper: ยกเลิกออเดอร์เมื่อชำระเงินไม่ทันเวลา */
async function expireOrder(order) {
  await dbRun('UPDATE "Order" SET Order_Status = ?, Reference_Code = NULL WHERE Order_ID = ?',
    ['ยกเลิก', order.Order_ID]);
  
  if (order.Table_ID && order.Table_ID !== 'takeaway') {
    await dbRun('UPDATE "Table" SET Table_Status = ? WHERE Table_ID = ?', ['ว่าง', order.Table_ID]);
  }
}

/* แสดงหน้าเลือกช่องทางชำระเงิน */
router.get('/table/:tableId/payment/:orderId', async (req, res) => {
  const tableId = req.params.tableId;
  try {
    const table = await getTable(tableId);
    const order = await getOrderFull(req.params.orderId);
    if (!ownsOrder(table, order)) return res.redirect('/table/' + tableId + '/menu');

    if (order.Order_Status === 'ยกเลิก') {
      return res.redirect('/table/' + tableId + '/cart?error=expired');
    }

    if (order.Order_Status !== STATUS.WAIT_PAY) {
      return res.redirect('/table/' + tableId + '/order/' + order.Order_ID);
    }

    const age = await dbGet(
      "SELECT (julianday('now') - julianday(Order_Date_Time)) * 86400 AS sec FROM \"Order\" WHERE Order_ID = ?",
      [order.Order_ID]
    );
    const secondsLeft = Math.max(0, Math.floor(PAYMENT_TIMEOUT_MIN * 60 - age.sec));

    if (!order.Payment_ID && secondsLeft <= 0) {
      await expireOrder(order);
      return res.redirect('/table/' + tableId + '/cart?error=expired');
    }

    let method = req.query.method || null;
    let qr = null;
    if (method === 'qr') {
      qr = await paymentService.createOrderQr(order);
    }

    res.render('customer/payment', {
      table, order, method, qr,
      secondsLeft,
      hasPayment: !!order.Payment_ID,
      payConfig
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* เลือกชำระเงินด้วยเงินสด */
router.post('/table/:tableId/payment/:orderId/cash', async (req, res) => {
  const { tableId, orderId } = req.params;
  try {
    const table = await getTable(tableId);
    const order = await dbGet('SELECT * FROM "Order" WHERE Order_ID = ?', [orderId]);
    if (!ownsOrder(table, order)) return res.redirect('/table/' + tableId + '/menu');
    if (order.Order_Status !== STATUS.WAIT_PAY) return res.redirect('/table/' + tableId + '/order/' + orderId);

    const pay = await dbGet('SELECT * FROM Payment WHERE Order_ID = ?', [orderId]);
    if (!pay) {
      await dbRun(
        'INSERT INTO Payment (Order_ID, Payment_Method, Payment_Amount, Change_Amount, Payment_Status) VALUES (?, ?, ?, ?, ?)',
        [orderId, PAY_METHOD.CASH, 0, 0, 'รอชำระ']
      );
    } else {
      await dbRun('UPDATE Payment SET Payment_Method = ?, Payment_Status = ? WHERE Order_ID = ?', [PAY_METHOD.CASH, 'รอชำระ', orderId]);
    }
    res.redirect('/table/' + tableId + '/payment/' + orderId + '?method=cash');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ยืนยันการชำระเงินด้วย QR Code */
router.post('/table/:tableId/payment/:orderId/qr', async (req, res) => {
  const { tableId, orderId } = req.params;
  try {
    const table = await getTable(tableId);
    const order = await dbGet('SELECT * FROM "Order" WHERE Order_ID = ?', [orderId]);
    if (!ownsOrder(table, order)) return res.redirect('/table/' + tableId + '/menu');
    if (order.Order_Status !== STATUS.WAIT_PAY) return res.redirect('/table/' + tableId + '/order/' + orderId);

    const txn = 'TXN' + Date.now();
    const pay = await dbGet('SELECT * FROM Payment WHERE Order_ID = ?', [orderId]);
    if (!pay) {
      await dbRun(
        `INSERT INTO Payment (Order_ID, Payment_Method, Payment_Amount, Change_Amount, Payment_Status, Payment_Date_Time, Transaction_Ref)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [orderId, PAY_METHOD.QR, order.Total_Price, 0, 'ชำระแล้ว', txn]
      );
    } else {
      await dbRun(
        `UPDATE Payment SET Payment_Method = ?, Payment_Amount = ?, Change_Amount = 0, Payment_Status = ?,
         Transaction_Ref = ?, Payment_Date_Time = CURRENT_TIMESTAMP WHERE Order_ID = ?`,
        [PAY_METHOD.QR, order.Total_Price, 'ชำระแล้ว', txn, orderId]
      );
    }
    await dbRun('UPDATE "Order" SET Order_Status = ? WHERE Order_ID = ? AND Order_Status = ?',
      [STATUS.PREPARING, orderId, STATUS.WAIT_PAY]);
    res.redirect('/table/' + tableId + '/order/' + orderId);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* API Polling: ตรวจสอบสถานะการชำระเงินอัตโนมัติ */
router.get('/api/payment/:orderId/status', async (req, res) => {
  try {
    const order = await dbGet('SELECT * FROM "Order" WHERE Order_ID = ?', [req.params.orderId]);
    if (!order) return res.json({ ok: false });

    if (order.Order_Status === STATUS.WAIT_PAY) {
      const result = await paymentService.isOrderPaidViaKbank(order);
      if (result.paid) {
        const txn = 'KBANK' + Date.now();
        const pay = await dbGet('SELECT * FROM Payment WHERE Order_ID = ?', [order.Order_ID]);
        if (!pay) {
          await dbRun(
            `INSERT INTO Payment (Order_ID, Payment_Method, Payment_Amount, Change_Amount, Payment_Status, Payment_Date_Time, Transaction_Ref)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
            [order.Order_ID, PAY_METHOD.QR, order.Total_Price, 0, 'ชำระแล้ว', txn]
          );
        } else {
          await dbRun(
            `UPDATE Payment SET Payment_Method = ?, Payment_Amount = ?, Payment_Status = ?,
             Transaction_Ref = ?, Payment_Date_Time = CURRENT_TIMESTAMP WHERE Order_ID = ?`,
            [PAY_METHOD.QR, order.Total_Price, 'ชำระแล้ว', txn, order.Order_ID]
          );
        }
        await dbRun('UPDATE "Order" SET Order_Status = ? WHERE Order_ID = ? AND Order_Status = ?',
          [STATUS.PREPARING, order.Order_ID, STATUS.WAIT_PAY]);
        return res.json({ ok: true, paid: true, status: STATUS.PREPARING });
      }
    }

    const paid = order.Order_Status !== STATUS.WAIT_PAY && order.Order_Status !== STATUS.CART;
    res.json({ ok: true, paid, status: order.Order_Status });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ==========================================
// SECTION 9: UC07 - ORDER TRACKING & REALTIME STATUS
// ==========================================

/* แสดงหน้าติดตามสถานะรายการสั่งซื้อสำหรับลูกค้า */
router.get('/table/:tableId/order/:orderId', async (req, res) => {
  try {
    const table = await getTable(req.params.tableId);
    const order = await getOrderFull(req.params.orderId);
    if (!ownsOrder(table, order) || order.Order_Status === STATUS.CART || order.Order_Status === 'ยกเลิก') {
      return res.redirect('/table/' + req.params.tableId + '/menu');
    }
    res.render('customer/order', { table, order, notify: notifyCount[order.Order_ID] || 0 });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* API Polling: ดึงสถานะปัจจุบันของออเดอร์ไปอัปเดตบนหน้าจอติดตาม */
router.get('/api/order/:orderId', async (req, res) => {
  try {
    const order = await dbGet('SELECT Order_ID, Order_Status FROM "Order" WHERE Order_ID = ?', [req.params.orderId]);
    if (!order) return res.json({ ok: false });
    res.json({ ok: true, status: order.Order_Status, notify: notifyCount[order.Order_ID] || 0 });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ==========================================
// SECTION 10: EXPORTS
// ==========================================
module.exports = router;