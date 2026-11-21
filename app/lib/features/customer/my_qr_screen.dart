import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/push.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/celebration.dart';
import '../../widgets/common.dart';

/// Rotating QR (new code every minute, so screenshots stop working). Shops scan it to add or redeem.
class MyQrScreen extends StatefulWidget {
  const MyQrScreen({super.key});
  @override
  State<MyQrScreen> createState() => _MyQrScreenState();
}

class _MyQrScreenState extends State<MyQrScreen> with WidgetsBindingObserver {
  String? _qr;
  DateTime? _expires;
  Object? _error;
  Timer? _tick;
  int _left = 60;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _fetch();
    _startWatching();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_expires == null) return;
      final left = _expires!.difference(DateTime.now()).inSeconds;
      setState(() => _left = left.clamp(0, 60));
      if (left <= 2) _fetch();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tick?.cancel();
    _watch?.cancel();
    super.dispose();
  }

  // ---- points arriving while this screen is open --------------------------------------------
  Timer? _watch;
  int? _lastId; // newest ledger entry we had seen when the screen opened
  bool _celebrating = false;
  bool _foreground = true;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => _foreground = state == AppLifecycleState.resumed;

  Future<void> _startWatching() async {
    try {
      final r = await context.read<ApiClient>().get('me/earned') as Map<String, dynamic>;
      _lastId = asNum(r['latestId']).toInt();
    } catch (_) {
      _lastId = null; // try again on the next tick
    }
    if (!mounted) return;
    _watch = Timer.periodic(const Duration(milliseconds: 2500), (_) => _checkEarned());
  }

  bool _checking = false;
  Future<void> _checkEarned() async {
    if (_checking || _celebrating || !_foreground || !mounted) return;
    _checking = true;
    try {
      final api = context.read<ApiClient>();
      if (_lastId == null) {
        final r = await api.get('me/earned') as Map<String, dynamic>;
        _lastId = asNum(r['latestId']).toInt();
        return;
      }
      final r = await api.get('me/earned?after=$_lastId') as Map<String, dynamic>;
      _lastId = asNum(r['latestId']).toInt();
      final items = (r['items'] as List).cast<Map<String, dynamic>>();
      if (items.isEmpty || !mounted) return;
      await _celebrate(items);
    } catch (_) {
      // Offline for a moment: the next tick tries again.
    } finally {
      _checking = false;
    }
  }

  /// Animated "points received" screen (sound + vibration come with it), then straight to the home screen.
  Future<void> _celebrate(List<Map<String, dynamic>> items) async {
    _celebrating = true;
    final total = items.fold<int>(0, (a, i) => a + asNum(i['points']).toInt());
    final shops = items.map((i) => '${i['shopName']}').toSet().toList();
    final line = shops.length == 1 ? 'from ${shops.first}' : 'from ${shops.length} shops';
    final nav = Navigator.of(context);
    final inbox = context.read<Inbox>();
    var done = false;
    void goHome() {
      if (done) return;
      done = true;
      nav.popUntil((r) => r.isFirst); // closes the celebration and this QR screen
      inbox.refreshUnread();
    }

    Timer(const Duration(seconds: 5), goHome); // hands-free: the customer is standing at the counter
    await showCelebration(context, points: total, ribbon: 'Points received!', line: line, button: 'Done');
    goHome();
  }

  bool _fetching = false;
  Future<void> _fetch() async {
    if (_fetching) return;
    _fetching = true;
    try {
      final r = await context.read<ApiClient>().get('me/qr') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _qr = r['qr'] as String;
        // Server clock decides; add a small margin so we refresh just before it rolls over.
        _expires = DateTime.parse('${r['expiresAt']}').toLocal();
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      _fetching = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
      backgroundColor: VP.blue,
      appBar: AppBar(backgroundColor: VP.blue, foregroundColor: Colors.white, title: Text(context.t('my_qr'), style: const TextStyle(color: Colors.white))),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(26)),
          child: Column(children: [
            Text(s.name ?? '', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            Text('+91 ${prettyMobile(s.mobile)}', style: const TextStyle(color: VP.muted)),
            const SizedBox(height: 14),
            AspectRatio(
              aspectRatio: 1,
              child: _qr == null
                  ? (_error != null ? ErrorRetry(error: _error!, onRetry: _fetch) : const Center(child: CircularProgressIndicator()))
                  : QrImageView(data: _qr!, padding: const EdgeInsets.all(8), backgroundColor: Colors.white, errorCorrectionLevel: QrErrorCorrectLevel.M),
            ),
            const SizedBox(height: 10),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.autorenew, size: 18, color: VP.green),
              const SizedBox(width: 6),
              Text('New code in 0:${_left.toString().padLeft(2, '0')} · screenshots won\'t work', style: const TextStyle(color: VP.green, fontWeight: FontWeight.w600)),
            ]),
          ]),
        ),
        const SizedBox(height: 20),
        const Text('Show this at any Mere Points shop', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w700)),
        const Text('to collect or redeem points', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 15)),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(14)),
          child: Text('Shop camera not working? Tell them your number ${prettyMobile(s.mobile)}', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 15)),
        ),
      ]),
    );
  }
}
