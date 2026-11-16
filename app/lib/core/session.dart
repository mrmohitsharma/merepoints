import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';

class ShopRole {
  final int id;
  final String name;
  final String status; // pending | approved | rejected | suspended
  final String role; // owner | staff
  final String? logoUrl;
  ShopRole({required this.id, required this.name, required this.status, required this.role, this.logoUrl});

  bool get isOwner => role == 'owner';
  bool get isApproved => status == 'approved';

  factory ShopRole.fromJson(Map<String, dynamic> j) =>
      ShopRole(id: j['id'] as int, name: '${j['name']}', status: '${j['status']}', role: '${j['role']}', logoUrl: j['logo_url'] as String?);
}

/// Which side of the app is showing. One login can be a customer and work at shops.
class ActiveRole {
  final bool isShop;
  final int? shopId;
  const ActiveRole.customer() : isShop = false, shopId = null;
  const ActiveRole.shop(int id) : isShop = true, shopId = id;

  String encode() => isShop ? 'shop:$shopId' : 'customer';
  static ActiveRole? decode(String? s) {
    if (s == null) return null;
    if (s == 'customer') return const ActiveRole.customer();
    if (s.startsWith('shop:')) {
      final id = int.tryParse(s.substring(5));
      if (id != null) return ActiveRole.shop(id);
    }
    return null;
  }
}

enum SessionState { loading, signedOut, needsRole, ready }

class Session extends ChangeNotifier {
  Session(this.api, {FlutterSecureStorage? storage}) : _store = storage ?? const FlutterSecureStorage() {
    api.onUnauthorized = () => signOut();
  }

  final ApiClient api;
  final FlutterSecureStorage _store;

  SessionState state = SessionState.loading;
  String language = 'en';
  bool languageChosen = false;

  int? userId;
  String? mobile;
  String? name;
  bool isCustomer = false;
  bool isSuperAdmin = false;
  List<ShopRole> shops = [];
  ActiveRole? active;

  ShopRole? get activeShop => active?.isShop == true ? shops.where((s) => s.id == active!.shopId).firstOrNull : null;

  Future<void> boot() async {
    final lang = await _store.read(key: 'lang');
    if (lang != null) {
      language = lang;
      languageChosen = true;
    }
    final token = await _store.read(key: 'token');
    if (token == null) {
      state = SessionState.signedOut;
      notifyListeners();
      return;
    }
    api.token = token;
    try {
      await refresh();
    } on ApiException catch (e) {
      if (e.isNetwork) {
        // Offline at launch: keep the session; screens show their own retry.
        active = ActiveRole.decode(await _store.read(key: 'role'));
        state = active == null ? SessionState.needsRole : SessionState.ready;
        notifyListeners();
      } else {
        await signOut();
      }
    }
  }

  Future<void> setLanguage(String code) async {
    language = code;
    languageChosen = true;
    await _store.write(key: 'lang', value: code);
    notifyListeners();
  }

  /// Called after OTP verify. [data] is the API's session payload.
  Future<void> signedIn(Map<String, dynamic> data) async {
    api.token = data['token'] as String;
    await _store.write(key: 'token', value: api.token);
    _apply(data);
    await _pickRole();
  }

  Future<void> refresh() async {
    final me = await api.get('auth/me') as Map<String, dynamic>;
    _apply(me);
    await _pickRole();
  }

  void _apply(Map<String, dynamic> me) {
    final u = me['user'] as Map<String, dynamic>;
    final r = me['roles'] as Map<String, dynamic>;
    userId = u['id'] as int;
    mobile = u['mobile'] as String?;
    name = u['name'] as String?;
    isCustomer = r['customer'] == true;
    isSuperAdmin = r['superAdmin'] == true;
    shops = (r['shops'] as List).map((e) => ShopRole.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> _pickRole() async {
    final saved = ActiveRole.decode(await _store.read(key: 'role'));
    bool valid(ActiveRole? a) => a != null && (a.isShop ? shops.any((s) => s.id == a.shopId) : isCustomer);
    if (valid(saved)) {
      active = saved;
    } else if (shops.isNotEmpty && !isCustomer) {
      active = ActiveRole.shop(shops.first.id);
    } else if (isCustomer && shops.isEmpty) {
      active = const ActiveRole.customer();
    } else {
      active = null; // new user, or has both and never chose
    }
    api.shopId = active?.shopId;
    state = active == null ? SessionState.needsRole : SessionState.ready;
    notifyListeners();
  }

  Future<void> switchTo(ActiveRole role) async {
    active = role;
    api.shopId = role.shopId;
    await _store.write(key: 'role', value: role.encode());
    state = SessionState.ready;
    notifyListeners();
  }

  /// Back to the "who are you?" picker (to register a shop, or become a customer too).
  void chooseRoleAgain() {
    state = SessionState.needsRole;
    notifyListeners();
  }

  Future<void> signOut() async {
    await _store.delete(key: 'token');
    await _store.delete(key: 'role');
    api.token = null;
    api.shopId = null;
    userId = null;
    shops = [];
    isCustomer = false;
    active = null;
    state = SessionState.signedOut;
    notifyListeners();
  }
}
