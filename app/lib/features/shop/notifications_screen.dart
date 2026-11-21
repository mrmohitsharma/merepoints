import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/upload.dart';
import '../../widgets/common.dart';

Widget _pad(Widget w) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: w);
String _pct(num a, num b) => b == 0 ? '0%' : '${(a * 100 / b).round()}%';
String _when(dynamic iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  return d == null ? '' : DateFormat('d MMM, h:mm a').format(d);
}

/// Notifications the shop has sent, with how each one did. Replaces the old SMS screen.
class ShopNotificationsScreen extends StatefulWidget {
  const ShopNotificationsScreen({super.key});
  @override
  State<ShopNotificationsScreen> createState() => _ShopNotificationsScreenState();
}

class _ShopNotificationsScreenState extends State<ShopNotificationsScreen> {
  List<Map<String, dynamic>>? _items;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.read<ApiClient>().sget('notifications') as List;
      if (mounted) {
        setState(() {
          _items = r.cast<Map<String, dynamic>>();
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _new() async {
    final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const NewNotificationScreen()));
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add), label: const Text('New notification')),
      body: _error != null
          ? ErrorRetry(error: _error!, onRetry: _load)
          : items == null
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 100),
                          Icon(Icons.notifications_active_outlined, size: 56, color: VP.blue),
                          SizedBox(height: 12),
                          Center(child: Text('Reach your carpenters, painters and contractors', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700), textAlign: TextAlign.center)),
                          Padding(
                            padding: EdgeInsets.all(24),
                            child: Text('Send an offer or a reminder to their phone. You will see how many opened it and how many tapped the button.', textAlign: TextAlign.center, style: TextStyle(color: VP.muted)),
                          ),
                        ])
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(0, 12, 0, 110),
                          itemCount: items.length,
                          itemBuilder: (_, i) => _NotificationTile(n: items[i], onChanged: _load),
                        ),
                ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.n, required this.onChanged});
  final Map<String, dynamic> n;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final status = '${n['status']}';
    final sent = asNum(n['sent']).toInt();
    final hasButton = '${n['action_type']}' != 'none';
    final label = status == 'scheduled'
        ? 'Scheduled · ${_when(n['scheduled_at'])}'
        : status == 'cancelled'
            ? 'Cancelled'
            : status == 'sending'
                ? 'Sending…'
                : 'Sent · ${_when(n['sent_at'])}';
    Widget stat(String name, int v, {bool showPct = true}) => Expanded(
          child: Column(children: [
            Text('$v', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            Text(showPct ? '$name · ${_pct(v, sent)}' : name, style: const TextStyle(fontSize: 12, color: VP.muted), textAlign: TextAlign.center),
          ]),
        );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: WhiteCard(
        onTap: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => NotificationInsightsScreen(id: (n['id'] as num).toInt())));
          onChanged();
        },
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${n['title']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(fontSize: 13, color: status == 'cancelled' ? VP.red : VP.muted)),
          const SizedBox(height: 4),
          Text('${n['body']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
          if (status == 'sent') ...[
            const Divider(height: 22),
            Row(children: [
              stat('Sent', sent, showPct: false),
              stat('Opened', asNum(n['opened']).toInt()),
              if (hasButton) stat('Clicked', asNum(n['clicked']).toInt()),
              stat('Bought', asNum(n['bought']).toInt()),
            ]),
          ],
        ]),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/// Pick who gets it, write it, add a photo and a button, send now or later.
class NewNotificationScreen extends StatefulWidget {
  const NewNotificationScreen({super.key});
  @override
  State<NewNotificationScreen> createState() => _NewNotificationScreenState();
}

