import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'packages_screen.dart';

const _levelNames = ['Silver', 'Gold', 'Platinum'];
const _levelColors = [Color(0xFF8A94A3), Color(0xFFD99A00), Color(0xFF3A8FB7)];

/// Offers screen: "Loyalty goals" (visits / spend bonus) and "Shop levels" (Silver, Gold, Platinum).
/// Both come with the Advanced package; without it the cards show a lock and a way to upgrade.
class PerksSection extends StatefulWidget {
  const PerksSection({super.key});
  @override
  State<PerksSection> createState() => _PerksSectionState();
}

class _PerksSectionState extends State<PerksSection> {
  late Future<Map<String, dynamic>> _f = _load();

  Future<Map<String, dynamic>> _load() async => await context.read<ApiClient>().sget('perks') as Map<String, dynamic>;
  void _reload() => setState(() => _f = _load());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>>(
      future: _f,
      builder: (context, snap) {
        if (snap.hasError) {
          return Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: ErrorRetry(error: snap.error!, onRetry: _reload));
        }
        if (!snap.hasData) {
          return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
        }
        final d = snap.data!;
        final f = d['features'] as Map<String, dynamic>;
        final goals = (d['goals'] as List).cast<Map<String, dynamic>>();
        final levels = (d['levels'] as List).cast<Map<String, dynamic>>();
        final pointValue = asNum(d['pointValueRupees']).toDouble();
        final base = asNum(d['baseRewardPercent']).toDouble();
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SectionTitle(
            'Loyalty goals',
            trailing: f['goals'] == true ? TextButton(onPressed: () => _newGoal(pointValue), child: const Text('+ New goal')) : null,
          ),
          if (f['goals'] != true && goals.isEmpty)
            const _Locked(title: 'Visits and spend goals', text: 'Give bonus points to customers who visit often or buy a lot.')
          else ...[
            if (f['goals'] != true) const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 8), child: InfoNote('Goals are paused: your package no longer includes them. You can stop them here.', icon: Icons.lock_outline, color: VP.amberText, bg: VP.amberSoft)),
            if (goals.isEmpty) const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: InfoNote('No goals yet. Example: 5 visits in 30 days = 200 bonus points.')),
            for (final g in goals)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: WhiteCard(
                  child: Row(children: [
                    Container(
                      width: 46, height: 46,
                      decoration: BoxDecoration(color: VP.blueSoft, borderRadius: BorderRadius.circular(12)),
                      child: Icon(g['kind'] == 'visits' ? Icons.repeat : Icons.currency_rupee, color: VP.blue),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${g['label']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        Text('Bonus ${pts(asNum(g['bonusPoints']))} points (about ${rupees(asNum(g['bonusPoints']) * pointValue)}) · repeats every period',
                            style: const TextStyle(fontSize: 13, color: VP.muted)),
                      ]),
                    ),
                    IconButton(tooltip: 'Stop this goal', icon: const Icon(Icons.stop_circle_outlined, color: VP.red), onPressed: () => _stop(g)),
                  ]),
                ),
              ),
          ],
          SectionTitle(
            'Shop levels',
            trailing: f['levels'] == true ? TextButton(onPressed: () => _editLevels(levels, base), child: Text(levels.isEmpty ? 'Set up' : 'Edit')) : null,
          ),
          if (f['levels'] != true)
            const _Locked(title: 'Silver, Gold and Platinum levels', text: 'Customers who spend more at your shop earn a higher % on every bill.')
          else if (levels.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: InfoNote('No levels yet. Example: spend ₹50,000 in a year to reach Gold and earn more on every bill.'))
          else
            for (final l in levels)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: WhiteCard(
                  child: Row(children: [
                    Container(
                      width: 46, height: 46, alignment: Alignment.center,
                      decoration: BoxDecoration(color: _levelColors[(l['rank'] as int) - 1].withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                      child: Icon(Icons.workspace_premium, color: _levelColors[(l['rank'] as int) - 1]),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${l['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        Text('Spend ${rupees(asNum(l['minSpendRupees']))} in a year · ${asNum(l['rewardPercent'])}% on every bill', style: const TextStyle(fontSize: 13, color: VP.muted)),
                      ]),
                    ),
                  ]),
                ),
              ),
        ]);
      },
    );
  }

  Future<void> _stop(Map<String, dynamic> g) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Stop this goal?'),
        content: Text('${g['label']}. Customers will no longer see it. Bonus already given stays with them.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Stop goal'))],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<ApiClient>().spost('perks/goals/${g['id']}/stop');
      _reload();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _newGoal(double pointValue) async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _GoalSheet(pointValue: pointValue));
    if (ok == true) _reload();
  }

  Future<void> _editLevels(List<Map<String, dynamic>> current, double base) async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _LevelsSheet(current: current, base: base));
    if (ok == true) _reload();
  }
}

class _Locked extends StatelessWidget {
  const _Locked({required this.title, required this.text});
  final String title, text;
  @override
  Widget build(BuildContext context) {
    return WhiteCard(
      child: Row(children: [
        const Icon(Icons.lock_outline, color: VP.muted),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('$text Included in the Advanced package.', style: const TextStyle(fontSize: 13, color: VP.muted)),
          ]),
        ),
        TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PackagesScreen())), child: const Text('Upgrade')),
      ]),
    );
  }
}

class _GoalSheet extends StatefulWidget {
  const _GoalSheet({required this.pointValue});
  final double pointValue;
  @override
  State<_GoalSheet> createState() => _GoalSheetState();
}

class _GoalSheetState extends State<_GoalSheet> {
  int _kind = 0; // 0 visits, 1 spend
  int _visits = 5;
  int _spend = 50000;
  int _days = 30;
  int _bonus = 200;

