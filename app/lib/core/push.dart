import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api.dart';
import 'format.dart';

// Firebase settings come from the build, so no google-services.json file is needed:
//   --dart-define=FIREBASE_API_KEY=... --dart-define=FIREBASE_APP_ID=... --dart-define=FIREBASE_SENDER_ID=... --dart-define=FIREBASE_PROJECT_ID=...
// Without them push is simply off and notifications still arrive in the in-app inbox.
const _kKey = String.fromEnvironment('FIREBASE_API_KEY');
const _kAppId = String.fromEnvironment('FIREBASE_APP_ID');
const _kSender = String.fromEnvironment('FIREBASE_SENDER_ID');
const _kProject = String.fromEnvironment('FIREBASE_PROJECT_ID');

/// A push that arrived while the app was open.
class IncomingNotice {
  const IncomingNotice(this.title, this.body);
  final String title;
  final String body;
}

/// Site Expert's notification inbox state: unread badge, phone registration, and taps on a push.
class Inbox extends ChangeNotifier {
  Inbox(this.api);
  final ApiClient api;

  int unread = 0;
  /// Bumps when the person taps a push; the shell opens the inbox.
  final ValueNotifier<int> openInbox = ValueNotifier(0);
  /// Set when a push arrives with the app open; the shell shows a banner.
  final ValueNotifier<IncomingNotice?> foreground = ValueNotifier(null);

  bool get pushConfigured => _kKey.isNotEmpty && _kAppId.isNotEmpty && _kSender.isNotEmpty && _kProject.isNotEmpty;

  bool _started = false;
  String? _token;
  final List<StreamSubscription<dynamic>> _subs = [];

  Future<void> refreshUnread() async {
    try {
      final r = await api.get('me/notifications/unread-count') as Map<String, dynamic>;
      final n = asNum(r['unread']).toInt();
      if (n != unread) {
        unread = n;
        notifyListeners();
      }
    } catch (_) {}
  }

  /// Call once the Site Expert is signed in. Safe to call again.
  Future<void> start() async {
    unawaited(refreshUnread());
    if (_started || !pushConfigured) return;
    _started = true;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(options: const FirebaseOptions(apiKey: _kKey, appId: _kAppId, messagingSenderId: _kSender, projectId: _kProject));
      }
      final fm = FirebaseMessaging.instance;
      await fm.requestPermission(); // Android 13+ and iPhone ask here
      final t = await fm.getToken();
      if (t != null) await _register(t);
      _subs.add(fm.onTokenRefresh.listen(_register));
      _subs.add(FirebaseMessaging.onMessage.listen((m) {
        final id = int.tryParse('${m.data['notificationId'] ?? ''}');
        if (id != null) api.post('me/notifications/$id/delivered').catchError((_) {});
        foreground.value = IncomingNotice(m.notification?.title ?? '', m.notification?.body ?? '');
        refreshUnread();
      }));
      _subs.add(FirebaseMessaging.onMessageOpenedApp.listen(_tapped));
      final first = await fm.getInitialMessage();
      if (first != null) _tapped(first);
    } catch (e) {
      _started = false;
      debugPrint('Push setup failed: $e');
    }
  }

  Future<void> _register(String token) async {
    _token = token;
    try {
      await api.post('me/devices', {'token': token, 'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android'});
    } catch (_) {}
  }

  void _tapped(RemoteMessage m) {
    final id = int.tryParse('${m.data['notificationId'] ?? ''}');
    if (id != null) api.post('me/notifications/$id/open').catchError((_) {});
    openInbox.value++;
    refreshUnread();
  }

  /// Called before sign-out so this phone stops getting this person's notifications.
  Future<void> stop() async {
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    final t = _token;
    _token = null;
    _started = false;
    unread = 0;
    notifyListeners();
    if (t != null) {
      try {
        await api.post('me/devices/remove', {'token': t});
      } catch (_) {}
    }
  }
}
