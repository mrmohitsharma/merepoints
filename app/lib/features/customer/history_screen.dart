import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class HistoryRow extends StatelessWidget {
  const HistoryRow({super.key, required this.e, this.showShop = true});
  final Map<String, dynamic> e;
  final bool showShop;

  @override
  Widget build(BuildContext context) {
    final type = '${e['type']}';
    final points = asNum(e['points']).toInt();
    final bill = e['bill'] as Map<String, dynamic>?;
    final red = e['redemption'] as Map<String, dynamic>?;
    final shop = e['shop'] as Map<String, dynamic>;
    final String title;
    switch (type) {
      case 'earn_bill':
        title = 'Bill ${rupees(asNum(bill?['amountRupees']))}${bill?['offerBonus'] == true ? ' · offer bonus' : ''}';
      case 'earn_manual':
        title = '${'${e['reason'] ?? 'Bonus'}'.replaceAll('_', ' ')} (manual)';
      case 'redeem_hold':
        title = 'Redeemed · ${red?['method'] == 'gift' ? (e['reason'] ?? 'Gift') : '${'${red?['method'] ?? ''}'.toUpperCase()} ${rupees(asNum(e['valueRupees']))}'}';
      case 'redeem_release':
        title = 'Redemption cancelled · points back';
      case 'reversal':
        title = 'Entry reversed by shop';
      case 'expiry':
        title = 'Points expired';
      case 'admin_add':
        title = 'Added by Mere Points · ${e['reason'] ?? ''}';
      case 'admin_deduct':
        title = 'Taken by Mere Points · ${e['reason'] ?? ''}';
      default:
        title = type;
    }
    final status = red?['status'] as String?;
    final sub = [
      if (showShop) '${shop['name']}',
      shortDate(e['at']),
      if (type == 'redeem_hold' && status != null) {'held': 'not paid yet', 'paid': 'waiting for you', 'confirmed': 'you confirmed Received', 'disputed': 'under review', 'cancelled': 'cancelled'}[status] ?? status,
      if (e['reversedBy'] != null) 'reversed',
    ].join(' · ');
    final color = points > 0 ? VP.green : points < 0 ? VP.red : VP.muted;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: WhiteCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          if (showShop) ...[ShopLogo(name: '${shop['name']}', size: 40), const SizedBox(width: 10)],
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, decoration: e['reversedBy'] != null ? TextDecoration.lineThrough : null)),
              Text(sub, style: const TextStyle(fontSize: 13, color: VP.muted)),
              Text('${e['id']}', style: const TextStyle(fontSize: 11, color: VP.muted)),
            ]),
          ),
          Text('${points > 0 ? '+' : points < 0 ? '−' : ''}${pts(points.abs())}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color)),
        ]),
      ),
    );
  }
}

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, this.shopId, this.title});
  final int? shopId;
  final String? title;
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final _items = <Map<String, dynamic>>[];
  String? _next;
  bool _loading = false, _done = false;
  Object? _error;
  String? _kind;
  final _scroll = ScrollController();

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
      final r = await context.read<ApiClient>().get('me/history', query: {'limit': 30, 'before': _next, 'kind': _kind, 'shopId': widget.shopId}) as Map<String, dynamic>;
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
    return Scaffold(
      appBar: AppBar(title: Text(widget.title ?? context.t('history'))),
      body: RefreshIndicator(
        onRefresh: _reset,
        child: ListView(controller: _scroll, padding: const EdgeInsets.only(bottom: 100), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            child: ChoiceChips<String?>(options: const {null: 'All', 'earned': 'Earned', 'redeemed': 'Redeemed'}, selected: {_kind}, onTap: (k) {
              _kind = k;
              _reset();
            }),
          ),
          if (_error != null && _items.isEmpty) ErrorRetry(error: _error!, onRetry: _more),
          for (final e in _items) HistoryRow(e: e, showShop: widget.shopId == null),
          if (_loading) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
          if (_done && _items.isEmpty) const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('Nothing here yet', style: TextStyle(color: VP.muted)))),
        ]),
      ),
    );
  }
}