  @override
  Widget build(BuildContext context) {
    final visits = _kind == 0;
    final goalText = visits ? '$_visits visits in $_days days' : 'spend ${rupees(_spend)} in $_days days';
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('New loyalty goal', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          Segmented(labels: const ['Visits', 'Spend'], index: _kind, onChanged: (i) => setState(() => _kind = i)),
          const SizedBox(height: 14),
          Text(visits ? 'Number of visits (bills)' : 'Amount to spend', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (visits)
            ChoiceChips<int>(options: const {3: '3', 5: '5', 8: '8', 10: '10', 15: '15'}, selected: {_visits}, onTap: (v) => setState(() => _visits = v))
          else
            ChoiceChips<int>(
              options: const {10000: '₹10,000', 25000: '₹25,000', 50000: '₹50,000', 100000: '₹1,00,000'},
              selected: {_spend},
              onTap: (v) => setState(() => _spend = v),
            ),
          const SizedBox(height: 14),
          const Text('Within how many days', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ChoiceChips<int>(options: const {7: '7', 15: '15', 30: '30', 60: '60', 90: '90'}, selected: {_days}, onTap: (v) => setState(() => _days = v)),
          const SizedBox(height: 14),
          const Text('Bonus points', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ChoiceChips<int>(options: const {50: '50', 100: '100', 200: '200', 500: '500', 1000: '1,000'}, selected: {_bonus}, onTap: (v) => setState(() => _bonus = v)),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(14)),
            child: Text(
              'A customer who reaches $goalText gets $_bonus bonus points (about ${rupees(_bonus * widget.pointValue)} of your money). '
              'It repeats: they can earn it again in every new $_days days.',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(height: 8),
          const InfoNote('Counting starts today. Earlier bills do not count. You can have up to 5 goals running.', color: VP.amberText, bg: VP.amberSoft),
          const SizedBox(height: 16),
          BusyButton(
            label: 'Start goal',
            onPressed: () async {
              await context.read<ApiClient>().spost('perks/goals', {
                'kind': visits ? 'visits' : 'spend',
                'target': visits ? _visits : _spend,
                'periodDays': _days,
                'bonusPoints': _bonus,
              });
              if (context.mounted) Navigator.pop(context, true);
            },
          ),
        ]),
      ),
    );
  }
}

class _LevelsSheet extends StatefulWidget {
  const _LevelsSheet({required this.current, required this.base});
  final List<Map<String, dynamic>> current;
  final double base;
  @override
  State<_LevelsSheet> createState() => _LevelsSheetState();
}

class _LevelsSheetState extends State<_LevelsSheet> {
  final _on = [false, false, false];
  final _spend = [TextEditingController(), TextEditingController(), TextEditingController()];
  final _pct = [TextEditingController(), TextEditingController(), TextEditingController()];

  @override
  void initState() {
    super.initState();
    const spendDefaults = [10000, 50000, 150000];
    for (var i = 0; i < 3; i++) {
      final have = widget.current.where((l) => l['rank'] == i + 1);
      if (have.isNotEmpty) {
        _on[i] = true;
        _spend[i].text = '${asNum(have.first['minSpendRupees']).round()}';
        _pct[i].text = '${asNum(have.first['rewardPercent'])}';
      } else {
        _spend[i].text = '${spendDefaults[i]}';
        _pct[i].text = '${widget.base + (i + 1)}';
      }
    }
  }

  @override
  void dispose() {
    for (final c in [..._spend, ..._pct]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Shop levels', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('A customer\'s level comes from what they spent at your shop in the last 12 months. Your normal reward is ${widget.base}%.', style: const TextStyle(color: VP.muted)),
          const SizedBox(height: 12),
          for (var i = 0; i < 3; i++) ...[
            Row(children: [
              Icon(Icons.workspace_premium, color: _levelColors[i]),
              const SizedBox(width: 8),
              Expanded(child: Text(_levelNames[i], style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
              Switch(value: _on[i], onChanged: (v) => setState(() => _on[i] = v)),
            ]),
            if (_on[i])
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _spend[i],
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)],
                      decoration: const InputDecoration(labelText: 'Spend in a year (₹)', isDense: true),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _pct[i],
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')), LengthLimitingTextInputFormatter(5)],
                      decoration: const InputDecoration(labelText: 'Reward %', isDense: true),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                ]),
              ),
          ],
          if (_on.any((e) => e))
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(14)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var i = 0; i < 3; i++)
                  if (_on[i])
                    Text('${_levelNames[i]}: spends ${rupees(num.tryParse(_spend[i].text) ?? 0)} → ${_pct[i].text.isEmpty ? '?' : _pct[i].text}% instead of ${widget.base}%',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
              ]),
            ),
          const SizedBox(height: 8),
          const InfoNote('Each level needs more spend and a higher % than the one before. The level counts from the customer\'s next bill.', color: VP.amberText, bg: VP.amberSoft),
          const SizedBox(height: 16),
          BusyButton(
            label: 'Save levels',
            onPressed: () async {
              final levels = [
                for (var i = 0; i < 3; i++)
                  if (_on[i])
                    {
                      'rank': i + 1,
                      'minSpendRupees': num.tryParse(_spend[i].text) ?? 0,
                      'rewardPercent': num.tryParse(_pct[i].text) ?? 0,
                    },
              ];
              await context.read<ApiClient>().put('shop/perks/levels', {'levels': levels}, shop: true);
              if (context.mounted) Navigator.pop(context, true);
            },
          ),
        ]),
      ),
    );
  }
}
