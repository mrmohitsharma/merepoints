import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'shop_card_screen.dart';

const _levelColors = [Color(0xFF8A94A3), Color(0xFFD99A00), Color(0xFF3A8FB7)];
Color _levelColor(dynamic rank) {
  final i = (asNum(rank).toInt() - 1).clamp(0, 2);
  return _levelColors[i];
}

List<Map<String, dynamic>> _list(dynamic v) => v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];

/// A customer's level at one shop: badge, % on every bill, and how far to the next level.
class LevelProgress extends StatelessWidget {
  const LevelProgress({super.key, required this.levels, required this.my});
  final List<Map<String, dynamic>> levels;
  final Map<String, dynamic>? my;

  @override
  Widget build(BuildContext context) {
    if (levels.isEmpty) return const SizedBox.shrink();
    final level = my?['level'] as Map?;
    final next = my?['next'] as Map?;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (my != null)
        Row(children: [
          Icon(Icons.workspace_premium, color: level == null ? VP.muted : _levelColor(level['rank'])),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              level == null ? context.t('no_level') : context.tf('level_line', {'name': '${level['name']}', 'pct': '${asNum(level['rewardPercent'])}'}),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
        ]),
      if (my != null && next != null)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(context.tf('level_next', {'need': rupees(asNum(next['needRupees'])), 'name': '${next['name']}', 'pct': '${asNum(next['rewardPercent'])}'}),
              style: const TextStyle(fontSize: 13, color: VP.muted)),
        ),
      if (my != null && level != null && next == null)
        Padding(padding: const EdgeInsets.only(top: 4), child: Text(context.t('level_top'), style: const TextStyle(fontSize: 13, color: VP.green))),
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, children: [
        for (final l in levels)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(color: _levelColor(l['rank']).withValues(alpha: 0.14), borderRadius: BorderRadius.circular(20)),
            child: Text('${l['name']} ${rupees(asNum(l['minSpendRupees']))} → ${asNum(l['rewardPercent'])}%', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: _levelColor(l['rank']))),
          ),
      ]),
    ]);
  }
}

/// Goal rows with a progress bar when the server sent this customer's progress.
class GoalRows extends StatelessWidget {
  const GoalRows({super.key, required this.goals});
  final List<Map<String, dynamic>> goals;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final g in goals) ...[
        _goal(context, g),
        const SizedBox(height: 8),
      ],
    ]);
  }

  Widget _goal(BuildContext context, Map<String, dynamic> g) {
    final p = g['progress'] as Map?;
    final visits = g['kind'] == 'visits';
    final target = p == null ? 0 : asNum(p['target']).toDouble();
    final done = p == null ? 0 : asNum(p['done']).toDouble();
    final achieved = p?['achieved'] == true;
    final left = p?['daysLeft'];
    final days = '${asNum(g['periodDays'])}';
    final label = visits
        ? context.tf('goal_visits', {'n': '${asNum(g['target'])}', 'd': days})
        : context.tf('goal_spend', {'amt': rupees(asNum(g['target'])), 'd': days});
    final doneText = visits
        ? context.tf('goal_visits_prog', {'done': '${done.round()}', 'target': '${target.round()}'})
        : context.tf('goal_of', {'done': rupees(done), 'target': rupees(target)});
    final progText = left == null ? doneText : '$doneText · ${context.tf('days_left', {'n': '$left'})}';
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Icon(visits ? Icons.repeat : Icons.currency_rupee, size: 18, color: achieved ? VP.green : VP.blue),
        const SizedBox(width: 8),
        Expanded(child: Text(context.tf('goal_line', {'label': label, 'pts': pts(asNum(g['bonusPoints']))}), style: const TextStyle(fontWeight: FontWeight.w600))),
      ]),
      if (p != null && target > 0) ...[
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(value: (done / target).clamp(0.0, 1.0), minHeight: 8, backgroundColor: VP.line, color: achieved ? VP.green : VP.blue),
        ),
        const SizedBox(height: 4),
        Text(
          achieved ? context.t('goal_done') : progText,
          style: TextStyle(fontSize: 12.5, color: achieved ? VP.green : VP.muted),
        ),
      ],
    ]);
  }
}

/// Everything a shop offers (levels + goals), used on the shop card screen.
class ShopPerksPanel extends StatelessWidget {
  const ShopPerksPanel({super.key, required this.perks});
  final Map<String, dynamic>? perks;

