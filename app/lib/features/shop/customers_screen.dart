import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'add_points_screen.dart';
import 'redeem_screen.dart';
import 'transactions_screen.dart';

class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});
  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  String _search = '';
  String? _profession;
  String _sort = 'points';
  Timer? _debounce;
  final _key = GlobalKey<AsyncViewState<List<dynamic>>>();

  void _reload() => _key.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Customers')),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Column(children: [
            TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name or mobile'),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 350), () {
                  _search = v.trim();
                  _reload();
                });
              },
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final e in {null: 'All', ...professions}.entries)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(e.value),
                      selected: _profession == e.key,
                      onSelected: (_) {
                        _profession = e.key;
                        _reload();
                        setState(() {});
                      },
                    ),
                  ),
              ]),
            ),
            Row(children: [
              const Text('Sorted by', style: TextStyle(color: VP.muted)),
              const SizedBox(width: 6),
              DropdownButton<String>(
                value: _sort,
                underline: const SizedBox(),
                items: const [DropdownMenuItem(value: 'points', child: Text('Most points')), DropdownMenuItem(value: 'recent', child: Text('Recent visit'))],
                onChanged: (v) {
                  _sort = v!;
                  _reload();
                  setState(() {});
                },
              ),
            ]),
          ]),
        ),
        Expanded(
          child: AsyncView<List<dynamic>>(
            key: _key,
            load: () async => await api.sget('customers', query: {'search': _search, 'profession': _profession, 'sort': _sort, 'limit': 100}) as List,
            builder: (context, list, reload) => list.isEmpty
                ? ListView(children: const [Padding(padding: EdgeInsets.all(40), child: Center(child: Text('No customers yet', style: TextStyle(color: VP.muted))))])
                : ListView.builder(
                    padding: const EdgeInsets.only(top: 10, bottom: 100),
                    itemCount: list.length,
                    itemBuilder: (_, i) {
                      final c = list[i] as Map<String, dynamic>;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: WhiteCard(
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => CustomerDetailScreen(customerId: c['id'] as int))).then((_) => reload()),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          child: Row(children: [
                            Initials('${c['name']}'),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('${c['name'] ?? prettyMobile(c['mobile'] as String?)}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                Text('${professions[c['profession']] ?? ''} · last visit ${dayMonth(c['last_visit_at'])}', style: const TextStyle(fontSize: 13, color: VP.muted)),
                              ]),
                            ),
                            Text(pts(asNum(c['balance_points'])), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: VP.blue)),
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

class CustomerDetailScreen extends StatelessWidget {
  const CustomerDetailScreen({super.key, required this.customerId});
  final int customerId;

  Future<void> _toggleBlock(BuildContext context, bool blocked, Future<void> Function() reload) async {
    String? reason;
    if (!blocked) {
      final ctrl = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Block this customer?'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('They will not be able to earn or redeem points at your shop until you unblock them.'),
            const SizedBox(height: 10),
            TextField(controller: ctrl, decoration: const InputDecoration(hintText: 'Reason (optional)')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: VP.red), onPressed: () => Navigator.pop(ctx, true), child: const Text('Block')),
          ],
        ),
      );
      if (ok != true) return;
      reason = ctrl.text.trim().isEmpty ? null : ctrl.text.trim();
    }
    try {
      await context.read<ApiClient>().spost('customers/$customerId/block', {'blocked': !blocked, if (reason != null) 'reason': reason});
      await reload();
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Customer')),
      body: AsyncView<Map<String, dynamic>>(
        load: () async => await api.sget('customers/$customerId') as Map<String, dynamic>,
        builder: (context, d, reload) {
          final c = d['customer'] as Map<String, dynamic>;
          // Shape expected by AddPoints/Redeem screens (same as customers/resolve).
          final asResolved = {
            'id': c['id'], 'name': c['name'], 'mobile': c['mobile'], 'profession': c['profession'], 'upiId': c['upi_id'],
            'atThisShop': {'balance': c['balance_points'], 'held': c['held_points'], 'firstVisit': false},
          };
          final blocked = c['blocked'] == true;
          final isOwner = context.read<Session>().activeShop?.isOwner == true;
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            if (blocked)
              Container(
                color: VP.redSoft,
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  const Icon(Icons.block, color: VP.red),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Blocked at your shop. No points can be added or redeemed.', style: const TextStyle(color: VP.red, fontWeight: FontWeight.w600))),
                ]),
              ),
            Container(
              color: Colors.white,
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                Row(children: [
                  Initials('${c['name']}', size: 54),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${c['name']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                      Text('${professions[c['profession']] ?? ''}${c['city'] != null ? ' · ${c['city']}' : ''} · since ${dayMonth(c['first_visit_at'])}', style: const TextStyle(color: VP.muted)),
                    ]),
                  ),
                  IconButton.filledTonal(onPressed: () => launchUrl(Uri.parse('tel:+${c['mobile']}')), icon: const Icon(Icons.call, color: VP.green)),
                ]),
                const SizedBox(height: 14),
                Row(children: [
                  Expanded(child: StatTile(label: 'Balance', value: pts(asNum(c['balance_points'])), valueColor: VP.blue, bg: VP.blueSoft)),
                  const SizedBox(width: 8),
                  Expanded(child: StatTile(label: 'Earned', value: pts(asNum(c['earned_points'])), valueColor: VP.green, bg: VP.greenSoft)),
                  const SizedBox(width: 8),
                  Expanded(child: StatTile(label: 'Redeemed', value: pts(asNum(c['redeemed_points'])), valueColor: VP.red, bg: VP.redSoft)),
                ]),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(12)),
                  child: Row(children: [
                    Expanded(child: Text('Total purchases ${rupees(asNum(c['purchase_rupees']))}', style: const TextStyle(fontWeight: FontWeight.w600))),
                    Text('${c['visits']} visits', style: const TextStyle(fontWeight: FontWeight.w600)),
                  ]),
                ),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: blocked ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => AddPointsScreen(customer: asResolved))).then((_) => reload()),
                      child: const Text('Add points'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: VP.amber, foregroundColor: VP.ink),
                      onPressed: blocked ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => RedeemScreen(customer: asResolved))).then((_) => reload()),
                      child: const Text('Redeem'),
                    ),
                  ),
                ]),
                if (isOwner) ...[
                  const SizedBox(height: 6),
                  TextButton.icon(
                    onPressed: () => _toggleBlock(context, blocked, reload),
                    icon: Icon(blocked ? Icons.lock_open : Icons.block, color: blocked ? VP.green : VP.red, size: 20),
                    label: Text(blocked ? 'Unblock customer' : 'Block customer', style: TextStyle(color: blocked ? VP.green : VP.red, fontWeight: FontWeight.w700)),
                  ),
                ],
              ]),
            ),
            const SectionTitle('History at your shop'),
            for (final e in ((d['history'] as Map)['items'] as List).cast<Map<String, dynamic>>())
              LedgerRow(
                name: '${ledgerLabels[e['type']] ?? e['type']}${e['bill_rupees'] != null ? ' ${rupees(asNum(e['bill_rupees']))}' : ''}${e['invoice_no'] != null ? ' · ${e['invoice_no']}' : ''}',
                sub: '${shortDate(e['created_at'])}${e['by_name'] != null ? ' · by ${e['by_name']}' : ''} · ${e['public_id']}',
                points: asNum(e['points']).toInt(),
                type: '${e['type']}',
              ),
          ]);
        },
      ),
    );
  }
}
