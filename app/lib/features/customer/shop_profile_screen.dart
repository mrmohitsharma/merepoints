import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'shop_card_screen.dart';

class ShopProfileScreen extends StatelessWidget {
  const ShopProfileScreen({super.key, required this.shopId});
  final int shopId;

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(),
      body: AsyncView<Map<String, dynamic>>(
        load: () async => await api.get('discover/shops/$shopId') as Map<String, dynamic>,
        builder: (context, s, reload) {
          final offer = s['offer'] as Map<String, dynamic>?;
          final gifts = (s['gifts'] as List).cast<Map<String, dynamic>>();
          final ex = s['example'] as Map<String, dynamic>;
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            WhiteCard(
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  ShopLogo(name: '${s['name']}', url: s['logo_url'] as String?, size: 58),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${s['name']}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
                      Text('${s['address_line']}, ${s['city']}${s['landmark'] != null ? ' · ${s['landmark']}' : ''}', style: const TextStyle(color: VP.muted, fontSize: 14)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 10),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final c in (s['categories'] as List? ?? []))
                    Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2), decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(12)), child: Text('$c', style: const TextStyle(fontSize: 13))),
                ]),
                const SizedBox(height: 12),
                Row(children: [
                  if (s['phone'] != null) ...[
                    Expanded(child: FilledButton.tonalIcon(onPressed: () => launchUrl(Uri.parse('tel:${s['phone']}')), icon: const Icon(Icons.call), label: const Text('Call'))),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: FilledButton.tonalIcon(
                      onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${s['lat']},${s['lng']}'), mode: LaunchMode.externalApplication),
                      icon: const Icon(Icons.directions),
                      label: const Text('Directions'),
                    ),
                  ),
                ]),
              ]),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                Expanded(child: StatTile(label: 'You earn', value: '${asNum(s['rewardPercent'])}% in points', extra: '₹${pts(asNum(ex['billRupees']))} bill = ${pts(asNum(ex['points']))} pts')),
                const SizedBox(width: 10),
                Expanded(child: StatTile(label: 'Redeem from', value: '${pts(asNum(s['min_redeem_points']))} pts', extra: '1 point = ${rupees(asNum(s['pointValueRupees']))} here')),
              ]),
            ),
            if (offer != null)
              WhiteCard(
                margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                color: VP.amber,
                child: Row(children: [
                  Text('${asNum(offer['multiplier'])}x', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${offer['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      Text('${asNum(offer['multiplier'])}x points on every bill · till ${dayMonth(offer['endsAt'])}'),
                    ]),
                  ),
                ]),
              ),
            if (s['myPoints'] != null)
              Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: _MyCardButton(shopId: shopId, points: asNum(s['myPoints']).toInt())),
            if (gifts.isNotEmpty) ...[
              const SectionTitle('Gifts you can get'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Wrap(spacing: 10, runSpacing: 10, children: [
                  for (final g in gifts)
                    Container(
                      width: (MediaQuery.of(context).size.width - 52) / 3,
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        AspectRatio(
                          aspectRatio: 1.3,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: g['photo_url'] != null
                                ? Image.network('${g['photo_url']}', fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: VP.ground))
                                : Container(color: VP.ground, child: const Icon(Icons.card_giftcard, color: VP.muted)),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text('${g['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                        Text('${pts(asNum(g['points_cost']))} pts', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.blue, fontSize: 13)),
                      ]),
                    ),
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }
}

class _MyCardButton extends StatelessWidget {
  const _MyCardButton({required this.shopId, required this.points});
  final int shopId;
  final int points;
  @override
  Widget build(BuildContext context) => FilledButton(
        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopCardScreen(shopId: shopId))),
        child: Text('My card here · ${pts(points)} points'),
      );
}
