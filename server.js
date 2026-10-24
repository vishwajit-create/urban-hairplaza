/**
 * Urban Hairplaza – Production Backend Server
 * Technology: Node.js + Express + Neon PostgreSQL / JSON Fallback
 * Features:
 *   - Per-barber & general slot availability engine
 *   - Cashfree Payment Gateway (PG v3 API) with dev simulation mode
 *   - Full transaction logging & persistent client profiles
 *   - WhatsApp notification helpers & click-to-chat generator
 *   - Admin session authentication & full CRUD APIs
 *   - Neon PostgreSQL cloud storage with local JSON fallback
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const db = require('./db');

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const cleanA = a.replace(/^['"]|['"]$/g, '').trim();
  const cleanB = b.replace(/^['"]|['"]$/g, '').trim();
  const bufA = Buffer.from(cleanA);
  const bufB = Buffer.from(cleanB);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── STATELESS AUTH TOKEN (HMAC SHA-256) FOR SERVERLESS / MULTI-INSTANCE RESILIENCE ──
const AUTH_SECRET = process.env.SESSION_SECRET || 'urban-hairplaza-secret-2026';

function createAuthToken(payload) {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return data + '.' + signature;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const data = parts[0];
  const signature = parts[1];
  if (!data || !signature) return null;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (expectedSig !== signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractToken(req) {
  // 1. Authorization header: Bearer <token>
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  // 2. Custom headers
  if (req.headers['x-admin-token']) return String(req.headers['x-admin-token']).trim();
  if (req.headers['x-owner-token']) return String(req.headers['x-owner-token']).trim();
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']).trim();
  // 3. Cookies
  if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';');
    for (const c of cookies) {
      const trimmed = c.trim();
      if (trimmed.startsWith('uhp_admin_token=')) {
        return decodeURIComponent(trimmed.slice('uhp_admin_token='.length));
      }
      if (trimmed.startsWith('uhp_owner_token=')) {
        return decodeURIComponent(trimmed.slice('uhp_owner_token='.length));
      }
    }
  }
  // 4. Query param
  if (req.query && req.query.token) return req.query.token;
  return null;
}

const app = express();
const PORT = process.env.PORT || 7890;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL.startsWith('https://')) {
    return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.BASE_URL && process.env.BASE_URL.startsWith('https://')) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (req && req.get) {
    const host = req.get('host');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      return `${proto}://${host}`;
    }
  }
  return 'https://salonbooking-rho.vercel.app';
}

// ── OPERATING TIME SLOTS (9:00 AM – 9:00 PM) ──────────────────────────────
const OPERATING_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM',
  '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM',
  '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM',
  '05:00 PM', '05:30 PM', '06:00 PM', '06:30 PM',
  '07:00 PM', '07:30 PM', '08:00 PM', '08:30 PM'
];

const VALID_BARBERS = ['Raj Kumar', 'Sameer Khan', 'Amit Sharma'];

// ── SECURITY HEADERS & DEFENSES ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Lightweight in-memory rate limiter for abuse prevention
const rateLimitStore = new Map();
function rateLimit({ windowMs = 60000, max = 20, message = 'Too many requests. Please slow down.' }) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const key = `${req.baseUrl || req.path}:${ip}`;
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + windowMs;
    } else {
      record.count++;
    }

    rateLimitStore.set(key, record);

    if (record.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// ── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.set('trust proxy', 1);

app.use(session({
  name: 'uhp_session',
  secret: process.env.SESSION_SECRET || 'urban-hairplaza-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

// Static files
app.use(express.static(path.join(__dirname)));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/images', express.static(path.join(__dirname, 'images')));

const STATIC_PAGES = {
  '/': path.join(__dirname, 'index.html'),
  '/index.html': path.join(__dirname, 'index.html'),
  '/account': path.join(__dirname, 'account.html'),
  '/account.html': path.join(__dirname, 'account.html'),
  '/login': path.join(__dirname, 'account.html'),
  '/login.html': path.join(__dirname, 'account.html'),
  '/my-bookings': path.join(__dirname, 'account.html'),
  '/salons': path.join(__dirname, 'salons.html'),
  '/salons.html': path.join(__dirname, 'salons.html'),
  '/explore-salons': path.join(__dirname, 'salons.html'),
  '/register-salon': path.join(__dirname, 'register-salon.html'),
  '/register-salon.html': path.join(__dirname, 'register-salon.html'),
  '/owner': path.join(__dirname, 'owner', 'index.html'),
  '/owner/': path.join(__dirname, 'owner', 'index.html'),
  '/owner/login': path.join(__dirname, 'owner', 'login.html'),
  '/owner/login.html': path.join(__dirname, 'owner', 'login.html'),
  '/owner/register': path.join(__dirname, 'register-salon.html'),
  '/owner/dashboard': path.join(__dirname, 'owner', 'dashboard.html'),
  '/owner/dashboard.html': path.join(__dirname, 'owner', 'dashboard.html'),
  '/admin': path.join(__dirname, 'admin', 'login.html'),
  '/admin/': path.join(__dirname, 'admin', 'login.html'),
  '/admin/login': path.join(__dirname, 'admin', 'login.html'),
  '/admin/login.html': path.join(__dirname, 'admin', 'login.html'),
  '/admin/dashboard': path.join(__dirname, 'admin', 'dashboard.html'),
  '/admin/dashboard.html': path.join(__dirname, 'admin', 'dashboard.html'),
  '/pay': path.join(__dirname, 'pay.html'),
  '/pay.html': path.join(__dirname, 'pay.html'),
  '/book': path.join(__dirname, 'book.html'),
  '/book.html': path.join(__dirname, 'book.html'),
  '/services': path.join(__dirname, 'services.html'),
  '/services.html': path.join(__dirname, 'services.html'),
  '/barbers': path.join(__dirname, 'barbers.html'),
  '/barbers.html': path.join(__dirname, 'barbers.html'),
  '/gallery': path.join(__dirname, 'gallery.html'),
  '/gallery.html': path.join(__dirname, 'gallery.html'),
  '/about': path.join(__dirname, 'about.html'),
  '/about.html': path.join(__dirname, 'about.html'),
  '/contact': path.join(__dirname, 'contact.html'),
  '/contact.html': path.join(__dirname, 'contact.html'),
  '/lookbook': path.join(__dirname, 'lookbook.html'),
  '/lookbook.html': path.join(__dirname, 'lookbook.html'),
  '/privacy': path.join(__dirname, 'privacy.html'),
  '/privacy.html': path.join(__dirname, 'privacy.html'),
  '/privacy-policy': path.join(__dirname, 'privacy.html'),
  '/cookies': path.join(__dirname, 'privacy.html'),
  '/terms': path.join(__dirname, 'privacy.html'),
  '/styles.css': path.join(__dirname, 'styles.css'),
  '/main.js': path.join(__dirname, 'main.js')
};

for (const [route, filePath] of Object.entries(STATIC_PAGES)) {
  app.get(route, (req, res) => {
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send('Page not found');
    }
  });
}

// ── NOTIFICATION DISPATCHERS (SMS, EMAIL & WHATSAPP) ─────────────────────────

// Nodemailer optional import (falls back gracefully if not available)
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.warn('[Email] nodemailer module not loaded, SMTP fallback disabled.');
}

// ── REAL SMS DISPATCHER (Textbee / Fast2SMS / Twilio / 2Factor) ───────────────
async function sendRealSms(phone, message) {
  if (!phone || !message) return false;

  const rawPhone = String(phone).replace(/\D/g, '').slice(-10);
  if (rawPhone.length !== 10) return false;
  const formattedPhone = `+91${rawPhone}`;

  // 1. Textbee Gateway API (Official: https://api.textbee.dev/api/v1/gateway/send-sms)
  const rawKey = (process.env.TEXTBEE_API_KEY || process.env.TEXTBEE_KEY || process.env.TEXT_BEE_API_KEY || '').trim();
  const textbeeKey = rawKey.replace(/^['"]|['"]$/g, '').trim();
  const rawDevice = (process.env.TEXTBEE_DEVICE_ID || process.env.TEXTBEE_DEVICE || process.env.DEVICE_ID || '').trim();
  const textbeeDevice = rawDevice.replace(/^['"]|['"]$/g, '').trim() || '6ad42a0d5291071e5774b0b1';

  if (textbeeKey) {
    try {
      const res = await axios.post(
        'https://api.textbee.dev/api/v1/gateway/send-sms',
        {
          deviceId: textbeeDevice,
          recipients: [formattedPhone],
          message: message
        },
        {
          headers: {
            'x-api-key': textbeeKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      console.log(`[SMS-Textbee] Sent to ${formattedPhone}:`, res.data);
      return true;
    } catch (err) {
      console.warn('[SMS-Textbee] Error:', err.response?.data || err.message);
    }
  }

  // 2. Fast2SMS (India Bulk/OTP API fallback)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const res = await axios.post('https://www.fast2sms.com/dev/bulkV2', {
        route: 'v3',
        message: message,
        language: 'english',
        flash: 0,
        numbers: rawPhone
      }, {
        headers: {
          'authorization': process.env.FAST2SMS_API_KEY.trim()
        },
        timeout: 7000
      });
      console.log(`[SMS-Fast2SMS] Sent to ${rawPhone}:`, res.data);
      return true;
    } catch (err) {
      console.warn('[SMS-Fast2SMS] Error:', err.response?.data || err.message);
    }
  }

  // 3. Twilio SMS fallback
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
  if (twilioSid && twilioToken && twilioFrom) {
    try {
      const auth = Buffer.from(`${twilioSid.trim()}:${twilioToken.trim()}`).toString('base64');
      const params = new URLSearchParams({
        To: formattedPhone,
        From: twilioFrom.trim(),
        Body: message
      });
      await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid.trim()}/Messages.json`, params.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 7000
      });
      console.log(`[SMS-Twilio] Sent to ${formattedPhone}`);
      return true;
    } catch (err) {
      console.warn('[SMS-Twilio] Error:', err.response?.data || err.message);
    }
  }

  // 4. 2Factor.in SMS fallback
  if (process.env.TWOFACTOR_API_KEY) {
    try {
      await axios.get(`https://2factor.in/v1/${process.env.TWOFACTOR_API_KEY.trim()}/ADDON_SERVICES/SEND/TSMS`, {
        params: {
          From: 'URBANH',
          To: rawPhone,
          Msg: message
        },
        timeout: 7000
      });
      console.log(`[SMS-2Factor] Sent to ${rawPhone}`);
      return true;
    } catch (err) {
      console.warn('[SMS-2Factor] Error:', err.response?.data || err.message);
    }
  }

  return false;
}

async function sendRealSmsOtp(phone, otp) {
  return sendRealSms(phone, `✂️ Your Urban Hairplaza verification OTP is: ${otp}. Valid for 10 minutes. Do not share this code.`);
}

// ── REAL EMAIL DISPATCHER (Resend / Gmail SMTP / Brevo) ───────────────────────
async function sendRealEmail(email, subject, html) {
  if (!email || !email.includes('@')) return false;

  // 1. Resend API (Recommended)
  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM || 'Urban Hairplaza <onboarding@resend.dev>';
      const res = await axios.post('https://api.resend.com/emails', {
        from: fromEmail,
        to: email,
        subject: subject,
        html: html
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY.trim()}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });
      console.log(`[Email-Resend] Sent to ${email}:`, res.data?.id);
      return true;
    } catch (err) {
      console.warn('[Email-Resend] Error:', err.response?.data || err.message);
    }
  }

  // 2. Gmail SMTP / Custom SMTP via Nodemailer
  const smtpUser = process.env.GMAIL_USER || process.env.SMTP_USER;
  const smtpPass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
  if (nodemailer && smtpUser && smtpPass) {
    try {
      const isGmail = Boolean(process.env.GMAIL_USER || (smtpUser && smtpUser.includes('@gmail.com')));
      const transporter = nodemailer.createTransport(
        isGmail ? {
          service: 'gmail',
          auth: { user: smtpUser.trim(), pass: smtpPass.trim() }
        } : {
          host: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
          port: parseInt(process.env.SMTP_PORT || '465', 10),
          secure: (process.env.SMTP_PORT || '465') === '465',
          auth: { user: smtpUser.trim(), pass: smtpPass.trim() }
        }
      );

      await transporter.sendMail({
        from: `"Urban Hairplaza" <${smtpUser.trim()}>`,
        to: email,
        subject: subject,
        html: html
      });
      console.log(`[Email-SMTP] Sent to ${email} via ${smtpUser}`);
      return true;
    } catch (err) {
      console.warn('[Email-SMTP] Error:', err.message);
    }
  }

  // 3. Brevo API
  if (process.env.BREVO_API_KEY) {
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'Urban Hairplaza', email: process.env.BREVO_SENDER || 'urbanhairplaza@gmail.com' },
        to: [{ email }],
        subject: subject,
        htmlContent: html
      }, {
        headers: {
          'api-key': process.env.BREVO_API_KEY.trim(),
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });
      console.log(`[Email-Brevo] Sent to ${email}`);
      return true;
    } catch (err) {
      console.warn('[Email-Brevo] Error:', err.response?.data || err.message);
    }
  }

  return false;
}

async function sendRealEmailOtp(email, otp) {
  const htmlTemplate = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #0f1013; color: #f5f5f7; border-radius: 16px; border: 1px solid rgba(212,175,55,0.3); overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
      <div style="background: linear-gradient(135deg, #1c1d22 0%, #121316 100%); padding: 30px 24px; text-align: center; border-bottom: 1px solid rgba(212,175,55,0.2);">
        <h1 style="color: #d4af37; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">✂️ URBAN HAIRPLAZA</h1>
        <p style="color: #8e8e93; margin: 8px 0 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: 2px;">Luxury Grooming Lounge</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <p style="font-size: 15px; color: #cfcfd4; margin: 0 0 16px 0;">Use the verification code below to securely sign in and view your appointments:</p>
        <div style="display: inline-block; background: rgba(212,175,55,0.12); border: 2px dashed #d4af37; border-radius: 12px; padding: 14px 28px; margin: 12px 0 20px 0;">
          <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #e6c65b; font-family: monospace;">${otp}</span>
        </div>
        <p style="font-size: 13px; color: #8e8e93; margin: 0;">⏱️ This code expires in <strong>10 minutes</strong>. Never share your OTP with anyone.</p>
      </div>
      <div style="background: #0a0a0c; padding: 16px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
        <p style="font-size: 12px; color: #636366; margin: 0;">📍 Near Phanishwar Nath Renu Statue, Simraha, Araria, Bihar · +91 6202 692 426</p>
      </div>
    </div>
  `;
  return sendRealEmail(email, `✂️ Your Urban Hairplaza Verification Code: ${otp}`, htmlTemplate);
}

// ── MULTI-PROVIDER WHATSAPP NOTIFICATION ENGINE ─────────────────────────────
global.whatsappLogs = global.whatsappLogs || [];

async function sendWhatsAppNotification(message, destinationPhone, options = {}) {
  if (!destinationPhone || !message) return { success: false, reason: 'missing_destination_or_message' };

  let rawPhone = String(destinationPhone).replace(/\D/g, '');
  if (rawPhone.length === 10) rawPhone = '91' + rawPhone;
  else if (rawPhone.length === 12 && rawPhone.startsWith('91')) {
    // Already has 91
  } else if (rawPhone.length > 10) {
    rawPhone = rawPhone.slice(-10);
    rawPhone = '91' + rawPhone;
  } else {
    return { success: false, reason: 'invalid_phone_number', phone: destinationPhone };
  }

  let dispatched = false;
  let providerUsed = 'SIMULATOR';
  let responseData = null;

  // 1. Meta WhatsApp Cloud API (Official Graph API)
  const metaToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const metaPhoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

  if (metaToken && metaPhoneId) {
    try {
      const res = await axios.post(
        `https://graph.facebook.com/v19.0/${metaPhoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: rawPhone,
          type: 'text',
          text: { preview_url: true, body: message }
        },
        {
          headers: {
            Authorization: `Bearer ${metaToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      dispatched = true;
      providerUsed = 'META_CLOUD_API';
      responseData = res.data;
      console.log(`[WhatsApp-Meta] Sent to +${rawPhone}:`, res.data);
    } catch (err) {
      console.warn('[WhatsApp-Meta] Error:', err.response?.data || err.message);
    }
  }

  // 2. Twilio WhatsApp API
  const twilioSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const twilioToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const twilioFrom = (process.env.TWILIO_WHATSAPP_NUMBER || '').trim();

  if (!dispatched && twilioSid && twilioToken && twilioFrom) {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
      const params = new URLSearchParams();
      params.append('From', `whatsapp:${twilioFrom.startsWith('+') ? twilioFrom : '+' + twilioFrom}`);
      params.append('To', `whatsapp:+${rawPhone}`);
      params.append('Body', message);

      const res = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        params.toString(),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      dispatched = true;
      providerUsed = 'TWILIO_WHATSAPP';
      responseData = res.data;
      console.log(`[WhatsApp-Twilio] Sent to +${rawPhone}:`, res.data?.sid);
    } catch (err) {
      console.warn('[WhatsApp-Twilio] Error:', err.response?.data || err.message);
    }
  }

  // 3. CallMeBot API (Free Gateway)
  const callmebotKey = (process.env.WHATSAPP_APIKEY || process.env.CALLMEBOT_APIKEY || '').trim();
  if (!dispatched && callmebotKey) {
    try {
      const res = await axios.get('https://api.callmebot.com/whatsapp.php', {
        params: { phone: rawPhone, apikey: callmebotKey, text: message },
        timeout: 6000
      });
      dispatched = true;
      providerUsed = 'CALLMEBOT';
      responseData = res.data;
      console.log(`[WhatsApp-CallMeBot] Sent to +${rawPhone}`);
    } catch (err) {
      console.warn('[WhatsApp-CallMeBot] Error:', err.message);
    }
  }

  // 4. Fallback: Simulator Logger (Ensures zero failures during development / staging)
  if (!dispatched) {
    providerUsed = 'SIMULATOR_LOG';
    dispatched = true;
    console.log(`\n======================================================`);
    console.log(`[WhatsApp Engine Simulator] Outgoing to +${rawPhone}:`);
    console.log(message);
    console.log(`======================================================\n`);
  }

  const logEntry = {
    id: `WA-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
    phone: rawPhone,
    provider: providerUsed,
    status: 'sent',
    message: message,
    timestamp: new Date().toISOString()
  };
  global.whatsappLogs.unshift(logEntry);
  if (global.whatsappLogs.length > 100) global.whatsappLogs.pop();

  return { success: true, provider: providerUsed, phone: rawPhone, logId: logEntry.id };
}

function buildWhatsAppMessage(booking) {
  const balance = Math.max(0, (booking.price || 0) - (booking.advancePaid || 0));
  return `✂️ *Urban Hairplaza Booking Confirmation*\n` +
    `--------------------------------\n` +
    `*Booking ID:* #${booking.id}\n` +
    `*Client:* ${booking.name} (${booking.phone})\n` +
    `*Service:* ${booking.service}\n` +
    `*Barber:* ${booking.barber || 'Assigned Stylist'}\n` +
    `*Date & Time:* ${booking.date} at ${booking.time}\n` +
    `*Mode:* ${booking.type === 'home' ? '🏠 Home Visit' : '🏢 In-Shop'}\n` +
    `*Total Fee:* ₹${booking.price}\n` +
    `*Advance Paid:* ₹${booking.advancePaid || 0}\n` +
    `*Balance Due:* ₹${balance}\n` +
    `*Status:* Confirmed ✅\n` +
    `--------------------------------\n` +
    `📍 Near Phanishwar Nath Renu Statue, Simraha, Araria, Bihar`;
}

function buildCustomerBookingWhatsApp(booking, salon, publicBase = 'https://salonbooking-rho.vercel.app') {
  const balanceDue = Math.max(0, (Number(booking.price) || 0) - (Number(booking.advancePaid) || 0));
  const salonName = salon?.name || booking.salonName || 'Urban Hairplaza';
  const salonAddr = salon?.address || (booking.type === 'home' ? 'Doorstep Home Visit' : 'Near Phanishwar Nath Renu Statue, Simraha, Araria, Bihar');
  const salonMap = salon?.mapsUrl || 'https://maps.google.com/?q=Near+Phanishwar+Nath+Renu+Statue+Simraha+Araria';
  const salonPhone = salon?.phone || '+91 6202 692 426';

  return `✂️ *Urban Hairplaza – Slot Confirmed!* ✅\n` +
    `--------------------------------\n` +
    `Hello *${booking.name}*, your appointment has been successfully locked!\n\n` +
    `📋 *Booking ID:* #${booking.id}\n` +
    `🏬 *Salon:* ${salonName}\n` +
    `💈 *Service:* ${booking.service}\n` +
    `✂️ *Stylist:* ${booking.barber || 'Assigned Stylist'}\n` +
    `📅 *Date & Time:* ${booking.date} at ${booking.time}\n` +
    `📍 *Location:* ${booking.type === 'home' ? '🏠 Home Visit Address: ' + (booking.address || 'Address on file') : '🏢 In-Shop (' + salonAddr + ')'}\n` +
    `💰 *Advance Paid:* ₹${booking.advancePaid || 50} (Secured)\n` +
    `💵 *Balance Due at Salon:* ₹${balanceDue}\n\n` +
    `🗺️ *Google Maps Directions:*\n` +
    `${salonMap}\n\n` +
    `📱 *Manage appointment or view receipt anytime:*\n` +
    `${publicBase}/account.html\n\n` +
    `Need help or running late? Call ${salonPhone}.`;
}

function buildOwnerBookingAlertWhatsApp(booking, salon, publicBase = 'https://salonbooking-rho.vercel.app') {
  const cleanClientPhone = (booking.phone || '').replace(/\D/g, '').slice(-10);
  const balanceDue = Math.max(0, (Number(booking.price) || 0) - (Number(booking.advancePaid) || 0));
  const salonName = salon?.name || booking.salonName || 'Urban Hairplaza';

  return `🔔 *New Booking Confirmed for ${salonName}!* 💈\n` +
    `--------------------------------\n` +
    `*Booking ID:* #${booking.id}\n` +
    `*Client:* ${booking.name} (+91 ${cleanClientPhone})\n` +
    `*Service:* ${booking.service}\n` +
    `*Stylist:* ${booking.barber || 'First Available'}\n` +
    `*Date & Time:* ${booking.date} at ${booking.time}\n` +
    `*Mode:* ${booking.type === 'home' ? '🏠 Home Visit' : '🏢 In-Shop'}\n` +
    `*Advance Secured:* ₹${booking.advancePaid || 50}\n` +
    `*Balance to Collect:* ₹${balanceDue}\n` +
    `--------------------------------\n` +
    `👉 View and manage in your Owner Portal:\n` +
    `${publicBase}/owner/dashboard.html`;
}

function buildReminderWhatsApp(booking, salon, hoursText = '2 hours') {
  const salonName = salon?.name || booking.salonName || 'Urban Hairplaza';
  const salonAddr = salon?.address || 'Near Phanishwar Nath Renu Statue, Simraha, Araria';
  const salonMap = salon?.mapsUrl || 'https://maps.google.com/?q=Near+Phanishwar+Nath+Renu+Statue+Simraha+Araria';
  const salonPhone = salon?.phone || '+91 6202 692 426';

  return `⏰ *Reminder: Haircut in ${hoursText}!* ✂️\n` +
    `--------------------------------\n` +
    `Hello *${booking.name}*, this is a friendly reminder for your appointment today at *${salonName}*!\n\n` +
    `💈 *Service:* ${booking.service}\n` +
    `✂️ *Stylist:* ${booking.barber || 'Assigned Stylist'}\n` +
    `🕒 *Appointment Time:* Today at *${booking.time}*\n` +
    `📍 *Address:* ${salonAddr}\n\n` +
    `🗺️ *Tap for directions:* ${salonMap}\n\n` +
    `Your chair is reserved. Please arrive 5 minutes before your time slot. If you need to make any changes, please call ${salonPhone}. See you soon!`;
}

// Slot time parser for reminders
function parseSlotMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridian = match[3] ? match[3].toUpperCase() : null;
  if (meridian === 'PM' && hours < 12) hours += 12;
  if (meridian === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

// Indian Standard Time calculator (UTC+5:30)
function getNowIst() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + (330 * 60000));
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  const nowMinutes = istDate.getHours() * 60 + istDate.getMinutes();
  return { dateStr: todayStr, nowMinutes, istDate };
}

// Automated 2-hour pre-visit reminder engine
async function checkAndSendUpcomingReminders() {
  const { dateStr, nowMinutes } = getNowIst();
  const allBookings = await db.getBookings();
  const eligible = allBookings.filter(b => {
    if (b.status !== 'confirmed') return false;
    if (b.reminderSentAt) return false;
    if (b.date !== dateStr) return false;
    return true;
  });

  const sentReminders = [];

  for (const b of eligible) {
    const slotMinutes = parseSlotMinutes(b.time);
    if (slotMinutes === null) continue;

    const diffMinutes = slotMinutes - nowMinutes;
    // Check if slot is within 30 to 150 minutes from now (approx. 2 hours)
    if (diffMinutes >= 30 && diffMinutes <= 150) {
      let salon = null;
      if (b.salonId) {
        try { salon = await db.getSalonById(b.salonId); } catch (e) {}
      }
      const reminderMsg = buildReminderWhatsApp(b, salon, `${Math.round(diffMinutes / 60) || 1} hour(s)`);
      const res = await sendWhatsAppNotification(reminderMsg, b.phone);
      if (res.success) {
        await db.updateBooking(b.id, {
          reminderSentAt: new Date().toISOString(),
          reminderStatus: 'automated_2hr_sent'
        });
        sentReminders.push({
          bookingId: b.id,
          name: b.name,
          phone: b.phone,
          time: b.time,
          diffMinutes,
          sentAt: new Date().toISOString()
        });
        console.log(`[WhatsApp Reminder Engine] Dispatched 2-hr reminder for #${b.id} to +${b.phone}`);
      }
    }
  }

  return {
    checkedDate: dateStr,
    checkedTotal: eligible.length,
    sentCount: sentReminders.length,
    reminders: sentReminders
  };
}

// Periodic background reminder runner (runs every 10 minutes)
setInterval(() => {
  checkAndSendUpcomingReminders().catch(e => console.warn('[WhatsApp Cron Error]', e.message));
}, 10 * 60 * 1000);

// ── COMPREHENSIVE NOTIFICATION ENGINES ───────────────────────────────────────

// 1. SLOT BOOKED CONFIRMATION NOTIFICATION
async function sendBookingConfirmationNotifications(booking, publicBase = 'https://salonbooking-rho.vercel.app') {
  if (!booking) return;

  const cleanPhone = (booking.phone || '').replace(/\D/g, '').slice(-10);
  const balanceDue = Math.max(0, (Number(booking.price) || 0) - (Number(booking.advancePaid) || 0));

  let salon = null;
  if (booking.salonId) {
    try { salon = await db.getSalonById(booking.salonId); } catch (e) {}
  }
  const salonName = salon?.name || booking.salonName || 'Urban Hairplaza';
  const salonAddr = salon?.address || 'Near Phanishwar Nath Renu Statue, Simraha, Araria';

  // A. SMS Confirmation via Textbee
  const smsText = `✂️ ${salonName}: Your slot is CONFIRMED! #${booking.id}. Service: ${booking.service}, Stylist: ${booking.barber || 'Assigned Stylist'}, Date: ${booking.date} at ${booking.time}. Advance Paid: ₹${booking.advancePaid || 50}. Balance Due: ₹${balanceDue}. Location: ${salonAddr}. Manage: ${publicBase}/account.html. See you soon!`;
  sendRealSms(cleanPhone, smsText).catch(e => console.warn('[SMS-Conf-Error]', e.message));

  // B. WhatsApp Confirmation to Customer
  if (cleanPhone) {
    const customerMsg = buildCustomerBookingWhatsApp(booking, salon, publicBase);
    sendWhatsAppNotification(customerMsg, cleanPhone)
      .then(() => db.updateBooking(booking.id, { whatsappConfirmedAt: new Date().toISOString() }))
      .catch(e => console.warn('[WhatsApp-Customer-Error]', e.message));
  }

  // C. WhatsApp Alert to Salon Owner
  const rawOwnerPhone = salon?.ownerPhone || salon?.phone || process.env.BUSINESS_WHATSAPP || '916202692426';
  const ownerMsg = buildOwnerBookingAlertWhatsApp(booking, salon, publicBase);
  sendWhatsAppNotification(ownerMsg, rawOwnerPhone)
    .then(() => db.updateBooking(booking.id, { whatsappOwnerNotifiedAt: new Date().toISOString() }))
    .catch(e => console.warn('[WhatsApp-Owner-Error]', e.message));

  // D. Email Confirmation (if customer provided email)
  if (booking.email && booking.email.includes('@')) {
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #0f1013; color: #f5f5f7; border-radius: 16px; border: 1px solid rgba(212,175,55,0.3); overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1c1d22 0%, #121316 100%); padding: 28px 24px; text-align: center; border-bottom: 1px solid rgba(212,175,55,0.2);">
          <h1 style="color: #d4af37; margin: 0; font-size: 24px; font-weight: 700;">✂️ ${salonName.toUpperCase()}</h1>
          <p style="color: #8e8e93; margin: 6px 0 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Appointment Confirmed</p>
        </div>
        <div style="padding: 26px 24px;">
          <h2 style="font-size: 18px; color: #ffffff; margin: 0 0 8px 0;">Hello ${booking.name}, your chair is ready!</h2>
          <p style="font-size: 14px; color: #9ca3af; margin: 0 0 20px 0;">Your appointment is confirmed. Here is your appointment summary:</p>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 22px;">
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);"><td style="padding: 8px 0; color: #9ca3af;">Booking ID</td><td style="padding: 8px 0; font-weight: 700; color: #e6c65b; text-align: right;">#${booking.id}</td></tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);"><td style="padding: 8px 0; color: #9ca3af;">Salon</td><td style="padding: 8px 0; font-weight: 600; color: #fff; text-align: right;">${salonName}</td></tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);"><td style="padding: 8px 0; color: #9ca3af;">Service</td><td style="padding: 8px 0; font-weight: 600; color: #fff; text-align: right;">${booking.service}</td></tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);"><td style="padding: 8px 0; color: #9ca3af;">Barber</td><td style="padding: 8px 0; font-weight: 600; color: #fff; text-align: right;">${booking.barber || 'Assigned Stylist'}</td></tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);"><td style="padding: 8px 0; color: #9ca3af;">Date & Time</td><td style="padding: 8px 0; font-weight: 600; color: #fff; text-align: right;">${booking.date} at ${booking.time}</td></tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);"><td style="padding: 8px 0; color: #9ca3af;">Advance Paid</td><td style="padding: 8px 0; font-weight: 700; color: #34d399; text-align: right;">₹${booking.advancePaid || 50} (Paid)</td></tr>
            <tr><td style="padding: 8px 0; color: #9ca3af;">Balance Due at Salon</td><td style="padding: 8px 0; font-weight: 700; color: #fff; text-align: right;">₹${balanceDue}</td></tr>
          </table>

          <div style="text-align: center; margin-top: 24px;">
            <a href="${publicBase}/account.html" style="background: linear-gradient(135deg, #d4af37 0%, #aa820a 100%); color: #000; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">View Appointment & Receipt →</a>
          </div>
        </div>
        <div style="background: #0a0a0c; padding: 16px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: #636366;">
          📍 ${salonAddr} · 📞 ${salon?.phone || '+91 6202 692 426'}
        </div>
      </div>
    `;
    sendRealEmail(booking.email, `✂️ Appointment Confirmed #${booking.id} – ${salonName}`, emailHtml).catch(e => console.warn('[Email-Conf-Error]', e.message));
  }
}

// 2. PAYMENT FAILED / INCOMPLETE NOTIFICATION (WITH PAYMENT LINK)
async function sendPaymentFailedNotifications(booking, reason = '', publicBase = 'https://salonbooking-rho.vercel.app') {
  if (!booking) return;

  const cleanPhone = (booking.phone || '').replace(/\D/g, '').slice(-10);
  const payLink = `${publicBase}/pay?order_id=${booking.id}`;

  // A. SMS with direct payment link via Textbee
  const smsText = `✂️ Urban Hairplaza: Payment for appointment #${booking.id} (${booking.service}) was not completed. Complete your ₹50 advance payment now to lock your chair: ${payLink} (Held for 15 mins). Need help? Call +916202692426.`;
  sendRealSms(cleanPhone, smsText).catch(e => console.warn('[SMS-Fail-Error]', e.message));

  // B. WhatsApp message with payment link
  const waMsg = `⚠️ *Urban Hairplaza – Payment Incomplete*\n` +
    `--------------------------------\n` +
    `Hello *${booking.name}*, we noticed your advance payment of ₹50 for appointment *#${booking.id}* (${booking.service}) did not go through or was interrupted.\n\n` +
    `👉 *Click here to complete payment and lock your chair:*\n` +
    `${payLink}\n\n` +
    `📅 *Reserved Slot:* ${booking.date} at ${booking.time}\n` +
    `✂️ *Stylist:* ${booking.barber || 'Assigned Stylist'}\n` +
    `📍 *Location:* Simraha, Araria\n\n` +
    `Your chair is temporarily held for 15 minutes. Complete payment to guarantee your slot.\n` +
    `Questions? Call +91 6202 692 426.`;

  if (cleanPhone) {
    sendWhatsAppNotification(waMsg, `91${cleanPhone}`).catch(() => {});
  }

  // C. Email with payment link (if customer provided email)
  if (booking.email && booking.email.includes('@')) {
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #0f1013; color: #f5f5f7; border-radius: 16px; border: 1px solid rgba(239,68,68,0.3); overflow: hidden;">
        <div style="background: linear-gradient(135deg, #221212 0%, #150a0a 100%); padding: 28px 24px; text-align: center; border-bottom: 1px solid rgba(239,68,68,0.2);">
          <h1 style="color: #f87171; margin: 0; font-size: 22px; font-weight: 700;">⚠️ Payment Incomplete</h1>
          <p style="color: #d1d5db; margin: 6px 0 0 0; font-size: 13px;">Urban Hairplaza · Appointment #${booking.id}</p>
        </div>
        <div style="padding: 26px 24px;">
          <p style="font-size: 15px; color: #e5e7eb; margin: 0 0 16px 0;">Hello ${booking.name}, your advance payment of ₹50 for <strong>${booking.service}</strong> on <strong>${booking.date} at ${booking.time}</strong> could not be completed.</p>
          <p style="font-size: 14px; color: #9ca3af; margin: 0 0 24px 0;">Your chair is temporarily held for the next 15 minutes. Please complete payment using the link below to confirm your appointment:</p>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${payLink}" style="background: linear-gradient(135deg, #d4af37 0%, #aa820a 100%); color: #000; font-weight: 700; padding: 14px 28px; border-radius: 10px; font-size: 15px; text-decoration: none; display: inline-block;">💳 Complete ₹50 Payment Now →</a>
          </div>

          <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">Or copy this link in your browser: <br><span style="color:#e6c65b; word-break:break-all;">${payLink}</span></p>
        </div>
        <div style="background: #0a0a0c; padding: 16px 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: #636366;">
          Need assistance? Call +91 6202 692 426
        </div>
      </div>
    `;
    sendRealEmail(booking.email, `⚠️ Complete Payment for Appointment #${booking.id} – Urban Hairplaza`, emailHtml).catch(e => console.warn('[Email-Fail-Error]', e.message));
  }
}

// ── PUBLIC API ROUTES ────────────────────────────────────────────────────────

// GET /api/services — List active services (per salon or platform catalog)
app.get('/api/services', async (req, res) => {
  try {
    const salonId = (req.query.salonId || req.query.salon || '').trim();
    const services = salonId ? await db.getServicesBySalon(salonId) : await db.getServices();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// GET /api/barbers — List active barbers / staff (per salon or flagship)
app.get('/api/barbers', async (req, res) => {
  try {
    const salonId = (req.query.salonId || req.query.salon || '').trim();
    if (salonId && salonId !== 'salon-urban-hairplaza') {
      const staff = await db.getStaffBySalon(salonId);
      const mapped = staff.map(s => ({
        id: s.id,
        name: s.name,
        title: s.name,
        role: s.role || 'Stylist',
        exp: s.experience || 'Professional Barber',
        avatar: ''
      }));
      return res.json([
        { id: 'any', name: 'Any Barber', title: 'Any Available Barber', role: 'Fastest Availability', exp: 'First available chair', avatar: '' },
        ...mapped
      ]);
    }

    res.json([
      { id: 'any', name: 'Any Barber', title: 'Any Available Barber', role: 'Fastest Availability', exp: 'First available chair', avatar: '' },
      { id: 'raj', name: 'Raj Kumar', title: 'Raj Kumar', role: 'Master Barber', exp: '12+ yrs · Fades & Scissor', avatar: 'images/barber_raj.png' },
      { id: 'sameer', name: 'Sameer Khan', title: 'Sameer Khan', role: 'Senior Stylist', exp: '8+ yrs · Beard & Shave', avatar: 'images/barber_sameer.png' },
      { id: 'amit', name: 'Amit Sharma', title: 'Amit Sharma', role: 'Grooming Expert', exp: '6+ yrs · Massage & Cleanups', avatar: 'images/barber_amit.png' }
    ]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load barbers' });
  }
});

// ── MULTI-TENANT SALONS PUBLIC DIRECTORY & DISCOVERY APIS ───────────────────

// GET /api/salons — Public directory of approved salons
app.get('/api/salons', async (req, res) => {
  try {
    const { search, city, area, service, status } = req.query;
    let isAdmin = Boolean(req.session && req.session.isAdmin);
    if (!isAdmin) {
      const token = extractToken(req);
      if (token) {
        const payload = verifyAuthToken(token);
        if (payload && payload.role === 'admin') isAdmin = true;
      }
    }
    const salons = await db.getSalons({
      search,
      city,
      area,
      service,
      status: (isAdmin && status) ? status : 'approved'
    });
    res.json(salons);
  } catch (err) {
    console.error('[API-SALONS] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve salons directory' });
  }
});

// GET /api/salons/cities — Unique list of cities where approved salons exist
app.get('/api/salons/cities', async (req, res) => {
  try {
    const salons = await db.getSalons({ status: 'approved' });
    const citiesSet = new Set(['All']);
    salons.forEach(s => {
      if (s.city) citiesSet.add(s.city.trim());
    });
    res.json(Array.from(citiesSet));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load cities list' });
  }
});

// GET /api/salons/:id — Salon profile details, its services and barbers
app.get('/api/salons/:id', async (req, res) => {
  try {
    const salon = await db.getSalonById(req.params.id);
    if (!salon) {
      return res.status(404).json({ error: 'Salon profile not found' });
    }
    const [services, staff] = await Promise.all([
      db.getServicesBySalon(salon.id),
      db.getStaffBySalon(salon.id)
    ]);
    res.json({
      success: true,
      salon,
      services,
      staff
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load salon profile' });
  }
});

// ── SALON OWNER REGISTRATION & AUTHENTICATION ───────────────────────────────

// POST /api/salons/register — Salon owners register their salon
app.post('/api/salons/register', rateLimit({ windowMs: 60000, max: 8, message: 'Too many registration attempts. Please wait.' }), async (req, res) => {
  try {
    const {
      ownerName,
      phone,
      email,
      password,
      salonName,
      address,
      city,
      area,
      hours,
      description,
      servicesSummary,
      startingPrice,
      image
    } = req.body;

    if (!ownerName || !phone || !salonName || !address) {
      return res.status(400).json({ error: 'Owner name, mobile phone, salon name, and address are required.' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    // Check if phone is already registered as owner
    const existingOwner = await db.getOwnerByPhone(cleanPhone);
    if (existingOwner) {
      return res.status(400).json({ error: 'A salon owner with this mobile number is already registered. Please sign in.' });
    }

    const salonId = `salon-${Date.now().toString(36)}-${Math.floor(100 + Math.random() * 900)}`;
    const ownerId = `own-${Date.now().toString(36)}-${Math.floor(100 + Math.random() * 900)}`;
    const cleanSlug = salonName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + cleanPhone.slice(-4);

    const newSalon = {
      id: salonId,
      name: salonName.trim(),
      slug: cleanSlug,
      ownerId: ownerId,
      phone: `+91${cleanPhone}`,
      email: (email || '').trim().toLowerCase(),
      address: address.trim(),
      city: (city || 'Simraha').trim(),
      area: (area || 'Araria').trim(),
      hours: (hours || 'Daily: 9:00 AM – 8:30 PM').trim(),
      rating: 5.0,
      reviewsCount: 1,
      startingPrice: Number(startingPrice) || 100,
      image: image || 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=800&q=80',
      description: (description || `Welcome to ${salonName.trim()}. Dedicated to top-quality grooming and style.`).trim(),
      servicesSummary: (servicesSummary || 'Haircuts · Fade Styling · Beard Sculpting · Hot Towel Shave · Face Cleanup').trim(),
      status: 'pending', // Pending admin verification
      featured: false,
      createdAt: new Date().toISOString()
    };

    const newOwner = {
      id: ownerId,
      name: ownerName.trim(),
      phone: cleanPhone,
      email: (email || '').trim().toLowerCase(),
      passwordHash: password || 'owner123',
      salonId: salonId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    await db.saveSalon(newSalon);
    await db.saveOwner(newOwner);

    // Initial lead barber / staff
    await db.saveStaff({
      id: `STF-${Date.now().toString(36)}`,
      salonId: salonId,
      name: ownerName.trim(),
      role: 'Master Stylist / Lead Barber',
      experience: '5+ Years',
      available: true
    });

    // Alert salon owner via SMS
    sendRealSms(
      cleanPhone,
      `✂️ Urban Hairplaza Network: Registration for ${newSalon.name} received! Our team will verify and approve your salon listing shortly. Once approved, you can log in at /owner/login to manage your bookings.`
    ).catch(() => {});

    // Alert platform master admin
    sendWhatsAppNotification(`📢 *New Salon Registration Pending Approval!*\nSalon: ${newSalon.name} (${newSalon.city})\nOwner: ${newOwner.name} (+91${cleanPhone})\nPlease review and verify in Admin Dashboard.`).catch(() => {});

    res.json({
      success: true,
      salonId: salonId,
      ownerId: ownerId,
      message: 'Your salon has been registered successfully! It is currently pending admin verification and will go live once approved.'
    });
  } catch (err) {
    console.error('[SALON-REGISTER] Error:', err);
    res.status(500).json({ error: 'Failed to submit salon registration. Please try again.' });
  }
});

// POST /api/owner/login — Salon owner private login
app.post('/api/owner/login', rateLimit({ windowMs: 60000, max: 10, message: 'Too many login attempts. Please wait.' }), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Mobile number/email and password are required.' });
    }

    const clean = identifier.trim();
    const cleanPhone = clean.replace(/\D/g, '').slice(-10);
    let owner = null;

    if (cleanPhone.length === 10) {
      owner = await db.getOwnerByPhone(cleanPhone);
    }
    if (!owner && clean.includes('@')) {
      owner = await db.getOwnerByEmail(clean);
    }

    if (!owner) {
      return res.status(401).json({ error: 'No salon owner account found with these credentials.' });
    }

    if (owner.passwordHash && owner.passwordHash !== password.trim()) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    const salon = await db.getSalonById(owner.salonId);

    req.session.owner = {
      id: owner.id,
      name: owner.name,
      phone: owner.phone,
      email: owner.email,
      salonId: owner.salonId
    };

    const token = createAuthToken({
      role: 'owner',
      ownerId: owner.id,
      name: owner.name,
      phone: owner.phone,
      email: owner.email,
      salonId: owner.salonId,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000
    });

    res.cookie('uhp_owner_token', token, {
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      owner: req.session.owner,
      salon,
      token
    });
  } catch (err) {
    console.error('[OWNER-LOGIN] Error:', err);
    res.status(500).json({ error: 'Owner login failed. Please try again.' });
  }
});

// GET /api/owner/me — Check owner authentication status
app.get('/api/owner/me', async (req, res) => {
  let owner = req.session && req.session.owner;
  if (!owner) {
    const token = extractToken(req);
    if (token) {
      const payload = verifyAuthToken(token);
      if (payload && payload.role === 'owner' && payload.salonId) {
        owner = {
          id: payload.ownerId,
          name: payload.name,
          phone: payload.phone,
          email: payload.email,
          salonId: payload.salonId
        };
        if (req.session) req.session.owner = owner;
      }
    }
  }
  if (owner && owner.salonId) {
    const salon = await db.getSalonById(owner.salonId);
    return res.json({ loggedIn: true, owner, salon });
  }
  res.json({ loggedIn: false, owner: null });
});

// POST /api/owner/logout — Salon owner log out
app.post('/api/owner/logout', (req, res) => {
  res.clearCookie('uhp_owner_token');
  if (req.session) {
    delete req.session.owner;
  }
  res.json({ success: true });
});

// ── SALON OWNER PRIVATE DASHBOARD APIS (SCOPED STRICTLY PER SALON) ───────────

function requireOwner(req, res, next) {
  if (req.session && req.session.owner && ((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId))) {
    req.owner = req.session.owner;
    return next();
  }
  const token = extractToken(req);
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload && payload.role === 'owner' && payload.salonId) {
      const ownerInfo = {
        id: payload.ownerId,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        salonId: payload.salonId
      };
      if (req.session) {
        req.session.owner = ownerInfo;
      }
      req.owner = ownerInfo;
      return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized. Salon owner login required.' });
}

// GET /api/owner/salon — Owner's salon profile
app.get('/api/owner/salon', requireOwner, async (req, res) => {
  try {
    const salon = await db.getSalonById(((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId)));
    if (!salon) return res.status(404).json({ error: 'Salon profile not found.' });
    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load salon profile.' });
  }
});

// PUT /api/owner/salon — Update owner's salon profile
app.put('/api/owner/salon', requireOwner, async (req, res) => {
  try {
    const allowed = [
      'name', 'phone', 'email', 'address', 'city', 'area',
      'hours', 'startingPrice', 'image', 'description', 'servicesSummary'
    ];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        updates[f] = req.body[f];
      }
    }
    const updated = await db.updateSalon(((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId)), updates);
    res.json({ success: true, salon: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update salon profile.' });
  }
});

// GET /api/owner/stats — Stats strictly for this salon
app.get('/api/owner/stats', requireOwner, async (req, res) => {
  try {
    const salonId = ((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId));
    const bookings = await db.getBookingsBySalon(salonId);
    const todayStr = new Date().toISOString().split('T')[0];

    const todayBookings = bookings.filter(b => b.date === todayStr && b.status !== 'cancelled');
    const confirmed = bookings.filter(b => b.status === 'confirmed');
    const completed = bookings.filter(b => b.status === 'completed');
    const totalRevenue = bookings.reduce((sum, b) => {
      if (b.status === 'cancelled') return sum;
      return sum + (Number(b.price) || 0);
    }, 0);

    res.json({
      success: true,
      stats: {
        totalBookings: bookings.length,
        todayBookings: todayBookings.length,
        confirmedBookings: confirmed.length,
        completedBookings: completed.length,
        totalRevenue: totalRevenue
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// GET /api/owner/bookings — Bookings strictly for this salon (cannot view other salons)
app.get('/api/owner/bookings', requireOwner, async (req, res) => {
  try {
    const salonId = ((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId));
    const bookings = await db.getBookingsBySalon(salonId);
    res.json({ success: true, count: bookings.length, bookings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bookings.' });
  }
});

// PATCH /api/owner/bookings/:id — Update appointment status for this salon
app.patch('/api/owner/bookings/:id', requireOwner, async (req, res) => {
  try {
    const salonId = ((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId));
    const booking = await db.getBookingById(req.params.id);
    if (!booking || (booking.salonId && booking.salonId !== salonId)) {
      return res.status(403).json({ error: 'Access denied. You cannot modify bookings of another salon.' });
    }

    const { status, notes } = req.body;
    const updates = {};
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    const updated = await db.updateBooking(booking.id, updates);
    res.json({ success: true, booking: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking.' });
  }
});

// GET /api/owner/services — Services for this salon
app.get('/api/owner/services', requireOwner, async (req, res) => {
  try {
    const services = await db.getServicesBySalon(((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId)));
    res.json({ success: true, services });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load services.' });
  }
});

// POST /api/owner/services — Add service for this salon
app.post('/api/owner/services', requireOwner, async (req, res) => {
  try {
    const { name, category, price, duration, desc, type, icon } = req.body;
    if (!name || !price) {
      return res.status(400).json({ error: 'Service name and price are required.' });
    }
    const newService = {
      id: `SRV-${Date.now().toString(36)}`,
      salonId: ((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId)),
      name: name.trim(),
      category: category || 'Haircut',
      type: type || 'inshop',
      icon: icon || '✂️',
      desc: desc || '',
      price: Number(price) || 100,
      duration: Number(duration) || 30
    };
    await db.saveService(newService);
    res.json({ success: true, service: newService });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add service.' });
  }
});

// DELETE /api/owner/services/:id
app.delete('/api/owner/services/:id', requireOwner, async (req, res) => {
  try {
    await db.deleteService(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove service.' });
  }
});

// GET /api/owner/staff — Staff for this salon
app.get('/api/owner/staff', requireOwner, async (req, res) => {
  try {
    const staff = await db.getStaffBySalon(((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId)));
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load staff.' });
  }
});

// POST /api/owner/staff — Add staff for this salon
app.post('/api/owner/staff', requireOwner, async (req, res) => {
  try {
    const { name, role, experience } = req.body;
    if (!name) return res.status(400).json({ error: 'Staff name is required.' });
    const newStaff = {
      id: `STF-${Date.now().toString(36)}`,
      salonId: ((req.owner && req.owner.salonId) || (req.session && req.session.owner && req.session.owner.salonId)),
      name: name.trim(),
      role: role || 'Barber & Stylist',
      experience: experience || '3+ Years',
      available: true
    };
    await db.saveStaff(newStaff);
    res.json({ success: true, staff: newStaff });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add staff.' });
  }
});

// DELETE /api/owner/staff/:id
app.delete('/api/owner/staff/:id', requireOwner, async (req, res) => {
  try {
    await db.deleteStaff(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove staff.' });
  }
});

// ── USER AUTHENTICATION & PORTAL APIS (MOBILE / EMAIL OTP) ───────────────────

// POST /api/auth/send-otp — Send 6-digit OTP to mobile or email
app.post('/api/auth/send-otp', rateLimit({ windowMs: 60000, max: 10, message: 'Too many OTP attempts. Please wait a minute.' }), async (req, res) => {
  try {
    const { identifier, name } = req.body;
    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ error: 'Please enter your mobile number or email address.' });
    }

    const trimmed = identifier.trim();
    const cleanPhone = trimmed.replace(/\D/g, '').slice(-10);
    const isEmail = trimmed.includes('@') && trimmed.includes('.');
    const isPhone = cleanPhone.length === 10;

    if (!isEmail && !isPhone) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number or email address.' });
    }

    const type = isPhone ? 'phone' : 'email';
    const target = isPhone ? cleanPhone : trimmed.toLowerCase();

    // Cryptographically secure 6-digit OTP
    const otp = String(crypto.randomInt(100000, 999999));

    // Store in DB / JSON
    await db.saveOtp(target, otp, type);

    const deliveryChannels = [];

    if (isPhone) {
      // 1. Send Real SMS if configured (Fast2SMS / Twilio / 2Factor)
      const smsSent = await sendRealSmsOtp(cleanPhone, otp).catch(() => false);
      if (smsSent) deliveryChannels.push('SMS');

      // 2. Also send via WhatsApp
      const msg = `✂️ *Urban Hairplaza Verification*\nYour OTP is: *${otp}*\nValid for 10 minutes. Do not share this code.`;
      const waSent = await sendWhatsAppNotification(msg, `91${cleanPhone}`).then(() => true).catch(() => false);
      if (waSent) deliveryChannels.push('WhatsApp');
    } else {
      // Send Real Email if configured (Resend / Gmail SMTP / Brevo)
      const emailSent = await sendRealEmailOtp(target, otp).catch(() => false);
      if (emailSent) deliveryChannels.push('Email');
    }

    const channelSummary = deliveryChannels.length > 0 ? deliveryChannels.join(' & ') : 'Preview Demo';
    console.log(`[AUTH-OTP] OTP for ${target} (${type}): ${otp} [Delivered via: ${channelSummary}]`);

    res.json({
      success: true,
      message: `Verification code sent to ${isPhone ? `+91 ${cleanPhone}` : target}${deliveryChannels.length > 0 ? ` via ${deliveryChannels.join(' & ')}` : ''}.`,
      type,
      target,
      channels: deliveryChannels
    });
  } catch (err) {
    console.error('[AUTH-OTP] Error:', err);
    res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
  }
});

// POST /api/auth/verify-otp — Verify OTP and set user session
app.post('/api/auth/verify-otp', rateLimit({ windowMs: 60000, max: 20, message: 'Too many verification attempts. Please wait.' }), async (req, res) => {
  try {
    const { identifier, otp, name } = req.body;
    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Mobile / email and OTP code are required.' });
    }

    const trimmed = identifier.trim();
    const cleanPhone = trimmed.replace(/\D/g, '').slice(-10);
    const isEmail = trimmed.includes('@') && trimmed.includes('.');
    const isPhone = cleanPhone.length === 10;
    const target = isPhone ? cleanPhone : trimmed.toLowerCase();

    const isValid = await db.verifyOtp(target, otp);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired verification code. Please request a new code.' });
    }

    // Upsert or load user profile
    const existing = await db.getUserByIdentifier(target);
    const userName = (name && name.trim()) || (existing && existing.name) || 'Valued Client';
    const userPhone = isPhone ? cleanPhone : (existing ? existing.phone : '');
    const userEmail = isEmail ? target : (existing ? existing.email : '');

    const user = await db.upsertUser({
      name: userName,
      phone: userPhone,
      email: userEmail,
      spent: 0
    });

    const fallbackId = userPhone ? `USR-${userPhone}` : `USR-${Date.now()}`;

    // Establish session
    req.session.user = {
      id: (user && user.id) || fallbackId,
      name: (user && user.name) || userName,
      phone: (user && user.phone) || userPhone,
      email: (user && user.email) || userEmail
    };

    res.json({
      success: true,
      user: req.session.user,
      message: 'Logged in successfully.'
    });
  } catch (err) {
    console.error('[AUTH-VERIFY] Error:', err);
    res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
  }
});

// GET /api/user/me — Check current login state
app.get('/api/user/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false, user: null });
});

// GET /api/textbee/status — Diagnostic endpoint to check Textbee configuration
app.get('/api/textbee/status', async (req, res) => {
  const queryKey = typeof req.query.apiKey === 'string' ? req.query.apiKey.trim() : '';
  const rawKey = queryKey || (process.env.TEXTBEE_API_KEY || process.env.TEXTBEE_KEY || process.env.TEXT_BEE_API_KEY || '').trim();
  const textbeeKey = rawKey.replace(/^['"]|['"]$/g, '').trim();
  const rawDevice = (req.query.deviceId || process.env.TEXTBEE_DEVICE_ID || process.env.TEXTBEE_DEVICE || process.env.DEVICE_ID || '').toString().trim();
  const textbeeDevice = rawDevice.replace(/^['"]|['"]$/g, '').trim() || '6ad42a0d5291071e5774b0b1';

  if (!textbeeKey) {
    return res.json({
      configured: false,
      message: 'TEXTBEE_API_KEY is missing in environment variables. Add TEXTBEE_API_KEY in Vercel settings.'
    });
  }

  const results = {
    apiKeyPreview: `${textbeeKey.slice(0, 5)}...${textbeeKey.slice(-4)}`,
    deviceId: textbeeDevice,
    receivedMessagesTest: null,
    sendSmsTest: null
  };

  // Check Textbee authentication via GET /gateway/messages?direction=received
  try {
    const apiRes = await axios.get('https://api.textbee.dev/api/v1/gateway/messages?direction=received', {
      headers: { 'x-api-key': textbeeKey },
      timeout: 10000
    });
    results.receivedMessagesTest = {
      success: true,
      statusCode: apiRes.status,
      data: apiRes.data
    };
  } catch (err) {
    results.receivedMessagesTest = {
      success: false,
      statusCode: err.response?.status || 500,
      error: err.response?.data || err.message
    };
  }

  // Optional: If testRecipient is provided in query params, test sending an SMS
  const testRecipient = req.query.testPhone || req.query.testRecipient;
  if (testRecipient) {
    try {
      const formatted = testRecipient.startsWith('+') ? testRecipient : `+91${testRecipient}`;
      const sendRes = await axios.post(
        'https://api.textbee.dev/api/v1/gateway/send-sms',
        {
          deviceId: textbeeDevice,
          recipients: [formatted],
          message: 'Hello from Urban Hairplaza (Textbee integration test).'
        },
        {
          headers: {
            'x-api-key': textbeeKey,
            'Content-Type': 'application/json'
          },
          timeout: 12000
        }
      );
      results.sendSmsTest = {
        success: true,
        statusCode: sendRes.status,
        data: sendRes.data
      };
    } catch (sendErr) {
      results.sendSmsTest = {
        success: false,
        statusCode: sendErr.response?.status || 500,
        error: sendErr.response?.data || sendErr.message
      };
    }
  }

  const isAuthenticated = Boolean(results.receivedMessagesTest?.success);

  return res.json({
    configured: true,
    authenticated: isAuthenticated,
    details: results,
    message: isAuthenticated
      ? 'Textbee API key is valid and connected!'
      : `Textbee authentication failed: ${JSON.stringify(results.receivedMessagesTest?.error || 'Unknown error')}`
  });
});

// GET /api/user/bookings — Get authenticated user's booking history
app.get('/api/user/bookings', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Please log in to view your bookings.' });
  }

  try {
    const { phone, email } = req.session.user;
    const bookings = await db.getUserBookings(phone, email);
    res.json({
      success: true,
      user: req.session.user,
      count: bookings.length,
      bookings
    });
  } catch (err) {
    console.error('[USER-BOOKINGS] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve booking history.' });
  }
});

// POST /api/user/cancel-booking — Cancel an upcoming appointment
app.post('/api/user/cancel-booking', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const { bookingId } = req.body;
  if (!bookingId) {
    return res.status(400).json({ error: 'Booking ID is required.' });
  }

  try {
    const booking = await db.getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const uPhone = (req.session.user.phone || '').replace(/\D/g, '').slice(-10);
    const uEmail = (req.session.user.email || '').trim().toLowerCase();
    const bPhone = (booking.phone || '').replace(/\D/g, '').slice(-10);
    const bEmail = (booking.email || '').trim().toLowerCase();

    const owns = (uPhone && bPhone && uPhone === bPhone) || (uEmail && bEmail && uEmail === bEmail);
    if (!owns) {
      return res.status(403).json({ error: 'You do not have permission to cancel this appointment.' });
    }

    await db.updateBooking(bookingId, { status: 'cancelled' });
    res.json({ success: true, message: 'Appointment cancelled successfully.' });
  } catch (err) {
    console.error('[USER-CANCEL] Error:', err);
    res.status(500).json({ error: 'Failed to cancel appointment.' });
  }
});

// POST /api/auth/logout — Log out user
app.post('/api/auth/logout', (req, res) => {
  req.session.user = null;
  res.json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/slots — Check availability per barber, salon, and per date
app.get('/api/slots', async (req, res) => {
  const { date, barber, salonId } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Query parameter date (YYYY-MM-DD) is required' });
  }

  try {
    const targetSalonId = (salonId || 'salon-urban-hairplaza').trim();
    const bookings = await db.getBookings();
    // Active bookings on this date for this specific salon (not cancelled and not expired payment_pending)
    const activeBookings = bookings.filter(b => {
      const bSalon = b.salonId || 'salon-urban-hairplaza';
      if (bSalon !== targetSalonId) return false;
      if (b.date !== date) return false;
      if (b.status === 'cancelled') return false;
      if (b.status === 'payment_pending') {
        const ageMinutes = (Date.now() - new Date(b.createdAt).getTime()) / 60000;
        return ageMinutes <= 15;
      }
      return true;
    });

    // Check staff capacity for this salon
    const staff = await db.getStaffBySalon(targetSalonId);
    const maxCapacity = Math.max(staff.length || 3, 1);

    // Check past time if date is today (normalize to IST UTC+5.5)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const todayStr = istNow.toISOString().split('T')[0];
    const currentHours = istNow.getUTCHours();
    const currentMins = istNow.getUTCMinutes();

    const isToday = (date === todayStr);
    const bookedSlots = [];

    OPERATING_SLOTS.forEach(slot => {
      if (isToday) {
        const [timePart, meridiem] = slot.split(' ');
        let [h, m] = timePart.split(':').map(Number);
        if (meridiem === 'PM' && h !== 12) h += 12;
        if (meridiem === 'AM' && h === 12) h = 0;

        if (h < currentHours || (h === currentHours && m <= currentMins)) {
          bookedSlots.push(slot);
          return;
        }
      }

      const bookingsAtSlot = activeBookings.filter(b => b.time === slot);

      if (barber && barber !== 'Any' && barber !== 'Any Barber') {
        const isBarberBusy = bookingsAtSlot.some(b => b.barber === barber);
        if (isBarberBusy) bookedSlots.push(slot);
      } else {
        if (bookingsAtSlot.length >= maxCapacity) bookedSlots.push(slot);
      }
    });

    const availableSlots = OPERATING_SLOTS.filter(s => !bookedSlots.includes(s));

    res.json({
      date,
      barber: barber || 'Any',
      salonId: targetSalonId,
      allSlots: OPERATING_SLOTS,
      bookedSlots,
      availableSlots
    });
  } catch (err) {
    console.error('Slots error:', err);
    res.status(500).json({ error: 'Failed to compute slot availability' });
  }
});

// POST /api/create-payment-order — Initiate Cashfree advance payment order
app.post('/api/create-payment-order', rateLimit({ windowMs: 60000, max: 10, message: 'Too many booking attempts. Please wait a moment.' }), async (req, res) => {
  let createdBookingId = null;
  try {
    const { advanceAmount, bookingDetails } = req.body;
    if (!bookingDetails) {
      return res.status(400).json({ error: 'Missing booking details' });
    }

    const {
      name, phone, email, service, barber, date, time,
      type, address, notes, price, duration, salonId
    } = bookingDetails;

    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, service, date, and time are required.' });
    }

    const targetSalonId = (salonId || 'salon-urban-hairplaza').trim();
    const targetSalon = await db.getSalonById(targetSalonId);
    const targetSalonName = targetSalon ? targetSalon.name : 'Urban Hairplaza Flagship';

    const cleanReqPhone = phone.replace(/\D/g, '').slice(-10);

    // Verify slot is still free for this salon
    const bookings = await db.getBookings();
    const bookingsAtSlot = bookings.filter(b => {
      const bSalon = b.salonId || 'salon-urban-hairplaza';
      if (bSalon !== targetSalonId) return false;
      if (b.date !== date || b.time !== time) return false;
      if (b.status === 'cancelled') return false;
      if (b.status === 'payment_pending') {
        const ageMinutes = (Date.now() - new Date(b.createdAt).getTime()) / 60000;
        if (ageMinutes > 15) return false;

        // If the same client phone number is retrying their uncompleted booking, allow them through
        const bPhone = (b.phone || '').replace(/\D/g, '').slice(-10);
        if (bPhone && cleanReqPhone && bPhone === cleanReqPhone) {
          return false;
        }
      }
      return true;
    });

    const targetStaff = await db.getStaffBySalon(targetSalonId);
    const maxCapacity = Math.max(targetStaff.length || 3, 1);
    const chosenBarber = (barber && barber !== 'Any' && barber !== 'Any Barber') ? barber.trim() : 'Any Barber';

    if (chosenBarber !== 'Any Barber') {
      const barberBusy = bookingsAtSlot.some(b => b.barber === chosenBarber);
      if (barberBusy) {
        return res.status(400).json({ error: `${chosenBarber} is already booked at ${time} on ${date}. Please select another time slot or barber.` });
      }
    } else {
      if (bookingsAtSlot.length >= maxCapacity) {
        return res.status(400).json({ error: `All barbers at ${targetSalonName} are currently booked at ${time}. Please select another time.` });
      }
    }

    // Assign specific barber if "Any" chosen
    let assignedBarber = chosenBarber;
    if (chosenBarber === 'Any Barber') {
      const busyBarbers = bookingsAtSlot.map(b => b.barber);
      const staffNames = targetStaff.map(s => s.name);
      const availableBarbers = staffNames.length > 0 ? staffNames : VALID_BARBERS;
      const freeBarber = availableBarbers.find(b => !busyBarbers.includes(b));
      assignedBarber = freeBarber || availableBarbers[0] || 'Staff Stylist';
    }

    // Server-side service verification against database (prevents client price tampering)
    const allServices = await db.getServicesBySalon(targetSalonId);
    const matchedService = allServices.find(s =>
      s.name.toLowerCase() === service.trim().toLowerCase() || s.id === service.trim()
    );
    const verifiedPrice = matchedService ? Number(matchedService.price) : (Number(price) || 150);
    const verifiedDuration = matchedService ? (parseInt(matchedService.duration) || 30) : (Number(duration) || 30);
    const advance = 50; // Strictly enforce standard ₹50 deposit on server

    const orderId = `UHP-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    createdBookingId = orderId;

    const newBooking = {
      id: orderId,
      salonId: targetSalonId,
      salonName: targetSalonName,
      name: name.trim(),
      phone: phone.trim(),
      email: (email || '').trim(),
      service: matchedService ? matchedService.name : service.trim(),
      barber: assignedBarber,
      date: date.trim(),
      time: time.trim(),
      type: type || 'inshop',
      address: (address || '').trim(),
      notes: (notes || '').trim(),
      price: verifiedPrice,
      duration: verifiedDuration,
      advancePaid: 0,
      advanceRequired: advance,
      status: 'payment_pending',
      createdAt: new Date().toISOString()
    };

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const env = (process.env.CASHFREE_ENVIRONMENT || 'sandbox').toLowerCase();
    const isConfigured = Boolean(appId && secretKey && appId.trim().length > 3);

    const publicBase = getPublicBaseUrl(req);

    if (isConfigured) {
      const cashfreeUrl = env === 'production'
        ? 'https://api.cashfree.com/pg/orders'
        : 'https://sandbox.cashfree.com/pg/orders';

      const customerPhone = cleanReqPhone.length === 10 ? cleanReqPhone : '9876543210';

      const cfPayload = {
        order_id: orderId,
        order_amount: advance,
        order_currency: 'INR',
        customer_details: {
          customer_id: `cust_${customerPhone}`,
          customer_name: name.trim(),
          customer_phone: customerPhone,
          customer_email: (email && email.includes('@')) ? email.trim() : 'client@urbanhairplaza.com'
        },
        order_meta: {
          return_url: `${publicBase}/book.html?order_id={order_id}`,
          notify_url: `${publicBase}/api/cashfree-webhook`
        },
        order_note: `Urban Hairplaza Advance Booking for ${newBooking.service}`
      };

      const cfRes = await axios.post(cashfreeUrl, cfPayload, {
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': appId.trim(),
          'x-client-secret': secretKey.trim(),
          'x-api-version': '2023-08-01'
        },
        timeout: 10000
      });

      // ONLY save pending booking to DB after Cashfree order creation successfully succeeds!
      await db.saveBooking(newBooking);

      return res.json({
        success: true,
        order_id: orderId,
        payment_session_id: cfRes.data.payment_session_id,
        environment: env,
        advanceAmount: advance,
        is_simulation: false
      });
    } else {
      // Simulation mode
      await db.saveBooking(newBooking);

      return res.json({
        success: true,
        order_id: orderId,
        payment_session_id: `sim_session_${orderId}`,
        environment: 'sandbox',
        advanceAmount: advance,
        is_simulation: true,
        message: 'Cashfree test simulation mode active. You can test advance verification directly.'
      });
    }

  } catch (err) {
    const errDetails = err.response?.data || err.message;
    console.error('[Cashfree] Order Creation Error:', errDetails);

    // Ensure any partially saved booking is deleted if gateway order creation failed
    if (createdBookingId) {
      await db.deleteBooking(createdBookingId).catch(() => {});
    }

    const message = err.response?.data?.message || err.message || 'Failed to initiate advance payment order.';
    res.status(500).json({
      error: 'Failed to initiate advance payment order.',
      details: message
    });
  }
});

// POST /api/verify-payment — Verify Cashfree payment completion & log transaction
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { order_id, is_simulation } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: 'Order ID is required.' });
    }

    const booking = await db.getBookingById(order_id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking order not found.' });
    }

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const env = (process.env.CASHFREE_ENVIRONMENT || 'sandbox').toLowerCase();
    const isConfigured = Boolean(appId && secretKey && appId.trim().length > 3);

    let isPaid = false;
    let paidAmount = booking.advanceRequired || 50;
    let gatewayData = null;

    if (isConfigured) {
      // Live / Sandbox Cashfree Gateway is configured: ALWAYS verify against Cashfree API
      const cashfreeUrl = env === 'production'
        ? `https://api.cashfree.com/pg/orders/${order_id}`
        : `https://sandbox.cashfree.com/pg/orders/${order_id}`;

      const cfRes = await axios.get(cashfreeUrl, {
        headers: {
          'x-client-id': appId,
          'x-client-secret': secretKey,
          'x-api-version': '2023-08-01'
        },
        timeout: 10000
      });

      gatewayData = cfRes.data;

      if (cfRes.data && (cfRes.data.order_status === 'PAID' || cfRes.data.order_status === 'SUCCESS')) {
        isPaid = true;
        paidAmount = Number(cfRes.data.order_amount) || paidAmount;
      } else {
        const publicBase = getPublicBaseUrl(req);
        sendPaymentFailedNotifications(booking, cfRes.data?.order_status || 'Payment incomplete', publicBase).catch(() => {});
        return res.status(400).json({
          error: `Payment is not completed. Current status: ${cfRes.data?.order_status || 'UNKNOWN'}`
        });
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // ONLY allow local dev simulation when Cashfree API keys are not provided in environment
      isPaid = true;
      gatewayData = { mode: 'sandbox_simulation_dev_only', verified_at: new Date().toISOString() };
    } else {
      return res.status(500).json({ error: 'Payment gateway configuration is missing on server.' });
    }

    if (isPaid) {
      const updatedBooking = await db.updateBooking(booking.id, {
        status: 'confirmed',
        advancePaid: paidAmount,
        paymentVerifiedAt: new Date().toISOString()
      });

      // Save persistent transaction record
      await db.saveTransaction({
        orderId: booking.id,
        bookingId: booking.id,
        amount: paidAmount,
        currency: 'INR',
        status: 'PAID',
        paymentMethod: isConfigured && !is_simulation ? 'CASHFREE' : 'SANDBOX_SIMULATION',
        customerName: booking.name,
        customerPhone: booking.phone,
        customerEmail: booking.email,
        gatewayResponse: gatewayData
      });

      const publicBase = getPublicBaseUrl(req);

      // Dispatches Confirmation SMS to customer, WhatsApp to customer & salon, and Email!
      sendBookingConfirmationNotifications(updatedBooking || booking, publicBase).catch(() => {});

      const waMsg = buildWhatsAppMessage(updatedBooking || booking);
      const businessNumber = process.env.BUSINESS_WHATSAPP || '916202692426';
      const encodedMsg = encodeURIComponent(waMsg);
      const whatsappClientLink = `https://wa.me/${businessNumber}?text=${encodedMsg}`;

      return res.json({
        success: true,
        order_id: booking.id,
        booking: updatedBooking || booking,
        whatsapp_link: whatsappClientLink
      });
    }

  } catch (err) {
    console.error('Verify payment error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment verification failed. Please contact us.' });
  }
});

// POST /api/payment-failed — Triggered when checkout fails, closes, or is cancelled
app.post('/api/payment-failed', async (req, res) => {
  try {
    const { order_id, reason } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: 'Order ID is required.' });
    }

    const booking = await db.getBookingById(order_id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.status === 'confirmed' || booking.status === 'completed') {
      return res.json({ success: true, message: 'Booking is already confirmed.' });
    }

    const publicBase = getPublicBaseUrl(req);
    const payLink = `${publicBase}/pay?order_id=${booking.id}`;

    // Dispatches SMS with payment link via Textbee, WhatsApp, and Email
    sendPaymentFailedNotifications(booking, reason || 'Payment Incomplete', publicBase).catch(() => {});

    res.json({
      success: true,
      order_id: booking.id,
      payment_link: payLink,
      message: `Payment retry link sent to +91 ${booking.phone.slice(-10)} via SMS.`
    });
  } catch (err) {
    console.error('[PAYMENT-FAILED] Error:', err);
    res.status(500).json({ error: 'Failed to process payment failure notice.' });
  }
});

// GET /api/booking-details/:id — Safe booking details for payment retry page
app.get('/api/booking-details/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const booking = await db.getBookingById(id);
    if (!booking) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    res.json({
      success: true,
      booking: {
        id: booking.id,
        name: booking.name,
        phone: booking.phone,
        email: booking.email,
        service: booking.service,
        barber: booking.barber,
        date: booking.date,
        time: booking.time,
        type: booking.type,
        address: booking.address,
        price: booking.price,
        duration: booking.duration,
        advancePaid: booking.advancePaid || 0,
        status: booking.status,
        createdAt: booking.createdAt
      }
    });
  } catch (err) {
    console.error('[BOOKING-DETAILS] Error:', err);
    res.status(500).json({ error: 'Failed to load booking details.' });
  }
});

// POST /api/retry-payment — Generate a fresh Cashfree payment session for retry
app.post('/api/retry-payment', rateLimit({ windowMs: 60000, max: 15, message: 'Too many requests. Please wait a moment.' }), async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: 'Order ID is required.' });
    }

    const booking = await db.getBookingById(order_id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.status === 'confirmed' || booking.status === 'completed') {
      return res.status(400).json({ error: 'This booking is already paid and confirmed.' });
    }

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const env = (process.env.CASHFREE_ENVIRONMENT || 'sandbox').toLowerCase();
    const isConfigured = Boolean(appId && secretKey && appId.trim().length > 3);
    const advance = 50;
    const publicBase = getPublicBaseUrl(req);

    if (isConfigured) {
      const cashfreeUrl = env === 'production'
        ? 'https://api.cashfree.com/pg/orders'
        : 'https://sandbox.cashfree.com/pg/orders';

      const cleanReqPhone = (booking.phone || '').replace(/\D/g, '').slice(-10);
      const customerPhone = cleanReqPhone.length === 10 ? cleanReqPhone : '9876543210';

      // Check if existing order on Cashfree has an active session
      let sessionData = null;
      try {
        const existingOrderRes = await axios.get(`${cashfreeUrl}/${order_id}`, {
          headers: {
            'x-client-id': appId.trim(),
            'x-client-secret': secretKey.trim(),
            'x-api-version': '2023-08-01'
          },
          timeout: 8000
        });

        if (existingOrderRes.data?.payment_session_id && existingOrderRes.data?.order_status === 'ACTIVE') {
          sessionData = existingOrderRes.data;
        }
      } catch (e) {}

      // If not active, create fresh session
      if (!sessionData) {
        const cfPayload = {
          order_id: order_id,
          order_amount: advance,
          order_currency: 'INR',
          customer_details: {
            customer_id: `cust_${customerPhone}`,
            customer_name: booking.name,
            customer_phone: customerPhone,
            customer_email: (booking.email && booking.email.includes('@')) ? booking.email.trim() : 'client@urbanhairplaza.com'
          },
          order_meta: {
            return_url: `${publicBase}/pay?order_id=${order_id}`,
            notify_url: `${publicBase}/api/cashfree-webhook`
          },
          order_note: `Urban Hairplaza Advance Booking for ${booking.service}`
        };

        const cfRes = await axios.post(cashfreeUrl, cfPayload, {
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': appId.trim(),
            'x-client-secret': secretKey.trim(),
            'x-api-version': '2023-08-01'
          },
          timeout: 10000
        });
        sessionData = cfRes.data;
      }

      return res.json({
        success: true,
        order_id: order_id,
        payment_session_id: sessionData.payment_session_id,
        environment: env,
        advanceAmount: advance,
        is_simulation: false
      });
    } else {
      return res.json({
        success: true,
        order_id: order_id,
        payment_session_id: `sim_session_${order_id}`,
        environment: 'sandbox',
        advanceAmount: advance,
        is_simulation: true
      });
    }

  } catch (err) {
    console.error('[RETRY-PAYMENT] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment session for retry.', details: err.response?.data?.message || err.message });
  }
});

// POST /api/cashfree-webhook — Handle asynchronous Cashfree payment notifications
app.post('/api/cashfree-webhook', async (req, res) => {
  try {
    const data = req.body?.data || req.body;
    const order = data?.order || data;
    const orderId = order?.order_id || req.body?.order_id;
    const orderStatus = order?.order_status || data?.payment?.payment_status;

    if (!orderId) {
      return res.status(200).send('Ignored: No order_id in webhook');
    }

    const booking = await db.getBookingById(orderId);
    if (!booking) {
      return res.status(200).send('Ignored: Booking not found');
    }

    const publicBase = getPublicBaseUrl(req);

    if (orderStatus === 'PAID' || orderStatus === 'SUCCESS') {
      if (booking.status !== 'confirmed') {
        const updated = await db.updateBooking(booking.id, {
          status: 'confirmed',
          advancePaid: 50,
          paymentVerifiedAt: new Date().toISOString()
        });
        sendBookingConfirmationNotifications(updated || booking, publicBase).catch(() => {});
      }
    } else if (orderStatus === 'FAILED' || orderStatus === 'USER_DROPPED' || orderStatus === 'CANCELLED') {
      sendPaymentFailedNotifications(booking, orderStatus, publicBase).catch(() => {});
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[CASHFREE-WEBHOOK] Error:', err);
    res.status(200).json({ error: err.message });
  }
});

// POST /api/bookings — Direct reservation (for walk-in, admin, or pay at shop)
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10, message: 'Too many booking requests. Please wait a moment.' }), async (req, res) => {
  try {
    const { name, phone, email, service, barber, date, time, type, address, notes, price, duration, advancePaid } = req.body;
    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, service, date, and time are required.' });
    }

    const isAdmin = Boolean(req.session && req.session.isAdmin);
    const targetSalonId = (req.body.salonId || req.body.salon || 'salon-urban-hairplaza').trim();
    const targetSalon = await db.getSalonById(targetSalonId);
    const targetSalonName = targetSalon ? targetSalon.name : 'Urban Hairplaza Flagship';

    // Verify service price against DB (prevents tampering)
    const allServices = await db.getServicesBySalon(targetSalonId);
    const matched = allServices.find(s => s.name.toLowerCase() === service.trim().toLowerCase() || s.id === service.trim());
    const verifiedPrice = matched ? Number(matched.price) : (Number(price) || 150);
    const verifiedDuration = matched ? (parseInt(matched.duration) || 30) : (Number(duration) || 30);

    // Security check: Only authenticated admins can mark an appointment confirmed or log paid advance directly
    const finalAdvance = isAdmin ? (Number(advancePaid) || 0) : 0;
    const finalStatus = isAdmin ? (req.body.status || 'confirmed') : 'pending_confirmation';

    const booking = {
      id: `DIR-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
      salonId: targetSalonId,
      salonName: targetSalonName,
      name: name.trim(),
      phone: phone.trim(),
      email: (email || '').trim(),
      service: matched ? matched.name : service.trim(),
      barber: barber || 'Any Barber',
      date: date.trim(),
      time: time.trim(),
      type: type || 'inshop',
      address: (address || '').trim(),
      notes: (notes || '').trim(),
      price: verifiedPrice,
      duration: verifiedDuration,
      advancePaid: finalAdvance,
      status: finalStatus,
      createdAt: new Date().toISOString()
    };

    await db.saveBooking(booking);

    if (booking.advancePaid > 0) {
      await db.saveTransaction({
        orderId: booking.id,
        bookingId: booking.id,
        amount: booking.advancePaid,
        currency: 'INR',
        status: 'PAID',
        paymentMethod: 'CASH / DIRECT',
        customerName: booking.name,
        customerPhone: booking.phone,
        customerEmail: booking.email
      });
    }

    const publicBase = getPublicBaseUrl(req);
    sendBookingConfirmationNotifications(booking, publicBase).catch(() => {});

    const waMsg = buildWhatsAppMessage(booking);
    sendWhatsAppNotification(waMsg).catch(() => {});

    const businessNumber = process.env.BUSINESS_WHATSAPP || '916202692426';
    const whatsappClientLink = `https://wa.me/${businessNumber}?text=${encodeURIComponent(waMsg)}`;

    res.json({
      success: true,
      id: booking.id,
      booking,
      whatsapp_link: whatsappClientLink
    });
  } catch (err) {
    console.error('Direct booking error:', err);
    res.status(500).json({ error: 'Failed to record booking.' });
  }
});

// POST /api/enquiries — Submit contact message (with anti-spam rate limiting)
app.post('/api/enquiries', rateLimit({ windowMs: 60000, max: 5, message: 'Please wait before sending another enquiry.' }), async (req, res) => {
  try {
    const { name, phone, email, subject, message } = req.body;
    if (!name || !phone || !message) {
      return res.status(400).json({ error: 'Name, phone, and message are required.' });
    }

    const enquiry = {
      id: `ENQ-${Date.now().toString(36).toUpperCase()}`,
      name: name.trim(),
      phone: phone.trim(),
      email: (email || '').trim(),
      subject: (subject || 'General Inquiry').trim(),
      message: message.trim(),
      status: 'unread',
      createdAt: new Date().toISOString()
    };

    await db.saveEnquiry(enquiry);

    sendWhatsAppNotification(
      `📩 *New Enquiry – Urban Hairplaza*\nFrom: ${enquiry.name} (${enquiry.phone})\nSubject: ${enquiry.subject}\nMessage: ${enquiry.message}`
    ).catch(() => {});

    res.json({ success: true, id: enquiry.id });
  } catch (err) {
    console.error('Enquiry error:', err);
    res.status(500).json({ error: 'Failed to submit enquiry.' });
  }
});

// ── ADMIN AUTHENTICATION MIDDLEWARE ─────────────────────────────────────────
function requireAdmin(req, res, next) {
  // 1. Session check
  if (req.session && req.session.isAdmin) {
    return next();
  }
  // 2. Stateless HMAC token check (critical for Vercel serverless lambdas)
  const token = extractToken(req);
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload && payload.role === 'admin') {
      if (req.session) {
        req.session.isAdmin = true;
        req.session.user = payload.user || 'Admin';
      }
      req.adminUser = payload.user || 'Admin';
      return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized. Admin login required.' });
}

// ── ADMIN AUTH ROUTES ────────────────────────────────────────────────────────
// Protected with brute-force rate limiter (max 15 attempts per 15 min per IP) and timing-safe comparison
app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: 'Too many login attempts. Please wait 15 minutes.' }), (req, res) => {
  const { username, password } = req.body;
  const adminUser = (process.env.ADMIN_USERNAME || process.env.ADMIN_USER || 'admin').replace(/^['"]|['"]$/g, '').trim();
  const adminPass = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || 'urban@hairplaza2025').replace(/^['"]|['"]$/g, '').trim();

  const cleanUser = typeof username === 'string' ? username.trim() : '';
  const cleanPass = typeof password === 'string' ? password : '';

  if (safeCompare(cleanUser, adminUser) && safeCompare(cleanPass, adminPass)) {
    const token = createAuthToken({
      role: 'admin',
      user: cleanUser,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    if (req.session) {
      req.session.isAdmin = true;
      req.session.user = cleanUser;
    }

    res.cookie('uhp_admin_token', token, {
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    return res.json({ success: true, user: cleanUser, token });
  }
  res.status(401).json({ success: false, error: 'Invalid username or password.' });
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ authenticated: true, user: req.session.user || 'Admin' });
  }
  const token = extractToken(req);
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload && payload.role === 'admin') {
      if (req.session) {
        req.session.isAdmin = true;
        req.session.user = payload.user || 'Admin';
      }
      return res.json({ authenticated: true, user: payload.user || 'Admin' });
    }
  }
  res.status(401).json({ authenticated: false });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('uhp_admin_token');
  if (req.session) {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  } else {
    res.json({ success: true });
  }
});

// ── ADMIN DATA MANAGEMENT ───────────────────────────────────────────────────

// GET /api/admin/stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [bookings, enquiries, transactions, users] = await Promise.all([
      db.getBookings(),
      db.getEnquiries(),
      db.getTransactions(),
      db.getUsers()
    ]);

    const todayStr = new Date().toISOString().split('T')[0];
    const todayBookings = bookings.filter(b => b.date === todayStr && b.status !== 'cancelled');

    const totalAdvance = transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const totalRevenueEst = bookings.reduce((sum, b) => {
      return sum + (b.status === 'confirmed' || b.status === 'completed' ? (Number(b.price) || 0) : 0);
    }, 0);

    res.json({
      bookings: {
        total: bookings.length,
        today: todayBookings.length,
        pending: bookings.filter(b => b.status === 'pending' || b.status === 'payment_pending').length,
        confirmed: bookings.filter(b => b.status === 'confirmed').length,
        completed: bookings.filter(b => b.status === 'completed').length,
        cancelled: bookings.filter(b => b.status === 'cancelled').length,
      },
      revenue: {
        totalAdvance,
        totalRevenueEst
      },
      transactions: {
        totalCount: transactions.length,
        totalVolume: totalAdvance
      },
      clients: {
        totalClients: users.length
      },
      enquiries: {
        total: enquiries.length,
        unread: enquiries.filter(e => e.status === 'unread').length,
        read: enquiries.filter(e => e.status === 'read').length,
        replied: enquiries.filter(e => e.status === 'replied').length,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to calculate stats' });
  }
});

// GET /api/admin/bookings
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const bookings = await db.getBookings();
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// PATCH /api/admin/bookings/:id
app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await db.updateBooking(id, req.body);
    res.json({ success: true, booking: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// DELETE /api/admin/bookings/:id
app.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteBooking(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// GET /api/admin/transactions — View all payments
app.get('/api/admin/transactions', requireAdmin, async (req, res) => {
  try {
    const transactions = await db.getTransactions();
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// GET /api/admin/users — View all registered client profiles
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// GET /api/admin/enquiries
app.get('/api/admin/enquiries', requireAdmin, async (req, res) => {
  try {
    const enquiries = await db.getEnquiries();
    res.json(enquiries);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch enquiries' });
  }
});

// DELETE /api/admin/enquiries/:id
app.delete('/api/admin/enquiries/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteEnquiry(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete enquiry' });
  }
});

// GET /api/admin/services
app.get('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const services = await db.getServices();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// POST /api/admin/services
app.post('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const { category, type, icon, name, desc, price, duration, badge } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Service name and price are required.' });

    const newService = {
      id: `SRV-${Date.now().toString(36).toUpperCase()}`,
      category: category || 'Haircut',
      type: type || 'inshop',
      icon: icon || '✂️',
      name: name.trim(),
      desc: (desc || '').trim(),
      price: Number(price) || 0,
      duration: Number(duration) || 30,
      badge: badge || ''
    };

    await db.saveService(newService);
    res.json({ success: true, service: newService });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// PUT /api/admin/services/:id
app.put('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await db.updateService(id, req.body);
    res.json({ success: true, service: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// DELETE /api/admin/services/:id
app.delete('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteService(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// ── ADMIN MULTI-TENANT SALONS MANAGEMENT ───────────────────────────────────

// GET /api/admin/salons — All registered salons (pending, approved, suspended)
app.get('/api/admin/salons', requireAdmin, async (req, res) => {
  try {
    const { status, search } = req.query;
    const salons = await db.getSalons({ status: status || 'all', search });
    res.json({ success: true, count: salons.length, salons });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load salons list' });
  }
});

// PATCH /api/admin/salons/:id/status — Approve, suspend, or set status
app.patch('/api/admin/salons/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['approved', 'pending', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved, pending, or suspended.' });
    }

    const salon = await db.getSalonById(id);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    const updated = await db.updateSalon(id, { status, updatedAt: new Date().toISOString() });

    // Also update associated owner status if exists
    if (salon.ownerId) {
      await db.updateOwner(salon.ownerId, { status });
    }

    // Notify owner of approval via SMS
    if (status === 'approved' && salon.phone) {
      const publicBase = getPublicBaseUrl(req);
      const cleanPhone = salon.phone.replace(/\D/g, '').slice(-10);
      const smsMsg = `🎉 Congratulations! Your salon "${salon.name}" has been APPROVED on Urban Hairplaza! It is now live to customers. Access your dashboard: ${publicBase}/owner/login`;
      sendRealSms(cleanPhone, smsMsg).catch(() => {});
      sendWhatsAppNotification(`🎉 *Salon Approved!* ${salon.name} (${salon.phone}) is now live on the platform!`).catch(() => {});
    }

    res.json({ success: true, salon: updated });
  } catch (err) {
    console.error('[ADMIN-SALON-STATUS] Error:', err);
    res.status(500).json({ error: 'Failed to update salon status' });
  }
});

// DELETE /api/admin/salons/:id — Delete salon listing
app.delete('/api/admin/salons/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'salon-urban-hairplaza') {
      return res.status(400).json({ error: 'Cannot delete the flagship Urban Hairplaza salon.' });
    }
    await db.deleteSalon(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete salon' });
  }
});

// GET /api/admin/owners — All salon owners
app.get('/api/admin/owners', requireAdmin, async (req, res) => {
  try {
    const owners = await db.getOwners();
    res.json({ success: true, count: owners.length, owners });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch salon owners' });
  }
});

// ── ADMIN PAGE REDIRECTS ────────────────────────────────────────────────────
app.get(['/admin', '/admin/'], (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin/dashboard.html');
  }
  res.redirect('/admin/login.html');
});

// ── INITIALIZATION & SERVER START ───────────────────────────────────────────
db.initDB().catch(err => console.error('[Init DB Error]', err));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║               URBAN HAIRPLAZA WEB APP READY                  ║
║                                                              ║
║  🌐 Web App:    http://localhost:${PORT}                        ║
║  🔑 Admin:      http://localhost:${PORT}/admin/                 ║
║  💈 Location:   Simraha, Araria, Bihar                       ║
║  📞 Phone:      +91 6202 692 426                             ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });
}


// ── WHATSAPP REMINDERS & NOTIFICATION ENDPOINTS ─────────────────────────────

// GET /api/cron/reminders — Scheduled runner to trigger 2-hour pre-appointment WhatsApp reminders
app.get('/api/cron/reminders', async (req, res) => {
  try {
    const result = await checkAndSendUpcomingReminders();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result
    });
  } catch (err) {
    console.error('Error in /api/cron/reminders:', err);
    res.status(500).json({ error: 'Failed to process reminders', details: err.message });
  }
});

// POST /api/appointments/:id/send-reminder — Manual WhatsApp nudge by Owner or Admin
app.post('/api/appointments/:id/send-reminder', async (req, res) => {
  try {
    const bookingId = req.params.id;
    const booking = await db.getBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    let salon = null;
    if (booking.salonId) {
      try { salon = await db.getSalonById(booking.salonId); } catch (e) {}
    }

    const { customMessage } = req.body || {};
    const message = customMessage || buildReminderWhatsApp(booking, salon, 'soon');

    const result = await sendWhatsAppNotification(message, booking.phone);
    if (!result.success) {
      return res.status(400).json({ error: 'Failed to send WhatsApp message', details: result });
    }

    await db.updateBooking(booking.id, {
      reminderSentAt: new Date().toISOString(),
      reminderStatus: 'manual_sent'
    });

    res.json({
      success: true,
      message: `WhatsApp reminder dispatched to +${result.phone}`,
      result
    });
  } catch (err) {
    console.error('Error in send-reminder:', err);
    res.status(500).json({ error: 'Internal server error while sending reminder' });
  }
});

// GET /api/admin/whatsapp-logs — View recent WhatsApp outgoing notifications
app.get('/api/admin/whatsapp-logs', requireAdmin, async (req, res) => {
  res.json({
    success: true,
    count: (global.whatsappLogs || []).length,
    logs: global.whatsappLogs || []
  });
});

module.exports = app;
