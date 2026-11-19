import type { Metadata } from 'next';
import Link from 'next/link';
import { H, LegalPage } from '@/components/site';
import { COMPANY as C } from '@/lib/company';

export const metadata: Metadata = { title: 'Refund and cancellation policy | Mere Points' };

export default function Refunds() {
  return (
    <LegalPage title="Refund and cancellation policy" toc={['What you pay for', 'Cancelling a plan', 'Refunds', 'Home-screen ads', 'Points are not refundable', 'How to ask for a refund']} intro={
      <p>This policy applies to payments Shops make to {C.legalName} for {C.brand}: monthly plans, SMS packs and Home-screen ads. Customers do not pay us anything. It is part of our <Link href="/terms/">Terms of service</Link>.</p>
    }>
      <H n={1}>What you pay for</H>
      <ul>
        <li><b>Monthly plan</b>: paid in advance for one month. It does not renew automatically.</li>
        <li><b>SMS pack</b>: a number of SMS added to your shop’s balance straight away.</li>
        <li><b>Home-screen ad</b>: a banner for a fixed number of days, shown after we approve it.</li>
      </ul>
      <p>All services are digital and delivered in the app and dashboard as soon as payment is confirmed (ads after approval). Nothing is shipped.</p>

      <H n={2}>Cancelling a plan</H>
      <p>Because plans do not renew automatically, you cancel simply by not paying for the next month. Your shop keeps full access until the end of the paid month, then has 7 days of grace, then becomes read-only: customers can still redeem the points they hold. You can also ask us to close your shop account at any time.</p>

      <H n={3}>Refunds</H>
      <table>
        <thead><tr><th>Situation</th><th>What we do</th></tr></thead>
        <tbody>
          <tr><td>Charged twice, or charged but the plan / SMS was not added</td><td>Full refund of the extra charge, or we add what you paid for</td></tr>
          <tr><td>A fault on our side stopped the Service for more than 3 days in a row in a paid month</td><td>Refund or credit for those days</td></tr>
          <tr><td>You paid for a month and changed your mind within 48 hours, with no bills added in that time</td><td>Full refund</td></tr>
          <tr><td>Part of a month already used</td><td>No refund; access continues to the end of the month</td></tr>
          <tr><td>SMS packs once SMS have been used</td><td>No refund for used SMS; unused SMS stay in your balance</td></tr>
          <tr><td>Account suspended for breaking the Terms</td><td>No refund</td></tr>
        </tbody>
      </table>

      <H n={4}>Home-screen ads</H>
      <ul>
        <li>You can cancel an ad request free of charge before paying.</li>
        <li>If we do not approve a paid ad, we refund the full amount.</li>
        <li>Once an approved ad has started, it is not refundable. If we pause or remove it for a reason that is our fault, we refund the unused days.</li>
      </ul>

      <H n={5}>Points are not refundable</H>
      <p>Points are rewards given by Shops to their Customers. They are not bought from us and have no cash value with us, so we do not refund or buy back points. Questions about redeeming points should go to the Shop that gave them; if a payout was not received, use <b>Not received yet</b> in the app.</p>

      <H n={6}>How to ask for a refund</H>
      <p>Email <a href={`mailto:${C.supportEmail}?subject=Refund request`}>{C.supportEmail}</a> from your registered email, or write with your shop name and the receipt number (it starts with MP). We reply within 2 working days. Approved refunds go back to the original payment method through Razorpay within 5 to 7 working days; your bank may take a little longer to show it.</p>
    </LegalPage>
  );
}
