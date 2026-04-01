/**
 * Urban Hairplaza – Backend Server
 * Node.js + Express
 * Features: REST API, JSON file storage, Session auth, WhatsApp + SMS (Infobip) notifications
 */

require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const { v4: uuidv4 } = require('uuid');
const axios      = require('axios');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 7890;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── DATA DIRECTORY ─────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE  = path.join(DATA_DIR, 'bookings.json');
const ENQUIRIES_FILE = path.join(DATA_DIR, 'enquiries.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BOOKINGS_FILE))  fs.writeFileSync(BOOKINGS_FILE,  '[]', 'utf8');
  if (!fs.existsSync(ENQUIRIES_FILE)) fs.writeFileSync(ENQUIRIES_FILE, '[]', 'utf8');
}
ensureDataDir();

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'urban_hairplaza_secret_2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }  // 8 hours
}));

// Serve static files (HTML pages, CSS, JS, images)
app.use(express.static(path.join(__dirname)));

// ── WHATSAPP NOTIFICATION ──────────────────────────────────────────────────
async function sendWhatsApp(message) {
  const phone  = process.env.WHATSAPP_PHONE;
  const apiKey = process.env.WHATSAPP_APIKEY;

  if (!phone || !apiKey) {
    console.log('[WhatsApp] Not configured. Message would be:\n', message);
    return { success: false, reason: 'not_configured' };
  }

  try {
    const encoded = encodeURIComponent(message);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`;
    const res = await axios.get(url, { timeout: 8000 });
    console.log('[WhatsApp] Sent:', res.status);
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] Error:', err.message);
    return { success: false, error: err.message };
  }
}

function bookingWhatsAppMsg(b) {
  return (
    `🔔 *NEW BOOKING – Urban Hairplaza*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Client:* ${b.name}\n` +
    `📱 *Phone:* ${b.phone}\n` +
    `✂️ *Service:* ${b.service}\n` +
    `💈 *Barber:* ${b.barber}\n` +
    `📅 *Date:* ${b.date}\n` +
    `⏰ *Time:* ${b.time}\n` +
    `🏷️ *Type:* ${b.type === 'home' ? '🏠 Home Visit' : '🏢 In-Shop'}\n` +
    `💰 *Price:* ₹${b.price}\n` +
    `${b.advancePaid ? '💸 *Advance Paid:* ₹' + b.advancePaid + '\n' : ''}` +
    `${b.address ? '📍 *Address:* ' + b.address + '\n' : ''}` +
    `${b.notes ? '📝 *Notes:* ' + b.notes + '\n' : ''}` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 Booking ID: ${b.id}\n` +
    `Visit admin panel to confirm: ${BASE_URL}/admin/`
  );
}

