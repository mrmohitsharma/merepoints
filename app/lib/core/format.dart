import 'package:intl/intl.dart';

final _inr = NumberFormat('#,##,##0', 'en_IN');
final _inr2 = NumberFormat('#,##,##0.##', 'en_IN');

/// 175000 -> "1,75,000" (Indian grouping).
String pts(num n) => _inr.format(n);

/// 1750 -> "₹1,750"; 0.5 -> "₹0.5"
String rupees(num n) => '₹${n == n.roundToDouble() ? _inr.format(n) : _inr2.format(n)}';

num asNum(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;

String shortDate(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  if (d == null) return '';
  final now = DateTime.now();
  final t = DateFormat('h:mm a', 'en').format(d);
  if (d.year == now.year && d.month == now.month && d.day == now.day) return 'Today, $t';
  final y = now.subtract(const Duration(days: 1));
  if (d.year == y.year && d.month == y.month && d.day == y.day) return 'Yesterday, $t';
  return DateFormat('d MMM, h:mm a', 'en').format(d);
}

String dayMonth(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  return d == null ? '' : DateFormat('d MMM', 'en').format(d);
}

String initials(String? name) {
  final parts = (name ?? '').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}

/// Mobile shown as "98765 43210".
String prettyMobile(String? m) {
  if (m == null) return '';
  final ten = m.length > 10 ? m.substring(m.length - 10) : m;
  return ten.length == 10 ? '${ten.substring(0, 5)} ${ten.substring(5)}' : ten;
}

/// Work types. Starts with the built-in list so screens work offline; [loadProfessions] replaces it
/// with the Super Admin-editable list from the API (codes stay stable, names may change).
final Map<String, String> professions = {
  'carpenter': 'Carpenter',
  'painter': 'Painter',
  'contractor': 'Contractor',
  'interior_designer': 'Interior designer',
  'architect': 'Architect',
  'plumber': 'Plumber',
  'electrician': 'Electrician',
  'mason': 'Mason (raj mistri)',
  'tile_fitter': 'Tile fitter',
  'pop_ceiling': 'POP / false ceiling',
  'fabricator': 'Welder / fabricator',
  'kitchen_installer': 'Kitchen / wardrobe installer',
  'builder': 'Builder / site supervisor',
  'other': 'Other',
};

/// Emoji shown with each work type (Super Admin can change them). Built-in until the API list loads.
final Map<String, String> professionIcons = {
  'carpenter': '🪚', 'painter': '🖌️', 'contractor': '👷', 'interior_designer': '🛋️', 'architect': '📐', 'plumber': '🔧',
  'electrician': '⚡', 'mason': '🧱', 'tile_fitter': '🔲', 'pop_ceiling': '🏠', 'fabricator': '🔥', 'kitchen_installer': '🍳',
  'builder': '🏗️', 'other': '➕',
};

/// Hindi names from the API, used when the app language is Hindi.
final Map<String, String> professionsHi = {};

Future<void> loadProfessions(Future<dynamic> Function() fetch) async {
  try {
    final list = (await fetch()) as List;
    if (list.isEmpty) return;
    professions
      ..clear()
      ..addEntries(list.map((p) => MapEntry('${p['code']}', '${p['name']}')));
    professionsHi
      ..clear()
      ..addEntries(list.where((p) => p['nameHi'] != null).map((p) => MapEntry('${p['code']}', '${p['nameHi']}')));
    for (final p in list) {
      if (p['icon'] != null && '${p['icon']}'.isNotEmpty) professionIcons['${p['code']}'] = '${p['icon']}';
    }
  } catch (_) {
    // keep the built-in list
  }
}
