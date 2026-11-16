import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'customer_signup_screen.dart';
import 'shop_signup_screen.dart';

/// Shown when a user has no role yet, or has several and must pick one.
/// One login can be a customer AND work at shops; this is the role switch.
class RolePickerScreen extends StatelessWidget {
  const RolePickerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(actions: [TextButton(onPressed: s.signOut, child: Text(context.t('log_out')))]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text(s.name == null ? 'Welcome!' : 'Namaste, ${s.name}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(context.t('who_are_you'), style: const TextStyle(fontSize: 17, color: VP.muted)),
        const SizedBox(height: 20),
        if (s.isCustomer)
          _RoleCard(
            icon: Icons.account_balance_wallet_outlined, title: 'My points', subtitle: 'Customer account',
            onTap: () => s.switchTo(const ActiveRole.customer()),
          ),
        for (final shop in s.shops)
          _RoleCard(
            leading: ShopLogo(name: shop.name, url: shop.logoUrl),
            title: shop.name,
            subtitle: '${shop.isOwner ? 'Owner' : 'Staff'}${shop.isApproved ? '' : ' · ${shop.status}'}',
            onTap: () => s.switchTo(ActiveRole.shop(shop.id)),
          ),
        if (s.isCustomer || s.shops.isNotEmpty) const SectionTitle('Add another'),
        if (!s.isCustomer)
          _RoleCard(
            icon: Icons.handyman_outlined, title: context.t('i_customer'), subtitle: context.t('i_customer_sub'),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CustomerSignupScreen())),
          ),
        _RoleCard(
          icon: Icons.storefront_outlined, title: context.t('i_shop'), subtitle: context.t('i_shop_sub'),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShopSignupScreen())),
        ),
        const SizedBox(height: 12),
        const InfoNote('Shop staff: ask your shop owner to add your mobile number in Settings › Staff, then log in again.'),
      ]),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({this.icon, this.leading, required this.title, required this.subtitle, required this.onTap});
  final IconData? icon;
  final Widget? leading;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Material(
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: VP.line)),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(children: [
                leading ?? Container(width: 52, height: 52, decoration: BoxDecoration(color: VP.blueSoft, borderRadius: BorderRadius.circular(14)), child: Icon(icon, color: VP.blue, size: 28)),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    Text(subtitle, style: const TextStyle(fontSize: 14, color: VP.muted)),
                  ]),
                ),
                const Icon(Icons.chevron_right, color: VP.muted),
              ]),
            ),
          ),
        ),
      );
}
