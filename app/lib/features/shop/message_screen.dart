import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// SMS to a group of the shop's customers. {name} and {points} fill in per customer.
class MessageScreen extends StatefulWidget {
  const MessageScreen({super.key});
  @override
  State<MessageScreen> createState() => _MessageScreenState();
}

class _MessageScreenState extends State<MessageScreen> {
  static const _segments = {
    'all': 'All',
    'inactive_30d': 'Not visited 30 days',
    'expiring_30d': 'Points expiring',
    'can_afford_gift': 'Can take a gift',
    'profession:carpenter': 'Carpenters',
    'profession:painter': 'Painters',
    'profession:contractor': 'Contractors',
  };
  static const _templates = {
    'Offer live': 'Namaste {name}, bonus points offer on now at our shop. You have {points} pts with us.',
    'We miss you': 'Namaste {name}, we miss you! You have {points} pts waiting at our shop.',
    'New stock': 'Namaste {name}, new stock just arrived. Visit us. You have {points} pts.',
  };

  String _segment = 'inactive_30d';
  final _text = TextEditingController(text: _templates['We miss you']);
  int? _count;
  int? _balance;

  @override
  void initState() {
    super.initState();
    _text.addListener(() => setState(() {}));
    _loadCount();
    context.read<ApiClient>().sget('').then((s) {
      if (mounted) setState(() => _balance = asNum((s as Map)['sms_balance']).toInt());
    }).catchError((_) {});
  }

  Future<void> _loadCount() async {
    setState(() => _count = null);
    try {
      final r = await context.read<ApiClient>().sget('messages/count', query: {'segment': _segment});
      if (mounted) setState(() => _count = asNum((r as Map)['count']).toInt());
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    const suffix = ' -Vyapar Point';
    final preview = _text.text.replaceAll('{name}', 'Ramesh').replaceAll('{points}', '1750') + suffix;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Message customers')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: VP.blueSoft, borderRadius: BorderRadius.circular(12)),
          child: const Row(children: [Icon(Icons.sms_outlined, color: VP.blue), SizedBox(width: 10), Expanded(child: Text('SMS · also shows in their Vyapar Point app', style: TextStyle(color: VP.blue, fontWeight: FontWeight.w700)))]),
        ),
        const SectionTitle('Send to'),
        ChoiceChips<String>(options: _segments, selected: {_segment}, onTap: (s) {
          setState(() => _segment = s);
          _loadCount();
        }),
        const SectionTitle('Ready messages'),
        Wrap(spacing: 8, children: [for (final t in _templates.entries) ActionChip(label: Text(t.key), onPressed: () => _text.text = t.value)]),
        const SizedBox(height: 12),
        TextField(controller: _text, maxLines: 3, maxLength: 130, decoration: const InputDecoration(labelText: 'Message', helperText: 'Use {name} and {points}; they fill in per customer')),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('SMS preview', style: TextStyle(fontSize: 13, color: Color(0xFF3C4856), fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Container(width: double.infinity, padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)), child: Text(preview)),
            const SizedBox(height: 4),
            Text('${preview.length} / 160 characters · 1 SMS each', style: TextStyle(fontSize: 12, color: preview.length > 160 ? VP.red : VP.muted)),
          ]),
        ),
      ]),
      bottomNavigationBar: BottomAction(
        note: '${_count == null ? '…' : pts(_count!)} customers · ${_count ?? '…'} SMS · balance ${_balance == null ? '…' : pts(_balance!)}',
        child: BusyButton(
          label: 'Send now',
          onPressed: (_count ?? 0) == 0
              ? null
              : () async {
                  final r = await context.read<ApiClient>().spost('messages', {'segment': _segment, 'text': _text.text.trim()}) as Map<String, dynamic>;
                  if (!context.mounted) return;
                  showOk(context, 'Sent to ${r['sent']} customers');
                  Navigator.pop(context);
                },
        ),
      ),
    );
  }
}
