import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'transactions_screen.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});
  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  int _days = 30;
  final _key = GlobalKey<AsyncViewState<List<dynamic>>>();
  final _df = DateFormat('yyyy-MM-dd', 'en');

  ({String from, String to}) get _range {
    final now = DateTime.now();
    return (from: _df.format(now.subtract(Duration(days: _days - 1))), to: _df.format(now));
  }

  Future<void> _exportCsv() async {
    final r = _range;
    final csv = await context.read<ApiClient>().getRaw('shop/reports/transactions.csv', query: {'from': r.from, 'to': r.to}, shop: true);
    await Share.shareXFiles([XFile.fromData(utf8.encode(csv), mimeType: 'text/csv', name: 'mere-points-${r.from}-to-${r.to}.csv')], subject: 'Mere Points transactions');
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Reports'), actions: [
        TextButton.icon(
          onPressed: () async {
            try {
              await _exportCsv();
            } catch (e) {
              if (context.mounted) showError(context, e);
            }
          },
          icon: const Icon(Icons.download),
          label: const Text('Excel / CSV'),
        ),
      ]),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: ChoiceChips<int>(options: const {1: 'Today', 7: 'Week', 30: 'Month', 90: '3 months'}, selected: {_days}, onTap: (d) {
            setState(() => _days = d);
            _key.currentState?.reload();
          }),
        ),
        Expanded(
          child: AsyncView<List<dynamic>>(
            key: _key,
            load: () {
              final r = _range;
              final q = {'from': r.from, 'to': r.to};
              return Future.wait([
                api.sget('reports/dashboard', query: q),
                api.sget('reports/daily', query: q),
                api.sget('reports/top-customers'),
                api.sget('reports/staff', query: q),
              ]);
            },
            builder: (context, d, reload) {
              final dash = d[0] as Map<String, dynamic>;
              final daily = (d[1] as List).cast<Map<String, dynamic>>();
              final top = (d[2] as List).cast<Map<String, dynamic>>();
              final staff = (d[3] as List).cast<Map<String, dynamic>>();
              final out = dash['outstanding'] as Map<String, dynamic>;
              return ListView(padding: const EdgeInsets.only(top: 12, bottom: 100), children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: GridView.count(
                    crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: 2.1,
                    children: [
                      StatTile(label: 'Sales with points', value: rupees(asNum(dash['purchaseRupees']))),
                      StatTile(label: 'Repeat customers', value: '${dash['repeatRate']}%'),
                      StatTile(label: 'Bills', value: pts(asNum(dash['bills'])), extra: '+${dash['newCustomers']} new customers'),
                      StatTile(label: 'Redeemed', value: rupees(asNum(dash['valueRedeemedRupees'])), valueColor: VP.red),
                    ],
                  ),
                ),
                const SectionTitle('Points by day'),
                WhiteCard(child: _Bars(daily: daily)),
                const SizedBox(height: 10),
                WhiteCard(
                  color: VP.blueSoft,
                  child: Row(children: [
                    Expanded(child: Text('Issued ${pts(asNum(dash['pointsIssued']))} · Redeemed ${pts(asNum(dash['pointsRedeemed']))} · Expired ${pts(asNum(dash['pointsExpired']))}', style: const TextStyle(fontSize: 13))),
                    Text('Owed ${rupees(asNum(out['rupees']))}', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.blue)),
                  ]),
                ),
                const SectionTitle('Top customers'),
                WhiteCard(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Column(children: [
                    for (var i = 0; i < min(top.length, 10); i++)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading: Text('${i + 1}', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.muted, fontSize: 15)),
                        title: Text('${top[i]['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${professions[top[i]['profession']] ?? ''} · ${top[i]['visits']} visits · ${top[i]['visits_per_month']}/month'),
                        trailing: Text(rupees(asNum(top[i]['purchase_rupees'])), style: const TextStyle(fontWeight: FontWeight.w800)),
                      ),
                    if (top.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No customers yet', style: TextStyle(color: VP.muted))),
                  ]),
                ),
                if (staff.isNotEmpty) ...[
                  const SectionTitle('Staff activity'),
                  WhiteCard(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    child: Column(children: [
                      for (final s in staff)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          title: Text('${s['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${s['bills']} bills · ${s['manual_entries']} manual (${pts(asNum(s['manual_points']))} pts) · ${s['redemptions']} redeems · ${s['reversals']} reversed'),
                        ),
                    ]),
                  ),
                ],
                const SizedBox(height: 10),
                WhiteCard(
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TransactionsScreen())),
                  child: const Row(children: [Icon(Icons.list_alt, color: VP.blue), SizedBox(width: 10), Expanded(child: Text('All entries', style: TextStyle(fontWeight: FontWeight.w700))), Icon(Icons.chevron_right)]),
                ),
              ]);
            },
          ),
        ),
      ]),
    );
  }
}

/// Simple issued-vs-redeemed bars; no chart package needed.
class _Bars extends StatelessWidget {
  const _Bars({required this.daily});
  final List<Map<String, dynamic>> daily;
  @override
  Widget build(BuildContext context) {
    final maxV = daily.fold<num>(1, (m, d) => max(m, max(asNum(d['points_issued']), asNum(d['points_redeemed']))));
    return Column(children: [
      const Row(children: [
        _Legend(color: VP.blue, label: 'Issued'),
        SizedBox(width: 14),
        _Legend(color: VP.amber, label: 'Redeemed'),
      ]),
      const SizedBox(height: 10),
      SizedBox(
        height: 120,
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          for (final d in daily)
            Expanded(
              child: Tooltip(
                message: '${dayMonth(d['day'])}: +${pts(asNum(d['points_issued']))} / −${pts(asNum(d['points_redeemed']))}',
                child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Expanded(child: Container(height: max(2.0, 116 * asNum(d['points_issued']) / maxV), margin: const EdgeInsets.symmetric(horizontal: 0.5), color: VP.blue)),
                  Expanded(child: Container(height: max(2.0, 116 * asNum(d['points_redeemed']) / maxV), margin: const EdgeInsets.symmetric(horizontal: 0.5), color: VP.amber)),
                ]),
              ),
            ),
        ]),
      ),
      const SizedBox(height: 4),
      if (daily.isNotEmpty)
        Row(children: [Text(dayMonth(daily.first['day']), style: const TextStyle(fontSize: 12, color: VP.muted)), const Spacer(), Text(dayMonth(daily.last['day']), style: const TextStyle(fontSize: 12, color: VP.muted))]),
    ]);
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;
  @override
  Widget build(BuildContext context) => Row(children: [Container(width: 10, height: 10, color: color), const SizedBox(width: 4), Text(label, style: const TextStyle(fontSize: 13))]);
}
