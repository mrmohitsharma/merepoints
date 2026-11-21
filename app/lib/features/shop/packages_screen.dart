import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Where owners pay for a package or an extra pack (Cashfree checkout runs in the shop portal).
const String kPortalBillingUrl = String.fromEnvironment('WEB_URL', defaultValue: 'https://merepoints.in') + '/merchant/billing/';

const _limitLabels = {
  'notifications': ('Notifications', 'per month'),
  'products': ('Products & gifts', 'in catalogue'),
  'offers': ('Running offers', 'at a time'),
  'ads': ('Home-screen ads', 'per month'),
};

String _limit(dynamic n) => n == null ? 'Unlimited' : '$n';

/// The shop's package, what it includes, how much of each limit is used, and how to upgrade or buy extras.
class PackagesScreen extends StatelessWidget {
  const PackagesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Package & billing')),
      body: AsyncView<Map<String, dynamic>>(
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
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(children: [
                FilledButton.icon(
                  onPressed: () => launchUrl(Uri.parse(kPortalBillingUrl), mode: LaunchMode.externalApplication),
                  icon: const Icon(Icons.open_in_new),
                  label: const Text('Upgrade or buy extras'),
                ),
                const SizedBox(height: 8),
                const InfoNote('Payment opens in the Mere Points shop portal in your browser. Your package switches on in the app as soon as you have paid.', icon: Icons.info_outline, color: VP.blue),
              ]),
            ),
          ]);
        },
      ),
    );
  }
}
