import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import 'product_detail_screen.dart';
import 'shop_profile_screen.dart';

/// Home banner carousel, run from Super Admin. Slides every 4 s; no "Ad" label (as decided).
/// Views are counted once per banner per app session, taps every time; sent in small batches.
class AdCarousel extends StatefulWidget {
  const AdCarousel({super.key, required this.ads});
  final List<Map<String, dynamic>> ads;
  @override
  State<AdCarousel> createState() => _AdCarouselState();
}

class _AdCarouselState extends State<AdCarousel> {
  static final _viewed = <int>{}; // per app session
  final _page = PageController(viewportFraction: 0.92);
  final _pendingViews = <int>{};
  final _pendingTaps = <int>{};
  Timer? _auto;
  Timer? _flush;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _start();
    WidgetsBinding.instance.addPostFrameCallback((_) => _seen(0));
  }

  @override
  void didUpdateWidget(AdCarousel old) {
    super.didUpdateWidget(old);
    if (_index >= widget.ads.length) _index = 0;
  }

  void _start() {
    _auto?.cancel();
    if (widget.ads.length < 2) return;
    _auto = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!_page.hasClients || !mounted) return;
      final next = (_index + 1) % widget.ads.length;
      _page.animateToPage(next, duration: const Duration(milliseconds: 450), curve: Curves.easeOut);
    });
  }

  void _seen(int i) {
    if (i >= widget.ads.length) return;
    final id = asNum(widget.ads[i]['id']).toInt();
    if (_viewed.add(id)) {
      _pendingViews.add(id);
      _schedule();
    }
  }

  void _schedule() {
    _flush ??= Timer(const Duration(seconds: 3), _send);
  }

  Future<void> _send() async {
    _flush = null;
    if (_pendingViews.isEmpty && _pendingTaps.isEmpty) return;
    final body = {'views': _pendingViews.toList(), 'taps': _pendingTaps.toList()};
    _pendingViews.clear();
    _pendingTaps.clear();
    try {
      await context.read<ApiClient>().post('me/ads/events', body);
    } catch (_) {
      // stats are best-effort
    }
  }

  void _open(Map<String, dynamic> ad) {
    final id = asNum(ad['id']).toInt();
    _pendingTaps.add(id);
    _send();
    final o = ad['opens'] as Map<String, dynamic>?;
    if (o == null) return;
    final route = o['kind'] == 'product'
        ? MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: asNum(o['productId']).toInt()))
        : MaterialPageRoute(builder: (_) => ShopProfileScreen(shopId: asNum(o['shopId']).toInt()));
    Navigator.push(context, route);
  }

  @override
  void dispose() {
    _auto?.cancel();
    if (_flush != null) {
      _flush!.cancel();
      _send();
    }
    _page.dispose();
    super.dispose();
  }

  Color _hex(String? h) => Color(int.parse('FF${(h ?? '#0F4C81').replaceAll('#', '')}', radix: 16));

  @override
  Widget build(BuildContext context) {
    if (widget.ads.isEmpty) return const SizedBox.shrink();
    final hi = context.select<Session, String>((s) => s.language) == 'hi';
    return Column(children: [
      AspectRatio(
        aspectRatio: 1080 / (450 * 0.92), // page is 92% wide; keeps the 1080×450 banner shape
        child: Listener(
          onPointerDown: (_) => _auto?.cancel(),
          onPointerUp: (_) => _start(),
          child: PageView.builder(
            controller: _page,
            itemCount: widget.ads.length,
            onPageChanged: (i) {
              setState(() => _index = i);
              _seen(i);
            },
            itemBuilder: (_, i) {
              final ad = widget.ads[i];
              final title = (hi ? ad['titleHi'] : null) ?? ad['title'];
              final sub = (hi ? ad['subtitleHi'] : null) ?? ad['subtitle'];
              final img = ad['imageUrl'] as String?;
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Material(
                  color: _hex(ad['bgColor'] as String?),
                  borderRadius: BorderRadius.circular(16),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () => _open(ad),
                    child: img != null
                        // Banner already carries its own text.
                        ? Image.network(img, fit: BoxFit.cover, width: double.infinity, errorBuilder: (_, __, ___) => _TextBanner(title: '$title', sub: sub as String?))
                        : _TextBanner(title: '$title', sub: sub as String?, arrow: ad['opens'] != null),
                  ),
                ),
              );
            },
          ),
        ),
      ),
      if (widget.ads.length > 1)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 0; i < widget.ads.length; i++)
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == _index ? 18 : 6,
                height: 6,
                decoration: BoxDecoration(color: i == _index ? const Color(0xFF0F4C81) : const Color(0xFFCBD3DC), borderRadius: BorderRadius.circular(3)),
              ),
          ]),
        ),
    ]);
  }
}

class _TextBanner extends StatelessWidget {
  const _TextBanner({required this.title, this.sub, this.arrow = false});
  final String title;
  final String? sub;
  final bool arrow;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
        child: Row(children: [
          Expanded(
            child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800, height: 1.2)),
              if (sub != null && sub!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(sub!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white70, fontSize: 14)),
              ],
            ]),
          ),
          if (arrow) const CircleAvatar(radius: 16, backgroundColor: Colors.white24, child: Icon(Icons.arrow_forward, color: Colors.white, size: 18)),
        ]),
      );
}
