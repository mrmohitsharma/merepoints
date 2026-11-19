import 'package:flutter/material.dart';

import '../../core/i18n.dart';
import '../../core/theme.dart';
import 'customer_home_screen.dart';
import 'history_screen.dart';
import 'my_qr_screen.dart';
import 'explore_screen.dart';
import 'profile_screen.dart';

/// Customer side: Home, Explore (Shops | Products), [My QR], History, Profile.
class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key});
  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends State<CustomerShell> {
  int _tab = 0;
  final _exploreTab = ValueNotifier<int>(0);

  @override
  void dispose() {
    _exploreTab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      CustomerHomeScreen(
        onFindShops: () => setState(() {
          _exploreTab.value = 0;
          _tab = 1;
        }),
        onSeeAllProducts: () => setState(() {
          _exploreTab.value = 1;
          _tab = 1;
        }),
      ),
      ExploreScreen(tab: _exploreTab),
      const SizedBox.shrink(),
      const HistoryScreen(),
      const ProfileScreen(),
    ];
    Widget nav(int i, IconData icon, String label) => Expanded(
          child: InkWell(
            onTap: () => setState(() => _tab = i),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, color: _tab == i ? VP.blue : VP.muted),
              Text(label, style: TextStyle(fontSize: 12, color: _tab == i ? VP.blue : VP.muted, fontWeight: _tab == i ? FontWeight.w700 : FontWeight.w500)),
            ]),
          ),
        );
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: SizedBox(
        width: 68,
        height: 68,
        child: FloatingActionButton(
          heroTag: 'myqr',
          backgroundColor: VP.amber,
          shape: const CircleBorder(side: BorderSide(color: Colors.white, width: 5)),
          tooltip: context.t('my_qr'),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MyQrScreen())),
          child: const Icon(Icons.qr_code_2, color: VP.ink, size: 32),
        ),
      ),
      bottomNavigationBar: BottomAppBar(
        height: 72,
        color: Colors.white,
        padding: EdgeInsets.zero,
        notchMargin: 6,
        shape: const CircularNotchedRectangle(),
        child: Row(children: [
          nav(0, Icons.home_outlined, context.t('home')),
          nav(1, Icons.explore_outlined, context.t('explore')),
          const Expanded(child: SizedBox()),
          nav(3, Icons.list_alt, context.t('history')),
          nav(4, Icons.person_outline, context.t('profile')),
        ]),
      ),
    );
  }
}
