import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../auth/language_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _smsOnEarn = true;

  Future<void> _edit(String field, String label, {String? initial, String? hint}) async {
    final c = TextEditingController(text: initial ?? '');
    final v = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(label),
        content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: hint)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 44)), onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (v == null || v.isEmpty || !mounted) return;
    try {
      await context.read<ApiClient>().patch('me/customer', {field: v});
      if (mounted) showOk(context, 'Saved');
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    Widget row(IconData icon, String title, String sub, VoidCallback onTap, {Color? subColor}) => ListTile(
          leading: Icon(icon, color: VP.blue),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(sub, style: TextStyle(color: subColor ?? VP.muted)),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        );
    return Scaffold(
      appBar: AppBar(title: Text(context.t('profile'))),
      body: ListView(padding: const EdgeInsets.only(bottom: 100), children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            Initials(s.name, size: 62),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.name ?? '', style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700)),
                Text('+91 ${prettyMobile(s.mobile)}', style: const TextStyle(color: VP.muted)),
              ]),
            ),
            TextButton(onPressed: () => _edit('city', 'City'), child: const Text('Edit city')),
          ]),
        ),
        const SizedBox(height: 12),
        WhiteCard(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(children: [
            row(Icons.account_balance_outlined, 'UPI ID for payouts', 'Shops pay your points here', () => _edit('upiId', 'Your UPI ID', hint: 'name@ybl')),
            row(Icons.translate, context.t('language'), languages.firstWhere((l) => l.$1 == s.language).$2, () async {
              await Navigator.push(context, MaterialPageRoute(builder: (_) => const LanguageScreen(popOnDone: true)));
              if (!context.mounted) return;
              try {
                await context.read<ApiClient>().patch('me/customer', {'language': context.read<Session>().language});
              } catch (_) {}
            }),
            row(Icons.work_outline, 'Profession', 'Shops can give offers by profession', () async {
              final p = await showModalBottomSheet<String>(
                context: context,
                builder: (ctx) => ListView(shrinkWrap: true, children: [for (final e in professions.entries) ListTile(title: Text(e.value), onTap: () => Navigator.pop(ctx, e.key))]),
              );
              if (p != null && context.mounted) {
                try {
                  await context.read<ApiClient>().patch('me/customer', {'profession': p});
                  if (context.mounted) showOk(context, 'Saved');
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              }
            }),
            SwitchListTile(
              secondary: const Icon(Icons.sms_outlined, color: VP.blue),
              title: const Text('SMS when points are added', style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text('Recommended, so you can spot mistakes'),
              value: _smsOnEarn,
              onChanged: (v) async {
                setState(() => _smsOnEarn = v);
                try {
                  await context.read<ApiClient>().patch('me/customer', {'smsOnEarn': v});
                } catch (e) {
                  if (context.mounted) showError(context, e);
                  if (mounted) setState(() => _smsOnEarn = !v);
                }
              },
            ),
          ]),
        ),
        const SizedBox(height: 12),
        WhiteCard(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(children: [
            row(Icons.swap_horiz, context.t('switch_role'), s.shops.isEmpty ? 'Own a shop? Register it here' : 'Go to ${s.shops.first.name}', s.chooseRoleAgain),
            row(Icons.help_outline, 'Help & support', 'Missed call or chat', () => showOk(context, 'Support: give a missed call on [HELPLINE]')),
          ]),
        ),
        const SizedBox(height: 16),
        Center(child: TextButton(onPressed: s.signOut, child: Text(context.t('log_out'), style: const TextStyle(color: VP.red, fontSize: 16, fontWeight: FontWeight.w700)))),
      ]),
    );
  }
}
