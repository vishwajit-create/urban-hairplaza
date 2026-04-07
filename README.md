# Urban Hairplaza

> Premium Barbershop Website - Full-stack web platform with online booking, WhatsApp notifications, OTP authentication, payment gateway integration, and a secure admin dashboard.

## Features

- Landing Page - Hero section, services overview, featured barbers, testimonials
- Online Booking System - Pick a barber, service, date & time; mandatory advance payment for future appointments
- Cashfree Payment Integration - Secure payment gateway (sandbox & production)
- WhatsApp Notifications - Real-time alerts via CallMeBot API for new bookings & enquiries
- OTP Authentication - Mobile-number-based login via Twilio SMS
- User Profiles - View personal booking history after login
- Gallery - Dynamic photo gallery of work and salon ambience
- Barbers Page - Team profiles with specialties
- Services & Pricing - Fully admin-manageable service list
- Contact Page - Enquiry form with backend persistence
- Admin Dashboard - Manage bookings, enquiries, pricing, and site content
- Admin Auth - Session-based protected login for admin routes

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm (bundled with Node.js)
- A CallMeBot API key (for WhatsApp notifications)
- A Twilio account (for OTP SMS)
- A Cashfree account (for payments)

### Installation

1. Clone the repository: git clone https://github.com/vishwajit-create/urban-hairplaza.git
2. Install dependencies: npm install
3. Copy .env.example to .env and fill in your credentials
4. Start dev server: npm run dev

The server will start on http://localhost:7890 by default.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3 (Vanilla), JavaScript (ES6+) |
| Backend | Node.js, Express.js |
| Auth | express-session, Twilio OTP |
| Payments | Cashfree Payment Gateway |
| Notifications | CallMeBot WhatsApp API |
| Data Store | JSON flat files (no database required) |

## Admin Dashboard

- Route: /admin/login.html - Admin login page
- Route: /admin/dashboard.html - Full admin control panel
- Default credentials (change in .env): admin / urban@hairplaza2025

## NPM Scripts

- npm start - Run server with Node.js
- npm run dev - Run with nodemon (auto-reload)

## License

This project is for personal / commercial use by the salon owner. All rights reserved.

Built with love for Urban Hairplaza
