import 'package:flutter/material.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/theme.dart';
import 'common.dart';

/// Invite button for shop owners, staff and customers (carpenters, painters, contractors).
/// Opens a sheet: send to one person on WhatsApp, or send to many using WhatsApp's own contact picker.
class InviteButton extends StatelessWidget {
  const InviteButton({super.key, required this.senderName, this.shop = false, this.light = false});
  final String senderName; // shop name for shops, the person's own name for customers
  final bool shop;
  final bool light; // white text, for blue headers
  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: light ? Colors.white24 : VP.amber,
        foregroundColor: light ? Colors.white : VP.ink,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 12),
      ),
      onPressed: () => showInviteSheet(context, senderName: senderName, shop: shop),
      icon: const Icon(Icons.person_add_alt_1, size: 18),
      label: const Text('Invite', style: TextStyle(fontWeight: FontWeight.w700)),
    );
  }
}

Future<void> showInviteSheet(BuildContext context, {required String senderName, required bool shop}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: _InviteSheet(senderName: senderName, shop: shop),
    ),
  );
}

/// One simple Hindi + English line about the app, then the download link(s) set in Super Admin.
String inviteMessage({required String senderName, String? androidUrl, String? iosUrl}) {
  final hasA = androidUrl != null && androidUrl.isNotEmpty;
  final hasI = iosUrl != null && iosUrl.isNotEmpty;
  final links = [
    if (hasA) (hasI ? 'Android: $androidUrl' : androidUrl),
    if (hasI) (hasA ? 'iPhone: $iosUrl' : iosUrl),
  ].join('\n');
  return 'Namaste! $senderName ki taraf se: Mere Points app se har kharid par points kamao aur unhe paise ki tarah nikalo. Download karein:\n$links';
}

/// 10-digit Indian mobile from whatever was typed or stored in a contact. Null if it is not a valid number.
String? cleanMobile(String raw) {
  var d = raw.replaceAll(RegExp(r'\D'), '');
  if (d.length == 12 && d.startsWith('91')) d = d.substring(2);
  if (d.length == 11 && d.startsWith('0')) d = d.substring(1);
  return RegExp(r'^[6-9]\d{9}$').hasMatch(d) ? d : null;
}

class _InviteSheet extends StatefulWidget {
  const _InviteSheet({required this.senderName, required this.shop});
  final String senderName;
  final bool shop;
  @override
  State<_InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends State<_InviteSheet> {
  bool _one = false;
  final _text = TextEditingController();
  List<Contact> _contacts = [];
  bool _contactsTried = false;
  String? _picked; // number chosen from a suggestion
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<String?> _message() async {
    final r = await context.read<ApiClient>().get('invite/links') as Map<String, dynamic>;
    final a = r['androidUrl'] as String?;
    final i = r['iosUrl'] as String?;
    if ((a ?? '').isEmpty && (i ?? '').isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('The app download link is not set yet. Please try again later.')));
      return null;
    }
    return inviteMessage(senderName: widget.senderName, androidUrl: a, iosUrl: i);
  }

  Future<void> _loadContacts() async {
    if (_contactsTried) return;
    _contactsTried = true;
    try {
      if (await FlutterContacts.requestPermission(readonly: true)) {
        final list = await FlutterContacts.getContacts(withProperties: true);
        if (mounted) setState(() => _contacts = list.where((c) => c.phones.isNotEmpty).toList());
      }
    } catch (_) {
      // No permission or no contacts app: typing a number still works.
    }
  }

  Future<void> _sendOne() async {
    final number = cleanMobile(_picked ?? _text.text);
    if (number == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a 10 digit mobile number, or pick a name from the list.')));
      return;
    }
    setState(() => _busy = true);
    try {
      final msg = await _message();
      if (msg == null) return;
      final uri = Uri.parse('https://wa.me/91$number?text=${Uri.encodeComponent(msg)}');
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open WhatsApp. Is it installed?')));
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendMany() async {
    setState(() => _busy = true);
    try {
      final msg = await _message();
      if (msg == null) return;
      // The phone's share sheet: choose WhatsApp, then tick as many contacts as you like.
      await Share.share(msg);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<Contact> get _matches {
    final q = _text.text.trim().toLowerCase();
    if (q.length < 2 || _picked != null) return const [];
    final digits = q.replaceAll(RegExp(r'\D'), '');
    return _contacts
        .where((c) => c.displayName.toLowerCase().contains(q) || (digits.length >= 3 && c.phones.any((p) => p.number.replaceAll(RegExp(r'\D'), '').contains(digits))))
        .take(5)
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(_one ? 'Send on WhatsApp' : 'Invite on WhatsApp', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('They get a message with the Mere Points app link.', style: TextStyle(color: VP.muted)),
          const SizedBox(height: 16),
          if (!_one) ...[
            _Option(
              icon: Icons.person_outline,
              title: 'Share with one person',
              sub: 'Type a name or number',
              onTap: () {
                setState(() => _one = true);
                _loadContacts();
              },
            ),
            const SizedBox(height: 10),
            _Option(icon: Icons.groups_outlined, title: 'Share with many people', sub: 'Choose WhatsApp, then tick many contacts', onTap: _busy ? null : _sendMany),
          ] else ...[
            TextField(
              controller: _text,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Name or mobile number', prefixIcon: Icon(Icons.search), border: OutlineInputBorder()),
              onChanged: (_) => setState(() => _picked = null),
            ),
            for (final c in _matches)
              ListTile(
                dense: true,
                leading: const Icon(Icons.contact_phone_outlined),
                title: Text(c.displayName),
                subtitle: Text(c.phones.first.number),
                onTap: () => setState(() {
                  _picked = c.phones.first.number;
                  _text.text = '${c.displayName} · ${c.phones.first.number}';
                }),
              ),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: const Color(0xFF25D366), foregroundColor: Colors.white),
              onPressed: _busy ? null : _sendOne,
              icon: const Icon(Icons.send),
              label: const Text('Share on WhatsApp', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            TextButton(onPressed: () => setState(() => _one = false), child: const Text('Back')),
          ],
        ]),
      ),
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({required this.icon, required this.title, required this.sub, required this.onTap});
  final IconData icon;
  final String title, sub;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    return Material(
      color: VP.blue.withOpacity(0.07),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Icon(icon, size: 30, color: VP.blue),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                Text(sub, style: const TextStyle(color: VP.muted)),
              ]),
            ),
            const Icon(Icons.chevron_right),
          ]),
        ),
      ),
    );
  }
}
