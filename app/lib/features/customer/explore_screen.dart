import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/products.dart';
import 'nearby_screen.dart';
import 'product_detail_screen.dart';

/// Bottom-menu "Explore": Shops | Products. Home's "See all" opens the Products tab.
class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key, required this.tab});

  /// 0 = Shops, 1 = Products. The shell sets it; this screen follows it.
  final ValueNotifier<int> tab;

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this, initialIndex: widget.tab.value);

  @override
  void initState() {
    super.initState();
    widget.tab.addListener(_follow);
    _tabs.addListener(() {
      if (!_tabs.indexIsChanging && widget.tab.value != _tabs.index) widget.tab.value = _tabs.index;
    });
  }

  void _follow() {
    if (_tabs.index != widget.tab.value) _tabs.animateTo(widget.tab.value);
  }

  @override
  void dispose() {
    widget.tab.removeListener(_follow);
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(context.t('explore')),
          bottom: TabBar(
            controller: _tabs,
            labelStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            tabs: const [Tab(text: 'Shops'), Tab(text: 'Products')],
          ),
        ),
        body: TabBarView(controller: _tabs, children: const [NearbyScreen(embedded: true), ProductsTab()]),
      );
}

/// Explore › Products. "My shops" by default; "Nearby" shows products at shops around the customer.
class ProductsTab extends StatefulWidget {
  const ProductsTab({super.key});
  @override
  State<ProductsTab> createState() => _ProductsTabState();
}

class _ProductsTabState extends State<ProductsTab> with AutomaticKeepAliveClientMixin {
  static const _page = 24;
  String _kind = 'redeem';
  String _scope = 'my';
  String? _category;
  bool _canTake = false;
  String _search = '';
  Position? _pos;
  String? _locError;

  final _items = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _cats = [];
  Map<String, dynamic>? _summary;
  int? _next = 0;
  bool _loading = false;
  Object? _error;
  int _gen = 0; // drops answers from older filter settings
  Timer? _debounce;
  final _scroll = ScrollController();

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600) _more();
    });
    _reset();
  }

  @override
  void dispose() {
    _scroll.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _reset() async {
    _gen++;
    setState(() {
      _items.clear();
      _next = 0;
      _error = null;
      _loading = false;
    });
    await _more();
  }

  Future<void> _more() async {
    if (_loading || _next == null) return;
    if (_scope == 'nearby' && _pos == null) {
      await _locate();
      if (_pos == null) return;
    }
    final gen = _gen;
    setState(() => _loading = true);
    try {
      final r = await context.read<ApiClient>().get('me/products', query: {
        'kind': _kind, 'scope': _scope, 'category': _category, 'search': _search, 'canTake': _canTake ? 'true' : null,
        'lat': _scope == 'nearby' ? _pos!.latitude : null, 'lng': _scope == 'nearby' ? _pos!.longitude : null, 'km': _scope == 'nearby' ? 10 : null,
        'limit': _page, 'offset': _next,
      }) as Map<String, dynamic>;
      if (!mounted || gen != _gen) return;
      setState(() {
        _items.addAll((r['items'] as List).cast<Map<String, dynamic>>());
        _next = r['next'] as int?;
        if (r['categories'] != null) _cats = (r['categories'] as List).cast<Map<String, dynamic>>();
        if (r['summary'] != null) _summary = r['summary'] as Map<String, dynamic>;
        _loading = false;
      });
    } catch (e) {
      if (mounted && gen == _gen) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _locate() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw 'Turn on location to see products near you';
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
      if (p == LocationPermission.denied || p == LocationPermission.deniedForever) throw 'Allow location to see products near you';
      _pos = await Geolocator.getLastKnownPosition() ?? await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium));
      _locError = null;
    } catch (e) {
      if (mounted) setState(() => _locError = '$e');
    }
  }

  void _set(VoidCallback f) {
    f();
    _reset();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final sm = _summary;
    final summaryText = sm == null
        ? ''
        : _scope == 'my'
            ? 'From my ${sm['shops']} shop${sm['shops'] == 1 ? '' : 's'}${_kind == 'redeem' ? ' · ${sm['canTake']} you can take now' : ''}'
            : '${sm['total']} products at ${sm['shops']} shop${sm['shops'] == 1 ? '' : 's'} within 10 km';
    return RefreshIndicator(
      onRefresh: _reset,
      child: ListView(controller: _scroll, padding: const EdgeInsets.only(bottom: 110), children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(0, 10, 0, 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search product or brand'),
                onChanged: (v) {
                  _debounce?.cancel();
                  _debounce = Timer(const Duration(milliseconds: 350), () => _set(() => _search = v.trim()));
                },
              ),
            ),
            const SizedBox(height: 10),
            KindTabs(kind: _kind, onChanged: (k) => _set(() {
                  _kind = k;
                  _category = null;
                  _canTake = false;
                })),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                ChoiceChip(label: const Text('My shops'), selected: _scope == 'my', onSelected: (_) => _set(() => _scope = 'my')),
                const SizedBox(width: 8),
                ChoiceChip(avatar: const Icon(Icons.near_me_outlined, size: 18), label: const Text('Nearby'), selected: _scope == 'nearby', onSelected: (_) => _set(() => _scope = 'nearby')),
                if (_kind == 'redeem') ...[
                  const SizedBox(width: 8),
                  FilterChip(label: const Text('Can take now'), selected: _canTake, onSelected: (v) => _set(() => _canTake = v)),
                ],
                const SizedBox(width: 8),
                Container(width: 1, height: 26, color: VP.line),
                for (final c in _cats) ...[
                  const SizedBox(width: 8),
                  ChoiceChip(label: Text('${c['name']}'), selected: _category == c['name'], onSelected: (on) => _set(() => _category = on ? '${c['name']}' : null)),
                ],
              ]),
            ),
          ]),
        ),
        if (summaryText.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
            child: InkWell(
              // The underlined line in the design: one tap jumps between My shops and Nearby.
              onTap: () => _set(() => _scope = _scope == 'my' ? 'nearby' : 'my'),
              child: Text.rich(TextSpan(style: const TextStyle(color: VP.muted, fontSize: 13.5), children: [
                TextSpan(text: '$summaryText · '),
                TextSpan(
                  text: _scope == 'my' ? 'switch to Nearby' : 'back to My shops',
                  style: const TextStyle(color: VP.blue, fontWeight: FontWeight.w700, decoration: TextDecoration.underline),
                ),
              ])),
            ),
          ),
        const SizedBox(height: 8),
        if (_scope == 'nearby' && _locError != null)
          ErrorRetry(error: _locError!, onRetry: _reset)
        else if (_error != null && _items.isEmpty)
          ErrorRetry(error: _error!, onRetry: _reset)
        else if (!_loading && _items.isEmpty)
          Padding(
            padding: const EdgeInsets.all(32),
            child: Text(
              _scope == 'my'
                  ? (_kind == 'redeem' ? 'Your shops have not listed gifts yet. Try Nearby.' : 'No bonus products at your shops yet. Try Nearby.')
                  : 'No products listed at shops near you yet.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: VP.muted),
            ),
          )
        else
          ProductGrid(items: _items, onTap: (p) => ProductDetailScreen.open(context, p)),
        if (_loading) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
      ]),
    );
  }
}
