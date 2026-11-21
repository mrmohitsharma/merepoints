import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/celebration.dart';
import '../../widgets/common.dart';

/// "Did you receive ₹1,000?" — the redemption is valid only after the customer taps Received.
Future<void> showReceivedSheet(BuildContext context, Map<String, dynamic> p) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    isDismissible: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    builder: (_) => _ReceivedSheet(p: p),
  );
}

class _ReceivedSheet extends StatelessWidget {
  const _ReceivedSheet({required this.p});
  final Map<String, dynamic> p;

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    final gift = p['method'] == 'gift';
    final what = gift ? '${p['gift_name']}' : rupees(asNum(p['value_rupees']));
    final how = gift ? 'as your gift' : p['method'] == 'upi' ? 'by UPI in ${p['upi_id']}' : 'in cash';
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Center(child: Container(width: 44, height: 5, decoration: BoxDecoration(color: const Color(0xFFCBD3DC), borderRadius: BorderRadius.circular(3)))),
          const SizedBox(height: 14),
          Row(children: [
            ShopLogo(name: '${p['shop_name']}', url: p['logo_url'] as String?, size: 52),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${p['shop_name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                Text('Redeem ${pts(asNum(p['points']))} points', style: const TextStyle(color: VP.muted)),
              ]),
            ),
          ]),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: VP.amberSoft, borderRadius: BorderRadius.circular(18)),
            child: Column(children: [
              Text(context.t('did_you_receive'), style: const TextStyle(fontSize: 17, color: Color(0xFF5C3A00), fontWeight: FontWeight.w600)),
              Text(what, textAlign: TextAlign.center, style: TextStyle(fontSize: gift ? 30 : 46, fontWeight: FontWeight.w800)),
              Text('$how?', style: const TextStyle(fontSize: 16, color: Color(0xFF3C4856))),
            ]),
          ),
          const SizedBox(height: 12),
          Text(gift ? 'Tap Received only after you have the gift in hand.' : 'Check your bank or UPI app first. Tap Received only after the money has come in.',
              textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF3C4856))),
          const SizedBox(height: 16),
          BusyButton(
            label: context.t('received'),
            icon: Icons.check,
            color: VP.green,
            onPressed: () async {
              await api.post('me/redemptions/${p['id']}/received');
              if (context.mounted) {
                final root = Navigator.of(context).context; // stays valid after the sheet closes
                Navigator.pop(context);
                await showCelebration(
                  root,
                  points: asNum(p['points']).toInt(),
                  ribbon: gift ? 'Gift received!' : 'Money received!',
                  line: gift ? 'Enjoy your ${p['gift_name']} from ${p['shop_name']}.' : 'Your points turned into ${rupees(asNum(p['value_rupees']))}. Keep earning!',
                );
              }
            },
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: VP.red, side: const BorderSide(color: VP.red, width: 2)),
            onPressed: () async {
              try {
                await api.post('me/redemptions/${p['id']}/not-received', {'note': 'Customer says not received'});
                if (context.mounted) {
                  Navigator.pop(context);
                  showOk(context, 'We told the shop. Your points stay safe.');
                }
              } catch (e) {
                if (context.mounted) showError(context, e);
              }
            },
            child: Text(context.t('not_received')),
          ),
          const SizedBox(height: 6),
          const Text('Your points stay safe until you tap Received', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: VP.muted)),
        ]),
      ),
    );
  }
}
