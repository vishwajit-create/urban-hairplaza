/**
 * Urban Hairplaza – Backend Server
 * Node.js + Express
 * Features: REST API, PostgreSQL (Neon) storage, Session auth, WhatsApp + SMS (Twilio) notifications
 */

require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const { v4: uuidv4 } = require('uuid');
const axios      = require('axios');
const path       = require('path');
const { Pool }   = require('pg');

const app  = express();
const PORT = process.env.PORT || 7890;
const BASE_URL = process.env.BASE_URL || \`http://localhost:\${PORT}\`;

// POSTGRESQL CONNECTION
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// DATABASE INITIALIZATION
async function initDB() {
  await db.query(\`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  \`);

  await db.query(\`
    CREATE TABLE IF NOT EXISTS services (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      name        TEXT NOT NULL,
      price       INTEGER DEFAULT 0,
      duration    INTEGER DEFAULT 0,
      desc        TEXT DEFAULT '',
      icon        TEXT DEFAULT ''
    );
  \`);

  await db.query(\`
    CREATE TABLE IF NOT EXISTS bookings (
      id              TEXT PRIMARY KEY,
      type            TEXT DEFAULT 'inshop',
      service         TEXT NOT NULL,
      barber          TEXT DEFAULT 'Best Available',
      date            TEXT NOT NULL,
      time            TEXT NOT NULL,
      name            TEXT NOT NULL,
      phone           TEXT NOT NULL,
      address         TEXT DEFAULT '',
      notes           TEXT DEFAULT '',
      price           INTEGER DEFAULT 0,
      duration        INTEGER DEFAULT 0,
      advance_paid    INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'pending',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ
    );
  \`);

  await db.query(\`
    CREATE TABLE IF NOT EXISTS enquiries (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL,
      email       TEXT DEFAULT '',
      subject     TEXT DEFAULT 'General Inquiry',
      message     TEXT NOT NULL,
      status      TEXT DEFAULT 'unread',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ
    );
  \`);

  const { rows } = await db.query('SELECT COUNT(*) FROM services');
  if (parseInt(rows[0].count) === 0) {
    const defaultServices = [
      { type: 'inshop', name: 'Classic Haircut', price: 150, duration: 30, desc: 'Precision cut, any style', icon: '✂' },
      { type: 'inshop', name: 'Beard Trim & Shape-Up', price: 200, duration: 20, desc: 'Shaping, lining & styling', icon: ':' },
      { type: 'inshop', name: 'Royal Shave', price: 250, duration: 30, desc: 'Hot-towel straight-razor shave', icon: ':' },
      { type: 'inshop', name: 'Haircut + Beard Combo', price: 500, duration: 50, desc: 'Full cut + beard trim package', icon: ':' },
      { type: 'inshop', name: 'Head Shave', price: 400, duration: 30, desc: 'Clean head shave, razor smooth', icon: ':' },
      { type: 'home', name: 'Classic Haircut (Home)', price: 250, duration: 30, desc: 'Precision cut at your home', icon: '✂' },
      { type: 'home', name: 'Beard Trim (Home)', price: 350, duration: 20, desc: 'Shaping & lining at your home', icon: ':' },
      { type: 'home', name: 'Royal Shave (Home)', price: 400, duration: 30, desc: 'Hot-towel shave at your home', icon: ':' },
      { type: 'home', name: 'Haircut + Beard Combo (Home)', price: 500, duration: 50, desc: 'Full home grooming package', icon: ':' },
      { type: 'home', name: 'Kids Haircut (Home)', price: 200, duration: 25, desc: 'Gentle cut for kids at home', icon: ':' }
    ];
    for (const s of defaultServices) {
      const id = uuidv4().split('-')[0].toUpperCase();
      await db.query(
        'INSERT INTO services (id, type, name, price, duration, desc, icon) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, s.type, s.name, s.price, s.duration, s.desc, s.icon]
      );
    }
    console.log('[DB] Default services seeded.');
  }
  console.log('[DB] PostgreSQL connected and tables ready.');
}

initDB().catch(console.error);
app.use(express.json());
app.get('/', (req, res) => res.send('Urban Hairplaza Server (Partially Restored)'));
app.listen(PORT, () => console.log('Server running'));

