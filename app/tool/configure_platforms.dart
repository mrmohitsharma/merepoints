// Run once after `flutter create` (see setup.sh). Adds the permissions and settings
// Mere Points needs to the generated Android and iOS projects. Safe to run again.
//
//   dart run tool/configure_platforms.dart
import 'dart:io';

void main() {
  _android();
  _ios();
  stdout.writeln('Platforms configured for Mere Points.');
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
      'android.permission.POST_NOTIFICATIONS', // Android 13+: shop offers and updates
    ];
    for (final p in perms) {
      if (!s.contains(p)) s = s.replaceFirst('<application', '<uses-permission android:name="$p"/>\n    <application');
    }
    s = s.replaceFirst(RegExp(r'android:label="[^"]*"'), 'android:label="Mere Points"');
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
  // Older plugins (e.g. geocoding_android) compile against an old Android API while newer AndroidX libraries need 34+.
  // Raise it for every plugin module so the release build passes the AAR metadata check.
  final kts = File('android/build.gradle.kts');
  final groovy = File('android/build.gradle');
  if (kts.existsSync()) {
    final t = kts.readAsStringSync();
    if (!t.contains('MerePointsCompileSdk')) {
      kts.writeAsStringSync('''$t

// MerePointsCompileSdk: raise old plugin modules to a compileSdk the AndroidX libraries accept.
subprojects {
    if (name != "app") {
        val raise: Project.() -> Unit = { extensions.findByName("android")?.withGroovyBuilder { "compileSdkVersion"(36) } }
        if (state.executed) raise() else afterEvaluate { raise() }
    }
}
''');
    }
  } else if (groovy.existsSync()) {
    final t = groovy.readAsStringSync();
    if (!t.contains('MerePointsCompileSdk')) {
      groovy.writeAsStringSync('''$t

// MerePointsCompileSdk: raise old plugin modules to a compileSdk the AndroidX libraries accept.
subprojects { p ->
    if (p.name != 'app') {
        p.afterEvaluate { if (p.hasProperty('android')) { p.android { compileSdkVersion 36 } } }
    }
}
''');
    }
  }
  // Debug builds talk to a local API over plain http (10.0.2.2). Release builds stay https-only.
  _patch('android/app/src/debug/AndroidManifest.xml', (s) {
    if (s.contains('usesCleartextTraffic')) return s;
    return s.replaceFirst('</manifest>', '    <application android:usesCleartextTraffic="true"/>\n</manifest>');
  });
}

void _ios() {
  _patch('ios/Runner/Info.plist', (s) {
    final entries = <String, String>{
      'NSCameraUsageDescription': '<string>Scan your customers\' Mere Points QR code at the counter, and take product photos.</string>',
      'NSPhotoLibraryUsageDescription': '<string>Pick product photos and ad banners for your shop.</string>',
      'NSLocationWhenInUseUsageDescription': '<string>Set your shop location and show Mere Points shops near you.</string>',
      'LSApplicationQueriesSchemes': '<array><string>upi</string><string>phonepe</string><string>tez</string><string>gpay</string><string>paytmmp</string><string>tel</string></array>',
      'NSAppTransportSecurity': '<dict><key>NSAllowsLocalNetworking</key><true/></dict>',
    };
    for (final e in entries.entries) {
      if (!s.contains('<key>${e.key}</key>')) {
        s = s.replaceFirst('<dict>', '<dict>\n\t<key>${e.key}</key>\n\t${e.value}');
      }
    }
    // Google sign-in on iPhone needs the iOS OAuth client ID: GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com dart run tool/configure_platforms.dart
    final iosId = Platform.environment['GOOGLE_IOS_CLIENT_ID'];
    if (iosId != null && iosId.isNotEmpty && !s.contains('<key>GIDClientID</key>')) {
      final reversed = iosId.split('.').reversed.join('.');
      s = s.replaceFirst('<dict>', '<dict>\n\t<key>GIDClientID</key>\n\t<string>$iosId</string>\n\t<key>CFBundleURLTypes</key>\n\t<array><dict><key>CFBundleURLSchemes</key><array><string>$reversed</string></array></dict></array>');
    }
    s = s.replaceFirstMapped(RegExp(r'(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)'), (m) => '${m[1]}Mere Points${m[2]}');
    return s;
  });
  final podfile = File('ios/Podfile');
  if (podfile.existsSync()) {
    final p = podfile.readAsStringSync();
    final fixed = p.replaceFirst(RegExp(r"#?\s*platform :ios, '[\d.]+'"), "platform :ios, '13.0'");
    var out = fixed;
    // permission_handler only includes the permissions switched on here.
    if (!out.contains('PERMISSION_CAMERA')) {
      out = out.replaceFirst(
        'flutter_additional_ios_build_settings(target)',
        "flutter_additional_ios_build_settings(target)\n    target.build_configurations.each do |config|\n      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['\$(inherited)', 'PERMISSION_CAMERA=1', 'PERMISSION_PHOTOS=1']\n    end",
      );
    }
    if (out != p) podfile.writeAsStringSync(out);
  }
}
