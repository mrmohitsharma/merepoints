import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'history_screen.dart';
import 'shop_profile_screen.dart';

/// One shop's points card: balance & value at this shop, gifts with progress, history here.
class ShopCardScreen extends StatelessWidget {
  const ShopCardScreen({super.key, required this.shopId});
  final int shopId;

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Shop card'), actions: [
        TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopProfileScreen(shopId: shopId))), child: const Text('Shop info')),
      ]),
      body: AsyncView<Map<String, dynamic>>(
        load: () async => await api.get('me/cards/$shopId') as Map<String, dynamic>,
        builder: (context, d, reload) {
          final shop = d['shop'] as Map<String, dynamic>;
          final gifts = (d['gifts'] as List).cast<Map<String, dynamic>>();
          final history = (d['history'] as List).cast<Map<String, dynamic>>();
          return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: VP.blue, borderRadius: BorderRadius.circular(22)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  ShopLogo(name: '${shop['name']}', url: shop['logoUrl'] as String?, size: 50),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${shop['name']}', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                      Text('${asNum(shop['rewardPercent'])}% back · 1 point = ${rupees(asNum(shop['pointValueRupees']))} here', style: const TextStyle(color: Colors.white70, fontSize: 14)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 14),
                const Text('Available here', style: TextStyle(color: Colors.white70)),
                Text.rich(TextSpan(children: [
                  TextSpan(text: pts(asNum(d['points'])), style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800)),
                  TextSpan(text: '  = ${rupees(asNum(d['valueRupees']))}', style: const TextStyle(color: Color(0xFFF2C14E), fontSize: 17, fontWeight: FontWeight.w600)),
                ])),
                if (asNum(d['onHold']) > 0) Text('${pts(asNum(d['onHold']))} on hold for a redemption', style: const TextStyle(color: Color(0xFFF2C14E))),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: _MiniStat('Earned', pts(asNum(d['earned'])))),
                  const SizedBox(width: 10),
                  Expanded(child: _MiniStat('Redeemed', pts(asNum(d['redeemed'])))),
                ]),
              ]),
            ),
            const SizedBox(height: 10),
            WhiteCard(
              color: d['canRedeem'] == true ? VP.greenSoft : VP.amberSoft,
              child: Row(children: [
                Icon(d['canRedeem'] == true ? Icons.check_circle_outline : Icons.hourglass_bottom, color: d['canRedeem'] == true ? VP.green : VP.amberText),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    d['canRedeem'] == true ? 'You can redeem. Minimum ${pts(asNum(d['minRedeem']))} · show My QR at the shop' : '${pts(asNum(d['minRedeem']) - asNum(d['points']))} more points to redeem here',
                    style: TextStyle(fontWeight: FontWeight.w600, color: d['canRedeem'] == true ? const Color(0xFF0B5A40) : VP.amberText),
                  ),
                ),
              ]),
            ),
            if (gifts.isNotEmpty) ...[
              const SectionTitle('Gifts at this shop'),
              SizedBox(
                height: 186,
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  scrollDirection: Axis.horizontal,
                  itemCount: gifts.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 10),
                  itemBuilder: (_, i) {
                    final g = gifts[i];
                    final cost = asNum(g['points_cost']);
                    final progress = (asNum(d['points']) / cost).clamp(0.0, 1.0).toDouble();
                    return Container(
                      width: 130,
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: g['photo_url'] != null
                                ? Image.network('${g['photo_url']}', fit: BoxFit.cover, width: double.infinity, errorBuilder: (_, __, ___) => Container(color: VP.ground))
                                : Container(color: VP.ground, child: const Center(child: Icon(Icons.card_giftcard, color: VP.muted))),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text('${g['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                        Text('${pts(cost)} pts', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.blue, fontSize: 13)),
                        const SizedBox(height: 3),
                        ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: progress, minHeight: 5, color: g['canTake'] == true ? VP.green : VP.muted, backgroundColor: const Color(0xFFE6EAF0))),
                        Text(g['in_stock'] != true ? 'Out of stock' : g['canTake'] == true ? 'You can take it' : '${pts(asNum(g['needMore']))} more',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: g['canTake'] == true ? VP.green : VP.muted)),
                      ]),
                    );
                  },
                ),
              ),
            ],
            SectionTitle('History here', trailing: TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HistoryScreen(shopId: shopId, title: '${shop['name']}'))), child: const Text('See all'))),
            for (final e in history.take(10)) HistoryRow(e: e, showShop: false),
          ]);
        },
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w800)),
        ]),
      );
}
