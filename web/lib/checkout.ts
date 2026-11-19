'use client';

import { inr } from './format';

declare global { interface Window { Razorpay?: any } }

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load the payment window. Check your internet.'));
    document.body.appendChild(s);
  });
}

export type Order = { orderId: string; amountPaise: number; description: string; keyId: string | null; testMode: boolean };

/**
 * Opens Razorpay Checkout for an order made by the API (or a confirm box in test mode),
 * then calls finish(paymentId, signature), which should POST shop/billing/verify.
 * Resolves false if the window was closed without paying.
 */
export async function payOrder(order: Order, who: { shopName: string; shopId: number; mobile: string; name?: string | null },
  finish: (paymentId: string, signature: string) => Promise<void>, onFail: (msg: string) => void): Promise<boolean> {
  if (order.testMode) {
    if (!confirm(`TEST MODE (no real money)\n\nPay ${inr(order.amountPaise / 100)} for ${order.description}?`)) return false;
    await finish(`pay_test_${Date.now()}`, 'test');
    return true;
  }
  await loadCheckout();
  return new Promise<boolean>((resolve) => {
    const rz = new window.Razorpay({
      key: order.keyId, order_id: order.orderId, amount: order.amountPaise, currency: 'INR',
      name: 'Vyapar Point', description: `${order.description} · ${who.shopName}`,
      prefill: { contact: '+' + who.mobile, name: who.name ?? undefined },
      notes: { shop: String(who.shopId) },
      theme: { color: '#0F4C81' },
      handler: async (resp: any) => {
        try { await finish(resp.razorpay_payment_id, resp.razorpay_signature); resolve(true); } catch (e: any) { onFail(e?.message ?? 'Payment could not be verified'); resolve(false); }
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rz.on('payment.failed', (resp: any) => onFail(resp?.error?.description ?? 'Payment failed'));
    rz.open();
  });
}