class _NewNotificationScreenState extends State<NewNotificationScreen> {
  static const _templates = <String, (String, String)>{
    'Offer live': ('Bonus points offer is live', 'Namaste {name}, extra points on every bill this week. You have {points} pts with us.'),
    'We miss you': ('We miss you!', 'Namaste {name}, you have {points} pts waiting at our shop. Visit us soon.'),
    'New stock': ('New stock arrived', 'Namaste {name}, new material just arrived at our shop. Come and see it.'),
    'Points expiring': ('Your points expire soon', 'Namaste {name}, some of your {points} pts expire soon. Use them at our shop.'),
  };
  static const _days = [7, 15, 30, 60];

  String? _visit; // in7 / out30 ...
  final Set<String> _types = {};
  bool _expiring = false;
  bool _gift = false;
  String? _spend;
  final _mobile = TextEditingController();

  final _title = TextEditingController();
  final _body = TextEditingController();
  String? _image;
  bool _uploading = false;

  String _action = 'none';
  int? _productId;
  List<Map<String, dynamic>>? _products;
  final _label = TextEditingController();

  bool _later = false;
  DateTime? _at;

  int? _count;
  int? _push;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    for (final c in [_title, _body, _label]) {
      c.addListener(() => setState(() {}));
    }
    _mobile.addListener(_loadCount);
    _loadCount();
  }

  @override
  void dispose() {
    for (final c in [_title, _body, _label, _mobile]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, dynamic> _filters() {
    final f = <String, dynamic>{};
    final v = _visit;
    if (v != null) {
      final inside = v.startsWith('in');
      f[inside ? 'visitedWithinDays' : 'notVisitedDays'] = int.parse(v.substring(inside ? 2 : 3));
    }
    if (_types.isNotEmpty) f['professions'] = _types.toList();
    if (_expiring) f['pointsExpiring'] = true;
    if (_gift) f['canTakeGift'] = true;
    if (_spend != null) f['spend'] = _spend;
    final m = _mobile.text.trim();
    if (m.length == 10) f['mobile'] = m;
    return f;
  }

  Future<void> _loadCount() async {
    final mine = ++_seq;
    setState(() => _count = null);
    try {
      final r = await context.read<ApiClient>().spost('notifications/audience', _filters()) as Map<String, dynamic>;
      if (mounted && mine == _seq) {
        setState(() {
          _count = asNum(r['count']).toInt();
          _push = asNum(r['pushReachable']).toInt();
        });
      }
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _count = 0);
    }
  }

  void _change(VoidCallback fn) {
    setState(fn);
    _loadCount();
  }

  Future<void> _pickAction(String a) async {
    setState(() => _action = a);
    if (a == 'product' && _products == null) {
      try {
        final r = await context.read<ApiClient>().sget('products') as List;
        if (mounted) setState(() => _products = r.cast<Map<String, dynamic>>());
      } catch (e) {
        if (mounted) showError(context, e);
      }
    }
  }

  Future<void> _photo() async {
    setState(() => _uploading = true);
    try {
      final url = await pickAndUploadPhoto(context, context.read<ApiClient>(), purpose: 'ad');
      if (url != null && mounted) setState(() => _image = url);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _pickTime() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, initialDate: _at ?? now.add(const Duration(days: 1)), firstDate: now, lastDate: now.add(const Duration(days: 30)));
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 9, minute: 0));
    if (t == null) return;
    setState(() => _at = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  String? get _problem {
    if (_title.text.trim().length < 2) return 'Write a title';
    if (_body.text.trim().length < 2) return 'Write the message';
    if (_action == 'product' && _productId == null) return 'Choose the product for the button';
    if (_later && (_at == null || _at!.isBefore(DateTime.now().add(const Duration(minutes: 2))))) return 'Pick a time in the future';
    return null;
  }

  Future<void> _send() async {
    final problem = _problem;
    if (problem != null) {
      showError(context, problem);
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_later ? 'Schedule for ${_when(_at!.toUtc().toIso8601String())}?' : 'Send now?'),
        content: Text('This goes to ${_count ?? 0} customers. You cannot take it back after it is sent.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not yet')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(_later ? 'Schedule' : 'Send'))],
      ),
    );
    if (ok != true || !mounted) return;
    final label = _label.text.trim();
    final r = await context.read<ApiClient>().spost('notifications', {
      'title': _title.text.trim(),
      'body': _body.text.trim(),
      if (_image != null) 'imageUrl': _image,
      'action': {'type': _action, if (_action == 'product') 'productId': _productId, if (_action != 'none' && label.length >= 2) 'label': label},
      'filters': _filters(),
      if (_later && _at != null) 'scheduledAt': _at!.toUtc().toIso8601String(),
    }) as Map<String, dynamic>;
    if (!mounted) return;
    showOk(context, r['scheduled'] == true ? 'Scheduled for ${r['recipients']} customers' : 'Sent to ${r['recipients']} customers');
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final previewTitle = _title.text.trim().isEmpty ? 'Your title' : _title.text.replaceAll('{name}', 'Ramesh').replaceAll('{points}', '1750');
    final previewBody = _body.text.trim().isEmpty ? 'Your message shows here' : _body.text.replaceAll('{name}', 'Ramesh').replaceAll('{points}', '1750');
    const actions = {'none': 'No button', 'shop': 'Open shop', 'offer': 'View offer', 'product': 'View product', 'call': 'Call shop'};
    const defaults = {'shop': 'Open shop', 'offer': 'View offer', 'product': 'View product', 'call': 'Call shop'};
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('New notification')),
      body: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const SectionTitle('Who gets it'),
        _sub('Visited in the last'),
        _pad(ChoiceChips<String>(options: {for (final d in _days) 'in$d': '$d days'}, selected: {if (_visit != null) _visit!}, onTap: (k) => _change(() => _visit = _visit == k ? null : k))),
        _sub('Has not visited in'),
        _pad(ChoiceChips<String>(options: {for (final d in _days) 'out$d': '$d days'}, selected: {if (_visit != null) _visit!}, onTap: (k) => _change(() => _visit = _visit == k ? null : k))),
        _sub('Work type (pick any)'),
        _pad(ChoiceChips<String>(
          multi: true,
          options: {for (final e in professions.entries) e.key: '${professionIcons[e.key] ?? ''} ${e.value}'.trim()},
          selected: _types,
          onTap: (k) => _change(() => _types.contains(k) ? _types.remove(k) : _types.add(k)),
        )),
        _sub('Points and spend'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            FilterChip(label: const Text('Points expiring'), selected: _expiring, onSelected: (v) => _change(() => _expiring = v)),
            FilterChip(label: const Text('Can take a gift'), selected: _gift, onSelected: (v) => _change(() => _gift = v)),
            FilterChip(label: const Text('Top spenders'), selected: _spend == 'top_spenders', onSelected: (v) => _change(() => _spend = v ? 'top_spenders' : null)),
            FilterChip(label: const Text('New in last 30 days'), selected: _spend == 'new_customers', onSelected: (v) => _change(() => _spend = v ? 'new_customers' : null)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: TextField(controller: _mobile, keyboardType: TextInputType.phone, maxLength: 10, decoration: const InputDecoration(labelText: 'Or one customer’s mobile (optional)', counterText: '')),
        ),
        Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: VP.blueSoft, borderRadius: BorderRadius.circular(12)),
          child: Row(children: [
            const Icon(Icons.people_alt_outlined, color: VP.blue),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _count == null ? 'Counting…' : '${pts(_count!)} customers match · ${pts(_push ?? 0)} get a phone alert, the rest see it in the app',
                style: const TextStyle(color: VP.blue, fontWeight: FontWeight.w700),
              ),
            ),
          ]),
        ),
        const SectionTitle('Message'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, children: [
            for (final t in _templates.entries)
              ActionChip(label: Text(t.key), onPressed: () {
                _title.text = t.value.$1;
                _body.text = t.value.$2;
              }),
          ]),
        ),
        Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: TextField(controller: _title, maxLength: 60, decoration: const InputDecoration(labelText: 'Title'))),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          child: TextField(controller: _body, maxLines: 3, maxLength: 240, decoration: const InputDecoration(labelText: 'Message', helperText: 'Use {name} and {points}; they fill in for each person')),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: _image == null
              ? OutlinedButton.icon(onPressed: _uploading ? null : _photo, icon: _uploading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_photo_alternate_outlined), label: const Text('Add a photo (optional)'))
              : Stack(children: [
                  ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.network(_image!, height: 150, width: double.infinity, fit: BoxFit.cover)),
                  Positioned(right: 6, top: 6, child: CircleAvatar(backgroundColor: Colors.white, child: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _image = null)))),
                ]),
        ),
        const SectionTitle('Button (optional)'),
        _pad(ChoiceChips<String>(options: actions, selected: {_action}, onTap: _pickAction)),
        if (_action == 'product')
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: _products == null
                ? const LinearProgressIndicator()
                : DropdownButtonFormField<int>(
                    value: _productId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Product'),
                    items: [for (final p in _products!) DropdownMenuItem(value: (p['id'] as num).toInt(), child: Text('${p['name']}', overflow: TextOverflow.ellipsis))],
                    onChanged: (v) => setState(() => _productId = v),
                  ),
          ),
        if (_action != 'none')
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(controller: _label, maxLength: 24, decoration: InputDecoration(labelText: 'Button text', hintText: defaults[_action], counterText: '')),
          ),
        const SectionTitle('When'),
        _pad(ChoiceChips<String>(options: const {'now': 'Send now', 'later': 'Schedule'}, selected: {_later ? 'later' : 'now'}, onTap: (k) => setState(() => _later = k == 'later'))),
        if (_later)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: OutlinedButton.icon(onPressed: _pickTime, icon: const Icon(Icons.schedule), label: Text(_at == null ? 'Pick date and time' : _when(_at!.toUtc().toIso8601String()))),
          ),
        const SectionTitle('Preview'),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(16)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('MERE POINTS · now', style: TextStyle(fontSize: 11, color: VP.muted, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
            const SizedBox(height: 6),
            Text(previewTitle, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 2),
            Text(previewBody),
            if (_image != null) ...[const SizedBox(height: 8), ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.network(_image!, height: 90, width: double.infinity, fit: BoxFit.cover))],
            if (_action != 'none') ...[
              const SizedBox(height: 8),
              Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), decoration: BoxDecoration(color: VP.blue, borderRadius: BorderRadius.circular(20)), child: Text(_label.text.trim().length >= 2 ? _label.text.trim() : (defaults[_action] ?? ''), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
            ],
          ]),
        ),
      ]),
      bottomNavigationBar: BottomAction(
        note: '${_count == null ? '…' : pts(_count!)} customers · up to 5 notifications a day',
        child: BusyButton(label: _later ? 'Schedule' : 'Send now', onPressed: (_count ?? 0) == 0 ? null : _send),
      ),
    );
  }

  Widget _sub(String t) => Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 4), child: Text(t, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: VP.muted)));
}

