import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'core/api.dart';
import 'core/format.dart';
import 'core/i18n.dart';
import 'core/push.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'features/auth/language_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/role_picker_screen.dart';
import 'features/customer/customer_shell.dart';
import 'features/shop/shop_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final api = ApiClient();
  final session = Session(api)..boot();
  final inbox = Inbox(api);
  session.beforeSignOut = inbox.stop;
  loadProfessions(() => api.get('shops/professions'));
  runApp(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: api),
        ChangeNotifierProvider<Session>.value(value: session),
        ChangeNotifierProvider<Inbox>.value(value: inbox),
      ],
      child: const MerePointsApp(),
    ),
  );
}

class MerePointsApp extends StatelessWidget {
  const MerePointsApp({super.key});

  @override
  Widget build(BuildContext context) {
    final lang = context.select<Session, String>((s) => s.language);
    return MaterialApp(
      title: 'Mere Points',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: Locale(lang),
      supportedLocales: languages.map((l) => Locale(l.$1)),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const RootSwitch(),
    );
  }
}

/// Decides what the user sees based on session state. Each branch has its own navigation stack,
/// so switching role (customer ⇄ shop) starts a clean stack.
class RootSwitch extends StatelessWidget {
  const RootSwitch({super.key});

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    switch (s.state) {
      case SessionState.loading:
        return const _Splash();
      case SessionState.signedOut:
        return s.languageChosen ? const LoginScreen() : const LanguageScreen();
      case SessionState.needsRole:
        return const RolePickerScreen();
      case SessionState.ready:
        final a = s.active!;
        return a.isShop ? ShopShell(key: ValueKey('shop-${a.shopId}')) : const CustomerShell(key: ValueKey('customer'));
    }
  }
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.white,
        body: Center(child: Image.asset('assets/brand/logo.png', width: 230, semanticLabel: 'Mere Points')),
      );
}
