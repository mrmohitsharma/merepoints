# Vyapar Point app (Android + iOS)

One Flutter app with a role switch. After OTP login a person can be:
- **Customer** (carpenter, painter, contractor…): points wallet across shops, My QR, history, nearby shops, the "Received" confirmation.
- **Shop owner / staff**: scan customer QR, add points from a bill or manually, redeem (cash, UPI, gift), offers and gifts, SMS, staff, reports.

The same mobile number can be a customer and work at one or more shops; **Settings › Switch account** moves between them.

## First run

Needs Flutter 3.24+ (`flutter --version`). From this folder:

```bash
./setup.sh
```

That generates the native Android/iOS projects (`flutter create`), applies the permissions this app needs (camera, location, UPI app links: see `tool/configure_platforms.dart`), installs packages, and runs `flutter analyze` and the tests.

Then start the API (`../api`, see its README) and run:

```bash
flutter run --dart-define=API_URL=http://10.0.2.2:3000/v1          # Android emulator
flutter run --dart-define=API_URL=http://192.168.1.20:3000/v1      # real phone on the same Wi-Fi
```

In development the server returns OTPs in the response and the app pre-fills them, so no SMS provider is needed to try it.

## Release builds

```bash
flutter build apk --release --dart-define=API_URL=https://api.yourdomain.in/v1     # Android
flutter build ipa --release --dart-define=API_URL=https://api.yourdomain.in/v1     # iOS (Mac + Apple developer account)
```

For the Play Store use `flutter build appbundle` and set up signing (`android/key.properties`).

**CI:** `.github/workflows/app.yml` runs analyze + tests, builds the Android APK (downloadable from the run) and compiles iOS on every push. Set the repo variable `API_URL` to your deployed API.

## Structure

```
lib/
  core/        api client (error codes, idempotency keys), session + role switch, theme, i18n, formatting, points formula
  widgets/     shared UI (async loader, busy button, cards, chips, stat tiles)
  features/
    auth/      language, mobile/Google login, OTP, role picker, customer sign-up, 4-step shop sign-up (GPS required)
    shop/      home, find customer (QR / mobile / quick add), add points, points added + reverse,
               redeem → pay → wait for Received (+ SMS OTP), customers, entries, settings, loyalty rules,
               staff, offers & gifts, message customers, reports + CSV
    customer/  home (wallet, 3 milestone tiles, shop cards, Received popup), My QR (rotates every minute),
               shop card, history, nearby shops, shop profile, profile, level-up
```

## Behaviour worth knowing

- **No double points on bad networks:** add-points sends an idempotency key per screen visit. Pressing again after a timeout returns the first result.
- **Received rule:** the shop's Pay screen polls the redemption every 3 s and moves on the moment the customer taps Received. The customer app checks for pending confirmations every 15 s and when it comes to the foreground.
- **Points preview:** `core/points_math.dart` mirrors the server formula exactly, and is covered by tests.
- **Languages:** English and Hindi strings are complete for the main flows. Tamil, Bengali, Kannada, Malayalam, Gujarati and Punjabi are selectable and fall back to English until their strings are added to `core/i18n.dart`.

## To finish before launch

| Item | Where |
|---|---|
| Push notifications (FCM) for "Did you receive?" | replace the 15 s poll in `customer_home_screen.dart` |
| Google sign-in | `login_screen.dart` `_google()` + server `googleVerifier` |
| Photo upload (logo, bill, gift) | currently a link field; add S3/GCS upload |
| Map view on Nearby | list works now; add `google_maps_flutter` + API key |
| Translations for 6 regional languages | `core/i18n.dart` |
| Mukta font (Hindi + English) | `pubspec.yaml` fonts section + `theme.dart` |
| App icon and splash | `flutter_launcher_icons` |
