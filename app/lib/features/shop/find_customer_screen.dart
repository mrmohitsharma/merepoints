import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'add_points_screen.dart';
import 'redeem_screen.dart';

enum FindPurpose { earn, redeem }

/// Counter step 1: scan the customer's QR, or type their mobile. New customer → quick add.
class FindCustomerScreen extends StatefulWidget {
  const FindCustomerScreen({super.key, required this.purpose});
  final FindPurpose purpose;
  @override
  State<FindCustomerScreen> createState() => _FindCustomerScreenState();
}

class _FindCustomerScreenState extends State<FindCustomerScreen> {
  final _scanner = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates, formats: const [BarcodeFormat.qrCode]);
  final _mobile = TextEditingController();
  bool _resolving = false;
  Map<String, dynamic>? _found;
  bool _notFound = false;
  bool _torch = false;

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _resolve(Map<String, String> by) async {
    if (_resolving) return;
    setState(() {
      _resolving = true;
      _notFound = false;
    });
    try {
      final r = await context.read<ApiClient>().spost('customers/resolve', by) as Map<String, dynamic>;
      if (!mounted) return;
      if (r['found'] == true) {
        HapticFeedback.mediumImpact();
        setState(() => _found = r['customer'] as Map<String, dynamic>);
        if (by.containsKey('qr')) _go(); // scanned QR: go straight on
      } else {
        setState(() => _notFound = true);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  void _go() {
    final c = _found!;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => widget.purpose == FindPurpose.earn ? AddPointsScreen(customer: c) : RedeemScreen(customer: c)),
    );
  }

  Future<void> _quickAdd() async {
    final res = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => QuickAddSheet(mobile: _mobile.text),
    );
    if (res != null && mounted) {
      await _resolve({'mobile': _mobile.text.isNotEmpty ? _mobile.text : '${res['mobile']}'});
    }
  }

  @override
  Widget build(BuildContext context) {
    final at = _found?['atThisShop'] as Map<String, dynamic>?;
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(children: [
        SizedBox(
          height: 360,
          child: Stack(fit: StackFit.expand, children: [
            Container(color: const Color(0xFF10161D)),
            MobileScanner(
              controller: _scanner,
              onDetect: (cap) {
                final v = cap.barcodes.firstOrNull?.rawValue;
                if (v != null && v.startsWith('VP1.')) _resolve({'qr': v});
              },
              errorBuilder: (context, error, child) => const Center(
                child: Padding(padding: EdgeInsets.all(24), child: Text('Camera not available. Search by mobile below.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70))),
              ),
            ),
            Center(
              child: Container(
                width: 210, height: 210,
                decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 4), borderRadius: BorderRadius.circular(18)),
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Row(children: [
                  IconButton.filledTonal(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.arrow_back)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(widget.purpose == FindPurpose.earn ? 'Scan customer QR to add points' : 'Scan customer QR to redeem',
                        style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700)),
                  ),
                  IconButton.filledTonal(
                    tooltip: 'Torch',
                    onPressed: () {
                      _scanner.toggleTorch();
                      setState(() => _torch = !_torch);
                    },
                    icon: Icon(_torch ? Icons.flash_on : Icons.flash_off),
                  ),
                ]),
              ),
            ),
            const Positioned(
              bottom: 30, left: 0, right: 0,
              child: Text('Ask the customer to open Vyapar Point › My QR', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFFC3CCD6))),
            ),
            if (_resolving) const Center(child: CircularProgressIndicator(color: Colors.white)),
          ]),
        ),
        Expanded(
          child: ListView(padding: const EdgeInsets.all(16), children: [
            const Text('Or search by mobile number', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _mobile,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
                  style: const TextStyle(fontSize: 20),
                  decoration: const InputDecoration(prefixText: '+91  '),
                  onChanged: (v) {
                    setState(() {
                      _found = null;
                      _notFound = false;
                    });
                    if (v.length == 10) _resolve({'mobile': v});
                  },
                ),
              ),
            ]),
            const SizedBox(height: 12),
            if (_found != null)
              WhiteCard(
                margin: EdgeInsets.zero,
                color: VP.ground,
                onTap: _go,
                child: Row(children: [
                  Initials('${_found!['name']}'),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${_found!['name'] ?? 'Customer'}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                      Text('${prettyMobile(_found!['mobile'] as String?)} · ${professions[_found!['profession']] ?? ''}${_found!['level'] != null ? ' · ${_found!['level']}' : ''}',
                          style: const TextStyle(color: VP.muted, fontSize: 14)),
                    ]),
                  ),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(pts(asNum(at?['balance'])), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: VP.blue)),
                    Text(at?['firstVisit'] == true ? 'first visit' : 'pts here', style: const TextStyle(fontSize: 12, color: VP.muted)),
                  ]),
                ]),
              ),
            if (_notFound) ...[
              const InfoNote('No Vyapar Point account with this number yet.', icon: Icons.person_search_outlined),
              const SizedBox(height: 12),
            ],
            if (widget.purpose == FindPurpose.earn) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: _quickAdd, icon: const Icon(Icons.person_add_alt), label: const Text('New customer? Add by mobile')),
              const SizedBox(height: 6),
              const Text('They get an SMS with the app link and their points', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: VP.muted)),
            ],
          ]),
        ),
      ]),
    );
  }
}

/// Counter quick-add: under 15 seconds, customer doesn't need the app yet.
class QuickAddSheet extends StatefulWidget {
  const QuickAddSheet({super.key, this.mobile = ''});
  final String mobile;
  @override
  State<QuickAddSheet> createState() => _QuickAddSheetState();
}

class _QuickAddSheetState extends State<QuickAddSheet> {
  late final _mobile = TextEditingController(text: widget.mobile);
  final _name = TextEditingController();
  String _profession = 'carpenter';

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Add new customer', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
        const SizedBox(height: 14),
        TextField(
          controller: _mobile,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
          decoration: const InputDecoration(labelText: 'Mobile', prefixText: '+91  '),
        ),
        const SizedBox(height: 12),
        TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name')),
        const SizedBox(height: 12),
        ChoiceChips<String>(options: professions, selected: {_profession}, onTap: (p) => setState(() => _profession = p)),
        const SizedBox(height: 18),
        BusyButton(
          label: 'Add customer',
          onPressed: () async {
            final r = await context.read<ApiClient>().spost('customers', {'mobile': _mobile.text, 'name': _name.text.trim(), 'profession': _profession});
            if (context.mounted) Navigator.pop(context, {...(r as Map<String, dynamic>), 'mobile': _mobile.text});
          },
        ),
      ]),
    );
  }
}
