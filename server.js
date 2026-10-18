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
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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
async function sendRealSmsOtp(phone, otp) {
  // 1. Textbee Gateway API (Official: https://api.textbee.dev/api/v1/gateway/send-sms)
  const textbeeKey = (process.env.TEXTBEE_API_KEY || process.env.TEXTBEE_KEY || process.env.TEXT_BEE_API_KEY || '').trim();
  const textbeeDevice = (process.env.TEXTBEE_DEVICE_ID || process.env.TEXTBEE_DEVICE || process.env.DEVICE_ID || '').trim();

  if (textbeeKey) {
    try {
      const formattedRecipient = phone.startsWith('+') ? phone : `+91${phone}`;

      const payload = {
        recipients: [formattedRecipient],
        message: `✂️ Your Urban Hairplaza verification OTP is: ${otp}. Valid for 10 minutes. Do not share this code.`
      };
      if (textbeeDevice) {
        payload.deviceId = textbeeDevice;
      }

      // Call Textbee official REST endpoint
      const res = await axios.post(
        'https://api.textbee.dev/api/v1/gateway/send-sms',
        payload,
        {
          headers: {
            'x-api-key': textbeeKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      console.log(`[SMS-Textbee] Dispatched OTP to ${formattedRecipient}:`, res.data);
      return true;
    } catch (err) {
      console.warn('[SMS-Textbee] Primary endpoint error:', err.response?.data || err.message);

      // Fallback: devices/:deviceId/send-sms if deviceId is specified
      if (textbeeDevice) {
        try {
          const formattedRecipient = phone.startsWith('+') ? phone : `+91${phone}`;
          const fallbackRes = await axios.post(
            `https://api.textbee.dev/api/v1/gateway/devices/${textbeeDevice}/send-sms`,
            {
              recipients: [formattedRecipient],
              message: `✂️ Your Urban Hairplaza verification OTP is: ${otp}. Valid for 10 minutes. Do not share this code.`
            },
            {
              headers: {
                'x-api-key': textbeeKey,
                'Content-Type': 'application/json'
              },
              timeout: 10000
            }
          );
          console.log(`[SMS-Textbee] Dispatched OTP via fallback to ${formattedRecipient}:`, fallbackRes.data);
          return true;
        } catch (err2) {
          console.warn('[SMS-Textbee] Fallback endpoint error:', err2.response?.data || err2.message);
        }
      }
    }
  }

  // 2. Fast2SMS (India Quick OTP API - fastest & easiest for Indian numbers)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const response = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
        params: {
          authorization: process.env.FAST2SMS_API_KEY.trim(),
          variables_values: otp,
          route: 'otp',
          numbers: phone
        },
        timeout: 7000
      });
      console.log(`[SMS-Fast2SMS] Sent to ${phone}:`, response.data);
      return true;
    } catch (err) {
      console.warn('[SMS-Fast2SMS] Error:', err.response?.data || err.message);
    }
  }

  // 3. Twilio SMS (Global SMS)
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
  if (twilioSid && twilioToken && twilioFrom) {
    try {
      const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`;
      const auth = Buffer.from(`${twilioSid.trim()}:${twilioToken.trim()}`).toString('base64');
      const params = new URLSearchParams({
        To: formattedPhone,
        From: twilioFrom.trim(),
        Body: `✂️ Your Urban Hairplaza verification OTP is: ${otp}. Valid for 10 minutes.`
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

  // 4. 2Factor.in SMS (India)
  if (process.env.TWOFACTOR_API_KEY) {
    try {
      await axios.get(`https://2factor.in/v1/${process.env.TWOFACTOR_API_KEY.trim()}/SMS/${phone}/${otp}/AUTOGEN`, { timeout: 7000 });
      console.log(`[SMS-2Factor] Sent to ${phone}`);
      return true;
    } catch (err) {
      console.warn('[SMS-2Factor] Error:', err.response?.data || err.message);
    }
  }

  return false;
}

