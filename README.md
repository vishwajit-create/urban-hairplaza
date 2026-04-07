# Urban Hairplaza

> **Premium Barbershop Website** — Full-stack web platform with online booking, WhatsApp notifications, OTP authentication, payment gateway integration, and a secure admin dashboard.

---

## Features

- Landing Page — Hero section, services overview, featured barbers, testimonials
- Online Booking System — Pick a barber, service, date & time; mandatory advance payment for future appointments
- Cashfree Payment Integration — Secure payment gateway (sandbox & production)
- WhatsApp Notifications — Real-time alerts via CallMeBot API for new bookings & enquiries
- OTP Authentication — Mobile-number-based login via Twilio SMS
- User Profiles — View personal booking history after login
- Gallery — Dynamic photo gallery of work and salon ambience
- Barbers Page — Team profiles with specialties
- Services & Pricing — Fully admin-manageable service list
- Contact Page — Enquiry form with backend persistence
- Admin Dashboard — Manage bookings, enquiries, pricing, and site content
- Admin Auth — Session-based protected login for admin routes

---

## Project Structure

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

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm (bundled with Node.js)
- A CallMeBot API key (for WhatsApp notifications)
- A Twilio account (for OTP SMS)
- A Cashfree account (for payments)

### Installation

Clone the repo, run npm install, copy .env.example to .env, then run npm run dev.

The server will start on http://localhost:7890 by default.

---

## Configuration

Copy .env.example to .env and fill in the values for PORT, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, WHATSAPP_PHONE, WHATSAPP_APIKEY, CASHFREE_APP_ID, CASHFREE_SECRET_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.

> **Warning:** Never commit your .env file. It is already listed in .gitignore.

---

## Admin Dashboard

- Route: /admin/login.html — Admin login page
- Route: /admin/dashboard.html — Full admin control panel

Default credentials (change in .env):
- Username: admin
- Password: urban@hairplaza2025

The dashboard allows you to view/confirm/delete bookings, manage enquiries, edit pricing, and view analytics.

---

## Tech Stack

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

## NPM Scripts

- npm start — Run server with Node.js
- npm run dev — Run with nodemon (auto-reload)

---

## Pages Overview

| Page | URL | Description |
|---|---|---|
| Home | / | Landing page with hero & highlights |
| Booking | /book.html | Full appointment booking flow |
| Barbers | /barbers.html | Team profiles |
| Services | /services.html | Pricing & service list |
| Gallery | /gallery.html | Photo gallery |
| About | /about.html | Salon story & values |
| Contact | /contact.html | Enquiry form |
| Login | /login.html | User OTP login |
| Profile | /profile.html | User booking history |
| Admin | /admin/dashboard.html | Admin panel |

---

## License

This project is for personal / commercial use by the salon owner. All rights reserved.

---

## Contributing

Pull requests are welcome for bug fixes and improvements. For major changes, please open an issue first.

---

Built with love for Urban Hairplaza
