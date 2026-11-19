import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'customers_screen.dart';
import 'find_customer_screen.dart';
import 'reports_screen.dart';
import 'settings_screen.dart';
import 'shop_home_screen.dart';
import 'transactions_screen.dart';

/// Shop side of the app. Owner tabs: Home, Customers, [Scan], Reports, Settings.
/// Staff tabs: Home, Customers, [Scan], Entries, Settings (account only).
class ShopShell extends StatefulWidget {
  const ShopShell({super.key});
  @override
  State<ShopShell> createState() => _ShopShellState();
}

class _ShopShellState extends State<ShopShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final shop = context.watch<Session>().activeShop;
    if (shop == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (!shop.isApproved) return _NotApproved(shopName: shop.name, status: shop.status, isOwner: shop.isOwner);

    final pages = <Widget>[
      const ShopHomeScreen(),
      const CustomersScreen(),
      const SizedBox.shrink(),
      shop.isOwner ? const ReportsScreen() : const TransactionsScreen(),
      const SettingsScreen(),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: SizedBox(
        width: 68,
        height: 68,
        child: FloatingActionButton(
          heroTag: 'scan',
          backgroundColor: VP.blue,
          shape: const CircleBorder(side: BorderSide(color: Colors.white, width: 5)),
          tooltip: 'Scan customer QR',
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FindCustomerScreen(purpose: FindPurpose.earn))),
          child: const Icon(Icons.qr_code_scanner, color: Colors.white, size: 30),
        ),
      ),
      bottomNavigationBar: BottomAppBar(
        height: 72,
        color: Colors.white,
        padding: EdgeInsets.zero,
        notchMargin: 6,
        shape: const CircularNotchedRectangle(),
        child: Row(children: [
          _NavItem(icon: Icons.home_outlined, label: context.t('home'), on: _tab == 0, onTap: () => setState(() => _tab = 0)),
          _NavItem(icon: Icons.people_outline, label: context.t('customers'), on: _tab == 1, onTap: () => setState(() => _tab = 1)),
          const Expanded(child: SizedBox()),
          shop.isOwner
              ? _NavItem(icon: Icons.insights_outlined, label: context.t('reports'), on: _tab == 3, onTap: () => setState(() => _tab = 3))
              : _NavItem(icon: Icons.list_alt, label: 'Entries', on: _tab == 3, onTap: () => setState(() => _tab = 3)),
          _NavItem(icon: Icons.settings_outlined, label: context.t('settings'), on: _tab == 4, onTap: () => setState(() => _tab = 4)),
        ]),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.icon, required this.label, required this.on, required this.onTap});
  final IconData icon;
  final String label;
  final bool on;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Expanded(
        child: InkWell(
          onTap: onTap,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, color: on ? VP.blue : VP.muted),
            Text(label, style: TextStyle(fontSize: 12, color: on ? VP.blue : VP.muted, fontWeight: on ? FontWeight.w700 : FontWeight.w500), overflow: TextOverflow.ellipsis),
          ]),
        ),
      );
}

class _NotApproved extends StatelessWidget {
  const _NotApproved({required this.shopName, required this.status, required this.isOwner});
  final String shopName;
  final String status;
  final bool isOwner;
  @override
  Widget build(BuildContext context) {
    final s = context.read<Session>();
    final pending = status == 'pending';
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(shopName)),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        const SizedBox(height: 24),
        Icon(pending ? Icons.hourglass_top_rounded : Icons.block, size: 72, color: pending ? VP.amber : VP.red),
        const SizedBox(height: 16),
        Text(pending ? 'Waiting for approval' : 'Shop is $status', textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text(
          pending
              ? 'We check your shop details and location, usually within 24 hours. You will get an SMS when you are live.'
              : 'Please contact Mere Points support. The reason was sent to your registered mobile.',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16, color: VP.muted, height: 1.4),
        ),
        const SizedBox(height: 28),
        BusyButton(label: 'Check again', outlined: true, onPressed: () => s.refresh()),
        const SizedBox(height: 10),
        if (isOwner)
          OutlinedButton(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LoyaltySettingsScreen())),
            child: const Text('Review loyalty rules'),
          ),
        const SizedBox(height: 10),
        TextButton(onPressed: s.chooseRoleAgain, child: Text(context.t('switch_role'))),
      ]),
    );
  }
}
