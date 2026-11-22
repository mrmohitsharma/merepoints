import 'dart:async';

import 'package:flutter/material.dart';
import '../../widgets/invite.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/products.dart';
import 'ad_carousel.dart';
import 'level_up_screen.dart';
import 'product_detail_screen.dart';
import 'my_qr_screen.dart';
import 'notifications_screen.dart';
import 'received_sheet.dart';
import 'rewards_widgets.dart';
import 'shop_card_screen.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key, required this.onFindShops, required this.onSeeAllProducts});
  final VoidCallback onFindShops;
  final VoidCallback onSeeAllProducts;
  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _home;
  Map<String, dynamic>? _rewards; // loaded on open and on pull-to-refresh, not on the 15-second poll
  Object? _error;
  // Products section: 2 rows (6) at a time, "Load more" adds 6.
  String _kind = 'redeem';
  final _products = <Map<String, dynamic>>[];
  int? _nextProducts = 0;
  int? _productsTotal;
  bool _productsLoading = false;
  int _productsGen = 0;
  Timer? _poll;
  final _shownSheets = <String>{};
  static const _store = FlutterSecureStorage();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    // Until push notifications are wired, check for "did you receive?" requests every 15 s.
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load(quiet: true));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _load(quiet: true);
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Only uses location if the customer already allowed it (never asks from Home).
  Future<Map<String, dynamic>> _where() async {
    try {
      final p = await Geolocator.checkPermission();
      if (p != LocationPermission.always && p != LocationPermission.whileInUse) return {};
      final pos = await Geolocator.getLastKnownPosition();
      return pos == null ? {} : {'lat': pos.latitude, 'lng': pos.longitude};
    } catch (_) {
      return {};
    }
  }

  Future<void> _loadProducts({bool reset = false}) async {
    if (reset) {
      _productsGen++;
      _products.clear();
      _nextProducts = 0;
      _productsLoading = false;
    }
    if (_productsLoading || _nextProducts == null) return;
    final gen = _productsGen;
    setState(() => _productsLoading = true);
    try {
      final r = await context.read<ApiClient>().get('me/products', query: {'kind': _kind, 'limit': 6, 'offset': _nextProducts}) as Map<String, dynamic>;
      if (!mounted || gen != _productsGen) return;
      setState(() {
        _products.addAll((r['items'] as List).cast<Map<String, dynamic>>());
        _nextProducts = r['next'] as int?;
        if (r['summary'] != null) _productsTotal = asNum((r['summary'] as Map)['total']).toInt();
        _productsLoading = false;
      });
    } catch (_) {
      if (mounted && gen == _productsGen) setState(() => _productsLoading = false);
    }
  }

  Future<void> _loadRewards() async {
    try {
      final r = await context.read<ApiClient>().get('me/rewards', query: {'limit': '3', 'offset': '0'}) as Map<String, dynamic>;
      if (mounted) setState(() => _rewards = r);
    } catch (_) {
      // The rest of the home screen works without it.
    }
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) {
      _loadProducts(reset: true);
      _loadRewards();
    }
    try {
      final h = await context.read<ApiClient>().get('me/home', query: await _where()) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _home = h;
        _error = null;
      });
      await _maybeShowReceived(h);
      await _maybeLevelUp(h);
    } catch (e) {
      if (!quiet && mounted) setState(() => _error = e);
    }
  }

  Future<void> _maybeShowReceived(Map<String, dynamic> h) async {
    final pending = (h['pending'] as List).cast<Map<String, dynamic>>().where((p) => p['status'] == 'paid' && !_shownSheets.contains(p['id'])).toList();
    if (pending.isEmpty || !mounted || ModalRoute.of(context)?.isCurrent != true) return;
    final p = pending.first;
    _shownSheets.add('${p['id']}');
    await showReceivedSheet(context, p);
    if (mounted) _load(quiet: true);
  }

  Future<void> _maybeLevelUp(Map<String, dynamic> h) async {
    final ms = h['milestones'] as Map<String, dynamic>;
    final current = ms['current'] as String?;
    if (current == null) return;
    final seen = await _store.read(key: 'seen_level');
    if (seen == null) {
      await _store.write(key: 'seen_level', value: current); // first launch: don't celebrate old levels
      return;
    }
    if (seen != current && mounted && ModalRoute.of(context)?.isCurrent == true) {
      await _store.write(key: 'seen_level', value: current);
      final tiles = (ms['tiles'] as List).cast<Map<String, dynamic>>();
      final tile = tiles.where((t) => t['name'] == current).firstOrNull;
      final next = tiles.where((t) => t['state'] == 'next').firstOrNull;
      if (!mounted) return;
      Navigator.push(context, MaterialPageRoute(fullscreenDialog: true, builder: (_) => LevelUpScreen(level: tile ?? {'name': current, 'perks': []}, next: next, basis: '${ms['basis']}')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final h = _home;
    if (h == null) {
      return Scaffold(body: _error != null ? ErrorRetry(error: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()));
    }
    final ms = h['milestones'] as Map<String, dynamic>;
    final cards = (h['cards'] as List).cast<Map<String, dynamic>>();
    final offerCard = cards.where((c) => c['offer'] != null).firstOrNull;
    final pendingHeld = (h['pending'] as List).cast<Map<String, dynamic>>();
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 100), children: [
          Container(
            color: VP.blue,
            padding: EdgeInsets.fromLTRB(18, MediaQuery.of(context).padding.top + 14, 18, 60),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Namaste,', style: TextStyle(color: Colors.white70, fontSize: 15)),
                  Text(s.name ?? '', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700)),
                ]),
              ),
              InviteButton(senderName: s.name ?? 'Mere Points', light: true),
              const SizedBox(width: 6),
              const NotificationBell(),
              if (ms['current'] != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                  decoration: BoxDecoration(color: const Color(0xFFF2C14E), borderRadius: BorderRadius.circular(14)),
                  child: Text('${ms['current']}'.toUpperCase(), style: const TextStyle(color: Color(0xFF4A3200), fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.5)),
                ),
            ]),
          ),
          Transform.translate(
            offset: const Offset(0, -44),
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: const [BoxShadow(color: Color(0x1F0F4C81), blurRadius: 20, offset: Offset(0, 6))]),
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${context.t('total_points')} · ${h['shopsCount']} shops', style: const TextStyle(color: VP.muted, fontSize: 14)),
                      Text(pts(asNum(h['totalPoints'])), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, height: 1.1)),
                    ]),
                  ),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: VP.amber, foregroundColor: VP.ink, minimumSize: const Size(0, 52), padding: const EdgeInsets.symmetric(horizontal: 14)),
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MyQrScreen())),
                    icon: const Icon(Icons.qr_code_2),
                    label: Text(context.t('my_qr')),
                  ),
                ]),
                const Divider(height: 26),
                MilestoneTiles(ms: ms),
              ]),
            ),
          ),
          Transform.translate(
            offset: const Offset(0, -32),
            child: Column(children: [
              for (final p in pendingHeld.where((p) => p['status'] == 'paid'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: WhiteCard(
                    color: VP.greenSoft,
                    onTap: () => showReceivedSheet(context, p).then((_) => _load(quiet: true)),
                    child: Row(children: [
                      const Icon(Icons.payments_outlined, color: VP.green),
                      const SizedBox(width: 10),
                      Expanded(child: Text('${p['shop_name']} says they paid ${p['method'] == 'gift' ? p['gift_name'] : rupees(asNum(p['value_rupees']))}. Did you receive it?', style: const TextStyle(fontWeight: FontWeight.w600))),
                      const Icon(Icons.chevron_right, color: VP.green),
                    ]),
                  ),
                ),
              if (offerCard != null)
                WhiteCard(
                  color: VP.navy,
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopCardScreen(shopId: offerCard['shopId'] as int))),
                  child: Row(children: [
                    Text('${asNum((offerCard['offer'] as Map)['multiplier'])}x', style: const TextStyle(color: Color(0xFFF2C14E), fontSize: 18, fontWeight: FontWeight.w800)),
                    const SizedBox(width: 10),
                    Expanded(child: Text('${offerCard['name']} · ${(offerCard['offer'] as Map)['name']} till ${dayMonth((offerCard['offer'] as Map)['endsAt'])}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600))),
                    const Icon(Icons.chevron_right, color: Colors.white),
                  ]),
                ),
              RewardsSection(data: _rewards, onBack: _loadRewards),
              SectionTitle(context.t('my_shop_cards'), trailing: TextButton(onPressed: widget.onFindShops, child: Text(context.t('find_shops')))),
              if (cards.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: InfoNote('No points yet. Show My QR at any Mere Points shop when you buy, and your points card appears here.', icon: Icons.qr_code_2),
                ),
              for (final c in cards)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: WhiteCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopCardScreen(shopId: c['shopId'] as int))).then((_) => _load(quiet: true)),
                    child: Row(children: [
                      ShopLogo(name: '${c['name']}', url: c['logoUrl'] as String?, size: 44),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${c['name']}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                          _CardNote(card: c),
                        ]),
                      ),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(pts(asNum(c['points'])), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: VP.blue)),
                        Text(c['mixedRates'] == true ? 'worth ${rupees(asNum(c['valueRupees']))}' : '1 pt = ${rupees(asNum(c['pointValueRupees']))}', style: const TextStyle(fontSize: 11, color: VP.muted)),
                      ]),
                    ]),
                  ),
                ),
              // Banner carousel sits between the shop cards and the products.
              if ((h['ads'] as List?)?.isNotEmpty == true)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: AdCarousel(ads: (h['ads'] as List).cast<Map<String, dynamic>>()),
                ),
              if (cards.isNotEmpty) ...[
                SectionTitle(context.t('products_at_my_shops'), trailing: TextButton(onPressed: widget.onSeeAllProducts, child: const Text('See all'))),
                KindTabs(kind: _kind, onChanged: (k) {
                  if (k == _kind) return;
                  setState(() => _kind = k);
                  _loadProducts(reset: true);
                }),
                const SizedBox(height: 10),
                if (_products.isEmpty && !_productsLoading)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    child: InfoNote(_kind == 'redeem' ? 'Your shops have not listed gifts yet.' : 'No bonus products at your shops yet.'),
                  )
                else
                  ProductGrid(items: _products, onTap: (p) => ProductDetailScreen.open(context, p).then((_) => _load(quiet: true))),
                if (_productsLoading) const Padding(padding: EdgeInsets.all(14), child: Center(child: CircularProgressIndicator())),
                if (_nextProducts != null && !_productsLoading && _products.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: OutlinedButton(onPressed: () => _loadProducts(), child: Text(context.t('load_more'))),
                  ),
                if (_productsTotal != null && _products.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Center(child: Text('Showing ${_products.length} of $_productsTotal', style: const TextStyle(color: VP.muted, fontSize: 13))),
                  ),
              ],
            ]),
          ),
        ]),
      ),
    );
  }
}

