import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/points_math.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/products.dart';
import 'dues_card.dart';
import 'history_screen.dart';
import 'product_detail_screen.dart';
import 'rewards_widgets.dart';
import 'shop_profile_screen.dart';

/// One shop's points card: balance & value at this shop, products (Redeem | Earn more), history here.
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
          final products = d['products'] as Map<String, dynamic>?;
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
                      Text('${rateText(shop)} back · ${d['mixedRates'] == true ? 'new points: ' : ''}1 point = ${rupees(asNum(shop['pointValueRupees']))} here', style: const TextStyle(color: Colors.white70, fontSize: 14)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 14),
                const Text('Available here', style: TextStyle(color: Colors.white70)),
                Text.rich(TextSpan(children: [
                  TextSpan(text: pts(asNum(d['points'])), style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w800)),
                  TextSpan(text: '  = ${rupees(asNum(d['valueRupees']))}', style: const TextStyle(color: Color(0xFFF2C14E), fontSize: 17, fontWeight: FontWeight.w600)),
                ])),
                if (d['mixedRates'] == true) const Text('Some points were earned at an older value, so each pays at its own value.', style: TextStyle(color: Colors.white70, fontSize: 12)),
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
            ShopPerksPanel(perks: d['perks'] as Map<String, dynamic>?),
            DuesCard(shopId: shopId, shopName: '${shop['name']}'),
            if (products != null) _ShopProducts(redeem: (products['redeem'] as List).cast<Map<String, dynamic>>(), earn: (products['earn'] as List).cast<Map<String, dynamic>>(), reload: reload),
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

/// Redeem | Earn more at this shop: 6 first, "See all N" shows the rest here.
class _ShopProducts extends StatefulWidget {
  const _ShopProducts({required this.redeem, required this.earn, required this.reload});
  final List<Map<String, dynamic>> redeem;
  final List<Map<String, dynamic>> earn;
  final Future<void> Function() reload;
  @override
  State<_ShopProducts> createState() => _ShopProductsState();
}

class _ShopProductsState extends State<_ShopProducts> {
  late String _kind = widget.redeem.isEmpty && widget.earn.isNotEmpty ? 'earn' : 'redeem';
  bool _all = false;

  @override
  Widget build(BuildContext context) {
    if (widget.redeem.isEmpty && widget.earn.isEmpty) return const SizedBox.shrink();
    final list = _kind == 'redeem' ? widget.redeem : widget.earn;
    final shown = _all ? list : list.take(6).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionTitle('Products at this shop',
          trailing: list.length > 6 && !_all ? TextButton(onPressed: () => setState(() => _all = true), child: Text('See all ${list.length}')) : null),
      KindTabs(kind: _kind, redeemCount: widget.redeem.length, earnCount: widget.earn.length, onChanged: (k) => setState(() {
            _kind = k;
            _all = false;
          })),
      const SizedBox(height: 10),
      if (shown.isEmpty)
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: InfoNote(_kind == 'redeem' ? 'No gifts listed here yet.' : 'No bonus products here yet.'))
      else
        ProductGrid(items: shown, showShop: false, onTap: (p) => ProductDetailScreen.open(context, p).then((_) => widget.reload())),
    ]);
  }
}
