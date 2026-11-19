#!/usr/bin/env bash
# One-time setup on a machine with Flutter installed (3.24 or newer).
# Generates the native Android/iOS projects, then applies Mere Points's permissions and settings.
set -euo pipefail
cd "$(dirname "$0")"

flutter --version
flutter create --platforms=android,ios --org in.merepoints --project-name mere_points .
dart run tool/configure_platforms.dart
flutter pub get
flutter analyze
flutter test

cat <<'MSG'

Done. Run the app:
  Android emulator (API on this machine):  flutter run --dart-define=API_URL=http://10.0.2.2:3000/v1
  Real phone on same Wi-Fi:                flutter run --dart-define=API_URL=http://<your-computer-ip>:3000/v1
  Production build:                        flutter build apk --release --dart-define=API_URL=https://api.yourdomain.in/v1
                                           flutter build ipa --release --dart-define=API_URL=https://api.yourdomain.in/v1   (Mac + Apple developer account)
MSG
