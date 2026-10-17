/**
 * Vercel Serverless Function entry point
 * Directs /api requests to the Express app
 */
const app = require('../server');

module.exports = app;
