import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

const _shortCodes = {
  'earn_bill': 'BILL', 'earn_manual': 'MAN', 'reversal': 'REV', 'redeem_hold': 'OUT',
  'redeem_release': 'BACK', 'redeem_confirm': 'OK', 'expiry': 'EXP',
};

const ledgerLabels = {
  'earn_bill': 'Bill',
  'earn_manual': 'Manual',
  'reversal': 'Reversed',
  'redeem_hold': 'Redeem',
  'redeem_release': 'Returned',
  'redeem_confirm': 'Received',
  'expiry': 'Expired',
};

class LedgerRow extends StatelessWidget {
  const LedgerRow({super.key, required this.name, required this.sub, required this.points, required this.type, this.onTap});
  final String name;
  final String sub;
  final int points;
  final String type;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final plus = points > 0;
    final color = points == 0 ? VP.muted : plus ? VP.green : VP.red;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: WhiteCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        onTap: onTap,
        child: Row(children: [
          Container(
            width: 42, height: 42, alignment: Alignment.center,
            decoration: BoxDecoration(color: points == 0 ? VP.ground : plus ? VP.greenSoft : VP.redSoft, borderRadius: BorderRadius.circular(12)),
            child: Text(_shortCodes[type] ?? '•', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
              Text(sub, style: const TextStyle(fontSize: 13, color: VP.muted), overflow: TextOverflow.ellipsis),
            ]),
          ),
          Text(points == 0 ? '✓' : '${plus ? '+' : '−'}${pts(points.abs())}', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
        ]),
      ),
    );
  }
}

/// All entries at the shop, keyset-paged, with type filters. Owner and staff.
class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key, this.customerId, this.embedded = false});
  final int? customerId;
  final bool embedded;
  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  final _items = <Map<String, dynamic>>[];
  String? _next;
  bool _loading = false;
  bool _done = false;
  Object? _error;
  String _filter = 'all';
  final _scroll = ScrollController();

  static const _filters = {
    'all': 'All',
    'earn_bill,earn_manual': 'Earned',
    'redeem_hold': 'Redeemed',
    'reversal,redeem_release': 'Reversed',
  };

  @override
  void initState() {
    super.initState();
    _more();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _more();
    });
  }

  Future<void> _reset() async {
    setState(() {
      _items.clear();
      _next = null;
      _done = false;
    });
    await _more();
  }

  Future<void> _more() async {
    if (_loading || _done) return;
    setState(() => _loading = true);
    try {
      final r = await context.read<ApiClient>().sget('transactions', query: {
        'limit': 30,
        'before': _next,
        if (_filter != 'all') 'types': _filter,
        if (widget.customerId != null) 'customerId': widget.customerId,
      }) as Map<String, dynamic>;
      setState(() {
        _items.addAll((r['items'] as List).cast<Map<String, dynamic>>());
        _next = r['next'] as String?;
        _done = _next == null;
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = RefreshIndicator(
      onRefresh: _reset,
      child: ListView(controller: _scroll, padding: const EdgeInsets.only(bottom: 100), children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: ChoiceChips<String>(options: _filters, selected: {_filter}, onTap: (f) {
            _filter = f;
            _reset();
          }),
        ),
        if (_error != null && _items.isEmpty) ErrorRetry(error: _error!, onRetry: _more),
        for (final e in _items)
          LedgerRow(
            name: widget.customerId != null ? (ledgerLabels[e['type']] ?? '${e['type']}') + (e['bill_rupees'] != null ? ' ${rupees(asNum(e['bill_rupees']))}' : '') : '${e['customer_name']}',
            sub: [
              shortDate(e['created_at']),
              if (e['invoice_no'] != null) '${e['invoice_no']}',
              if (e['by_name'] != null) 'by ${e['by_name']}',
              if (e['reason'] != null && e['type'] != 'earn_bill') '${e['reason']}',
              '${e['public_id']}',
            ].join(' · '),
            points: asNum(e['points']).toInt(),
            type: '${e['type']}',
          ),
        if (_loading) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
        if (_done && _items.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No entries yet', style: TextStyle(color: VP.muted)))),
      ]),
    );
    if (widget.embedded) return list;
    return Scaffold(appBar: AppBar(title: const Text('All entries')), body: list);
  }
}
