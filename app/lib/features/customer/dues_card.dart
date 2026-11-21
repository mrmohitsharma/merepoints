import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

String _day(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  return d == null ? '' : DateFormat('d MMM yyyy').format(d);
}

/// What the Site Expert owes this shop. Read-only: only the shop can add or clear dues.
/// Shows nothing when there are no dues (or if it cannot load).
class DuesCard extends StatefulWidget {
  const DuesCard({super.key, required this.shopId, required this.shopName});
  final int shopId;
  final String shopName;
  @override
  State<DuesCard> createState() => _DuesCardState();
}

class _DuesCardState extends State<DuesCard> {
  Map<String, dynamic>? _d;

  @override
  void initState() {
    super.initState();
    context.read<ApiClient>().get('me/dues/${widget.shopId}').then((r) {
      if (mounted) setState(() => _d = r as Map<String, dynamic>);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null || asNum(d['balanceRupees']) <= 0) return const SizedBox.shrink();
    final overdue = d['overdue'] == true;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: WhiteCard(
        color: overdue ? VP.redSoft : VP.amberSoft,
        onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => _DuesSheet(d: d, shopName: widget.shopName)),
        child: Row(children: [
          Icon(Icons.receipt_long_outlined, color: overdue ? VP.red : VP.amberText),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('You owe ${rupees(asNum(d['balanceRupees']))} to ${widget.shopName}', style: TextStyle(fontWeight: FontWeight.w800, color: overdue ? VP.red : VP.amberText)),
              Text(overdue ? 'Overdue · pay the shop and ask them to record it' : d['nextDueDate'] != null ? 'Promised by ${_day(d['nextDueDate'])} · tap to see details' : 'Tap to see details', style: const TextStyle(fontSize: 13, color: VP.muted)),
            ]),
          ),
          const Icon(Icons.chevron_right),
        ]),
      ),
    );
  }
}

class _DuesSheet extends StatelessWidget {
  const _DuesSheet({required this.d, required this.shopName});
  final Map<String, dynamic> d;
  final String shopName;
  @override
  Widget build(BuildContext context) {
    final entries = (d['entries'] as List).cast<Map<String, dynamic>>();
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      builder: (_, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 0, 16, 32), children: [
        Text('Dues at $shopName', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        Text(rupees(asNum(d['balanceRupees'])), style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800)),
        const Text('Only the shop can add or clear dues. If something looks wrong, speak to the shop.', style: TextStyle(color: VP.muted, fontSize: 13)),
        const SizedBox(height: 12),
        for (final e in entries)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(14)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(e['kind'] == 'due' ? Icons.north_east : Icons.south_west, color: e['kind'] == 'due' ? VP.red : VP.green, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text('${e['kind'] == 'due' ? 'Taken on credit' : 'Paid'} · ${_day(e['created_at'])}', style: const TextStyle(fontWeight: FontWeight.w700))),
                Text('${e['kind'] == 'due' ? '+' : '−'}${rupees(asNum(e['amount_rupees']))}', style: TextStyle(fontWeight: FontWeight.w800, color: e['kind'] == 'due' ? VP.red : VP.green)),
              ]),
              if ('${e['note'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${e['note']}')),
              if (e['kind'] == 'due' && e['due_date'] != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text('Promised by ${_day(e['due_date'])}', style: const TextStyle(fontSize: 13, color: VP.muted))),
              if (((e['photo_urls'] as List?) ?? const []).isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Wrap(spacing: 8, children: [
                    for (final u in (e['photo_urls'] as List).cast<String>())
                      GestureDetector(
                        onTap: () => showDialog<void>(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.network(u)))),
                        child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(u, width: 64, height: 64, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox(width: 64, height: 64))),
                      ),
                  ]),
                ),
            ]),
          ),
      ]),
    );
  }
}