function enquiryWhatsAppMsg(e) {
  return (
    `📩 *NEW ENQUIRY – Urban Hairplaza*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Name:* ${e.name}\n` +
    `📱 *Phone:* ${e.phone}\n` +
    `${e.email ? '📧 *Email:* ' + e.email + '\n' : ''}` +
    `📌 *Subject:* ${e.subject || 'General Inquiry'}\n` +
    `💬 *Message:*\n${e.message}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `Visit admin panel: ${BASE_URL}/admin/`
  );
}

// ── SMS NOTIFICATION (Infobip) ──────────────────────────────────────────
// Sign up FREE at https://portal.infobip.com/
// Copy your: API Key + Base URL (from the portal homepage)
// Set INFOBIP_API_KEY and INFOBIP_BASE_URL in .env
async function sendSMS(phoneNumber, message) {
  const apiKey  = process.env.INFOBIP_API_KEY;
  const baseUrl = process.env.INFOBIP_BASE_URL;   // e.g. abc123.api.infobip.com
  const sender  = process.env.INFOBIP_SENDER || 'Urban Hairplaza';

  if (!apiKey || !baseUrl) {
    console.log('[SMS] Infobip not configured. Set INFOBIP_API_KEY + INFOBIP_BASE_URL in .env');
    console.log('[SMS] Message would be:', message);
    return { success: false, reason: 'not_configured' };
  }

  // Normalise to E.164 format (add +91 if needed)
  let phone = String(phoneNumber).replace(/\D/g, '');
  if (!phone.startsWith('91') && phone.length === 10) phone = '91' + phone;
  if (phone.length < 10) {
    console.warn('[SMS] Invalid phone number:', phoneNumber);
    return { success: false, reason: 'invalid_phone' };
  }

  try {
    const url = `https://${baseUrl}/sms/2/text/advanced`;
    const res = await axios.post(
      url,
      {
        messages: [{
          from:         sender,
          destinations: [{ to: phone }],
          text:         message
        }]
      },
      {
        headers: {
          'Authorization': `App ${apiKey}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json'
        },
        timeout: 10000
      }
    );
    const msgId  = res.data?.messages?.[0]?.messageId || 'N/A';
    const status = res.data?.messages?.[0]?.status?.name || 'UNKNOWN';
    console.log(`[SMS] Infobip sent to ${phone} | Status: ${status} | MsgID: ${msgId}`);
    return { success: true, messageId: msgId, status };
  } catch (err) {
    const errData = err.response?.data;
    console.error('[SMS] Infobip error:', errData || err.message);
    return { success: false, error: errData || err.message };
  }
}

// SMS message templates
function bookingConfirmSMS(b) {
  return (
    `Dear ${b.name}, your booking at Urban Hairplaza is received! ` +
    `Booking ID: #${b.id}. ` +
    `Service: ${b.service} on ${b.date} at ${b.time} with ${b.barber}. ` +
    `${b.type === 'home' ? 'Home Visit.' : 'In-Shop Visit.'} ` +
    `Total: ₹${b.price}. ${b.advancePaid ? `Advance Paid: ₹${b.advancePaid}. ` : ''}We will confirm shortly. ` +
    `Queries? Call +916202692426. - Urban Hairplaza`
  );
}

function bookingConfirmedSMS(b) {
  return (
    `Hi ${b.name}, GREAT NEWS! Your appointment at Urban Hairplaza is CONFIRMED. ` +
    `ID: #${b.id} | ${b.service} on ${b.date} at ${b.time} with ${b.barber}. ` +
    `${b.type === 'home' ? 'Our barber will visit you at home.' : 'Please visit us at Simraha, Araria.'} ` +
    `See you soon! - Urban Hairplaza`
  );
}

function bookingCancelledSMS(b) {
  return (
    `Hi ${b.name}, your booking #${b.id} at Urban Hairplaza has been cancelled. ` +
    `To rebook call +916202692426 or visit urbanhairplaza.com. ` +
    `Sorry for the inconvenience. - Urban Hairplaza`
  );
}

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

// ── PUBLIC API ROUTES ──────────────────────────────────────────────────────

// POST /api/bookings — submit a new booking
app.post('/api/bookings', async (req, res) => {
  const { type, service, barber, date, time, name, phone, address, notes, price, duration } = req.body;

  if (!name || !phone || !service || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Check for double booking
  const bookings = readJSON(BOOKINGS_FILE);
  const isBooked = bookings.some(b => 
    b.date === date && 
    b.time === time && 
    b.barber === (barber || 'Best Available') && 
    b.status !== 'cancelled'
  );

  if (isBooked) {
    return res.status(400).json({ error: 'This time slot is already booked for the selected barber. Please choose another.' });
  }

  const booking = {
    id:        uuidv4().split('-')[0].toUpperCase(),
    type:      type || 'inshop',
    service:   service || '',
    barber:    barber || 'Best Available',
    date:      date || '',
    time:      time || '',
    name:      name.trim(),
    phone:     phone.trim(),
    address:   address || '',
    notes:     notes || '',
    price:     price || 0,
    duration:  duration || 0,
    status:    'pending',      // pending | confirmed | cancelled
    createdAt: new Date().toISOString()
  };

  bookings.unshift(booking);
  writeJSON(BOOKINGS_FILE, bookings);

  // Admin WhatsApp notification (non-blocking)
  sendWhatsApp(bookingWhatsAppMsg(booking)).catch(() => {});

  // Customer SMS confirmation (non-blocking)
  sendSMS(booking.phone, bookingConfirmSMS(booking)).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Booking received! We will confirm shortly.',
    bookingId: booking.id
  });
});

// ── CASHFREE PG ROUTES ──────────────────────────────────────────────────────

// POST /api/create-order — create a pending booking and a Cashfree order
app.post('/api/create-order', async (req, res) => {
  const { advanceAmount, bookingDetails } = req.body;
  if (!advanceAmount || !bookingDetails) {
    return res.status(400).json({ error: 'Missing payment details.' });
  }

  const { type, service, barber, date, time, name, phone, address, notes, price, duration } = bookingDetails;
  
  if (!name || !phone || !service || !date || !time) {
    return res.status(400).json({ error: 'Missing required booking fields.' });
  }

  // Check for double booking
  const bookings = readJSON(BOOKINGS_FILE);
  const isBooked = bookings.some(b => 
    b.date === date && 
    b.time === time && 
    b.barber === (barber || 'Best Available') && 
    b.status !== 'cancelled'
  );

  if (isBooked) {
    return res.status(400).json({ error: 'This time slot is already taken. Please choose another.' });
  }

  const booking = {
    id:        uuidv4().split('-')[0].toUpperCase(),
    type:      type || 'inshop',
    service:   service || '',
    barber:    barber || 'Best Available',
    date:      date || '',
    time:      time || '',
    name:      name.trim(),
    phone:     phone.trim(),
    address:   address || '',
    notes:     notes || '',
    price:     price || 0,
    duration:  duration || 0,
    advancePaid: 0,
    status:    'payment_pending',
    createdAt: new Date().toISOString()
  };

  bookings.unshift(booking);
  writeJSON(BOOKINGS_FILE, bookings);

  // Call Cashfree API
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const envPrefix = process.env.CASHFREE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'api';
  
  if (!appId || !secretKey) {
     return res.status(500).json({ error: 'Cashfree API keys not configured on server.' });
  }

  try {
     const cfRes = await axios.post(`https://${envPrefix}.cashfree.com/pg/orders`, {
        order_amount: advanceAmount,
        order_currency: 'INR',
        order_id: booking.id,
        customer_details: {
           customer_id: booking.id,
           customer_phone: String(booking.phone).replace(/\D/g, '').slice(-10) || '9999999999',
           customer_name: booking.name || 'Customer'
        }
        // No return_url — we handle completion via JS SDK onSuccess callback
     }, {
        headers: {
           'x-client-id': appId,
           'x-client-secret': secretKey,
           'x-api-version': '2023-08-01',
           'Content-Type': 'application/json'
        }
     });

     res.json({
        success: true,
        payment_session_id: cfRes.data.payment_session_id,
        order_id: booking.id
     });
  } catch (err) {
     console.error('[Cashfree] Order Error:', err.response?.data || err.message);
     res.status(500).json({ error: 'Failed to create payment order.' });
  }
});

// POST /api/verify-payment — called by JS SDK after payment success
app.post('/api/verify-payment', async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'Missing order_id.' });

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const envPrefix = process.env.CASHFREE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'api';

  try {
    const cfRes = await axios.get(`https://${envPrefix}.cashfree.com/pg/orders/${order_id}`, {
      headers: {
         'x-client-id': appId,
         'x-client-secret': secretKey,
         'x-api-version': '2023-08-01'
      }
    });

    const status = cfRes.data.order_status; // 'PAID', 'ACTIVE', 'EXPIRED'
    
    if (status === 'PAID') {
       const bookings = readJSON(BOOKINGS_FILE);
       const idx = bookings.findIndex(b => b.id === order_id);
       if (idx !== -1 && bookings[idx].status === 'payment_pending') {
          bookings[idx].status = 'pending';
          bookings[idx].advancePaid = cfRes.data.order_amount;
          writeJSON(BOOKINGS_FILE, bookings);
          
          const b = bookings[idx];
          sendWhatsApp(bookingWhatsAppMsg(b)).catch(() => {});
          sendSMS(b.phone, bookingConfirmSMS(b)).catch(() => {});
       }
       res.json({ success: true, status: 'PAID', order_id });
    } else {
       res.status(400).json({ success: false, status, order_id });
    }
  } catch (err) {
     console.error('[Cashfree Verify] Error:', err.response?.data || err.message);
     res.status(500).json({ error: 'Verification failed.' });
  }
});

