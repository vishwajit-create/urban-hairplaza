/**
 * Urban Hairplaza – Unified Database Layer
 * Supports:
 *   1. Neon Cloud PostgreSQL (when DATABASE_URL is set) — Permanent enterprise storage
 *   2. Local JSON Flat-Files (fallback when DATABASE_URL is not set)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  services:     path.join(DATA_DIR, 'services.json'),
  bookings:     path.join(DATA_DIR, 'bookings.json'),
  enquiries:    path.join(DATA_DIR, 'enquiries.json'),
  transactions: path.join(DATA_DIR, 'transactions.json'),
  users:        path.join(DATA_DIR, 'users.json'),
  otps:         path.join(DATA_DIR, 'otps.json')
};

// ── JSON FILE HELPERS ────────────────────────────────────────────────────────
function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[DB-JSON] Read error on ${file}:`, e.message);
    return [];
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[DB-JSON] Write error on ${file}:`, e.message);
  }
}

// ── POSTGRESQL POOL SETUP ───────────────────────────────────────────────────
let pgPool = null;
const dbUrl = process.env.DATABASE_URL;

if (dbUrl && dbUrl.trim().startsWith('postgres')) {
  try {
    pgPool = new Pool({
      connectionString: dbUrl.trim(),
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    console.log('[DB] Neon PostgreSQL connection pool initialized.');
  } catch (err) {
    console.error('[DB] Failed to initialize PostgreSQL pool:', err.message);
    pgPool = null;
  }
} else {
  console.log('[DB] No DATABASE_URL found. Using local JSON flat-file storage.');
}

// ── DATABASE INITIALIZATION & SCHEMA CREATION ───────────────────────────────
async function initDB() {
  if (pgPool) {
    try {
      const client = await pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS bookings (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50) NOT NULL,
            email VARCHAR(255),
            service VARCHAR(255) NOT NULL,
            barber VARCHAR(255) NOT NULL,
            date VARCHAR(50) NOT NULL,
            time VARCHAR(50) NOT NULL,
            type VARCHAR(50) DEFAULT 'inshop',
            address TEXT,
            notes TEXT,
            price NUMERIC(10,2) DEFAULT 0,
            duration VARCHAR(50),
            status VARCHAR(50) DEFAULT 'payment_pending',
            advance_paid NUMERIC(10,2) DEFAULT 0,
            payment_verified_at TIMESTAMPTZ,
            payment_order_id VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS transactions (
            id VARCHAR(64) PRIMARY KEY,
            booking_id VARCHAR(64),
            order_id VARCHAR(255) NOT NULL,
            amount NUMERIC(10,2) NOT NULL,
            currency VARCHAR(10) DEFAULT 'INR',
            status VARCHAR(50) DEFAULT 'PAID',
            payment_method VARCHAR(50) DEFAULT 'CASHFREE',
            customer_name VARCHAR(255),
            customer_phone VARCHAR(50),
            customer_email VARCHAR(255),
            gateway_response JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255),
            phone VARCHAR(50) UNIQUE,
            email VARCHAR(255),
            first_visit TIMESTAMPTZ DEFAULT NOW(),
            last_visit TIMESTAMPTZ DEFAULT NOW(),
            total_bookings INT DEFAULT 1,
            total_spent NUMERIC(10,2) DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS services (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(100),
            duration VARCHAR(50),
            price NUMERIC(10,2) NOT NULL,
            description TEXT,
            badge VARCHAR(50)
          );

          CREATE TABLE IF NOT EXISTS enquiries (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            email VARCHAR(255),
            subject VARCHAR(255),
            message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS otp_codes (
            identifier VARCHAR(255) PRIMARY KEY,
            otp VARCHAR(10) NOT NULL,
            type VARCHAR(20) DEFAULT 'phone',
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          ALTER TABLE services ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'inshop';
        `);
        console.log('[DB] PostgreSQL schema verified successfully.');
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('[DB] PostgreSQL init error:', e.message);
    }
  }

  // Initialize JSON seed if file is empty
  if (!fs.existsSync(FILES.services) || readJSON(FILES.services).length === 0) {
    const defaultServices = [
      { id: 'SRV-01', category: 'Haircut', type: 'inshop', icon: '✂️', name: 'Classic Tailored Haircut', desc: 'Precision scissor and clipper cut suited to your head shape, including rinse and hot towel neck finish.', price: 150, duration: 30 },
      { id: 'SRV-02', category: 'Haircut', type: 'inshop', icon: '💈', name: 'Fade & Taper Styling', desc: 'Skin fade, low fade, drop fade, or taper cut with razor-sharp temple and neck line-up.', price: 200, duration: 35 },
      { id: 'SRV-03', category: 'Beard', type: 'inshop', icon: '🪒', name: 'Beard Sculpting & Razor Line', desc: 'Detailed beard trimming, length shaping, organic oil conditioning, and straight-razor cheek line.', price: 100, duration: 20 },
      { id: 'SRV-04', category: 'Shave', type: 'inshop', icon: '🧴', name: 'Royal Hot Towel Shave', desc: 'Pre-shave eucalyptus oil, steamed towels, rich warm lather, and traditional straight-edge razor shave.', price: 150, duration: 25 },
      { id: 'SRV-05', category: 'Treatment', type: 'inshop', icon: '💆', name: 'Head & Scalp Revival Massage', desc: 'Deep pressure-point scalp massage with nourishing almond & mint oils to relieve stress and stimulate follicles.', price: 120, duration: 25 },
      { id: 'SRV-06', category: 'Treatment', type: 'inshop', icon: '✨', name: 'Charcoal Detox Face Cleanup', desc: 'Exfoliating activated charcoal scrub, steam pore opening, blackhead extraction, and calming moisturizer.', price: 250, duration: 30 },
      { id: 'SRV-07', category: 'Combos', type: 'inshop', icon: '👑', name: 'The Urban Plaza Full Package', desc: 'Signature haircut + full beard grooming + head massage + refreshing face cleanse.', price: 450, duration: 75 },
      { id: 'SRV-08', category: 'Home Visit', type: 'home', icon: '🏠', name: 'Home Visit – Signature Haircut', desc: 'Professional barber arrives at your doorstep with sanitized tools and sterile setup.', price: 250, duration: 45 },
      { id: 'SRV-09', category: 'Home Visit', type: 'home', icon: '🏠', name: 'Home Visit – Complete Grooming Combo', desc: 'Full haircut, beard styling, and soothing scalp massage in the comfort of your home.', price: 500, duration: 90 },
    ];
    writeJSON(FILES.services, defaultServices);
  }
  if (!fs.existsSync(FILES.bookings)) writeJSON(FILES.bookings, []);
  if (!fs.existsSync(FILES.enquiries)) writeJSON(FILES.enquiries, []);
  if (!fs.existsSync(FILES.transactions)) writeJSON(FILES.transactions, []);
  if (!fs.existsSync(FILES.users)) writeJSON(FILES.users, []);
  if (!fs.existsSync(FILES.otps)) writeJSON(FILES.otps, []);
}

// ── BOOKINGS METHODS ────────────────────────────────────────────────────────
async function getBookings() {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM bookings ORDER BY created_at DESC');
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        service: r.service,
        barber: r.barber,
        date: r.date,
        time: r.time,
        type: r.type,
        address: r.address,
        notes: r.notes,
        price: Number(r.price) || 0,
        duration: r.duration,
        status: r.status,
        advancePaid: Number(r.advance_paid) || 0,
        paymentVerifiedAt: r.payment_verified_at,
        paymentOrderId: r.payment_order_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    } catch (e) {
      console.error('[DB] Postgres getBookings error, falling back to JSON:', e.message);
    }
  }
  return readJSON(FILES.bookings);
}

async function getBookingById(id) {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [id]);
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          service: r.service,
          barber: r.barber,
          date: r.date,
          time: r.time,
          type: r.type,
          address: r.address,
          notes: r.notes,
          price: Number(r.price) || 0,
          duration: r.duration,
          status: r.status,
          advancePaid: Number(r.advance_paid) || 0,
          paymentVerifiedAt: r.payment_verified_at,
          paymentOrderId: r.payment_order_id,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        };
      }
    } catch (e) {
      console.error('[DB] Postgres getBookingById error:', e.message);
    }
  }
  const bookings = readJSON(FILES.bookings);
  return bookings.find(b => b.id === id) || null;
}

async function saveBooking(booking) {
  // Always update JSON cache
  const bookings = readJSON(FILES.bookings);
  const idx = bookings.findIndex(b => b.id === booking.id);
  if (idx >= 0) bookings[idx] = booking;
  else bookings.unshift(booking);
  writeJSON(FILES.bookings, bookings);

  // Auto-track user info
  await upsertUser({
    name: booking.name,
    phone: booking.phone,
    email: booking.email,
    spent: booking.advancePaid || 0
  });

  if (pgPool) {
    try {
      const query = `
        INSERT INTO bookings (
          id, name, phone, email, service, barber, date, time, type,
          address, notes, price, duration, status, advance_paid,
          payment_verified_at, payment_order_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          service = EXCLUDED.service,
          barber = EXCLUDED.barber,
          date = EXCLUDED.date,
          time = EXCLUDED.time,
          type = EXCLUDED.type,
          address = EXCLUDED.address,
          notes = EXCLUDED.notes,
          price = EXCLUDED.price,
          duration = EXCLUDED.duration,
          status = EXCLUDED.status,
          advance_paid = EXCLUDED.advance_paid,
          payment_verified_at = EXCLUDED.payment_verified_at,
          payment_order_id = EXCLUDED.payment_order_id,
          updated_at = NOW();
      `;
      const values = [
        booking.id,
        booking.name,
        booking.phone,
        booking.email || '',
        booking.service,
        booking.barber,
        booking.date,
        booking.time,
        booking.type || 'inshop',
        booking.address || '',
        booking.notes || '',
        Number(booking.price) || 0,
        booking.duration ? String(booking.duration) : '30',
        booking.status || 'payment_pending',
        Number(booking.advancePaid) || 0,
        booking.paymentVerifiedAt ? new Date(booking.paymentVerifiedAt) : null,
        booking.id,
        booking.createdAt ? new Date(booking.createdAt) : new Date(),
        new Date()
      ];
      await pgPool.query(query, values);
    } catch (e) {
      console.error('[DB] Postgres saveBooking error:', e.message);
    }
  }

  return booking;
}

async function updateBooking(id, updates) {
  const bookings = readJSON(FILES.bookings);
  const idx = bookings.findIndex(b => b.id === id);
  if (idx >= 0) {
    Object.assign(bookings[idx], updates, { updatedAt: new Date().toISOString() });
    writeJSON(FILES.bookings, bookings);
  }

  if (pgPool) {
    try {
      const setClauses = [];
      const values = [id];
      let i = 2;

      if (updates.status !== undefined) { setClauses.push(`status = $${i++}`); values.push(updates.status); }
      if (updates.barber !== undefined) { setClauses.push(`barber = $${i++}`); values.push(updates.barber); }
      if (updates.notes !== undefined) { setClauses.push(`notes = $${i++}`); values.push(updates.notes); }
      if (updates.advancePaid !== undefined) { setClauses.push(`advance_paid = $${i++}`); values.push(Number(updates.advancePaid)); }
      if (updates.paymentVerifiedAt !== undefined) { setClauses.push(`payment_verified_at = $${i++}`); values.push(new Date(updates.paymentVerifiedAt)); }

      setClauses.push(`updated_at = NOW()`);

      if (setClauses.length > 0) {
        await pgPool.query(`UPDATE bookings SET ${setClauses.join(', ')} WHERE id = $1`, values);
      }
    } catch (e) {
      console.error('[DB] Postgres updateBooking error:', e.message);
    }
  }

  return getBookingById(id);
}

async function deleteBooking(id) {
  const bookings = readJSON(FILES.bookings);
  writeJSON(FILES.bookings, bookings.filter(b => b.id !== id));

  if (pgPool) {
    try {
      await pgPool.query('DELETE FROM bookings WHERE id = $1', [id]);
    } catch (e) {
      console.error('[DB] Postgres deleteBooking error:', e.message);
    }
  }
  return true;
}

// ── TRANSACTIONS METHODS ────────────────────────────────────────────────────
async function saveTransaction(txn) {
  const transactions = readJSON(FILES.transactions);
  const newTxn = {
    id: txn.id || `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    bookingId: txn.bookingId || txn.orderId,
    orderId: txn.orderId,
    amount: Number(txn.amount) || 0,
    currency: txn.currency || 'INR',
    status: txn.status || 'PAID',
    paymentMethod: txn.paymentMethod || 'CASHFREE',
    customerName: txn.customerName || '',
    customerPhone: txn.customerPhone || '',
    customerEmail: txn.customerEmail || '',
    gatewayResponse: txn.gatewayResponse || null,
    createdAt: txn.createdAt || new Date().toISOString()
  };

  transactions.unshift(newTxn);
  writeJSON(FILES.transactions, transactions);

  // Sync user record lifetime spend
  await upsertUser({
    name: newTxn.customerName,
    phone: newTxn.customerPhone,
    email: newTxn.customerEmail,
    spent: newTxn.amount
  });

  if (pgPool) {
    try {
      const query = `
        INSERT INTO transactions (
          id, booking_id, order_id, amount, currency, status,
          payment_method, customer_name, customer_phone, customer_email,
          gateway_response, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          gateway_response = EXCLUDED.gateway_response;
      `;
      const values = [
        newTxn.id,
        newTxn.bookingId,
        newTxn.orderId,
        newTxn.amount,
        newTxn.currency,
        newTxn.status,
        newTxn.paymentMethod,
        newTxn.customerName,
        newTxn.customerPhone,
        newTxn.customerEmail,
        newTxn.gatewayResponse ? JSON.stringify(newTxn.gatewayResponse) : null,
        new Date(newTxn.createdAt)
      ];
      await pgPool.query(query, values);
    } catch (e) {
      console.error('[DB] Postgres saveTransaction error:', e.message);
    }
  }

  return newTxn;
}

async function getTransactions() {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM transactions ORDER BY created_at DESC');
      return res.rows.map(r => ({
        id: r.id,
        bookingId: r.booking_id,
        orderId: r.order_id,
        amount: Number(r.amount) || 0,
        currency: r.currency,
        status: r.status,
        paymentMethod: r.payment_method,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        gatewayResponse: r.gateway_response,
        createdAt: r.created_at
      }));
    } catch (e) {
      console.error('[DB] Postgres getTransactions error, fallback to JSON:', e.message);
    }
  }
  return readJSON(FILES.transactions);
}

// ── USERS / CLIENT PROFILES METHODS ─────────────────────────────────────────
async function upsertUser({ name, phone, email, spent = 0 }) {
  if (!phone) return null;
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  if (!cleanPhone) return null;

  const users = readJSON(FILES.users);
  let user = users.find(u => u.phone.replace(/\D/g, '').slice(-10) === cleanPhone);

  if (user) {
    if (name && name.trim()) user.name = name.trim();
    if (email && email.trim()) user.email = email.trim();
    user.lastVisit = new Date().toISOString();
    user.totalBookings = (user.totalBookings || 1) + 1;
    user.totalSpent = (Number(user.totalSpent) || 0) + Number(spent);
  } else {
    user = {
      id: `USR-${cleanPhone}`,
      name: (name || 'Valued Client').trim(),
      phone: phone.trim(),
      email: (email || '').trim(),
      firstVisit: new Date().toISOString(),
      lastVisit: new Date().toISOString(),
      totalBookings: 1,
      totalSpent: Number(spent) || 0
    };
    users.unshift(user);
  }
  writeJSON(FILES.users, users);

  if (pgPool) {
    try {
      const query = `
        INSERT INTO users (id, name, phone, email, first_visit, last_visit, total_bookings, total_spent)
        VALUES ($1, $2, $3, $4, NOW(), NOW(), 1, $5)
        ON CONFLICT (phone) DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
          email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
          last_visit = NOW(),
          total_bookings = users.total_bookings + 1,
          total_spent = users.total_spent + EXCLUDED.total_spent;
      `;
      await pgPool.query(query, [
        `USR-${cleanPhone}`,
        name || 'Valued Client',
        phone.trim(),
        email || '',
        Number(spent) || 0
      ]);
    } catch (e) {
      console.error('[DB] Postgres upsertUser error:', e.message);
    }
  }

  return user;
}

async function getUsers() {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM users ORDER BY last_visit DESC');
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        firstVisit: r.first_visit,
        lastVisit: r.last_visit,
        totalBookings: Number(r.total_bookings) || 1,
        totalSpent: Number(r.total_spent) || 0
      }));
    } catch (e) {
      console.error('[DB] Postgres getUsers error, fallback to JSON:', e.message);
    }
  }
  return readJSON(FILES.users);
}

// ── SERVICES METHODS ────────────────────────────────────────────────────────
async function getServices() {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM services ORDER BY price ASC');
      if (res.rows.length > 0) {
        const services = res.rows.map(r => {
          const isHome = (r.type === 'home') || 
                         (r.category && r.category.toLowerCase().includes('home')) || 
                         (r.name && r.name.toLowerCase().includes('home'));
          return {
            id: r.id,
            name: r.name,
            category: r.category,
            duration: r.duration,
            price: Number(r.price) || 0,
            desc: r.description,
            description: r.description,
            badge: r.badge,
            icon: isHome ? '🏠' : '✂️',
            type: isHome ? 'home' : 'inshop'
          };
        });

        // Ensure home services exist if not in database
        const hasHome = services.some(s => s.type === 'home');
        if (!hasHome) {
          services.push(
            { id: 'home-haircut', name: 'Home Visit – Signature Haircut', category: 'Home Visit', duration: '45 min', price: 250, desc: 'Professional barber arrives at your doorstep with sanitized tools and sterile setup.', description: 'Professional barber arrives at your doorstep with sanitized tools and sterile setup.', badge: 'Doorstep', icon: '🏠', type: 'home' },
            { id: 'home-combo', name: 'Home Visit – Complete Grooming Combo', category: 'Home Visit', duration: '90 min', price: 500, desc: 'Full haircut, beard styling, and soothing scalp massage in the comfort of your home.', description: 'Full haircut, beard styling, and soothing scalp massage in the comfort of your home.', badge: 'Doorstep', icon: '🏠', type: 'home' }
          );
        }

        return services;
      }
    } catch (e) {
      console.error('[DB] Postgres getServices error:', e.message);
    }
  }
  return readJSON(FILES.services).map(s => {
    const isHome = (s.type === 'home') || 
                   (s.category && s.category.toLowerCase().includes('home')) || 
                   (s.name && s.name.toLowerCase().includes('home'));
    return {
      ...s,
      type: isHome ? 'home' : 'inshop'
    };
  });
}

async function saveService(service) {
  const services = readJSON(FILES.services);
  services.push(service);
  writeJSON(FILES.services, services);

  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO services (id, name, category, duration, price, description, badge)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          duration = EXCLUDED.duration,
          price = EXCLUDED.price,
          description = EXCLUDED.description,
          badge = EXCLUDED.badge;
      `, [
        service.id,
        service.name,
        service.category || 'Haircut',
        String(service.duration || '30'),
        Number(service.price) || 0,
        service.desc || service.description || '',
        service.badge || ''
      ]);
    } catch (e) {
      console.error('[DB] Postgres saveService error:', e.message);
    }
  }
  return service;
}

async function updateService(id, updates) {
  const services = readJSON(FILES.services);
  const idx = services.findIndex(s => s.id === id);
  if (idx >= 0) {
    Object.assign(services[idx], updates);
    writeJSON(FILES.services, services);
  }

  if (pgPool) {
    try {
      await pgPool.query(`
        UPDATE services SET
          name = COALESCE($2, name),
          category = COALESCE($3, category),
          duration = COALESCE($4, duration),
          price = COALESCE($5, price),
          description = COALESCE($6, description)
        WHERE id = $1;
      `, [
        id,
        updates.name,
        updates.category,
        updates.duration ? String(updates.duration) : null,
        updates.price !== undefined ? Number(updates.price) : null,
        updates.desc || updates.description
      ]);
    } catch (e) {
      console.error('[DB] Postgres updateService error:', e.message);
    }
  }
  return services[idx];
}

async function deleteService(id) {
  const services = readJSON(FILES.services);
  writeJSON(FILES.services, services.filter(s => s.id !== id));

  if (pgPool) {
    try {
      await pgPool.query('DELETE FROM services WHERE id = $1', [id]);
    } catch (e) {
      console.error('[DB] Postgres deleteService error:', e.message);
    }
  }
  return true;
}

// ── ENQUIRIES METHODS ───────────────────────────────────────────────────────
async function getEnquiries() {
  if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM enquiries ORDER BY created_at DESC');
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        subject: r.subject,
        message: r.message,
        status: 'unread',
        createdAt: r.created_at
      }));
    } catch (e) {
      console.error('[DB] Postgres getEnquiries error:', e.message);
    }
  }
  return readJSON(FILES.enquiries);
}

async function saveEnquiry(enquiry) {
  const enquiries = readJSON(FILES.enquiries);
  enquiries.unshift(enquiry);
  writeJSON(FILES.enquiries, enquiries);

  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO enquiries (id, name, phone, email, subject, message, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        enquiry.id,
        enquiry.name,
        enquiry.phone || '',
        enquiry.email || '',
        enquiry.subject || 'General Enquiry',
        enquiry.message || '',
        new Date(enquiry.createdAt || Date.now())
      ]);
    } catch (e) {
      console.error('[DB] Postgres saveEnquiry error:', e.message);
    }
  }
  return enquiry;
}

async function deleteEnquiry(id) {
  const enquiries = readJSON(FILES.enquiries);
  writeJSON(FILES.enquiries, enquiries.filter(e => e.id !== id));

  if (pgPool) {
    try {
      await pgPool.query('DELETE FROM enquiries WHERE id = $1', [id]);
    } catch (e) {
      console.error('[DB] Postgres deleteEnquiry error:', e.message);
    }
  }
  return true;
}

// ── OTP AUTH & USER BOOKINGS ────────────────────────────────────────────────
async function saveOtp(identifier, otp, type = 'phone') {
  const cleanId = identifier.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // JSON fallback
  const otps = readJSON(FILES.otps);
  const idx = otps.findIndex(o => o.identifier === cleanId);
  const record = { identifier: cleanId, otp, type, expiresAt, createdAt: new Date().toISOString() };
  if (idx >= 0) otps[idx] = record;
  else otps.push(record);
  writeJSON(FILES.otps, otps);

  // PostgreSQL
  if (pgPool) {
    try {
      await pgPool.query(`
        INSERT INTO otp_codes (identifier, otp, type, expires_at, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (identifier) DO UPDATE SET
          otp = EXCLUDED.otp,
          type = EXCLUDED.type,
          expires_at = EXCLUDED.expires_at,
          created_at = NOW();
      `, [cleanId, otp, type, new Date(Date.now() + 10 * 60 * 1000)]);
    } catch (e) {
      console.error('[DB] Postgres saveOtp error:', e.message);
    }
  }
  return record;
}

async function verifyOtp(identifier, inputOtp) {
  const cleanId = identifier.trim().toLowerCase();
  const cleanOtp = String(inputOtp).trim();

  // PostgreSQL check
  if (pgPool) {
    try {
      const res = await pgPool.query(
        'SELECT * FROM otp_codes WHERE identifier = $1 AND otp = $2 AND expires_at > NOW() LIMIT 1',
        [cleanId, cleanOtp]
      );
      if (res.rows.length > 0) {
        // Delete used OTP
        await pgPool.query('DELETE FROM otp_codes WHERE identifier = $1', [cleanId]);
        return true;
      }
    } catch (e) {
      console.error('[DB] Postgres verifyOtp error:', e.message);
    }
  }

  // JSON check
  const otps = readJSON(FILES.otps);
  const record = otps.find(o => o.identifier === cleanId && o.otp === cleanOtp && new Date(o.expiresAt) > new Date());
  if (record) {
    writeJSON(FILES.otps, otps.filter(o => o.identifier !== cleanId));
    return true;
  }
  return false;
}

async function getUserByIdentifier(identifier) {
  const clean = identifier.trim().toLowerCase();
  const cleanPhone = clean.replace(/\D/g, '').slice(-10);
  const isPhone = cleanPhone.length === 10;

  const users = await getUsers();
  return users.find(u => {
    if (isPhone && (u.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone) return true;
    if ((u.email || '').trim().toLowerCase() === clean) return true;
    return false;
  }) || null;
}

async function getUserBookings(phone, email) {
  const cleanPhone = phone ? phone.replace(/\D/g, '').slice(-10) : '';
  const cleanEmail = email ? email.trim().toLowerCase() : '';

  const allBookings = await getBookings();
  return allBookings.filter(b => {
    const bPhone = (b.phone || '').replace(/\D/g, '').slice(-10);
    const bEmail = (b.email || '').trim().toLowerCase();

    const matchesPhone = Boolean(cleanPhone && bPhone && bPhone === cleanPhone);
    const matchesEmail = Boolean(cleanEmail && bEmail && bEmail === cleanEmail);
    return matchesPhone || matchesEmail;
  });
}

module.exports = {
  initDB,
  getBookings,
  getBookingById,
  saveBooking,
  updateBooking,
  deleteBooking,
  saveTransaction,
  getTransactions,
  upsertUser,
  getUsers,
  getUserByIdentifier,
  getUserBookings,
  saveOtp,
  verifyOtp,
  getServices,
  saveService,
  updateService,
  deleteService,
  getEnquiries,
  saveEnquiry,
  deleteEnquiry
};
