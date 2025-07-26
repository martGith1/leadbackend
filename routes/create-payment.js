const express = require('express');
const axios = require('axios');
const { getFirestore } = require('firebase-admin/firestore');
const router = express.Router();
const { initializeApp, cert } = require('firebase-admin/app');
const serviceAccount = require('../firebase-admin.json');

// Initialize Firebase
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Payment creation endpoint
router.post('/create-payment', async (req, res) => {
  try {
    const { amount, email, uid } = req.body;
    if (!amount || !email || !uid) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const response = await axios.post(
      'https://api.nowpayments.io/v1/invoice',
      {
        price_amount: amount,
        price_currency: 'usd',
        pay_currency: 'usdttrc20',
        order_description: `Top-up for ${email}`,
        success_url: 'http://localhost:5173/top-up-success',
        cancel_url: 'http://localhost:5173/top-up-cancel',
        ipn_callback_url: 'https://f00e75544225.ngrok-free.app/api/payment-webhook'
      },
      {
        headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY }
      }
    );

    const invoice = response.data;
    await db.collection('topups').doc(invoice.invoice_id).set({
      uid, email, amount,
      invoice_id: invoice.invoice_id,
      invoice_url: invoice.invoice_url,
      status: invoice.invoice_status || 'pending',
      createdAt: new Date()
    });

    res.json({
      invoice_url: invoice.invoice_url,
      payment_id: invoice.invoice_id
    });
  } catch (error) {
    console.error('Payment creation error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Payment status endpoint
router.get('/payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) return res.status(400).json({ error: 'Missing payment ID' });

    const response = await axios.get(
      `https://api.nowpayments.io/v1/invoice/${paymentId}`,
      { headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY } }
    );

    const status = response.data.invoice_status;
    await db.collection('topups').doc(paymentId).update({ status });

    if (status === 'confirmed' || status === 'finished') {
      const doc = await db.collection('topups').doc(paymentId).get();
      const { uid, amount } = doc.data();
      
      await db.collection('users').doc(uid).update({
        balance: admin.firestore.FieldValue.increment(amount)
      });
    }

    res.json({ status });
  } catch (error) {
    console.error('Status check error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Webhook endpoint
router.post('/payment-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const { payment_status, invoice_id } = req.body;
    if (!payment_status || !invoice_id) {
      return res.status(400).json({ error: 'Invalid webhook data' });
    }

    await db.collection('topups').doc(invoice_id).update({
      status: payment_status,
      updatedAt: new Date()
    });

    if (payment_status === 'confirmed' || payment_status === 'finished') {
      const doc = await db.collection('topups').doc(invoice_id).get();
      const { uid, amount } = doc.data();
      
      await db.collection('users').doc(uid).update({
        balance: admin.firestore.FieldValue.increment(amount)
      });
    }

    res.status(200).send('Webhook processed');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;