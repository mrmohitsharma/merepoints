import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/bill_photos.dart';
import '../../widgets/common.dart';

String _day(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  return d == null ? '' : DateFormat('d MMM yyyy').format(d);
}

/// Third tab of Add points: what this customer owes the shop. Add a due, record a payment, see the history.
class DuesTab extends StatefulWidget {
  const DuesTab({super.key, required this.customer});
  final Map<String, dynamic> customer;
  @override
  State<DuesTab> createState() => _DuesTabState();
}

class _DuesTabState extends State<DuesTab> {
  Map<String, dynamic>? _book;
  Object? _error;
  int _action = 0; // 0 add due, 1 payment received

  final _amount = TextEditingController();
  final _note = TextEditingController();
  DateTime? _dueDate;
  List<String> _photos = [];
  String _method = 'cash';
  bool _earn = true;
  String _key = ApiClient.newIdempotencyKey(); // same key on a retry, so a dropped network never records it twice

  int get _id => widget.customer['id'] as int;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await context.read<ApiClient>().sget('dues/customer/$_id') as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _book = r;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  double? get _amt => double.tryParse(_amount.text.replaceAll(',', ''));
  double get _balance => asNum(_book?['balanceRupees']).toDouble();

  void _reset() {
    _amount.clear();
    _note.clear();
    _dueDate = null;
    _photos = [];
    _key = ApiClient.newIdempotencyKey();
  }

  Future<void> _submit() async {
    final amt = _amt;
    if (amt == null || amt <= 0) throw ApiException(400, 'AMOUNT', 'Enter the amount');
    final api = context.read<ApiClient>();
    if (_action == 0) {
      await api.spost('dues', {
        'customerId': _id,
        'amountRupees': amt,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        if (_dueDate != null) 'dueDate': DateFormat('yyyy-MM-dd').format(_dueDate!),
        'photoUrls': _photos,
      }, _key);
      if (!mounted) return;
      showOk(context, '${rupees(amt)} added to dues');
    } else {
      final r = await api.spost('dues/pay', {
        'customerId': _id,
        'amountRupees': amt,
        'method': _method,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        'earnPoints': _earn,
        'photoUrls': _photos,
      }, _key) as Map<String, dynamic>;
      if (!mounted) return;
      final p = asNum(r['points']).toInt();
      final why = r['pointsNote'];
      showOk(context, p > 0 ? 'Payment recorded · +${pts(p)} points added' : (why != null ? 'Payment recorded. No points: $why' : 'Payment recorded'));
    }
    setState(_reset);
    await _load();
  }

