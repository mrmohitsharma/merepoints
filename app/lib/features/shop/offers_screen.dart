import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'message_screen.dart';

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
      appBar: AppBar(title: const Text('Offers & gifts')),
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
            SectionTitle('Gifts customers can take', trailing: TextButton(onPressed: () => _gift(context, null), child: const Text('+ Add gift'))),
            if (gifts.isEmpty) const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: InfoNote('Tools and useful items work best, e.g. a tool bag at 500 points.')),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: GridView.count(
                crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: 0.68,
                children: [
                  for (final g in gifts)
                    InkWell(
                      onTap: () => _gift(context, g),
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: g['photo_url'] != null
                                  ? Image.network('${g['photo_url']}', fit: BoxFit.cover, width: double.infinity, errorBuilder: (_, __, ___) => Container(color: VP.ground))
                                  : Container(color: VP.ground, child: const Center(child: Icon(Icons.card_giftcard, color: VP.muted))),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text('${g['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                          Text('${pts(asNum(g['points_cost']))} pts', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.blue, fontSize: 14)),
                          Text(asNum(g['stock']) == 0 ? 'Out of stock' : '${g['stock']} left',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: asNum(g['stock']) == 0 ? VP.red : asNum(g['stock']) <= 3 ? VP.amberText : VP.green)),
                        ]),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            WhiteCard(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MessageScreen())),
              child: const Row(children: [
                Icon(Icons.sms_outlined, color: VP.blue),
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

  Future<void> _gift(BuildContext context, Map<String, dynamic>? g) async {
    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _GiftSheet(gift: g));
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
          ChoiceChips<double>(options: const {1.25: '1.25x', 1.5: '1.5x', 2.0: '2x', 3.0: '3x'}, selected: {_mult}, onTap: (m) => setState(() => _mult = m)),
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

class _GiftSheet extends StatefulWidget {
  const _GiftSheet({this.gift});
  final Map<String, dynamic>? gift;
  @override
  State<_GiftSheet> createState() => _GiftSheetState();
}

class _GiftSheetState extends State<_GiftSheet> {
  late final _name = TextEditingController(text: widget.gift?['name'] as String? ?? '');
  late final _cost = TextEditingController(text: widget.gift?['points_cost']?.toString() ?? '');
  late final _stock = TextEditingController(text: widget.gift?['stock']?.toString() ?? '');
  late final _photo = TextEditingController(text: widget.gift?['photo_url'] as String? ?? '');
  late bool _visible = widget.gift?['visible'] as bool? ?? true;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.gift == null ? 'Add gift item' : 'Edit gift', style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          TextField(controller: _name, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Gift name', hintText: 'Electric kettle 1.5 L')),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _cost, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Points needed'))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _stock, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'How many in stock'))),
          ]),
          const SizedBox(height: 12),
          // Photo upload needs a storage bucket (S3/GCS). Until then, paste an image link.
          TextField(controller: _photo, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Photo link (optional)')),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Show in customer app'), subtitle: const Text('Customers see what they can save up for'), value: _visible, onChanged: (v) => setState(() => _visible = v)),
          const SizedBox(height: 8),
          BusyButton(
            label: 'Save gift',
            color: VP.amber,
            textColor: VP.ink,
            onPressed: () async {
              final cost = int.tryParse(_cost.text), stock = int.tryParse(_stock.text);
              if (_name.text.trim().length < 2 || cost == null || cost <= 0 || stock == null) throw ApiException(400, 'GIFT', 'Fill name, points and stock');
              await context.read<ApiClient>().spost('gifts', {
                if (widget.gift != null) 'id': widget.gift!['id'],
                'name': _name.text.trim(), 'pointsCost': cost, 'stock': stock, 'visible': _visible,
                if (_photo.text.trim().startsWith('http')) 'photoUrl': _photo.text.trim(),
              });
              if (context.mounted) Navigator.pop(context, true);
            },
          ),
          const SizedBox(height: 4),
          const Text('Stock goes down when a customer is given the gift', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: VP.muted)),
        ]),
      );
}
