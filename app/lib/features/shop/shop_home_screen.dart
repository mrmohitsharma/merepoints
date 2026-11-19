import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/points_math.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'find_customer_screen.dart';
import 'offers_screen.dart';
import 'pay_screen.dart';
import 'transactions_screen.dart';

class ShopHomeScreen extends StatelessWidget {
  const ShopHomeScreen({super.key});

  Future<Map<String, dynamic>> _load(ApiClient api, bool owner) async {
    final results = await Future.wait([
      api.sget(''),
      owner ? api.sget('reports/dashboard') : Future.value(null),
      api.sget('offers'),
      api.sget('redemptions'),
      owner ? Future.value(null) : api.sget('transactions', query: {'limit': 8}),
    ]);
    return {
      'shop': results[0],
      'dash': results[1],
      'offer': (results[2] as List).cast<Map<String, dynamic>>().where((o) => o['status'] == 'live').firstOrNull,
      'open': (results[3] as List).cast<Map<String, dynamic>>(),
      'recent': results[4] == null ? null : (results[4] as Map)['items'],
    };
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    final role = context.watch<Session>().activeShop!;
    return Scaffold(
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          load: () => _load(api, role.isOwner),
          builder: (context, d, reload) {
            final shop = d['shop'] as Map<String, dynamic>;
            final loyalty = shop['loyalty'] as Map<String, dynamic>;
            final dash = d['dash'] as Map<String, dynamic>?;
            final offer = d['offer'] as Map<String, dynamic>?;
            final open = d['open'] as List<Map<String, dynamic>>;
            final billing = shop['billing'] as String?;
            return ListView(padding: const EdgeInsets.only(bottom: 100), children: [
              if (billing == 'grace' || billing == 'read_only')
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: InfoNote(
                    billing == 'read_only'
                        ? 'Your Vyapar Point plan has expired. Adding points and SMS are paused; payouts still work. Renew in Plan & billing on the web dashboard.'
                        : 'Your Vyapar Point plan payment is due. Renew in Plan & billing on the web dashboard to keep adding points.',
                    icon: Icons.warning_amber_rounded,
                    color: billing == 'read_only' ? VP.red : const Color(0xFF9A6400),
                    bg: billing == 'read_only' ? const Color(0xFFFDECEC) : const Color(0xFFFEF5E1),
                  ),
                ),
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
                child: Column(children: [
                  Row(children: [
                    ShopLogo(name: '${shop['name']}', url: shop['logo_url'] as String?),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${shop['name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                        Text('${role.isOwner ? 'Owner' : 'Staff'} · Loyalty ${rateText(loyalty)} · 1 pt = ${rupees(asNum(loyalty['pointValueRupees']))}',
                            style: const TextStyle(fontSize: 13, color: VP.muted)),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 14),
                  Row(children: [
                    Expanded(
                      child: _BigAction(
                        color: VP.blue, fg: Colors.white, icon: Icons.add_circle_outline, title: 'Add points', sub: 'From bill amount',
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FindCustomerScreen(purpose: FindPurpose.earn))).then((_) => reload()),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _BigAction(
                        color: VP.amber, fg: VP.ink, icon: Icons.payments_outlined, title: 'Redeem', sub: 'Pay out points',
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FindCustomerScreen(purpose: FindPurpose.redeem))).then((_) => reload()),
                      ),
                    ),
                  ]),
                ]),
              ),
              if (open.isNotEmpty) ...[
                const SizedBox(height: 10),
                for (final r in open.take(3))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: WhiteCard(
                      color: r['status'] == 'disputed' ? VP.redSoft : VP.amberSoft,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PayScreen(redemptionId: '${r['id']}'))).then((_) => reload()),
                      child: Row(children: [
                        Icon(r['status'] == 'disputed' ? Icons.report_problem_outlined : Icons.hourglass_top, color: r['status'] == 'disputed' ? VP.red : VP.amberText),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '${r['customer_name']} · ${rupees(asNum(r['value_rupees']))} · ${{'held': 'not paid yet', 'paid': 'waiting for Received', 'disputed': 'says not received'}[r['status']]}',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                        const Icon(Icons.chevron_right),
                      ]),
                    ),
                  ),
              ],
              if (offer != null) ...[
                const SizedBox(height: 10),
                WhiteCard(
                  color: VP.amber,
                  onTap: role.isOwner ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OffersScreen())) : null,
                  child: Row(children: [
                    Text('${asNum(offer['multiplier'])}x', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                    const SizedBox(width: 10),
                    Expanded(child: Text('${offer['name']} is live · ends ${dayMonth(offer['ends_at'])}', style: const TextStyle(fontWeight: FontWeight.w700))),
                    if (role.isOwner) const Text('Offers ›', style: TextStyle(fontWeight: FontWeight.w700)),
                  ]),
                ),
              ],
              if (dash != null) ...[
                const SectionTitle('Last 30 days'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: GridView.count(
                    crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: 2.2,
                    children: [
                      StatTile(label: 'Purchase value', value: rupees(asNum(dash['purchaseRupees']))),
                      StatTile(label: 'Customers', value: pts(asNum(dash['customers'])), extra: '+${dash['newCustomers']} new'),
                      StatTile(label: 'Points issued', value: pts(asNum(dash['pointsIssued'])), valueColor: VP.green),
                      StatTile(label: 'Points redeemed', value: pts(asNum(dash['pointsRedeemed'])), valueColor: VP.red),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                WhiteCard(
                  color: VP.blueSoft,
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('Outstanding (you owe customers)', style: TextStyle(fontSize: 13, color: Color(0xFF3C4856))),
                        Text(rupees(asNum((dash['outstanding'] as Map)['rupees'])), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: VP.blue)),
                      ]),
                    ),
                    Text('${pts(asNum((dash['outstanding'] as Map)['points']))} pts', style: const TextStyle(color: VP.muted)),
                  ]),
                ),
                const SectionTitle('Recent'),
                ...((dash['recent'] as List).cast<Map<String, dynamic>>().take(6).map((e) => LedgerRow(
                      name: '${e['customer']}', sub: '${professions[e['profession']] ?? ''} · ${shortDate(e['created_at'])}${e['by_name'] != null ? ' · by ${e['by_name']}' : ''}',
                      points: asNum(e['points']).toInt(), type: '${e['type']}',
                    ))),
              ] else if (d['recent'] != null) ...[
                const SectionTitle('My recent entries'),
                ...((d['recent'] as List).cast<Map<String, dynamic>>().map((e) => LedgerRow(
                      name: '${e['customer_name']}', sub: shortDate(e['created_at']), points: asNum(e['points']).toInt(), type: '${e['type']}',
                    ))),
              ],
            ]);
          },
        ),
      ),
    );
  }
}

class _BigAction extends StatelessWidget {
  const _BigAction({required this.color, required this.fg, required this.icon, required this.title, required this.sub, required this.onTap});
  final Color color;
  final Color fg;
  final IconData icon;
  final String title;
  final String sub;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: color,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Container(
            height: 112,
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Icon(icon, color: fg, size: 32),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: TextStyle(color: fg, fontSize: 20, fontWeight: FontWeight.w800)),
                Text(sub, style: TextStyle(color: fg, fontSize: 14)),
              ]),
            ]),
          ),
        ),
      );
}
