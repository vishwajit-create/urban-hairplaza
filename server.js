/**
 * Urban Hairplaza – Backend Server
 * Node.js + Express
 * Features: REST API, JSON flat-file storage, Session auth, WhatsApp (CallMeBot) + SMS (Twilio) notifications
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


// ── DATA DIRECTORY ──────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  services:  path.join(DATA_DIR, 'services.json'),
  bookings:  path.join(DATA_DIR, 'bookings.json'),
  enquiries: path.join(DATA_DIR, 'enquiries.json'),
};

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return []; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}


// ── SEED DEFAULT SERVICES ────────────────────────────────────────────────────
function initDB() {
  if (!fs.existsSync(FILES.services) || readJSON(FILES.services).length === 0) {
    writeJSON(FILES.services, [
      { id: uuidv4(), type: 'inshop', icon: '✂️',  name: 'Classic Haircut',      desc: 'Precision cut tailored to your style',          price: 150, duration: 30 },
      { id: uuidv4(), type: 'inshop', icon: '🪒',  name: 'Beard Trim & Shape',   desc: 'Clean lines and sharp beard styling',           price: 100, duration: 20 },
      { id: uuidv4(), type: 'inshop', icon: '💆',  name: 'Head Massage',          desc: 'Relaxing scalp and head massage',               price: 120, duration: 25 },
      { id: uuidv4(), type: 'inshop', icon: '🧴',  name: 'Hair Wash & Style',    desc: 'Shampoo, condition, and blow-dry',              price: 200, duration: 40 },
      { id: uuidv4(), type: 'inshop', icon: '🪮',  name: 'Full Grooming Package', desc: 'Haircut + beard + massage combo',              price: 350, duration: 75 },
      { id: uuidv4(), type: 'home',   icon: '🏠',  name: 'Home Visit – Haircut', desc: 'Professional haircut at your doorstep',         price: 250, duration: 45 },
      { id: uuidv4(), type: 'home',   icon: '🏠',  name: 'Home Visit – Grooming', desc: 'Full grooming package at your home',          price: 500, duration: 90 },
    ]);
  }
  if (!fs.existsSync(FILES.bookings))  writeJSON(FILES.bookings,  []);
  if (!fs.existsSync(FILES.enquiries)) writeJSON(FILES.enquiries, []);
}


// ── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'urban-hairplaza-secret-2025',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use('/admin', express.static(path.join(__dirname, 'admin')));


// ── NOTIFICATION HELPERS ─────────────────────────────────────────────────────
async function sendWhatsApp(message) {
  const phone  = process.env.CALLMEBOT_PHONE;
  const apiKey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apiKey) return;
  try {
    await axios.get('https://api.callmebot.com/whatsapp.php', {
      params: { phone, apikey: apiKey, text: message }
    });
  } catch (err) {
    console.error('WhatsApp notification failed:', err.message);
  }
}


// ── PUBLIC ROUTES ────────────────────────────────────────────────────────────

// GET /api/services — list all services
app.get('/api/services', (req, res) => {
  try {
    const services = readJSON(FILES.services);
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load services' });
  }
});


// POST /api/enquiries — submit contact form
app.post('/api/enquiries', async (req, res) => {
  try {
    const { name, phone, email, subject, message } = req.body;
    if (!name || !phone || !message) {
      return res.status(400).json({ error: 'Name, phone, and message are required.' });
    }

    const enquiry = {
      id:        uuidv4().slice(0, 8).toUpperCase(),
      name:      name.trim(),
      phone:     phone.trim(),
      email:     (email || '').trim(),
      subject:   (subject || 'General').trim(),
      message:   message.trim(),
      status:    'unread',
      createdAt: new Date().toISOString(),
    };

    const enquiries = readJSON(FILES.enquiries);
    enquiries.unshift(enquiry);
    writeJSON(FILES.enquiries, enquiries);

    // WhatsApp notification
    await sendWhatsApp(
      `📩 New Enquiry – Urban Hairplaza\nFrom: ${enquiry.name} (${enquiry.phone})\nSubject: ${enquiry.subject}\nMessage: ${enquiry.message}`
    );

    res.json({ success: true, id: enquiry.id });
  } catch (err) {
    console.error('Enquiry error:', err);
    res.status(500).json({ error: 'Failed to save enquiry.' });
  }
});


// POST /api/bookings — create a new booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { name, phone, service, barber, date, time, type, address, notes, price, duration } = req.body;
    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Missing required booking fields.' });
    }

    const booking = {
      id:        uuidv4().slice(0, 8).toUpperCase(),
      name:      name.trim(),
      phone:     phone.trim(),
      service:   service.trim(),
      barber:    (barber || 'Any').trim(),
      date:      date.trim(),
      time:      time.trim(),
      type:      type || 'inshop',
      address:   (address || '').trim(),
      notes:     (notes || '').trim(),
      price:     price || 0,
      duration:  duration || 30,
      status:    'pending',
      createdAt: new Date().toISOString(),
    };

    const bookings = readJSON(FILES.bookings);
    bookings.unshift(booking);
    writeJSON(FILES.bookings, bookings);

    // WhatsApp notification
    await sendWhatsApp(
      `📅 New Booking – Urban Hairplaza\nClient: ${booking.name} (${booking.phone})\nService: ${booking.service} with ${booking.barber}\nDate: ${booking.date} at ${booking.time}\nType: ${booking.type === 'home' ? 'Home Visit' : 'In-Shop'}\nPrice: ₹${booking.price}`
    );

    res.json({ success: true, id: booking.id });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Failed to save booking.' });
  }
});


// ── ADMIN AUTH MIDDLEWARE ────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}


// ── ADMIN AUTH ROUTES ────────────────────────────────────────────────────────

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'urban@hairplaza2025';

  if (username === adminUser && password === adminPass) {
    req.session.isAdmin = true;
    req.session.user    = username;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// GET /api/admin/me
app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ authenticated: true, user: req.session.user || 'Admin' });
  }
  res.status(401).json({ authenticated: false });
});

// POST /api/admin/logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});


// ── ADMIN DATA ROUTES ────────────────────────────────────────────────────────

// GET /api/admin/stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const bookings  = readJSON(FILES.bookings);
    const enquiries = readJSON(FILES.enquiries);
    res.json({
      bookings: {
        total:     bookings.length,
        pending:   bookings.filter(b => b.status === 'pending').length,
        confirmed: bookings.filter(b => b.status === 'confirmed').length,
        cancelled: bookings.filter(b => b.status === 'cancelled').length,
      },
      enquiries: {
        total:  enquiries.length,
        unread: enquiries.filter(e => e.status === 'unread').length,
        read:   enquiries.filter(e => e.status === 'read').length,
        replied: enquiries.filter(e => e.status === 'replied').length,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/admin/bookings
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  try {
    res.json(readJSON(FILES.bookings));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

// PATCH /api/admin/bookings/:id
app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;
    const bookings   = readJSON(FILES.bookings);
    const idx        = bookings.findIndex(b => b.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
    bookings[idx].status = status;
    writeJSON(FILES.bookings, bookings);
    res.json({ success: true, booking: bookings[idx] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// DELETE /api/admin/bookings/:id
app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bookings = readJSON(FILES.bookings).filter(b => b.id !== id);
    writeJSON(FILES.bookings, bookings);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// GET /api/admin/enquiries
app.get('/api/admin/enquiries', requireAdmin, (req, res) => {
  try {
    res.json(readJSON(FILES.enquiries));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load enquiries' });
  }
});

// PATCH /api/admin/enquiries/:id
app.patch('/api/admin/enquiries/:id', requireAdmin, (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;
    const enquiries  = readJSON(FILES.enquiries);
    const idx        = enquiries.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Enquiry not found' });
    enquiries[idx].status = status;
    writeJSON(FILES.enquiries, enquiries);
    res.json({ success: true, enquiry: enquiries[idx] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update enquiry' });
  }
});

// DELETE /api/admin/enquiries/:id
app.delete('/api/admin/enquiries/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const enquiries = readJSON(FILES.enquiries).filter(e => e.id !== id);
    writeJSON(FILES.enquiries, enquiries);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete enquiry' });
  }
});

// GET /api/admin/services (admin view — same as public but auth-gated)
app.get('/api/admin/services', requireAdmin, (req, res) => {
  try {
    res.json(readJSON(FILES.services));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// POST /api/admin/services
app.post('/api/admin/services', requireAdmin, (req, res) => {
  try {
    const { type, icon, name, desc, price, duration } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price are required.' });
    const service = {
      id:       uuidv4().slice(0, 8).toUpperCase(),
      type:     type || 'inshop',
      icon:     icon || '✂️',
      name:     name.trim(),
      desc:     (desc || '').trim(),
      price:    Number(price),
      duration: Number(duration) || 30,
    };
    const services = readJSON(FILES.services);
    services.push(service);
    writeJSON(FILES.services, services);
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// PUT /api/admin/services/:id
app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { type, icon, name, desc, price, duration } = req.body;
    const services = readJSON(FILES.services);
    const idx      = services.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Service not found' });
    services[idx] = { ...services[idx], type, icon, name, desc, price: Number(price), duration: Number(duration) };
    writeJSON(FILES.services, services);
    res.json({ success: true, service: services[idx] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// DELETE /api/admin/services/:id
app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const services = readJSON(FILES.services).filter(s => s.id !== id);
    writeJSON(FILES.services, services);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete service' });
  }
});


// ── SPA / HTML FALLBACKS ─────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.redirect('/admin/login.html');
});
app.get('/admin/', (req, res) => {
  res.redirect('/admin/login.html');
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// ── START ────────────────────────────────────────────────────────────────────
initDB();
app.listen(PORT, () => {
  console.log(`✅ Urban Hairplaza server running on http://localhost:${PORT}`);
});
