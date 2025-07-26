require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const router = express.Router();
const { initializeApp, cert } = require('firebase-admin/app');
const serviceAccount = require('../firebase-admin.json');

// Initialize Firebase
initializeApp({
  credential: cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL // Add to .env
});

const db = getFirestore();

// Constants
const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1/invoice';
const SUCCESS_URL = process.env.PAYMENT_SUCCESS_URL || 'http://localhost:5173/top-up-success';
const CANCEL_URL = process.env.PAYMENT_CANCEL_URL || 'http://localhost:5173/top-up-cancel';
const WEBHOOK_URL = process.env.PAYMENT_WEBHOOK_URL || `${process.env.RENDER_EXTERNAL_URL}/api/payment-webhook`;

// Payment creation endpoint
router.post('/create-payment', async (req, res) => {
  try {
    const { amount, email, uid } = req.body;
    
    // Validation
    if (!amount || !email || !uid) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['amount', 'email', 'uid']
      });
    }

    if (isNaN(amount) {
      return res.status(400).json({ error: 'Amount must be a number' });
    }

    // Create payment invoice
    const invoiceData = {
      price_amount: parseFloat(amount),
      price_currency: 'usd',
      pay_currency: 'usdttrc20',
      order_description: `Top-up for ${email}`,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      ipn_callback_url: WEBHOOK_URL
    };

    const response = await axios.post(NOWPAYMENTS_API, invoiceData, {
      headers: { 
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    const invoice = response.data;

    // Save to Firestore
    await db.collection('topups').doc(invoice.invoice_id).set({
      uid,
      email,
      amount: parseFloat(amount),
      invoice_id: invoice.invoice_id,
      invoice_url: invoice.invoice_url,
      status: invoice.invoice_status || 'pending',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      invoice_url: invoice.invoice_url,
      payment_id: invoice.invoice_id,
      status: invoice.invoice_status
    });

  } catch (error) {
    console.error('Payment Error:', {
      request: error.config,
      response: error.response?.data,
      message: error.message
    });

    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      error: 'Payment creation failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Payment status endpoint
router.get('/payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    // Check payment status
    const response = await axios.get(`${NOWPAYMENTS_API}/${paymentId}`, {
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY },
      timeout: 5000
    });

    const status = response.data.invoice_status;

    // Update Firestore
    const batch = db.batch();
    const topupRef = db.collection('topups').doc(paymentId);
    
    batch.update(topupRef, { 
      status,
      updated_at: FieldValue.serverTimestamp() 
    });

    // Update user balance if payment completed
    if (status === 'confirmed' || status === 'finished') {
      const doc = await topupRef.get();
      if (doc.exists) {
        const { uid, amount } = doc.data();
        const userRef = db.collection('users').doc(uid);
        batch.update(userRef, {
          balance: FieldValue.increment(parseFloat(amount))
        });
      }
    }

    await batch.commit();

    res.json({ 
      success: true,
      status 
    });

  } catch (error) {
    console.error('Status Check Error:', error.message);
    
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      error: 'Failed to check payment status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Webhook endpoint
router.post('/payment-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const { payment_status, invoice_id } = req.body;

    if (!payment_status || !invoice_id) {
      console.warn('Invalid webhook payload:', req.body);
      return res.status(400).json({ error: 'Invalid webhook data' });
    }

    const batch = db.batch();
    const topupRef = db.collection('topups').doc(invoice_id);

    batch.update(topupRef, {
      status: payment_status,
      updated_at: FieldValue.serverTimestamp()
    });

    if (payment_status === 'confirmed' || payment_status === 'finished') {
      const doc = await topupRef.get();
      if (doc.exists) {
        const { uid, amount } = doc.data();
        const userRef = db.collection('users').doc(uid);
        batch.update(userRef, {
          balance: FieldValue.increment(parseFloat(amount))
        });
      }
    }

    await batch.commit();
    res.status(200).send('OK');

  } catch (error) {
    console.error('Webhook Processing Error:', error);
    res.status(500).json({ 
      error: 'Webhook processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
