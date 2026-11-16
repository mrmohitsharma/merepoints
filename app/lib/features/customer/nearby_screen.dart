import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'shop_profile_screen.dart';

/// Every approved shop near the customer, sorted by distance. Category filter + name search.
class NearbyScreen extends StatefulWidget {
  const NearbyScreen({super.key});
  @override
  State<NearbyScreen> createState() => _NearbyScreenState();
}

class _NearbyScreenState extends State<NearbyScreen> {
  Position? _pos;
  String? _locError;
  String? _category;
  String _search = '';
  int _radius = 5;
  Timer? _debounce;
  final _key = GlobalKey<AsyncViewState<List<dynamic>>>();
  Map<String, String> _cats = {};

  @override
  void initState() {
    super.initState();
    _locate();
    context.read<ApiClient>().get('shops/categories').then((r) {
      if (mounted) setState(() => _cats = {for (final c in (r as List)) '${c['code']}': '${c['name']}'});
    }).catchError((_) {});
  }

  Future<void> _locate() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw 'Turn on location to see shops near you';
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
      if (p == LocationPermission.denied || p == LocationPermission.deniedForever) throw 'Allow location to see shops near you';
      final pos = await Geolocator.getLastKnownPosition() ?? await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium));
      setState(() {
        _pos = pos;
        _locError = null;
      });
      _key.currentState?.reload();
    } catch (e) {
      setState(() => _locError = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Shops near you')),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Column(children: [
            TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search shop name'),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), () {
                  _search = v.trim();
                  _key.currentState?.reload();
                });
              },
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final e in {null: 'All', ..._cats}.entries)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(label: Text(e.value), selected: _category == e.key, onSelected: (_) {
                      setState(() => _category = e.key);
                      _key.currentState?.reload();
                    }),
                  ),
              ]),
            ),
            Row(children: [
              const Text('Within', style: TextStyle(color: VP.muted)),
              const SizedBox(width: 6),
              DropdownButton<int>(
                value: _radius,
                underline: const SizedBox(),
                items: const [2, 5, 10, 25].map((r) => DropdownMenuItem(value: r, child: Text('$r km'))).toList(),
                onChanged: (v) {
                  setState(() => _radius = v!);
                  _key.currentState?.reload();
                },
              ),
            ]),
          ]),
        ),
        Expanded(
          child: _pos == null
              ? (_locError != null
                  ? ErrorRetry(error: _locError!, onRetry: _locate)
                  : const Center(child: CircularProgressIndicator()))
              : AsyncView<List<dynamic>>(
                  key: _key,
                  load: () async => await api.get('discover/shops', query: {
                    'lat': _pos!.latitude, 'lng': _pos!.longitude, 'radiusKm': _radius, 'category': _category, 'search': _search,
                  }) as List,
                  builder: (context, list, reload) => list.isEmpty
                      ? ListView(children: const [Padding(padding: EdgeInsets.all(40), child: Center(child: Text('No Vyapar Point shops here yet. Try a bigger distance.', textAlign: TextAlign.center, style: TextStyle(color: VP.muted))))])
                      : ListView.builder(
                          padding: const EdgeInsets.only(top: 10, bottom: 100),
                          itemCount: list.length,
                          itemBuilder: (_, i) {
                            final s = list[i] as Map<String, dynamic>;
                            final offer = s['offer'] as Map<String, dynamic>?;
                            final mine = s['myPoints'];
                            final tag = offer != null
                                ? '${asNum(offer['multiplier'])}x offer live${mine != null ? ' · you have ${pts(asNum(mine))}' : ''}'
                                : mine != null
                                    ? 'You have ${pts(asNum(mine))} points'
                                    : s['giftsFrom'] != null
                                        ? 'Gifts from ${pts(asNum(s['giftsFrom']))} pts'
                                        : 'New for you · join on first bill';
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: WhiteCard(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopProfileScreen(shopId: s['id'] as int))),
                                child: Row(children: [
                                  ShopLogo(name: '${s['name']}', url: s['logoUrl'] as String?),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text('${s['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                      Text('${(s['categories'] as List).take(2).map((c) => _cats[c] ?? c).join(' · ')} · ${asNum(s['rewardPercent'])}% back · 1 pt = ${rupees(asNum(s['pointValueRupees']))}',
                                          style: const TextStyle(fontSize: 13, color: VP.muted)),
                                      Text(tag, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: offer != null ? VP.amberText : mine != null ? VP.blue : VP.green)),
                                    ]),
                                  ),
                                  Text('${s['km']} km', style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
        ),
      ]),
    );
  }
}
