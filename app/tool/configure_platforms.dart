// Run once after `flutter create` (see setup.sh). Adds the permissions and settings
// Vyapar Point needs to the generated Android and iOS projects. Safe to run again.
//
//   dart run tool/configure_platforms.dart
import 'dart:io';

void main() {
  _android();
  _ios();
  stdout.writeln('Platforms configured for Vyapar Point.');
}

void _patch(String path, String Function(String) fn) {
  final f = File(path);
  if (!f.existsSync()) {
    stderr.writeln('Missing $path. Run flutter create first.');
    exit(1);
  }
  final before = f.readAsStringSync();
  final after = fn(before);
  if (after != before) f.writeAsStringSync(after);
}

void _android() {
  _patch('android/app/src/main/AndroidManifest.xml', (s) {
    const perms = [
      'android.permission.INTERNET',
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
    ];
    for (final p in perms) {
      if (!s.contains(p)) s = s.replaceFirst('<application', '<uses-permission android:name="$p"/>\n    <application');
    }
    s = s.replaceFirst(RegExp(r'android:label="[^"]*"'), 'android:label="Vyapar Point"');
    // Android 11+ package visibility: let url_launcher open UPI apps, the dialer and maps.
    if (!s.contains('android:scheme="upi"')) {
      const q = '''
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="upi"/></intent>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="tel"/></intent>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
''';
      s = s.contains('<queries>') ? s.replaceFirst('<queries>', '<queries>\n$q') : s.replaceFirst('</manifest>', '    <queries>\n$q    </queries>\n</manifest>');
    }
    return s;
  });
  // Debug builds talk to a local API over plain http (10.0.2.2). Release builds stay https-only.
  _patch('android/app/src/debug/AndroidManifest.xml', (s) {
    if (s.contains('usesCleartextTraffic')) return s;
    return s.replaceFirst('</manifest>', '    <application android:usesCleartextTraffic="true"/>\n</manifest>');
  });
}

void _ios() {
  _patch('ios/Runner/Info.plist', (s) {
    final entries = <String, String>{
      'NSCameraUsageDescription': '<string>Scan your customers\' Vyapar Point QR code at the counter, and take product photos.</string>',
      'NSPhotoLibraryUsageDescription': '<string>Pick product photos and ad banners for your shop.</string>',
      'NSLocationWhenInUseUsageDescription': '<string>Set your shop location and show Vyapar Point shops near you.</string>',
      'LSApplicationQueriesSchemes': '<array><string>upi</string><string>phonepe</string><string>tez</string><string>gpay</string><string>paytmmp</string><string>tel</string></array>',
      'NSAppTransportSecurity': '<dict><key>NSAllowsLocalNetworking</key><true/></dict>',
    };
    for (final e in entries.entries) {
      if (!s.contains('<key>${e.key}</key>')) {
        s = s.replaceFirst('<dict>', '<dict>\n\t<key>${e.key}</key>\n\t${e.value}');
      }
    }
    s = s.replaceFirstMapped(RegExp(r'(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)'), (m) => '${m[1]}Vyapar Point${m[2]}');
    return s;
  });
  final podfile = File('ios/Podfile');
  if (podfile.existsSync()) {
    final p = podfile.readAsStringSync();
    final fixed = p.replaceFirst(RegExp(r"#?\s*platform :ios, '[\d.]+'"), "platform :ios, '13.0'");
    if (fixed != p) podfile.writeAsStringSync(fixed);
  }
}