// ── REAL EMAIL DISPATCHER (Resend / Gmail SMTP / Brevo) ───────────────────────
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

  // 1. Resend API (Recommended - fast, high deliverability, zero spam)
  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM || 'Urban Hairplaza <onboarding@resend.dev>';
      const res = await axios.post('https://api.resend.com/emails', {
        from: fromEmail,
        to: email,
        subject: `Your Urban Hairplaza Verification Code: ${otp}`,
        html: htmlTemplate
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
        subject: `✂️ Your Urban Hairplaza Verification Code: ${otp}`,
        html: htmlTemplate
      });
      console.log(`[Email-SMTP] Sent to ${email} via ${smtpUser}`);
      return true;
    } catch (err) {
      console.warn('[Email-SMTP] Error:', err.message);
    }
  }

  // 3. Brevo (Sendinblue) API
  if (process.env.BREVO_API_KEY) {
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'Urban Hairplaza', email: process.env.BREVO_SENDER || 'urbanhairplaza@gmail.com' },
        to: [{ email }],
        subject: `✂️ Your Urban Hairplaza Verification Code: ${otp}`,
        htmlContent: htmlTemplate
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

// ── WHATSAPP HELPER ──────────────────────────────────────────────────────────
async function sendWhatsAppNotification(message, customPhone) {
  const phone = customPhone || process.env.WHATSAPP_PHONE || process.env.CALLMEBOT_PHONE;
  const apiKey = process.env.WHATSAPP_APIKEY || process.env.CALLMEBOT_APIKEY;
  if (!phone || !apiKey) return;
  try {
    await axios.get('https://api.callmebot.com/whatsapp.php', {
      params: { phone, apikey: apiKey, text: message },
      timeout: 5000
    });
  } catch (err) {
    console.warn('[WhatsApp] Notification failed:', err.message);
  }
}

function buildWhatsAppMessage(booking) {
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
    `*Balance Due:* ₹${Math.max(0, (booking.price || 0) - (booking.advancePaid || 0))}\n` +
    `*Status:* Confirmed ✅\n` +
    `--------------------------------\n` +
    `📍 Near Phanishwar Nath Renu Statue, Simraha, Araria, Bihar`;
}

// ── PUBLIC API ROUTES ────────────────────────────────────────────────────────