class _CardNote extends StatelessWidget {
  const _CardNote({required this.card});
  final Map<String, dynamic> card;
  @override
  Widget build(BuildContext context) {
    final exp = card['expiring'] as Map<String, dynamic>?;
    if (exp != null) return Text('${pts(asNum(exp['points']))} points expire on ${dayMonth(exp['on'])}', style: const TextStyle(fontSize: 13, color: VP.red, fontWeight: FontWeight.w600));
    if (asNum(card['onHold']) > 0) return Text('${pts(asNum(card['onHold']))} on hold for a redemption', style: const TextStyle(fontSize: 13, color: VP.amberText, fontWeight: FontWeight.w600));
    if (card['canRedeem'] == true) {
      final gift = card['cheapestAffordableGift'];
      return Text(gift != null ? 'Can redeem now · gifts from ${pts(asNum(gift))} pts' : 'Can redeem now · ${rupees(asNum(card['valueRupees']))}', style: const TextStyle(fontSize: 13, color: VP.green, fontWeight: FontWeight.w600));
    }
    return Text('${pts(asNum(card['toRedeem']))} more to redeem', style: const TextStyle(fontSize: 13, color: VP.muted));
  }
}

/// Three tiles from the admin-configured milestones: last crossed, NEXT (with progress), the one after.
class MilestoneTiles extends StatelessWidget {
  const MilestoneTiles({super.key, required this.ms});
  final Map<String, dynamic> ms;

