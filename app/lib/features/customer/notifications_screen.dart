import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/push.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'product_detail_screen.dart';
import 'shop_card_screen.dart';

String _ago(String iso) {
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} hr ago';
  if (diff.inDays < 7) return '${diff.inDays} day${diff.inDays == 1 ? '' : 's'} ago';
  return '${d.day}/${d.month}/${d.year}';
}

/// Messages from shops the Site Expert is connected to. Opening a card and tapping its button are counted for the shop's insights.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final List<Map<String, dynamic>> _items = [];
  Object? _error;
  bool _loading = true;
  bool _more = true;

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
    }
    try {
      final before = reset || _items.isEmpty ? null : _items.last['id'];
      final r = await context.read<ApiClient>().get('me/notifications', query: {'before': before}) as Map<String, dynamic>;
      final got = (r['items'] as List).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(got);
        _more = got.length >= 30;
        _loading = false;
      });
      context.read<Inbox>().refreshUnread();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _open(Map<String, dynamic> n) async {
    if (n['opened'] == true) return;
    setState(() => n['opened'] = true);
    try {
      await context.read<ApiClient>().post('me/notifications/${n['id']}/open');
    } catch (_) {}
    if (mounted) context.read<Inbox>().refreshUnread();
  }

  Future<void> _tapButton(Map<String, dynamic> n) async {
    final api = context.read<ApiClient>();
    setState(() {
      n['opened'] = true;
      n['clicked'] = true;
    });
    api.post('me/notifications/${n['id']}/click').then((_) => context.mounted ? context.read<Inbox>().refreshUnread() : null).catchError((_) {});
    final type = '${n['action_type']}';
    final nav = Navigator.of(context);
    if (type == 'call') {
      final phone = '${n['phone'] ?? ''}';
      if (phone.isNotEmpty) await launchUrl(Uri(scheme: 'tel', path: phone));
    } else if (type == 'product') {
      final id = int.tryParse('${n['action_ref']}');
      if (id != null) nav.push(MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: id)));
    } else {
      nav.push(MaterialPageRoute(builder: (_) => ShopCardScreen(shopId: (n['shop_id'] as num).toInt())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(error: _error!, onRetry: () => _load(reset: true))
              : RefreshIndicator(
                  onRefresh: () => _load(reset: true),
                  child: _items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 120),
                          Icon(Icons.notifications_none, size: 56, color: VP.muted),
                          SizedBox(height: 12),
                          Center(child: Text('No notifications yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
                          Padding(padding: EdgeInsets.all(24), child: Text('Offers and updates from your shops show up here.', textAlign: TextAlign.center, style: TextStyle(color: VP.muted))),
                        ])
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
                          itemCount: _items.length + (_more ? 1 : 0),
                          itemBuilder: (_, i) {
                            if (i == _items.length) {
                              return Padding(
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                child: Center(child: TextButton(onPressed: () => _load(), child: const Text('Show older'))),
                              );
                            }
                            return _NoticeCard(n: _items[i], onOpen: () => _open(_items[i]), onButton: () => _tapButton(_items[i]));
                          },
                        ),
                ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.n, required this.onOpen, required this.onButton});
  final Map<String, dynamic> n;
  final VoidCallback onOpen;
  final VoidCallback onButton;

  @override
  Widget build(BuildContext context) {
    final unread = n['opened'] != true;
    final shop = '${n['shop_name'] ?? ''}';
    final image = n['image_url'];
    final hasButton = '${n['action_type']}' != 'none' && n['action_label'] != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: unread ? VP.blueSoft : Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onOpen,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: unread ? VP.blue.withValues(alpha: 0.35) : const Color(0xFFE3E8EE))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: VP.blue,
                  backgroundImage: n['shop_logo'] != null ? NetworkImage('${n['shop_logo']}') : null,
                  child: n['shop_logo'] == null ? Text(shop.isEmpty ? '?' : shop[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)) : null,
                ),
                const SizedBox(width: 10),
                Expanded(child: Text(shop, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                Text(_ago('${n['created_at']}'), style: const TextStyle(color: VP.muted, fontSize: 12)),
                if (unread) ...[const SizedBox(width: 8), const CircleAvatar(radius: 5, backgroundColor: VP.blue)],
              ]),
              const SizedBox(height: 10),
              Text('${n['title']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text('${n['body']}', style: const TextStyle(fontSize: 14.5, height: 1.35)),
              if (image != null && '$image'.isNotEmpty) ...[
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network('$image', height: 160, width: double.infinity, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                ),
              ],
              if (hasButton) ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(onPressed: onButton, child: Text('${n['action_label']}')),
                ),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

/// Bell with an unread badge, for headers.
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key, this.color = Colors.white});
  final Color color;
  @override
  Widget build(BuildContext context) {
    final n = context.watch<Inbox>().unread;
    return IconButton(
      tooltip: 'Notifications',
      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen())),
      icon: Badge(label: Text(n > 9 ? '9+' : '$n'), isLabelVisible: n > 0, child: Icon(Icons.notifications_none, color: color, size: 28)),
    );
  }
}
