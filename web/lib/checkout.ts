'use client';

import { inr } from './format';

declare global { interface Window { Cashfree?: (o: { mode: 'sandbox' | 'production' }) => { checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => Promise<{ error?: { message?: string }; paymentDetails?: unknown }> } } }

function loadCheckout(): Promise<void> {
  if (window.Cashfree) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load the payment window. Check your internet.'));
    document.body.appendChild(s);
  });
}

export type Order = { orderId: string; amountPaise: number; description: string; paymentSessionId: string | null; cashfreeEnv: 'production' | 'sandbox'; testMode: boolean };

/**
 * Opens Cashfree Checkout for an order made by the API (or a confirm box in test mode),
 * then calls finish(paymentId, signature), which should POST shop/billing/verify.
 * The server asks Cashfree whether the order was really paid, so the values passed on are only used in test mode.
 * Resolves false if the window was closed without paying.
 */
export async function payOrder(order: Order, _who: { shopName: string; shopId: number; mobile: string; name?: string | null },
  finish: (paymentId: string, signature: string) => Promise<void>, onFail: (msg: string) => void): Promise<boolean> {
  if (order.testMode) {
    if (!confirm(`TEST MODE (no real money)\n\nPay ${inr(order.amountPaise / 100)} for ${order.description}?`)) return false;
    await finish(`pay_test_${Date.now()}`, 'test');
    return true;
  }
  if (!order.paymentSessionId) { onFail('Could not start the payment. Please try again.'); return false; }
  await loadCheckout();
  const cf = window.Cashfree!({ mode: order.cashfreeEnv === 'sandbox' ? 'sandbox' : 'production' });
  const res = await cf.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: '_modal' });
  if (res.error) { onFail(res.error.message ?? 'Payment failed or was cancelled'); return false; }
  try { await finish('', ''); return true; } catch (e: any) { onFail(e?.message ?? 'Payment could not be verified'); return false; }
}
