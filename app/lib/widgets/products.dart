import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/i18n.dart';
import '../core/theme.dart';

/// Product photo with a calm placeholder (icon by kind) when there is no photo or it fails to load.
class ProductPhoto extends StatelessWidget {
  const ProductPhoto({super.key, required this.url, required this.kind, this.radius = 12, this.iconSize = 30});
  final String? url;
  final String kind;
  final double radius;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      color: kind == 'earn' ? VP.greenSoft : VP.blueSoft,
      child: Center(child: Icon(kind == 'earn' ? Icons.add_shopping_cart : Icons.card_giftcard, size: iconSize, color: kind == 'earn' ? VP.green : VP.blue)),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      // cacheWidth keeps decoded photos small in memory: grids show ~120 px tiles.
      child: url == null ? placeholder : Image.network(url!, fit: BoxFit.cover, width: double.infinity, height: double.infinity, cacheWidth: 480, errorBuilder: (_, __, ___) => placeholder),
    );
  }
}

/// One product in the 3-column grid (home, Explore › Products, shop card).
/// Redeem: points + progress + "You can take it" / "N more". Earn more: "+N pts per sheet".
class ProductTile extends StatelessWidget {
  const ProductTile({super.key, required this.p, this.onTap, this.showShop = true});
  final Map<String, dynamic> p;
  final VoidCallback? onTap;
  final bool showShop;

  @override
  Widget build(BuildContext context) {
    final redeem = p['kind'] == 'redeem';
    final shop = p['shop'] as Map<String, dynamic>?;
    final canTake = p['canTake'] == true;
    final cost = asNum(p['pointsCost']);
    final mine = asNum(p['myPoints']);
    final progress = redeem && cost > 0 ? (mine / cost).clamp(0.0, 1.0).toDouble() : 0.0;
    final brand = [p['brand'], p['category']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(7),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            AspectRatio(
              aspectRatio: 1,
              child: Stack(children: [
                Positioned.fill(child: ProductPhoto(url: p['photoUrl'] as String?, kind: '${p['kind']}', radius: 10)),
                if (redeem && p['lowStock'] == true)
                  Positioned(
                    left: 4, top: 4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(color: VP.redSoft, borderRadius: BorderRadius.circular(6)),
                      child: Text('Only ${p['stock']} left', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: VP.red)),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 5),
            if (brand.isNotEmpty) Text(brand, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: VP.muted)),
            Text('${p['name']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, height: 1.2)),
            const Spacer(),
            if (redeem) ...[
              Text('${pts(cost)} pts', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.blue, fontSize: 13)),
              const SizedBox(height: 3),
              ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: progress, minHeight: 4, color: canTake ? VP.green : VP.amber, backgroundColor: const Color(0xFFE6EAF0))),
              const SizedBox(height: 2),
              Text(canTake ? 'You can take it' : '${pts(asNum(p['needMore']))} more',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: canTake ? VP.green : VP.muted)),
            ] else
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(8)),
                child: Text('+${pts(asNum(p['bonusPoints']))} pts / ${p['unit'] ?? 'piece'}', maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: VP.green)),
              ),
            if (showShop && shop != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('${shop['name']}${p['km'] != null ? ' · ${p['km']} km' : ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: VP.muted)),
              ),
          ]),
        ),
      ),
    );
  }
}

/// Fixed 3-column grid that sits inside a ListView (no own scrolling).
class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.items, required this.onTap, this.showShop = true, this.padding = const EdgeInsets.symmetric(horizontal: 16)});
  final List<Map<String, dynamic>> items;
  final void Function(Map<String, dynamic>) onTap;
  final bool showShop;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Padding(
        padding: padding,
        child: GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 8, mainAxisSpacing: 8, childAspectRatio: showShop ? 0.52 : 0.58),
          itemCount: items.length,
          itemBuilder: (_, i) => ProductTile(p: items[i], showShop: showShop, onTap: () => onTap(items[i])),
        ),
      );
}

/// Redeem | Earn more pill tabs.
class KindTabs extends StatelessWidget {
  const KindTabs({super.key, required this.kind, required this.onChanged, this.redeemCount, this.earnCount});
  final String kind;
  final ValueChanged<String> onChanged;
  final int? redeemCount;
  final int? earnCount;

  @override
  Widget build(BuildContext context) {
    Widget tab(String k, String label, int? n) {
      final on = kind == k;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(k),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: BoxDecoration(color: on ? Colors.white : Colors.transparent, borderRadius: BorderRadius.circular(10),
                boxShadow: on ? const [BoxShadow(color: Color(0x14000000), blurRadius: 4, offset: Offset(0, 1))] : null),
            child: Text(n == null ? label : '$label · $n', textAlign: TextAlign.center,
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: on ? (k == 'earn' ? VP.green : VP.blue) : VP.muted)),
          ),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: const Color(0xFFE6EAF0), borderRadius: BorderRadius.circular(12)),
      child: Row(children: [tab('redeem', context.t('redeem_tab'), redeemCount), tab('earn', context.t('earn_more_tab'), earnCount)]),
    );
  }
}