  @override
  Widget build(BuildContext context) {
    final p = perks;
    if (p == null) return const SizedBox.shrink();
    final levels = _list(p['levels']);
    final goals = _list(p['goals']);
    if (levels.isEmpty && goals.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionTitle(context.t('extra_here')),
      WhiteCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (levels.isNotEmpty) LevelProgress(levels: levels, my: p['my'] as Map<String, dynamic>?),
          if (levels.isNotEmpty && goals.isNotEmpty) const Divider(height: 24),
          if (goals.isNotEmpty) GoalRows(goals: goals),
        ]),
      ),
    ]);
  }
}

/// Compact card for one shop in the rewards list (home and See all).
class ShopRewardTile extends StatelessWidget {
  const ShopRewardTile({super.key, required this.item, this.onBack});
  final Map<String, dynamic> item;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final levels = _list(item['levels']);
    final goals = _list(item['goals']);
    final my = item['my'] as Map<String, dynamic>?;
    final level = my?['level'] as Map?;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: WhiteCard(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShopCardScreen(shopId: asNum(item['shopId']).toInt()))).then((_) => onBack?.call()),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            ShopLogo(name: '${item['name']}', url: item['logoUrl'] as String?, size: 40),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${item['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                if ((item['city'] ?? '').toString().isNotEmpty) Text('${item['city']}', style: const TextStyle(fontSize: 12.5, color: VP.muted)),
              ]),
            ),
            if (level != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: _levelColor(level['rank']).withValues(alpha: 0.14), borderRadius: BorderRadius.circular(20)),
                child: Text('${level['name']}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _levelColor(level['rank']))),
              ),
            const Icon(Icons.chevron_right, color: VP.muted),
          ]),
          const SizedBox(height: 10),
          if (goals.isNotEmpty) GoalRows(goals: goals.take(2).toList()),
          if (levels.isNotEmpty) LevelProgress(levels: levels, my: my),
        ]),
      ),
    );
  }
}

/// Home screen block: 2–3 shops and a See all button. Renders nothing when no shop offers anything.
class RewardsSection extends StatelessWidget {
  const RewardsSection({super.key, required this.data, this.onBack});
  final Map<String, dynamic>? data;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final items = _list(data?['items']);
    if (items.isEmpty) return const SizedBox.shrink();
    final more = data?['hasMore'] == true;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionTitle(
        context.t('rewards_title'),
        trailing: TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RewardsScreen())).then((_) => onBack?.call()), child: Text(more ? context.t('see_all') : context.t('details'))),
      ),
      for (final it in items.take(3)) ShopRewardTile(item: it, onBack: onBack),
    ]);
  }
}

/// See all: every shop in the customer's city with goals or levels.
class RewardsScreen extends StatefulWidget {
  const RewardsScreen({super.key});
  @override
  State<RewardsScreen> createState() => _RewardsScreenState();
}

class _RewardsScreenState extends State<RewardsScreen> {
  static const _page = 20;
  final _items = <Map<String, dynamic>>[];
  bool _more = false, _loading = true, _loadingMore = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final r = await context.read<ApiClient>().get('me/rewards', query: {'limit': '$_page', 'offset': '${reset ? 0 : _items.length}'}) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(_list(r['items']));
        _more = r['hasMore'] == true;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error != null && _items.isEmpty) {
      body = ErrorRetry(error: _error!, onRetry: () => _load(reset: true));
    } else if (_items.isEmpty) {
      body = Center(
        child: Padding(padding: const EdgeInsets.all(24), child: Text(context.t('rewards_empty'), textAlign: TextAlign.center, style: const TextStyle(color: VP.muted, fontSize: 16))),
      );
    } else {
      body = RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView(padding: const EdgeInsets.only(top: 8, bottom: 24), children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: InfoNote(context.t('rewards_note'), icon: Icons.card_giftcard)),
          for (final it in _items) ShopRewardTile(item: it, onBack: () => _load(reset: true)),
          if (_more)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: OutlinedButton(onPressed: _loadingMore ? null : () => _load(), child: _loadingMore ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(context.t('show_more_shops'))),
            ),
        ]),
      );
    }
    return Scaffold(appBar: AppBar(title: Text(context.t('rewards_screen'))), body: body);
  }
}
