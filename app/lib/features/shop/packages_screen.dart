import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/company.dart';
import '../../core/pay.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

const _limitLabels = {
  'notifications': ('Notifications', 'per month'),
  'products': ('Products & gifts', 'in catalogue'),
  'offers': ('Running offers', 'at a time'),
  'ads': ('Home-screen ads', 'per month'),
};

String _limit(dynamic n) => n == null ? 'Unlimited' : '$n';

/// The shop's package, what it includes, how much of each limit is used, and how to upgrade or buy extras.
class PackagesScreen extends StatefulWidget {
  const PackagesScreen({super.key});
  @override
  State<PackagesScreen> createState() => _PackagesScreenState();
}

class _PackagesScreenState extends State<PackagesScreen> {
  int _version = 0; // bump to reload after a payment
  bool _paying = false;

  Future<void> _buy(Map<String, dynamic> body, String what) async {
    if (_paying) return;
    setState(() => _paying = true);
    try {
      final r = await payInApp(context, body);
      if (!mounted || r == null) return;
      setState(() => _version++);
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          icon: const Icon(Icons.check_circle, color: VP.green, size: 48),
          title: const Text('Payment received'),
          content: Text('$what is now on.\nReceipt ${r['receipt']} · ${rupees(asNum(r['amountRupees']))}\nSold by $kCompanyName, $kCompanyCity'),
          actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('Done'))],
        ),
      );
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Package & billing')),
      body: AsyncView<Map<String, dynamic>>(
        key: ValueKey(_version),
        load: () async => await api.sget('billing') as Map<String, dynamic>,
        builder: (context, d, reload) {
          final plan = d['plan'] as Map<String, dynamic>;
          final limits = d['limits'] as Map<String, dynamic>;
          final usage = d['usage'] as Map<String, dynamic>;
          final extras = d['extras'] as Map<String, dynamic>;
          final plans = (d['plans'] as List).cast<Map<String, dynamic>>();
          final cat = (d['featureCatalogue'] as List).cast<Map<String, dynamic>>();
          final state = '${d['state']}';
          return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            WhiteCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Your package', style: TextStyle(color: VP.muted, fontSize: 13)),
                Text('${plan['name']}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(
                  state == 'free'
                      ? 'Free package. Upgrade any time to switch on more features.'
                      : state == 'trial'
                          ? 'Free trial till ${shortDate(d['trialEndsAt'])}'
                          : state == 'active'
                              ? 'Paid till ${shortDate(d['periodEnd'])}'
                              : state == 'grace'
                                  ? 'Payment due. Pay by ${shortDate(d['graceEndsAt'])} to keep paid features.'
                                  : 'Your paid package ended. You are on the free Basic package; points and payouts still work.',
                  style: const TextStyle(color: VP.muted),
                ),
              ]),
            ),
            const SectionTitle('This month’s use'),
            WhiteCard(
              child: Column(children: [
                for (final k in _limitLabels.keys)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(children: [
                      Expanded(child: Text('${_limitLabels[k]!.$1} ${_limitLabels[k]!.$2}')),
                      Text('${usage[k]} / ${_limit(limits[k])}${(extras[k] ?? 0) > 0 ? ' +${extras[k]}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    ]),
                  ),
              ]),
            ),
            const SectionTitle('Packages'),
            for (final p in plans)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: WhiteCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${p['name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                      if (plan['code'] == p['code']) const Text('Your package', style: TextStyle(color: VP.blue, fontWeight: FontWeight.w700)),
                    ]),
                    Text(
                      p['free'] == true
                          ? 'Free'
                          : '${rupees(asNum(p['priceRupees']))} / month${p['yearlyPriceRupees'] != null ? ' · ${rupees(asNum(p['yearlyPriceRupees']))} / year' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: VP.blue),
                    ),
                    if (p['free'] != true)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Wrap(spacing: 8, runSpacing: 8, children: [
                          FilledButton(
                            onPressed: _paying ? null : () => _buy({'kind': 'plan', 'planCode': p['code'], 'period': 'monthly'}, '${p['name']} package'),
                            child: Text('Buy monthly · ${rupees(asNum(p['priceRupees']))}'),
                          ),
                          if (p['yearlyPriceRupees'] != null)
                            OutlinedButton(
                              onPressed: _paying ? null : () => _buy({'kind': 'plan', 'planCode': p['code'], 'period': 'yearly'}, '${p['name']} package'),
                              child: Text('Buy yearly · ${rupees(asNum(p['yearlyPriceRupees']))}'),
                            ),
                        ]),
                      ),
                    const SizedBox(height: 8),
                    for (final f in cat)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(children: [
                          Icon((p['featureKeys'] as List).contains(f['key']) ? Icons.check_circle : Icons.lock_outline,
                              size: 18, color: (p['featureKeys'] as List).contains(f['key']) ? VP.green : VP.muted),
                          const SizedBox(width: 8),
                          Expanded(child: Text('${f['label']}', style: TextStyle(color: (p['featureKeys'] as List).contains(f['key']) ? VP.ink : VP.muted))),
                        ]),
                      ),
                  ]),
                ),
              ),
            if ((d['addonPacks'] as List).isNotEmpty) ...[
              const SectionTitle('Extra packs (valid till your package period ends)'),
              for (final a in (d['addonPacks'] as List).cast<Map<String, dynamic>>())
                WhiteCard(
                  child: Row(children: [
                    Expanded(child: Text(_packLabel(a), style: const TextStyle(fontWeight: FontWeight.w600))),
                    FilledButton(
                      onPressed: _paying ? null : () => _buy({'kind': 'addon', 'packCode': a['code']}, _packLabel(a)),
                      child: Text(rupees(asNum(a['priceRupees']))),
                    ),
                  ]),
                ),
            ],
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Column(children: [
                InfoNote('Pay safely with UPI, card or netbanking. Your package switches on as soon as the payment is done. Sold by $kCompanyName, $kCompanyCity.', icon: Icons.lock_outline, color: VP.blue),
                TextButton.icon(
                  onPressed: () => launchUrl(Uri.parse('tel:$kSupportPhone')),
                  icon: const Icon(Icons.call),
                  label: const Text('Need help? Call $kSupportPhone'),
                ),
              ]),
            ),
          ]);
        },
      ),
    );
  }
}

String _packLabel(Map<String, dynamic> a) {
  final q = a['quantity'];
  switch ('${a['kind']}') {
    case 'notifications':
      return '$q notifications';
    case 'products':
      return '$q more products';
    case 'offers':
      return '$q more running offers';
    case 'ads':
      return '$q home-screen ad${q == 1 ? '' : 's'}';
    default:
      return '${a['kind']} × $q';
  }
}
