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
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;


// POSTGRESQL CONNECTION
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


// DATABASE INITIALIZATION
async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);


  await db.query(` 
