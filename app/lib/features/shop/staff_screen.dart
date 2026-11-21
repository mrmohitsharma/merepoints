import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class StaffScreen extends StatefulWidget {
  const StaffScreen({super.key});
  @override
  State<StaffScreen> createState() => _StaffScreenState();
}

class _StaffScreenState extends State<StaffScreen> {
  final key = GlobalKey<AsyncViewState<List<dynamic>>>();

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Staff & roles')),
      body: AsyncView<List<dynamic>>(
        key: key,
        load: () async => await api.sget('staff') as List,
        builder: (context, list, reload) => ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          for (final m in list.cast<Map<String, dynamic>>())
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: WhiteCard(
                child: Opacity(
                  opacity: m['active'] == true ? 1 : 0.6,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Initials('${m['name']}', bg: m['role'] == 'owner' ? VP.blue : VP.blueSoft, fg: m['role'] == 'owner' ? Colors.white : VP.blue),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${m['name'] ?? 'Staff'}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                          Text('${prettyMobile(m['mobile'] as String?)} · ${m['entries_7d']} entries this week', style: const TextStyle(fontSize: 13, color: VP.muted)),
                        ]),
                      ),
                      _Badge(m['role'] == 'owner' ? 'Owner' : m['active'] == true ? 'Staff' : 'Blocked', m['role'] == 'owner' ? VP.blue : m['active'] == true ? VP.blueSoft : VP.redSoft,
                          m['role'] == 'owner' ? Colors.white : m['active'] == true ? VP.blue : VP.red),
                    ]),
                    if (m['role'] == 'staff') ...[
                      const SizedBox(height: 8),
                      _PermToggle(label: 'Can add points (bills)', value: m['can_add_points'] != false, onChanged: (v) => _patch(context, m, {'canAddPoints': v}, reload)),
                      _PermToggle(label: 'Can redeem', value: m['can_redeem'] == true, onChanged: (v) => _patch(context, m, {'canRedeem': v}, reload)),
                      _PermToggle(label: 'Manual points (≤ ${m['manual_daily_limit']}/day)', value: m['can_manual'] == true, onChanged: (v) => _patch(context, m, {'canManual': v}, reload)),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton.icon(
                          onPressed: () => _editLimit(context, m, reload),
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          label: Text('Manual points limit: ${m['manual_daily_limit']} per day'),
                        ),
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => _patch(context, m, {'active': !(m['active'] == true)}, reload),
                          child: Text(m['active'] == true ? 'Remove access' : 'Give access back', style: TextStyle(color: m['active'] == true ? VP.red : VP.green)),
                        ),
                      ),
                    ],
                  ]),
                ),
              ),
            ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: InfoNote('Staff log in with their own mobile OTP. Every entry shows who made it.', icon: Icons.shield_outlined, color: VP.blue),
          ),
        ]),
      ),
      bottomNavigationBar: BottomAction(
        child: FilledButton.icon(
          onPressed: () async {
            final added = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => const _AddStaffSheet());
            if (added == true) key.currentState?.reload();
          },
          icon: const Icon(Icons.add),
          label: const Text('Add staff by mobile'),
        ),
      ),
    );
  }

  Future<void> _editLimit(BuildContext context, Map<String, dynamic> m, Future<void> Function() reload) async {
    final ctrl = TextEditingController(text: '${m['manual_daily_limit']}');
    final v = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Manual points per day'),
        content: TextField(controller: ctrl, keyboardType: TextInputType.number, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. 500')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, int.tryParse(ctrl.text.trim())), child: const Text('Save')),
        ],
      ),
    );
    if (v != null && v >= 0 && context.mounted) await _patch(context, m, {'manualDailyLimit': v}, reload);
  }

  Future<void> _patch(BuildContext context, Map<String, dynamic> m, Map<String, dynamic> body, Future<void> Function() reload) async {
    try {
      await context.read<ApiClient>().patch('shop/staff/${m['id']}', body, shop: true);
      await reload();
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.text, this.bg, this.fg);
  final String text;
  final Color bg;
  final Color fg;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
        child: Text(text, style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 13)),
      );
}

class _PermToggle extends StatelessWidget {
  const _PermToggle({required this.label, required this.value, required this.onChanged});
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(child: Text(label)),
        Switch(value: value, onChanged: onChanged),
      ]);
}

class _AddStaffSheet extends StatefulWidget {
  const _AddStaffSheet();
  @override
  State<_AddStaffSheet> createState() => _AddStaffSheetState();
}

class _AddStaffSheetState extends State<_AddStaffSheet> {
  final _mobile = TextEditingController();
  final _name = TextEditingController();
  bool _redeem = true;
  bool _manual = false;
  final _limit = TextEditingController(text: '500');

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Add staff', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          TextField(controller: _mobile, keyboardType: TextInputType.phone, inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)], decoration: const InputDecoration(labelText: 'Mobile', prefixText: '+91  ')),
          const SizedBox(height: 12),
          TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name')),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Can redeem points'), value: _redeem, onChanged: (v) => setState(() => _redeem = v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Can give manual points'), value: _manual, onChanged: (v) => setState(() => _manual = v)),
          if (_manual) TextField(controller: _limit, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Manual points limit per day')),
          const SizedBox(height: 16),
          BusyButton(
            label: 'Add staff',
            onPressed: () async {
              await context.read<ApiClient>().spost('staff', {
                'mobile': _mobile.text, 'name': _name.text.trim(), 'canRedeem': _redeem, 'canManual': _manual,
                'manualDailyLimit': int.tryParse(_limit.text) ?? 500,
              });
              if (context.mounted) Navigator.pop(context, true);
            },
          ),
        ]),
      );
}