// GET /api/services — List active services
app.get('/api/services', async (req, res) => {
  try {
    const services = await db.getServices();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// GET /api/barbers — List active barbers
app.get('/api/barbers', (req, res) => {
  res.json([
    { id: 'any', name: 'Any Barber', title: 'Any Available Barber', role: 'Fastest Availability', exp: 'First available chair', avatar: '' },
    { id: 'raj', name: 'Raj Kumar', title: 'Raj Kumar', role: 'Master Barber', exp: '12+ yrs · Fades & Scissor', avatar: 'images/barber_raj.png' },
    { id: 'sameer', name: 'Sameer Khan', title: 'Sameer Khan', role: 'Senior Stylist', exp: '8+ yrs · Beard & Shave', avatar: 'images/barber_sameer.png' },
    { id: 'amit', name: 'Amit Sharma', title: 'Amit Sharma', role: 'Grooming Expert', exp: '6+ yrs · Massage & Cleanups', avatar: 'images/barber_amit.png' }
  ]);
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
  const textbeeKey = (process.env.TEXTBEE_API_KEY || process.env.TEXTBEE_KEY || process.env.TEXT_BEE_API_KEY || '').trim();
  const textbeeDevice = (process.env.TEXTBEE_DEVICE_ID || process.env.TEXTBEE_DEVICE || process.env.DEVICE_ID || '').trim();

  if (!textbeeKey) {
    return res.json({
      configured: false,
      message: 'TEXTBEE_API_KEY is missing in environment variables.'
    });
  }

  // Ping Textbee API to verify credentials
  try {
    const testRes = await axios.get('https://api.textbee.dev/api/v1/gateway/devices', {
      headers: { 'x-api-key': textbeeKey },
      timeout: 8000
    });
    return res.json({
      configured: true,
      authenticated: true,
      apiKeyValid: true,
      deviceIdSet: textbeeDevice || '(Using default device)',
      devices: testRes.data,
      message: 'Textbee API key is valid and authenticated!'
    });
  } catch (err) {
    return res.json({
      configured: true,
      authenticated: false,
      statusCode: err.response?.status || 500,
      apiKeyPreview: textbeeKey.length > 8 ? `${textbeeKey.slice(0, 4)}...${textbeeKey.slice(-4)}` : 'SET',
      deviceIdSet: textbeeDevice || 'NONE',
      gatewayError: err.response?.data || err.message,
      message: err.response?.status === 401
        ? 'Textbee returned 401 Unauthorized (AUTH_INVALID). Please check that the API Key in Vercel matches your Textbee Dashboard exactly.'
        : 'Textbee returned an error.'
    });
  }
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

// GET /api/slots — Check availability per barber and per date
app.get('/api/slots', async (req, res) => {
  const { date, barber } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Query parameter date (YYYY-MM-DD) is required' });
  }

  try {
    const bookings = await db.getBookings();
    // Active bookings on this date (not cancelled and not expired payment_pending)
    const activeBookings = bookings.filter(b => {
      if (b.date !== date) return false;
      if (b.status === 'cancelled') return false;
      if (b.status === 'payment_pending') {
        const ageMinutes = (Date.now() - new Date(b.createdAt).getTime()) / 60000;
        return ageMinutes <= 15;
      }
      return true;
    });

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
        if (bookingsAtSlot.length >= 3) bookedSlots.push(slot);
      }
    });

    const availableSlots = OPERATING_SLOTS.filter(s => !bookedSlots.includes(s));

    res.json({
      date,
      barber: barber || 'Any',
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
      type, address, notes, price, duration
    } = bookingDetails;

    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, service, date, and time are required.' });
    }

    const cleanReqPhone = phone.replace(/\D/g, '').slice(-10);

    // Verify slot is still free
    const bookings = await db.getBookings();
    const bookingsAtSlot = bookings.filter(b => {
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

    const chosenBarber = (barber && barber !== 'Any' && barber !== 'Any Barber') ? barber.trim() : 'Any Barber';

    if (chosenBarber !== 'Any Barber') {
      const barberBusy = bookingsAtSlot.some(b => b.barber === chosenBarber);
      if (barberBusy) {
        return res.status(400).json({ error: `${chosenBarber} is already booked at ${time} on ${date}. Please select another time slot or barber.` });
      }
    } else {
      if (bookingsAtSlot.length >= 3) {
        return res.status(400).json({ error: `All barbers are currently booked at ${time}. Please select another time.` });
      }
    }

    // Assign specific barber if "Any" chosen
    let assignedBarber = chosenBarber;
    if (chosenBarber === 'Any Barber') {
      const busyBarbers = bookingsAtSlot.map(b => b.barber);
      const freeBarber = VALID_BARBERS.find(b => !busyBarbers.includes(b));
      assignedBarber = freeBarber || VALID_BARBERS[0];
    }

    // Server-side service verification against database (prevents client price tampering)
    const allServices = await db.getServices();
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

      // WhatsApp notification
      const waMsg = buildWhatsAppMessage(updatedBooking || booking);
      sendWhatsAppNotification(waMsg).catch(() => {});

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

// POST /api/bookings — Direct reservation (for walk-in, admin, or pay at shop)
app.post('/api/bookings', rateLimit({ windowMs: 60000, max: 10, message: 'Too many booking requests. Please wait a moment.' }), async (req, res) => {
  try {
    const { name, phone, email, service, barber, date, time, type, address, notes, price, duration, advancePaid } = req.body;
    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, service, date, and time are required.' });
    }

    const isAdmin = Boolean(req.session && req.session.isAdmin);

    // Verify service price against DB (prevents tampering)
    const allServices = await db.getServices();
    const matched = allServices.find(s => s.name.toLowerCase() === service.trim().toLowerCase() || s.id === service.trim());
    const verifiedPrice = matched ? Number(matched.price) : (Number(price) || 150);
    const verifiedDuration = matched ? (parseInt(matched.duration) || 30) : (Number(duration) || 30);

    // Security check: Only authenticated admins can mark an appointment confirmed or log paid advance directly
    const finalAdvance = isAdmin ? (Number(advancePaid) || 0) : 0;
    const finalStatus = isAdmin ? (req.body.status || 'confirmed') : 'pending_confirmation';

    const booking = {
      id: `DIR-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`,
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
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Admin login required.' });
}

// ── ADMIN AUTH ROUTES ────────────────────────────────────────────────────────
// Protected with brute-force rate limiter (max 8 attempts per 15 min per IP) and timing-safe comparison
app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: 'Too many login attempts. Please wait 15 minutes.' }), (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || 'urban@hairplaza2025';

  if (safeCompare(username, adminUser) && safeCompare(password, adminPass)) {
    req.session.isAdmin = true;
    req.session.user = username;
    return res.json({ success: true, user: username });
  }
  res.status(401).json({ success: false, error: 'Invalid username or password.' });
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ authenticated: true, user: req.session.user || 'Admin' });
  }
  res.status(401).json({ authenticated: false });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
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

module.exports = app;
