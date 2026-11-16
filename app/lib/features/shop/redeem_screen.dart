import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'pay_screen.dart';

/// Redeem: Cash/UPI (enter points) or Gift (pick one). Points are held on the next step and only
/// deducted for good when the customer taps Received.
class RedeemScreen extends StatefulWidget {
  const RedeemScreen({super.key, required this.customer});
  final Map<String, dynamic> customer;
  @override
  State<RedeemScreen> createState() => _RedeemScreenState();
}

class _RedeemScreenState extends State<RedeemScreen> {
  int _tab = 0; // 0 cash/upi, 1 gift
  final _points = TextEditingController();
  late String _method = widget.customer['upiId'] != null ? 'upi' : 'cash';
  int? _giftId;

  late final Future<List<dynamic>> _data = Future.wait([context.read<ApiClient>().sget(''), context.read<ApiClient>().sget('gifts')]);

  int get _balance => asNum((widget.customer['atThisShop'] as Map)['balance']).toInt();

  Future<void> _create(Map<String, dynamic> cfg) async {
    final body = <String, dynamic>{'customerId': widget.customer['id']};
    if (_tab == 1) {
      if (_giftId == null) throw ApiException(400, 'GIFT', 'Pick a gift');
      body.addAll({'method': 'gift', 'giftId': _giftId});
    } else {
      final p = int.tryParse(_points.text);
      if (p == null || p <= 0) throw ApiException(400, 'POINTS', 'Enter points to redeem');
      body.addAll({'method': _method, 'points': p});
    }
    final r = await context.read<ApiClient>().spost('redemptions', body) as Map<String, dynamic>;
    if (!mounted) return;
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => PayScreen(redemptionId: '${r['redemptionId']}', created: r)));
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.customer;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Redeem points')),
      body: FutureBuilder<List<dynamic>>(
        future: _data,
        builder: (context, snap) {
          if (snap.hasError) return ErrorRetry(error: snap.error!, onRetry: () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => RedeemScreen(customer: c))));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final cfg = (snap.data![0] as Map<String, dynamic>)['loyalty'] as Map<String, dynamic>;
          final gifts = (snap.data![1] as List).cast<Map<String, dynamic>>().where((g) => g['visible'] == true).toList();
          final minR = asNum(cfg['minRedeemPoints']).toInt();
          final maxR = cfg['maxRedeemPoints'] == null ? _balance : asNum(cfg['maxRedeemPoints']).toInt().clamp(0, _balance);
          final pv = asNum(cfg['pointValueRupees']);
          final p = int.tryParse(_points.text) ?? 0;
          final canRedeem = _balance >= minR;
          return Column(children: [
            Expanded(
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: VP.blue, borderRadius: BorderRadius.circular(18)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Initials('${c['name']}', bg: Colors.white24, fg: Colors.white),
                      const SizedBox(width: 12),
                      Expanded(child: Text('${c['name'] ?? 'Customer'}', style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700))),
                    ]),
                    const SizedBox(height: 10),
                    const Text('Available at your shop', style: TextStyle(color: Colors.white70)),
                    Row(children: [
                      Text(pts(_balance), style: const TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800)),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: canRedeem ? const Color(0xFFD7F0E5) : VP.amberSoft, borderRadius: BorderRadius.circular(14)),
                        child: Text(canRedeem ? 'Can redeem ✓' : 'Needs ${pts(minR - _balance)} more', style: TextStyle(fontWeight: FontWeight.w700, color: canRedeem ? const Color(0xFF0B5A40) : VP.amberText)),
                      ),
                    ]),
                  ]),
                ),
                const SizedBox(height: 14),
                Segmented(labels: const ['Cash / UPI', 'Gift'], index: _tab, onChanged: (i) => setState(() => _tab = i)),
                const SizedBox(height: 16),
                if (_tab == 0) ...[
                  const Text('Points to redeem', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _points,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, children: [
                    for (final q in {minR, if (maxR >= 1000 && minR < 1000) 1000, maxR}.where((q) => q >= minR && q <= _balance))
                      ActionChip(label: Text(q == maxR ? 'Max ${pts(q)}' : pts(q)), onPressed: () => setState(() => _points.text = '$q')),
                  ]),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: VP.amberSoft, borderRadius: BorderRadius.circular(16)),
                    child: Row(children: [
                      const Expanded(child: Text('You pay the customer', style: TextStyle(fontSize: 16, color: Color(0xFF5C3A00)))),
                      Text('≈ ${rupees(p * pv)}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                    ]),
                  ),
                  const Padding(padding: EdgeInsets.only(top: 4), child: Text('Exact amount shown next (older points keep their value)', style: TextStyle(fontSize: 12, color: VP.muted))),
                  const SizedBox(height: 14),
                  const Text('Pay by', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
                  const SizedBox(height: 8),
                  ChoiceChips<String>(
                    options: {
                      if (cfg['payoutCash'] == true) 'cash': 'Cash',
                      if (cfg['payoutUpi'] == true && c['upiId'] != null) 'upi': 'UPI · ${c['upiId']}',
                    },
                    selected: {_method},
                    onTap: (m) => setState(() => _method = m),
                  ),
                  if (c['upiId'] == null) const Padding(padding: EdgeInsets.only(top: 6), child: InfoNote('Customer has not added a UPI ID, so pay in cash or give a gift.')),
                  const SizedBox(height: 10),
                  InfoNote('Your rules: minimum ${pts(minR)} points${cfg['maxRedeemPoints'] != null ? ' · maximum ${pts(asNum(cfg['maxRedeemPoints']))} per redemption' : ''}'),
                ] else ...[
                  if (gifts.isEmpty) const InfoNote('No gifts added yet. Add gifts in Settings › Offers & gifts.'),
                  for (final g in gifts)
                    Builder(builder: (context) {
                      final cost = asNum(g['points_cost']).toInt();
                      final inStock = asNum(g['stock']) > 0;
                      final afford = _balance >= cost;
                      final on = _giftId == g['id'];
                      final enabled = inStock && afford;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Opacity(
                          opacity: enabled ? 1 : 0.5,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: enabled ? () => setState(() => _giftId = g['id'] as int) : null,
                            child: Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(color: on ? VP.blueSoft : Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: on ? VP.blue : VP.line, width: on ? 2 : 1)),
                              child: Row(children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(12),
                                  child: g['photo_url'] != null
                                      ? Image.network('${g['photo_url']}', width: 64, height: 64, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const _GiftPh())
                                      : const _GiftPh(),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${g['name']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                                    Text('${pts(cost)} points', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: VP.blue)),
                                    Text(!inStock ? 'Out of stock' : !afford ? 'Needs ${pts(cost - _balance)} more points' : '${g['stock']} in stock',
                                        style: TextStyle(fontSize: 13, color: !inStock ? VP.red : !afford ? VP.muted : VP.green, fontWeight: FontWeight.w600)),
                                  ]),
                                ),
                                if (on) const Icon(Icons.check_circle, color: VP.blue),
                              ]),
                            ),
                          ),
                        ),
                      );
                    }),
                ],
              ]),
            ),
            BottomAction(
              note: 'Points are held now and deducted only when the customer taps Received',
              child: BusyButton(
                label: _tab == 1 ? 'Next: hand over gift' : 'Next: pay ${c['name']?.toString().split(' ').first ?? 'customer'}',
                color: VP.amber,
                textColor: VP.ink,
                onPressed: canRedeem ? () => _create(cfg) : null,
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class _GiftPh extends StatelessWidget {
  const _GiftPh();
  @override
  Widget build(BuildContext context) => Container(width: 64, height: 64, color: VP.ground, child: const Icon(Icons.card_giftcard, color: VP.muted));
}