// GET /api/available-slots — fetch booked times for a specific date and barber
app.get('/api/available-slots', (req, res) => {
  const { date, barber } = req.query;
  if (!date || !barber) {
    return res.status(400).json({ error: 'Date and barber are required.' });
  }

  const bookings = readJSON(BOOKINGS_FILE);
  const bookedTimes = bookings
    .filter(b => b.date === date && b.barber === barber && b.status !== 'cancelled' && b.status !== 'payment_pending')
    .map(b => b.time);

  res.json({ bookedTimes });
});

// POST /api/enquiries — submit a contact enquiry
app.post('/api/enquiries', async (req, res) => {
  const { name, phone, email, subject, message } = req.body;

  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Name, phone and message are required.' });
  }

  const enquiry = {
    id:        uuidv4().split('-')[0].toUpperCase(),
    name:      name.trim(),
    phone:     phone.trim(),
    email:     email || '',
    subject:   subject || 'General Inquiry',
    message:   message.trim(),
    status:    'unread',     // unread | read | replied
    createdAt: new Date().toISOString()
  };

  const enquiries = readJSON(ENQUIRIES_FILE);
  enquiries.unshift(enquiry);
  writeJSON(ENQUIRIES_FILE, enquiries);

  // WhatsApp notification (non-blocking)
  sendWhatsApp(enquiryWhatsAppMsg(enquiry)).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Message received! We will get back to you soon.'
  });
});

// ── ADMIN AUTH ─────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'urban@hairplaza2025';

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    req.session.adminUser = username;
    res.json({ success: true, message: 'Logged in successfully.' });
  } else {
    res.status(401).json({ error: 'Invalid username or password.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ authenticated: true, user: req.session.adminUser });
});

// ── ADMIN DATA ROUTES ──────────────────────────────────────────────────────

// GET all bookings
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const bookings = readJSON(BOOKINGS_FILE);
  res.json(bookings);
});

