import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'find_customer_screen.dart';

class PointsAddedScreen extends StatefulWidget {
  const PointsAddedScreen({super.key, required this.result, required this.customer, this.bill});
  final Map<String, dynamic> result;
  final Map<String, dynamic> customer;
  final Map<String, String>? bill;
  @override
  State<PointsAddedScreen> createState() => _PointsAddedScreenState();
}

class _PointsAddedScreenState extends State<PointsAddedScreen> {
  bool _reversed = false;

  Future<void> _reverse() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController(text: 'Wrong entry');
        return AlertDialog(
          title: const Text('Reverse this entry?'),
          content: TextField(controller: c, decoration: const InputDecoration(labelText: 'Reason')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: VP.red, minimumSize: const Size(0, 44)), onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Reverse')),
          ],
        );
      },
    );
    if (reason == null || reason.length < 3 || !mounted) return;
    try {
      await context.read<ApiClient>().spost('points/${widget.result['entryId']}/reverse', {'reason': reason});
      if (!mounted) return;
      setState(() => _reversed = true);
      showOk(context, 'Entry reversed. Customer gets an update.');
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.result;
    final rate = r['rate'] as Map<String, dynamic>?;
    final ms = r['milestoneCrossed'] as Map<String, dynamic>?;
    return PopScope(
      canPop: true,
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const SizedBox(height: 32),
            Center(child: _reversed ? const Icon(Icons.undo_rounded, size: 90, color: VP.red) : const SuccessBadge()),
            const SizedBox(height: 16),
            Center(
              child: Text(_reversed ? 'Reversed' : '+${pts(asNum(r['points']))}',
                  style: TextStyle(fontSize: 54, fontWeight: FontWeight.w800, color: _reversed ? VP.red : VP.green)),
            ),
            Center(child: Text('points ${_reversed ? 'taken back from' : 'added to'} ${widget.customer['name'] ?? 'customer'}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600))),
            if (!_reversed)
              const Center(
                child: Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.sms_outlined, size: 18, color: VP.muted), SizedBox(width: 6), Text('SMS sent to customer', style: TextStyle(color: VP.muted))]),
                ),
              ),
            if (ms != null && !_reversed)
              Container(
                margin: const EdgeInsets.only(top: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: VP.amberSoft, borderRadius: BorderRadius.circular(12)),
                child: Row(children: [
                  const Icon(Icons.emoji_events, color: VP.gold),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${widget.customer['name'] ?? 'Customer'} just reached ${ms['name']}! Tell them.', style: const TextStyle(fontWeight: FontWeight.w700))),
                ]),
              ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(border: Border.all(color: VP.line), borderRadius: BorderRadius.circular(18)),
              child: Column(children: [
                if (widget.bill != null) _kv('Bill amount', rupees(double.tryParse(widget.bill!['amount']!.replaceAll(',', '')) ?? 0)),
                if (rate != null) _kv('Rate', '${asNum(rate['rewardPercent'])}%${asNum(rate['multiplier']) > 1 ? ' × ${asNum(rate['multiplier'])} ${rate['offerName']}' : ''}'),
                if (widget.bill != null && widget.bill!['invoice']!.isNotEmpty) _kv('Invoice', widget.bill!['invoice']!),
                _kv('Transaction ID', '${r['entryId']}'),
                const Divider(height: 22),
                _kv('New balance at your shop', _reversed ? '—' : pts(asNum(r['balance'])), bold: true),
              ]),
            ),
          ]),
        ),
        bottomNavigationBar: BottomAction(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            FilledButton(
              onPressed: () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const FindCustomerScreen(purpose: FindPurpose.earn))),
              child: const Text('Next customer'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Done')),
            if (!_reversed) TextButton(onPressed: _reverse, child: const Text('Wrong entry? Reverse within 15 min', style: TextStyle(color: VP.red, fontWeight: FontWeight.w600))),
          ]),
        ),
      ),
    );
  }

  Widget _kv(String k, String v, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(k, style: TextStyle(color: bold ? VP.ink : VP.muted, fontWeight: bold ? FontWeight.w700 : FontWeight.w400))),
          Text(v, style: TextStyle(fontWeight: FontWeight.w700, fontSize: bold ? 20 : 15, color: bold ? VP.blue : VP.ink)),
        ]),
      );
}
