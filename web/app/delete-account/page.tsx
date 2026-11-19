import type { Metadata } from 'next';
import { H, LegalPage } from '@/components/site';
import { COMPANY as C } from '@/lib/company';

export const metadata: Metadata = { title: 'Delete your account and data | Mere Points' };

export default function DeleteAccount() {
  return (
    <LegalPage title="Delete your account and data" intro={<p>You can delete your {C.brand} account at any time, from the app or by asking us.</p>}>
      <H n={1}>In the app (customers)</H>
      <ul>
        <li>Open the {C.brand} app and tap <b>Profile</b>.</li>
        <li>Scroll down and tap <b>Delete my account</b>.</li>
        <li>Type <b>DELETE</b> and confirm. You are signed out straight away.</li>
      </ul>
      <p>Finish any payout that is in progress first (tap Received or Not received). Points you still hold at any shop are given up when you delete, so redeem them first if you want them.</p>

      <H n={2}>Shop owners</H>
      <p>To close a shop, write to us. Before we close it, the shop must pay out points its customers hold, or tell them by SMS. Staff can be removed by the owner in Staff.</p>

      <H n={3}>By email</H>
      <p>Email <a href={`mailto:${C.supportEmail}?subject=Delete my Mere Points account`}>{C.supportEmail}</a> with the subject “Delete my account” and the mobile number on the account. We confirm it is you with an OTP and delete it within 30 days.</p>

      <H n={4}>What is deleted and what is kept</H>
      <ul>
        <li><b>Deleted</b>: your name, mobile number, email, UPI ID, photo, city and work type, and your sign-in. Your mobile number can be used again later for a fresh account.</li>
        <li><b>Kept without your name</b>: bills, points and payout records, for up to 8 years, because shops and we must keep business and tax records under Indian law.</li>
      </ul>
      <p>See our <a href="/privacy/">Privacy policy</a> for details.</p>
    </LegalPage>
  );
}
