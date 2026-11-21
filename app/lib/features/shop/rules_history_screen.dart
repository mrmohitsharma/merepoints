import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Every version of the shop's loyalty rules, newest first, with what changed.
class RulesHistoryScreen extends StatelessWidget {
  const RulesHistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Rules history')),
      body: AsyncView<List<dynamic>>(
        load: () async => await api.sget('config/history') as List,
        builder: (context, list, reload) => ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          for (final v in list.cast<Map<String, dynamic>>())
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: WhiteCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text('Version ${v['version']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 8),
                    if (v['current'] == true)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(10)),
                        child: const Text('Current', style: TextStyle(color: VP.green, fontWeight: FontWeight.w700, fontSize: 12)),
                      ),
                  ]),
                  const SizedBox(height: 2),
                  Text('${shortDate(v['createdAt'])}${v['byName'] != null ? ' · by ${v['byName']}' : ''}', style: const TextStyle(fontSize: 13, color: VP.muted)),
                  const SizedBox(height: 8),
                  if ((v['changes'] as List).isEmpty)
                    Text(v['version'] == 1 ? 'Starting rules: ${_summary(v['config'] as Map)}' : 'No changes', style: const TextStyle(color: VP.ink))
                  else
                    for (final ch in (v['changes'] as List)) Padding(padding: const EdgeInsets.only(bottom: 3), child: Text('• $ch')),
                ]),
              ),
            ),
        ]),
      ),
    );
  }

  static String _summary(Map c) =>
      '${c['rewardPercent']}% reward, 1 point = ₹${c['pointValueRupees']}, min redeem ${c['minRedeemPoints']}, expiry ${c['expiryDays'] ?? 'never'} days';
}
