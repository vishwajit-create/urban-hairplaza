# ✂️ Urban Hairplaza

> **Premium Barbershop Website** — Full-stack web platform with online booking, WhatsApp notifications, OTP authentication, payment gateway integration, and a secure admin dashboard.

---

## 🌟 Features

- 🏠 **Landing Page** — Hero section, services overview, featured barbers, testimonials
- 📅 **Online Booking System** — Pick a barber, service, date & time; mandatory advance payment for future appointments
- 💳 **Cashfree Payment Integration** — Secure payment gateway (sandbox & production)
- 📲 **WhatsApp Notifications** — Real-time alerts via CallMeBot API for new bookings & enquiries
- 📱 **OTP Authentication** — Mobile-number-based login via Twilio SMS
- 👤 **User Profiles** — View personal booking history after login
- 🖼️ **Gallery** — Dynamic photo gallery of work and salon ambience
- 💈 **Barbers Page** — Team profiles with specialties
- 💰 **Services & Pricing** — Fully admin-manageable service list
- 📬 **Contact Page** — Enquiry form with backend persistence
- 🔐 **Admin Dashboard** — Manage bookings, enquiries, pricing, and site content
- 🛡️ **Admin Auth** — Session-based protected login for admin routes

---

## 🗂️ Project Structure

```
urban-hairplaza/
├── index.html          # Home / Landing page
├── book.html           # Booking flow (service + barber + time + payment)
├── barbers.html        # Meet the team
├── services.html       # Services & pricing
├── gallery.html        # Gallery
├── about.html          # About the salon
├── contact.html        # Contact / enquiry form
├── login.html          # User login (OTP)
├── profile.html        # User profile & booking history
├── visualizer.html     # Hairstyle visualizer
├── styles.css          # Global stylesheet
├── main.js             # Shared frontend JS
├── server.js           # Node.js / Express backend
├── package.json        # NPM configuration
├── .env.example        # Environment variable template
├── .gitignore
├── admin/
│   ├── login.html      # Admin login page
│   └── dashboard.html  # Admin control panel
├── data/               # JSON data store (bookings, enquiries, pricing)
└── images/             # Static assets
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (bundled with Node.js)
- A [CallMeBot](https://www.callmebot.com/) API key (for WhatsApp notifications)
- A [Twilio](https://www.twilio.com/) account (for OTP SMS)
- A [Cashfree](https://cashfree.com/) account (for payments)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/urban-hairplaza.git
cd urban-hairplaza

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your own credentials (see Configuration section)

# 4. Start the development server
npm run dev

# Or for production
npm start
```

The server will start on **http://localhost:7890** by default.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in the values:

```env
# Server
PORT=7890

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password

# Session secret (change in production!)
SESSION_SECRET=your_session_secret

# WhatsApp Notifications (CallMeBot)
WHATSAPP_PHONE=91XXXXXXXXXX      # Your phone with country code, no '+'
WHATSAPP_APIKEY=your_api_key

# Business WhatsApp link
BUSINESS_WHATSAPP=91XXXXXXXXXX

# Cashfree Payment Gateway
CASHFREE_APP_ID=your_app_id
CASHFREE_SECRET_KEY=your_secret_key
CASHFREE_ENVIRONMENT=sandbox     # or 'production'

# Twilio SMS (OTP)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

> **⚠️ Warning:** Never commit your `.env` file. It is already listed in `.gitignore`.

---

## 🔑 Admin Dashboard

| Route | Description |
|---|---|
| `/admin/login.html` | Admin login page |
| `/admin/dashboard.html` | Full admin control panel |

**Default credentials** (change in `.env`):
- Username: `admin`
- Password: `ur025`

The dashboard allows you to:
- ✅ View, confirm, and delete bookings
- ✅ View and reply to contact enquiries
- ✅ Edit service names, prices, and categories
- ✅ View analytics summary

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3 (Vanilla), JavaScript (ES6+) |
| Backend | Node.js, Express.js |
| Auth | express-session, Twilio OTP |
| Payments | Cashfree Payment Gateway |
| Notifications | CallMeBot WhatsApp API |
| Data Store | JSON flat files (no database required) |
| Dev Tools | nodemon |

---

## 📦 NPM Scripts

| Script | Command | Description |
|---|---|---|
| Start | `npm start` | Run server with Node.js |
| Dev | `npm run dev` | Run with nodemon (auto-reload) |

---

## 📸 Pages Overview

| Page | URL | Description |
|---|---|---|
| Home | `/` | Landing page with hero & highlights |
| Booking | `/book.html` | Full appointment booking flow |
| Barbers | `/barbers.html` | Team profiles |
| Services | `/services.html` | Pricing & service list |
| Gallery | `/gallery.html` | Photo gallery |
| About | `/about.html` | Salon story & values |
| Contact | `/contact.html` | Enquiry form |
| Login | `/login.html` | User OTP login |
| Profile | `/profile.html` | User booking history |
| Admin | `/admin/dashboard.html` | Admin panel |

---

## 📄 License

This project is for personal / commercial use by the salon owner. All rights reserved.

---

## 🤝 Contributing

Pull requests are welcome for bug fixes and improvements. For major changes, please open an issue first.

---

*Built with ❤️ for Urban Hairplaza*