// GET all enquiries
app.get('/api/admin/enquiries', requireAdmin, (req, res) => {
  const enquiries = readJSON(ENQUIRIES_FILE);
  res.json(enquiries);
});

// PATCH a booking (update status)
app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const bookings = readJSON(BOOKINGS_FILE);
  const idx = bookings.findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found.' });

  bookings[idx].status = status;
  bookings[idx].updatedAt = new Date().toISOString();
  writeJSON(BOOKINGS_FILE, bookings);

  // WhatsApp + SMS notify on status change
  const b = bookings[idx];
  if (status === 'confirmed') {
    const waMsg =
      `✅ *BOOKING CONFIRMED – Urban Hairplaza*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Client: ${b.name} | 📅 ${b.date} ⏰ ${b.time}\n` +
      `✂️ ${b.service} with ${b.barber}\n` +
      `📌 ID: ${b.id}`;
    sendWhatsApp(waMsg).catch(() => {});
    // SMS to customer
    sendSMS(b.phone, bookingConfirmedSMS(b)).catch(() => {});
  } else if (status === 'cancelled') {
    // SMS to customer on cancellation
    sendSMS(b.phone, bookingCancelledSMS(b)).catch(() => {});
  }

  res.json({ success: true, booking: bookings[idx] });
});

// PATCH an enquiry (update status)
app.patch('/api/admin/enquiries/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['unread', 'read', 'replied'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const enquiries = readJSON(ENQUIRIES_FILE);
  const idx = enquiries.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Enquiry not found.' });

  enquiries[idx].status = status;
  enquiries[idx].updatedAt = new Date().toISOString();
  writeJSON(ENQUIRIES_FILE, enquiries);

  res.json({ success: true, enquiry: enquiries[idx] });
});

// DELETE a booking
app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  let bookings = readJSON(BOOKINGS_FILE);
  const before = bookings.length;
  bookings = bookings.filter(b => b.id !== id);
  if (bookings.length === before) return res.status(404).json({ error: 'Not found.' });
  writeJSON(BOOKINGS_FILE, bookings);
  res.json({ success: true });
});

// DELETE an enquiry
app.delete('/api/admin/enquiries/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  let enquiries = readJSON(ENQUIRIES_FILE);
  const before = enquiries.length;
  enquiries = enquiries.filter(e => e.id !== id);
  if (enquiries.length === before) return res.status(404).json({ error: 'Not found.' });
  writeJSON(ENQUIRIES_FILE, enquiries);
  res.json({ success: true });
});

// GET stats summary
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const bookings  = readJSON(BOOKINGS_FILE);
  const enquiries = readJSON(ENQUIRIES_FILE);
  res.json({
    bookings: {
      total:     bookings.length,
      pending:   bookings.filter(b => b.status === 'pending').length,
      confirmed: bookings.filter(b => b.status === 'confirmed').length,
      cancelled: bookings.filter(b => b.status === 'cancelled').length,
    },
    revenue: {
      totalAdvance: bookings.reduce((sum, b) => sum + (b.status !== 'cancelled' ? (b.advancePaid || 0) : 0), 0)
    },
    enquiries: {
      total:   enquiries.length,
      unread:  enquiries.filter(e => e.status === 'unread').length,
      read:    enquiries.filter(e => e.status === 'read').length,
      replied: enquiries.filter(e => e.status === 'replied').length,
    }
  });
});

// ── ADMIN PAGE ROUTES ──────────────────────────────────────────────────────
// Serve admin pages (no auth check here — JS on the page handles redirect)
app.get(['/admin', '/admin/'], (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.redirect('/admin/dashboard.html');
  } else {
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
  }
});

// ── START ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Urban Hairplaza Server Running      ║
║   ${BASE_URL}               ║
║   Admin: ${BASE_URL}/admin/ ║
╚════════════════════════════════════════╝
  `);
  if (!process.env.WHATSAPP_APIKEY) {
    console.warn('[WhatsApp] ⚠️  Not configured. Set WHATSAPP_PHONE + WHATSAPP_APIKEY in .env');
  }
  if (!process.env.INFOBIP_API_KEY || !process.env.INFOBIP_BASE_URL) {
    console.warn('[SMS]       ⚠️  Infobip not configured. Set INFOBIP_API_KEY + INFOBIP_BASE_URL in .env');
    console.warn('[SMS]       ⚠️  Sign up FREE at https://portal.infobip.com/');
  } else {
    console.log('[SMS]       ✅  Infobip ready – customers will get SMS on booking.');
  }
});