  Future<void> _remind() async {
    try {
      await context.read<ApiClient>().spost('dues/customer/$_id/remind');
      if (mounted) showOk(context, 'Reminder sent to ${widget.customer['name'] ?? 'customer'}');
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _undo(Map<String, dynamic> e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Undo this entry?'),
        content: Text('${e['kind'] == 'due' ? 'Due' : 'Payment'} of ${rupees(asNum(e['amount_rupees']))} will be struck off. The history keeps a record.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Undo'))],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<ApiClient>().spost('dues/${e['id']}/undo');
      await _load();
    } catch (err) {
      if (mounted) showError(context, err);
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _dueDate ?? now.add(const Duration(days: 7)), firstDate: now, lastDate: now.add(const Duration(days: 365)));
    if (d != null) setState(() => _dueDate = d);
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return ErrorRetry(error: _error!, onRetry: _load);
    final b = _book;
    if (b == null) return const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()));
    final owes = _balance > 0;
    final overdue = b['overdue'] == true;
    final entries = (b['entries'] as List).cast<Map<String, dynamic>>();
    final amt = _amt ?? 0;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      // Balance
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: !owes ? VP.greenSoft : overdue ? VP.redSoft : VP.amberSoft, borderRadius: BorderRadius.circular(16)),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(owes ? 'Owes you' : 'No dues', style: TextStyle(fontWeight: FontWeight.w700, color: owes ? VP.amberText : VP.green)),
              Text(rupees(_balance), style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: !owes ? VP.green : overdue ? VP.red : VP.ink)),
              if (owes && overdue) const Text('Overdue', style: TextStyle(color: VP.red, fontWeight: FontWeight.w700)),
              if (owes && !overdue && b['nextDueDate'] != null) Text('Promised by ${_day(b['nextDueDate'])}', style: const TextStyle(color: VP.muted)),
            ]),
          ),
          if (owes) OutlinedButton.icon(onPressed: _remind, icon: const Icon(Icons.notifications_active_outlined), label: const Text('Remind')),
        ]),
      ),
      const SizedBox(height: 14),
      Segmented(labels: const ['Add due', 'Payment received'], index: _action, onChanged: (i) => setState(() => _action = i)),
      const SizedBox(height: 14),
      const Text('Amount', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
      const SizedBox(height: 6),
      TextField(
        controller: _amount,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800),
        onChanged: (_) => setState(() {}),
        decoration: const InputDecoration(prefixText: '₹ ', prefixStyle: TextStyle(fontSize: 28, color: VP.muted, fontWeight: FontWeight.w700)),
      ),
      if (_action == 1 && owes)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Wrap(spacing: 8, children: [
            ActionChip(label: Text('Full ${rupees(_balance)}'), onPressed: () => setState(() => _amount.text = _balance == _balance.roundToDouble() ? '${_balance.round()}' : '$_balance')),
          ]),
        ),
      const SizedBox(height: 12),
      if (_action == 1) ...[
        const Text('Paid by', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
        const SizedBox(height: 6),
        ChoiceChips<String>(options: const {'cash': 'Cash', 'upi': 'UPI', 'cheque': 'Cheque', 'other': 'Other'}, selected: {_method}, onTap: (m) => setState(() => _method = m)),
        const SizedBox(height: 6),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _earn,
          onChanged: (v) => setState(() => _earn = v),
          title: const Text('Add points for this payment', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(_earn ? 'Points are earned on the money received, like a normal bill' : 'No points for this payment'),
        ),
      ] else ...[
        OutlinedButton.icon(
          onPressed: _pickDate,
          icon: const Icon(Icons.event_outlined),
          label: Text(_dueDate == null ? 'Promised to pay by (optional)' : 'Promised by ${DateFormat('d MMM yyyy').format(_dueDate!)}'),
        ),
        const SizedBox(height: 10),
      ],
      TextField(controller: _note, maxLength: 200, decoration: InputDecoration(labelText: _action == 0 ? 'What was taken? (note)' : 'Note (optional)', counterText: '')),
      const SizedBox(height: 12),
      BillPhotosField(urls: _photos, onChanged: (u) => setState(() => _photos = u), title: _action == 0 ? 'Bill photos' : 'Receipt photos'),
      const SizedBox(height: 16),
      SizedBox(
        width: double.infinity,
        child: BusyButton(
          label: _action == 0 ? (amt > 0 ? 'Add ${rupees(amt)} to dues' : 'Add due') : (amt > 0 ? 'Record ${rupees(amt)} received' : 'Record payment'),
          onPressed: _submit,
        ),
      ),
      const SizedBox(height: 22),
      const Text('History', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      const SizedBox(height: 6),
      if (entries.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 18), child: Text('No dues recorded for this customer yet.', style: TextStyle(color: VP.muted))),
      for (final e in entries) _EntryTile(e: e, onUndo: () => _undo(e)),
    ]);
  }
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({required this.e, required this.onUndo});
  final Map<String, dynamic> e;
  final VoidCallback onUndo;
  @override
  Widget build(BuildContext context) {
    final due = e['kind'] == 'due';
    final undone = e['reversed_at'] != null;
    final photos = (e['photo_urls'] as List?)?.cast<String>() ?? const [];
    final sub = <String>[
      _day(e['created_at']),
      if (!due && e['method'] != null) '${e['method']}'.toUpperCase(),
      if (due && e['due_date'] != null) 'by ${_day(e['due_date'])}',
      if (!due && asNum(e['points']) > 0) '+${pts(asNum(e['points']))} pts',
      if (undone) 'undone',
    ];
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(due ? Icons.north_east : Icons.south_west, color: undone ? VP.muted : (due ? VP.red : VP.green)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(due ? 'Due added' : 'Payment received', style: TextStyle(fontWeight: FontWeight.w700, decoration: undone ? TextDecoration.lineThrough : null)),
              Text(sub.join(' · '), style: const TextStyle(fontSize: 13, color: VP.muted)),
              if ('${e['note'] ?? ''}'.isNotEmpty) Text('${e['note']}', style: const TextStyle(fontSize: 14)),
            ]),
          ),
          Text('${due ? '+' : '−'}${rupees(asNum(e['amount_rupees']))}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: undone ? VP.muted : (due ? VP.red : VP.green), decoration: undone ? TextDecoration.lineThrough : null)),
          if (!undone) IconButton(tooltip: 'Undo', icon: const Icon(Icons.undo, size: 20), onPressed: onUndo),
        ]),
        if (photos.isNotEmpty) ...[
          const SizedBox(height: 8),
          SizedBox(
            height: 56,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final u in photos)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GestureDetector(
                    onTap: () => showDialog<void>(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.network(u)))),
                    child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(u, width: 56, height: 56, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox(width: 56, height: 56))),
                  ),
                ),
            ]),
          ),
        ],
      ]),
    );
  }
}
