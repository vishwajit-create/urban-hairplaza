/**
 * Urban Hairplaza – Backend Server
 * Node.js + Express
 * Features: REST API, JSON file storage, Session auth, WhatsApp + SMS (Twilio) notifications
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
const SERVICES_FILE  = path.join(DATA_DIR, 'services.json');


function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BOOKINGS_FILE))  fs.writeFileSync(BOOKINGS_FILE,  '[]', 'utf8');
  if (!fs.existsSync(ENQUIRIES_FILE)) fs.writeFileSync(ENQUIRIES_FILE, '[]', 'utf8');
  if (!fs.existsSync(SERVICES_FILE)) {
    const defaultServices = [
      { id: uuidv4().split('-')[0].toUpperCase(), type: 'inshop', name: 'Classic Haircut', price: 150, duration: 30, desc: 'Precision cut, any style', icon: '✂️' },
      { id: uuidv4().split('-')[0].toUpperCase(), type: 'inshop', name: 'Beard Trim & Shape-Up', price: 200, duration: 20, desc: 'Shaping, lining & styling', icon: '🧔' },
      { id: uuidv4().split('-')[0].toUpperCase(), type: 'inshop', name: 'Royal Shave', price: 250, duration: 30, desc: 'Hot-towel straight-razor shave', icon: '👑' },
      { id: uuidv4().split('-')[0].toUpperCase(), type: 'inshop', name: 'Haircut + Beard Combo', price: 500, duration: 50, desc: 'Full cut + beard trim package', icon: '💈' },
      { id: uuidv4().split('-')[0].toUpperCase(), type: 'inshop', name: 'Head Shave', price: 400, duration: 30, desc: 'Clean head shave, razor smooth', icon: '🪒' },
      { id: uuidv4().split('-')[0].toUpperCase(), type: 'home', name: 'Classic Haircut (Home)', price: 250, duration: 30, desc: 'Precision cut at your home', icon: '✂️' },
