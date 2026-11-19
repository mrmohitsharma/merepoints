import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/points_math.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../auth/language_screen.dart';
import '../auth/shop_signup_screen.dart';
import 'message_screen.dart';
import 'offers_screen.dart';
import 'products_screen.dart';
import 'staff_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final shop = s.activeShop!;
    Widget item(IconData icon, String title, String sub, Widget page) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: WhiteCard(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => page)),
            child: Row(children: [
              Icon(icon, color: VP.blue),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  Text(sub, style: const TextStyle(fontSize: 13, color: VP.muted)),
                ]),
              ),
              const Icon(Icons.chevron_right, color: VP.muted),
            ]),
          ),
        );
    return Scaffold(
      appBar: AppBar(title: Text(context.t('settings'))),
      body: ListView(padding: const EdgeInsets.only(top: 8, bottom: 100), children: [
        if (shop.isOwner) ...[
          item(Icons.tune, 'Loyalty rules', '% per bill, value of 1 point, redeem limits, expiry', const LoyaltySettingsScreen()),
          item(Icons.inventory_2_outlined, 'Products', 'Gifts to redeem, and products that earn bonus points', const ShopProductsScreen()),
          item(Icons.local_offer_outlined, 'Offers', 'Bonus points offers, e.g. 2x for painters this week', const OffersScreen()),
          item(Icons.sms_outlined, 'Message customers', 'SMS to a group of your customers', const MessageScreen()),
          item(Icons.badge_outlined, 'Staff & roles', 'Who can add points, redeem, give manual points', const StaffScreen()),
        ],
        const SectionTitle('Account'),
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: WhiteCard(
            child: Row(children: [
              Initials(s.name, size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(s.name ?? 'Me', style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text('+91 ${prettyMobile(s.mobile)} · ${shop.isOwner ? 'Owner' : 'Staff'} at ${shop.name}', style: const TextStyle(fontSize: 13, color: VP.muted)),
                ]),
              ),
            ]),
          ),
        ),
        item(Icons.translate, context.t('language'), languages.firstWhere((l) => l.$1 == s.language).$2, const LanguageScreen(popOnDone: true)),
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: WhiteCard(
            onTap: s.chooseRoleAgain,
            child: Row(children: [
              const Icon(Icons.swap_horiz, color: VP.blue),
              const SizedBox(width: 14),
              Expanded(child: Text(context.t('switch_role'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
              const Text('My points / other shops', style: TextStyle(fontSize: 13, color: VP.muted)),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        Center(child: TextButton(onPressed: s.signOut, child: Text(context.t('log_out'), style: const TextStyle(color: VP.red, fontSize: 16, fontWeight: FontWeight.w700)))),
      ]),
    );
  }
}

class LoyaltySettingsScreen extends StatefulWidget {
  const LoyaltySettingsScreen({super.key});
  @override
  State<LoyaltySettingsScreen> createState() => _LoyaltySettingsScreenState();
}

class _LoyaltySettingsScreenState extends State<LoyaltySettingsScreen> {
  Map<String, dynamic>? _c;
  final _maxPerBill = TextEditingController();
  final _maxRedeem = TextEditingController();
  final _minBill = TextEditingController();
  int? _expiryDays;
  List<RewardSlab>? _slabs;

  @override
  void initState() {
    super.initState();
    context.read<ApiClient>().sget('config').then((r) {
      if (!mounted) return;
      final c = Map<String, dynamic>.from(r as Map);
      setState(() {
        _c = c;
        _maxPerBill.text = c['maxPointsPerBill']?.toString() ?? '';
        _maxRedeem.text = c['maxRedeemPoints']?.toString() ?? '';
        _minBill.text = asNum(c['minBillRupees']) == 0 ? '' : '${asNum(c['minBillRupees']).round()}';
        _expiryDays = c['expiryDays'] as int?;
        _slabs = RewardSlab.listFrom(c['rewardSlabs']);
      });
    }).catchError((e) {
      if (mounted) showError(context, e);
    });
  }

  Future<void> _save() async {
    final c = _c!;
    final err = _slabs == null ? null : slabError(_slabs!);
    if (err != null) throw ApiException(400, 'FORM', err);
    await context.read<ApiClient>().put('shop/config', {
      'enabled': c['enabled'],
      'rewardPercent': asNum(c['rewardPercent']),
      'rewardSlabs': _slabs?.map((s) => s.toJson()).toList(),
      'pointValueRupees': asNum(c['pointValueRupees']),
      'minRedeemPoints': asNum(c['minRedeemPoints']).toInt(),
      'minBillRupees': num.tryParse(_minBill.text) ?? 0,
      'maxPointsPerBill': int.tryParse(_maxPerBill.text),
      'maxRedeemPoints': int.tryParse(_maxRedeem.text),
      'expiryDays': _expiryDays,
      'payoutCash': c['payoutCash'],
      'payoutUpi': c['payoutUpi'],
    }, shop: true);
    if (mounted) {
      showOk(context, 'Saved. New rules apply to new bills from now.');
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return Scaffold(
      appBar: AppBar(title: const Text('Loyalty rules')),
      body: c == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(16), children: [
              WhiteCard(
                margin: EdgeInsets.zero,
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Loyalty program', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(c['enabled'] == true ? 'On · customers earn points' : 'Off · no new points', style: TextStyle(color: c['enabled'] == true ? VP.green : VP.red)),
                  value: c['enabled'] == true,
                  onChanged: (v) => setState(() => c['enabled'] = v),
                ),
              ),
              const SizedBox(height: 16),
              LoyaltyRulesEditor(
                percent: asNum(c['rewardPercent']).toDouble(),
                slabs: _slabs,
                onSlabsChanged: (s) => setState(() => _slabs = s),
                pointValue: asNum(c['pointValueRupees']).toDouble(),
                minRedeem: asNum(c['minRedeemPoints']).toInt(),
                onChanged: (p, v, m) => setState(() {
                  c['rewardPercent'] = p;
                  c['pointValueRupees'] = v;
                  c['minRedeemPoints'] = m;
                }),
              ),
              const SectionTitle('More rules'),
              TextField(controller: _minBill, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Minimum bill for points (₹)', hintText: 'No minimum')),
              const SizedBox(height: 12),
              TextField(controller: _maxPerBill, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Max points per bill', hintText: 'No limit')),
              const SizedBox(height: 12),
              TextField(controller: _maxRedeem, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Max points per redemption', hintText: 'No limit')),
              const SizedBox(height: 14),
              const Text('Points expire after', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
              const SizedBox(height: 8),
              ChoiceChips<int?>(options: const {180: '6 months', 365: '12 months', 730: '24 months', null: 'Never'}, selected: {_expiryDays}, onTap: (d) => setState(() => _expiryDays = d)),
              const SizedBox(height: 14),
              const Text('Pay customers by', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
              CheckboxListTile(contentPadding: EdgeInsets.zero, title: const Text('Cash'), value: c['payoutCash'] == true, onChanged: (v) => setState(() => c['payoutCash'] = v)),
              CheckboxListTile(contentPadding: EdgeInsets.zero, title: const Text('UPI'), value: c['payoutUpi'] == true, onChanged: (v) => setState(() => c['payoutUpi'] = v)),
              const SizedBox(height: 8),
              const InfoNote('Changes apply to new bills only. Points already earned keep the value they had when earned.', icon: Icons.info_outline, color: VP.blue),
            ]),
      bottomNavigationBar: c == null ? null : BottomAction(child: BusyButton(label: context.t('save'), onPressed: _save)),
    );
  }
}
