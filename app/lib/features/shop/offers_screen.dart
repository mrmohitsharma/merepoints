import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'notifications_screen.dart';
import 'perks_section.dart';
import 'products_screen.dart';

/// Bonus-points offers (one at a time) and the gift catalogue.
class OffersScreen extends StatefulWidget {
  const OffersScreen({super.key});
  @override
  State<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends State<OffersScreen> {
  final _key = GlobalKey<AsyncViewState<List<dynamic>>>();

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Offers')),
      body: AsyncView<List<dynamic>>(
        key: _key,
        load: () => Future.wait([api.sget('offers'), api.sget('gifts')]),
        builder: (context, d, reload) {
          final offers = (d[0] as List).cast<Map<String, dynamic>>();
          final gifts = (d[1] as List).cast<Map<String, dynamic>>();
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            SectionTitle('Bonus points offers', trailing: TextButton(onPressed: () => _newOffer(context), child: const Text('+ New offer'))),
            if (offers.isEmpty) const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: InfoNote('No offers yet. Example: 1.5x points for Diwali.')),
            for (final o in offers)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: WhiteCard(
                  color: o['status'] == 'live' ? VP.blue : Colors.white,
                  child: Opacity(
                    opacity: o['status'] == 'ended' || o['status'] == 'cancelled' ? 0.6 : 1,
                    child: Row(children: [
                      Container(
                        width: 58, height: 58, alignment: Alignment.center,
                        decoration: BoxDecoration(color: o['status'] == 'live' ? VP.amber : VP.blueSoft, borderRadius: BorderRadius.circular(14)),
                        child: Text('${asNum(o['multiplier'])}x', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: o['status'] == 'live' ? VP.ink : VP.blue)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${o['name']}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: o['status'] == 'live' ? Colors.white : VP.ink)),
                          Text('${dayMonth(o['starts_at'])} – ${dayMonth(o['ends_at'])} · ${o['professions'] == null ? 'all customers' : (o['professions'] as List).map((p) => professions[p]).join(', ')}',
                              style: TextStyle(fontSize: 13, color: o['status'] == 'live' ? Colors.white70 : VP.muted)),
                          Text(
                            '${'${o['status']}'.toUpperCase()}${o['status'] == 'live' || o['status'] == 'ended' ? ' · ${pts(asNum(o['extra_points']))} extra pts given' : ''}',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: o['status'] == 'live' ? const Color(0xFFF2C14E) : VP.blue),
                          ),
                        ]),
                      ),
                      if (o['status'] == 'live' || o['status'] == 'scheduled')
                        IconButton(
                          tooltip: o['status'] == 'live' ? 'End now' : 'Cancel',
                          icon: Icon(Icons.stop_circle_outlined, color: o['status'] == 'live' ? Colors.white : VP.red),
                          onPressed: () async {
                            try {
                              await api.spost('offers/${o['id']}/cancel');
                              await reload();
                            } catch (e) {
                              if (context.mounted) showError(context, e);
                            }
                          },
                        ),
                    ]),
                  ),
                ),
              ),
            const PerksSection(),
            const SizedBox(height: 14),
            WhiteCard(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShopProductsScreen())),
              child: Row(children: [
                const Icon(Icons.inventory_2_outlined, color: VP.blue),
                const SizedBox(width: 10),
                Expanded(child: Text('Gifts & bonus products · ${gifts.length} gifts', style: const TextStyle(fontWeight: FontWeight.w600))),
                const Icon(Icons.chevron_right),
              ]),
            ),
            const SizedBox(height: 14),
            WhiteCard(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShopNotificationsScreen())),
              child: const Row(children: [
                Icon(Icons.notifications_active_outlined, color: VP.blue),
                SizedBox(width: 10),
                Expanded(child: Text('Tell customers about your offers', style: TextStyle(fontWeight: FontWeight.w600))),
                Icon(Icons.chevron_right),
              ]),
            ),
          ]);
        },
      ),
    );
  }

  Future<void> _newOffer(BuildContext context) async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => const _NewOfferSheet());
    if (ok == true) _key.currentState?.reload();
  }


}

class _NewOfferSheet extends StatefulWidget {
  const _NewOfferSheet();
  @override
  State<_NewOfferSheet> createState() => _NewOfferSheetState();
}

class _NewOfferSheetState extends State<_NewOfferSheet> {
  final _name = TextEditingController();
  double _mult = 1.5;
  DateTimeRange _range = DateTimeRange(start: DateTime.now(), end: DateTime.now().add(const Duration(days: 7)));
  final Set<String> _profs = {};

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('d MMM yyyy', 'en');
    final base = 500;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('New bonus offer', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Offer name', hintText: 'Diwali Dhamaka')),
          const SizedBox(height: 14),
          const Text('Extra points', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ChoiceChips<double>(options: {1.25: '1.25x', 1.5: '1.5x', 2.0: '2x', 3.0: '3x'}, selected: {_mult}, onTap: (m) => setState(() => _mult = m)),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            icon: const Icon(Icons.date_range),
            label: Text('${df.format(_range.start)} – ${df.format(_range.end)}'),
            onPressed: () async {
              final r = await showDateRangePicker(context: context, firstDate: DateTime.now().subtract(const Duration(days: 1)), lastDate: DateTime.now().add(const Duration(days: 365)), initialDateRange: _range);
              if (r != null) setState(() => _range = r);
            },
          ),
          const SizedBox(height: 14),
          const Text('Who gets it (none selected = all customers)', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ChoiceChips<String>(multi: true, options: professions, selected: _profs, onTap: (p) => setState(() => _profs.contains(p) ? _profs.remove(p) : _profs.add(p))),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(14)),
            child: Text('Example: a bill that earns $base points earns ${(base * _mult).floor()} during the offer', style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
          const SizedBox(height: 8),
          const InfoNote('Only one offer can run at a time. Dates can\'t overlap another offer.', color: VP.amberText, bg: VP.amberSoft),
          const SizedBox(height: 16),
          BusyButton(
            label: 'Start offer',
            onPressed: () async {
              if (_name.text.trim().length < 2) throw ApiException(400, 'NAME', 'Give the offer a name');
              final start = DateUtils.dateOnly(_range.start);
              final startAt = start.isAfter(DateTime.now()) ? start : DateTime.now();
              final endAt = DateUtils.dateOnly(_range.end).add(const Duration(days: 1)); // end of the last day
              await context.read<ApiClient>().spost('offers', {
                'name': _name.text.trim(),
                'multiplier': _mult,
                'startsAt': startAt.toUtc().toIso8601String(),
                'endsAt': endAt.toUtc().toIso8601String(),
                'professions': _profs.isEmpty ? null : _profs.toList(),
              });
              if (context.mounted) Navigator.pop(context, true);
            },
          ),
        ]),
      ),
    );
  }
}

