import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

/// Base URL comes from `--dart-define=API_URL=https://api.vyaparpoint.in/v1`.
/// Android emulator reaches the host machine at 10.0.2.2.
const String kApiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000/v1');

/// Every API error carries a stable [code] (e.g. DUPLICATE_INVOICE) the UI can switch on,
/// and a human [message] already written for shop owners and customers.
class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  final dynamic details;
  ApiException(this.status, this.code, this.message, [this.details]);

  bool get isNetwork => status == 0;
  bool get isAuth => status == 401;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  String? token;
  int? shopId; // set when acting as a shop; sent as X-Shop-Id
  void Function()? onUnauthorized;

  static final _rand = Random.secure();

  /// Random key so a retried add-points request never adds points twice.
  static String newIdempotencyKey() =>
      List.generate(24, (_) => '0123456789abcdefghijklmnopqrstuvwxyz'[_rand.nextInt(36)]).join();

  Map<String, String> _headers({bool shop = false, String? idempotencyKey}) => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        if (shop && shopId != null) 'X-Shop-Id': '$shopId',
        if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
      };

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && '$v'.isNotEmpty) q[k] = '$v';
    });
    return Uri.parse('$kApiUrl/$path').replace(queryParameters: q.isEmpty ? null : q);
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query, bool shop = false}) =>
      _send(() => _http.get(_uri(path, query), headers: _headers(shop: shop)));

  Future<dynamic> post(String path, [Object? body, bool shop = false, String? idempotencyKey]) =>
      _send(() => _http.post(_uri(path), headers: _headers(shop: shop, idempotencyKey: idempotencyKey), body: jsonEncode(body ?? {})));

  Future<dynamic> put(String path, Object body, {bool shop = false}) =>
      _send(() => _http.put(_uri(path), headers: _headers(shop: shop), body: jsonEncode(body)));

  Future<dynamic> patch(String path, Object body, {bool shop = false}) =>
      _send(() => _http.patch(_uri(path), headers: _headers(shop: shop), body: jsonEncode(body)));

  /// Shop-scoped helpers (adds X-Shop-Id).
  Future<dynamic> sget(String path, {Map<String, dynamic>? query}) => get(path.isEmpty ? 'shop' : 'shop/$path', query: query, shop: true);
  Future<dynamic> spost(String path, [Object? body, String? idempotencyKey]) => post('shop/$path', body, true, idempotencyKey);

  /// Link to a file endpoint (CSV) with auth in the URL is not supported; callers download via [getRaw].
  Future<String> getRaw(String path, {Map<String, dynamic>? query, bool shop = false}) async {
    final r = await _http.get(_uri(path, query), headers: _headers(shop: shop)).timeout(const Duration(seconds: 30));
    if (r.statusCode >= 400) throw _toError(r);
    return utf8.decode(r.bodyBytes);
  }

  Future<dynamic> _send(Future<http.Response> Function() call) async {
    http.Response r;
    try {
      r = await call().timeout(const Duration(seconds: 20));
    } on TimeoutException {
      throw ApiException(0, 'NETWORK', 'Network is slow. Please try again.');
    } catch (_) {
      throw ApiException(0, 'NETWORK', 'No internet connection. Please try again.');
    }
    if (r.statusCode >= 400) {
      final e = _toError(r);
      if (e.isAuth) onUnauthorized?.call();
      throw e;
    }
    if (r.body.isEmpty) return null;
    return jsonDecode(utf8.decode(r.bodyBytes));
  }

  ApiException _toError(http.Response r) {
    try {
      final j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
      return ApiException(r.statusCode, '${j['code'] ?? 'ERROR'}', '${j['message'] ?? 'Something went wrong'}', j['details']);
    } catch (_) {
      return ApiException(r.statusCode, 'ERROR', 'Something went wrong (${r.statusCode})');
    }
  }
}