  Color _hex(String? h) => Color(int.parse('FF${(h ?? '#9AA6B4').replaceAll('#', '')}', radix: 16));

  @override
  Widget build(BuildContext context) {
    final tiles = (ms['tiles'] as List).cast<Map<String, dynamic>>();
    final unit = ms['basis'] == 'rupees' ? '₹' : '';
    String amt(dynamic v) => '$unit${pts(asNum(v))}';
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Text(context.t('my_milestones'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const Spacer(),
        Text('${amt(ms['earnedSoFar'])} ${ms['basis'] == 'rupees' ? 'earned' : 'pts earned'} so far', style: const TextStyle(fontSize: 12, color: VP.muted)),
      ]),
      const SizedBox(height: 10),
      IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (var i = 0; i < tiles.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(
              flex: tiles[i]['state'] == 'next' ? 5 : 4,
              child: switch (tiles[i]['state']) {
                'next' => Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: VP.blue, borderRadius: BorderRadius.circular(14), boxShadow: const [BoxShadow(color: Color(0x400F4C81), blurRadius: 12, offset: Offset(0, 4))]),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(context.t('next'), style: const TextStyle(color: Color(0xFFF2C14E), fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                      Text('${tiles[i]['name']}', style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(value: asNum(tiles[i]['progress']).toDouble(), minHeight: 6, color: VP.amber, backgroundColor: Colors.white24),
                      ),
                      const SizedBox(height: 4),
                      Text('${amt(tiles[i]['toGo'])} ${context.t('to_go')} · ${amt(tiles[i]['threshold'])}', style: const TextStyle(color: Colors.white, fontSize: 12)),
                    ]),
                  ),
                'crossed' => Container(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
                    decoration: BoxDecoration(color: const Color(0xFFFFF6DB), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFF2C14E))),
                    child: Column(children: [
                      CircleAvatar(radius: 17, backgroundColor: _hex(tiles[i]['color'] as String?), child: const Icon(Icons.check, color: Colors.white, size: 18)),
                      const SizedBox(height: 4),
                      Text('${tiles[i]['name']}', style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF6B4A00))),
                      Text('${amt(tiles[i]['threshold'])} · ${context.t('crossed')}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: Color(0xFF6B4A00))),
                    ]),
                  ),
                _ => Container(
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
                    decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFCBD3DC))),
                    child: Column(children: [
                      const CircleAvatar(radius: 17, backgroundColor: Color(0xFFE6EAF0), child: Icon(Icons.lock_outline, color: VP.muted, size: 16)),
                      const SizedBox(height: 4),
                      Text('${tiles[i]['name']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF3C4856))),
                      Text(amt(tiles[i]['threshold']), style: const TextStyle(fontSize: 11, color: VP.muted)),
                    ]),
                  ),
              },
            ),
          ],
        ]),
      ),
    ]);
  }
}
