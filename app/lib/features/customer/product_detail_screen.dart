import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/products.dart';
import 'my_qr_screen.dart';
import 'shop_profile_screen.dart';

/// Product details only (no ordering in the app): what it is, what it costs in points or what it earns,
/// how close the customer is, and how to get it at the shop.
class ProductDetailScreen extends StatelessWidget {
  const ProductDetailScreen({super.key, required this.productId});
  final int productId;

  static Future<void> open(BuildContext context, Map<String, dynamic> p) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: asNum(p['id']).toInt())));

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Product')),
      body: AsyncView<Map<String, dynamic>>(
        load: () async => await api.get('me/products/$productId') as Map<String, dynamic>,
        builder: (context, p, reload) {
          final redeem = p['kind'] == 'redeem';
          final shop = p['shop'] as Map<String, dynamic>;
          final canTake = p['canTake'] == true;
          final brand = [p['brand'], p['category']].where((x) => x != null && '$x'.isNotEmpty).join(' · ');
          return ListView(padding: const EdgeInsets.only(bottom: 120), children: [
            AspectRatio(aspectRatio: 1.25, child: ProductPhoto(url: p['photoUrl'] as String?, kind: '${p['kind']}', radius: 0, iconSize: 64)),
            WhiteCard(
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (brand.isNotEmpty) Text(brand, style: const TextStyle(color: VP.muted, fontSize: 14)),
                Text('${p['name']}', style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
                if (p['mrpRupees'] != null) Text('MRP ${rupees(asNum(p['mrpRupees']))}', style: const TextStyle(color: VP.muted, fontSize: 14)),
                const SizedBox(height: 12),
                if (redeem) ...[
                  Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text('${pts(asNum(p['pointsCost']))} pts', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: VP.blue)),
                    const Spacer(),
                    Text('You have ${pts(asNum(p['myPoints']))} here', style: const TextStyle(color: VP.muted, fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(value: asNum(p['progress']).toDouble(), minHeight: 8, color: canTake ? VP.green : VP.amber, backgroundColor: const Color(0xFFE6EAF0)),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    canTake
                        ? 'You can take it now · ${pts(asNum(p['stock']))} in stock'
                        : '${pts(asNum(p['needMore']))} more points · about ${rupees(asNum(p['shoppingForNeedRupees']))} of shopping at ${shop['name']}',
                    style: TextStyle(fontWeight: FontWeight.w700, color: canTake ? VP.green : VP.amberText),
                  ),
                ] else ...[
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(12)),
                    child: Text('+${pts(asNum(p['bonusPoints']))} bonus points per ${p['unit'] ?? 'piece'}',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: VP.green)),
                  ),
                  const SizedBox(height: 8),
                  const Text('On top of your usual points for the bill. Ask the counter to tick this product when you buy.', style: TextStyle(color: VP.muted)),
                ],
                if (p['availableUntil'] != null) ...[
                  const SizedBox(height: 6),
                  Text('Available till ${dayMonth(p['availableUntil'])}', style: const TextStyle(color: VP.red, fontWeight: FontWeight.w600)),
                ],
              ]),
            ),
            WhiteCard(
              margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopProfileScreen(shopId: asNum(shop['id']).toInt()))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  ShopLogo(name: '${shop['name']}', url: shop['logoUrl'] as String?, size: 42),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${shop['name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                      Text('${shop['address']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: VP.muted, fontSize: 13)),
                    ]),
                  ),
                  const Icon(Icons.chevron_right, color: VP.muted),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  if (shop['phone'] != null) ...[
                    Expanded(child: FilledButton.tonalIcon(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)), onPressed: () => launchUrl(Uri.parse('tel:${shop['phone']}')), icon: const Icon(Icons.call), label: const Text('Call'))),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: FilledButton.tonalIcon(
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                      onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${shop['lat']},${shop['lng']}'), mode: LaunchMode.externalApplication),
                      icon: const Icon(Icons.directions),
                      label: const Text('Directions'),
                    ),
                  ),
                ]),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: InfoNote(redeem
                  ? 'To take it: go to the shop and show My QR. The shop gives the item and your points are used. Stock can change, so call first for costly items.'
                  : 'Buy it at the shop and show My QR. The counter adds the bonus with your bill.'),
            ),
          ]);
        },
      ),
      bottomNavigationBar: BottomAction(
        child: FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: VP.amber, foregroundColor: VP.ink),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MyQrScreen())),
          icon: const Icon(Icons.qr_code_2),
          label: const Text('Show My QR at the shop'),
        ),
      ),
    );
  }
}