// ---------------------------------------------------------------------------------------------------------------------
/// How one notification did: sent, delivered, opened, clicked, bought within 7 days, and who.
class NotificationInsightsScreen extends StatefulWidget {
  const NotificationInsightsScreen({super.key, required this.id});
  final int id;
  @override
  State<NotificationInsightsScreen> createState() => _NotificationInsightsScreenState();
}

class _NotificationInsightsScreenState extends State<NotificationInsightsScreen> {
  Map<String, dynamic>? _d;
  Object? _error;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await context.read<ApiClient>().sget('notifications/${widget.id}') as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _d = r;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _cancel() async {
    try {
      await context.read<ApiClient>().spost('notifications/${widget.id}/cancel');
      if (!mounted) return;
      showOk(context, 'Cancelled');
      Navigator.pop(context);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return Scaffold(
      appBar: AppBar(title: const Text('How it did')),
      body: _error != null
          ? ErrorRetry(error: _error!, onRetry: _load)
          : d == null
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(onRefresh: _load, child: _content(d)),
    );
  }

  Widget _content(Map<String, dynamic> d) {
    final sent = asNum(d['sent']).toInt();
    final status = '${d['status']}';
    final hasButton = '${d['action_type']}' != 'none';
    final people = (d['people'] as List).cast<Map<String, dynamic>>();
    bool opened(Map p) => p['opened_at'] != null;
    final shown = people.where((p) {
      switch (_filter) {
        case 'not_opened':
          return !opened(p);
        case 'opened':
          return opened(p);
        case 'clicked':
          return p['clicked_at'] != null;
        case 'bought':
          return p['bought'] == true;
        default:
          return true;
      }
    }).toList();

    Widget bar(String label, int v, Color c, {String? sub}) => Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
              Text('$v · ${_pct(v, sent)}', style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
            const SizedBox(height: 6),
            ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: sent == 0 ? 0 : v / sent, minHeight: 10, color: c, backgroundColor: const Color(0xFFE8EDF3))),
            if (sub != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(sub, style: const TextStyle(fontSize: 12, color: VP.muted))),
          ]),
        );

    return ListView(padding: const EdgeInsets.fromLTRB(0, 12, 0, 40), children: [
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${d['title']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(status == 'scheduled' ? 'Scheduled · ${_when(d['scheduled_at'])}' : status == 'cancelled' ? 'Cancelled' : 'Sent · ${_when(d['sent_at'])}', style: const TextStyle(color: VP.muted)),
          const SizedBox(height: 8),
          Text('${d['body']}'),
          const SizedBox(height: 18),
          if (status == 'scheduled') OutlinedButton.icon(onPressed: _cancel, icon: const Icon(Icons.cancel_outlined), label: const Text('Cancel this notification')),
        ]),
      ),
      if (status == 'sent') ...[
        WhiteCard(
          child: Column(children: [
            bar('Sent', sent, VP.blue, sub: 'Phone alert reached ${asNum(d['pushed']).toInt()}; everyone can see it in the app inbox'),
            bar('Delivered to phone', asNum(d['delivered']).toInt(), VP.blue),
            bar('Opened', asNum(d['opened']).toInt(), VP.green),
            if (hasButton) bar('Tapped the button', asNum(d['clicked']).toInt(), VP.amber) else const Padding(padding: EdgeInsets.only(bottom: 14), child: Text('No button on this notification', style: TextStyle(color: VP.muted))),
            bar('Bought within 7 days', asNum(d['bought']).toInt(), VP.green, sub: 'Added a bill at your shop after this was sent'),
          ]),
        ),
        const SectionTitle('Customers'),
        _pad(ChoiceChips<String>(
          options: const {'all': 'All', 'not_opened': 'Not opened', 'opened': 'Opened', 'clicked': 'Clicked', 'bought': 'Bought'},
          selected: {_filter},
          onTap: (k) => setState(() => _filter = k),
        )),
        const SizedBox(height: 8),
        if (shown.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Nobody here yet', style: TextStyle(color: VP.muted)))),
        for (final p in shown)
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16),
            title: Text('${p['name'] ?? p['mobile']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(p['clicked_at'] != null ? 'Tapped the button' : p['opened_at'] != null ? 'Opened' : p['delivered_at'] != null ? 'Delivered, not opened' : 'Not seen yet'),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              if (p['bought'] == true) const Padding(padding: EdgeInsets.only(right: 4), child: Chip(label: Text('Bought'), visualDensity: VisualDensity.compact)),
              if (!opened(p)) IconButton(tooltip: 'Call', icon: const Icon(Icons.call_outlined, color: VP.blue), onPressed: () => launchUrl(Uri(scheme: 'tel', path: '+${p['mobile']}'))),
            ]),
          ),
      ],
    ]);
  }
}
