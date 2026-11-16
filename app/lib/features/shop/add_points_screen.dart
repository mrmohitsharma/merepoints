import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/points_math.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'points_added_screen.dart';

/// Counter step 2: bill amount → points worked out live (shop % × live offer, capped).
/// Goal: under 30 seconds from scan to SMS.
class AddPointsScreen extends StatefulWidget {
  const AddPointsScreen({super.key, required this.customer});
  final Map<String, dynamic> customer;
  @override
  State<AddPointsScreen> createState() => _AddPointsScreenState();
}

class _AddPointsScreenState extends State<AddPointsScreen> {
  int _mode = 0; // 0 bill, 1 manual
  final _amount = TextEditingController();
  final _invoice = TextEditingController();
  final _manualPts = TextEditingController();
  final _remarks = TextEditingController();
  String _reason = 'festival_bonus';
  Map<String, dynamic>? _cfg;
  Map<String, dynamic>? _offer;
  bool _canManual = false;
  // One key per screen visit: if the network drops and the button is pressed again,
  // the server returns the first result instead of adding points twice.
  final _idemKey = ApiClient.newIdempotencyKey();

  @override
  void initState() {
    super.initState();
    _amount.addListener(() => setState(() {}));
    final api = context.read<ApiClient>();
    Future.wait([api.sget(''), api.sget('offers')]).then((r) {
      if (!mounted) return;
      final prof = widget.customer['profession'];
      final shop = r[0] as Map<String, dynamic>;
      setState(() {
        _cfg = shop['loyalty'] as Map<String, dynamic>;
        _canManual = (shop['me'] as Map<String, dynamic>)['canManual'] == true;
        _offer = (r[1] as List).cast<Map<String, dynamic>>().where((o) {
          final ps = o['professions'] as List?;
          return o['status'] == 'live' && (ps == null || ps.contains(prof));
        }).firstOrNull;
      });
    }).catchError((e) {
      if (mounted) showError(context, e);
    });
  }

  ({int base, int points, bool capped})? _preview() {
    final cfg = _cfg;
    final amt = double.tryParse(_amount.text.replaceAll(',', ''));
    if (cfg == null || amt == null || amt <= 0) return null;
    return previewPoints(
      amountRupees: amt,
      rewardPercent: asNum(cfg['rewardPercent']),
      multiplier: _offer == null ? 1 : asNum(_offer!['multiplier']),
      maxPointsPerBill: cfg['maxPointsPerBill'] as int?,
    );
  }

  Future<void> _submit() async {
    final api = context.read<ApiClient>();
    final customerId = widget.customer['id'] as int;
    Map<String, dynamic> r;
    if (_mode == 0) {
      final amt = double.tryParse(_amount.text.replaceAll(',', ''));
      if (amt == null || amt <= 0) throw ApiException(400, 'AMOUNT', 'Enter the bill amount');
      r = await api.spost('points/bill', {
        'customerId': customerId,
        'amountRupees': amt,
        if (_invoice.text.trim().isNotEmpty) 'invoiceNo': _invoice.text.trim(),
      }, _idemKey) as Map<String, dynamic>;
    } else {
      final p = int.tryParse(_manualPts.text);
      if (p == null || p <= 0) throw ApiException(400, 'POINTS', 'Enter points to add');
      r = await api.spost('points/manual', {
        'customerId': customerId,
        'points': p,
        'reason': _reason,
        if (_remarks.text.trim().isNotEmpty) 'remarks': _remarks.text.trim(),
      }, _idemKey) as Map<String, dynamic>;
    }
    if (!mounted) return;
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => PointsAddedScreen(result: r, customer: widget.customer, bill: _mode == 0 ? {'amount': _amount.text, 'invoice': _invoice.text} : null)));
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.customer;
    final at = c['atThisShop'] as Map<String, dynamic>;
    final shop = context.watch<Session>().activeShop!;
    final pv = _preview();
    final pointValue = asNum(_cfg?['pointValueRupees'] ?? 1);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Add points')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        _CustomerBar(customer: c, balance: asNum(at['balance']).toInt()),
        const SizedBox(height: 14),
        if (_canManual) Segmented(labels: const ['From bill', 'Manual points'], index: _mode, onChanged: (i) => setState(() => _mode = i)),
        const SizedBox(height: 18),
        if (_mode == 0) ...[
          const Text('Bill amount', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
          const SizedBox(height: 6),
          TextField(
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800),
            decoration: const InputDecoration(prefixText: '₹ ', prefixStyle: TextStyle(fontSize: 32, color: VP.muted, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: 14),
          if (_cfg != null)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(16)),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(pv == null ? 'Your rate: ${asNum(_cfg!['rewardPercent'])}% of bill' : '${asNum(_cfg!['rewardPercent'])}% of ${rupees(double.parse(_amount.text.replaceAll(',', '')))} = ${pts(pv.base)}',
                        style: const TextStyle(color: Color(0xFF3C4856))),
                    if (_offer != null)
                      Container(
                        margin: const EdgeInsets.only(top: 4),
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
                        decoration: BoxDecoration(color: VP.amber, borderRadius: BorderRadius.circular(8)),
                        child: Text('× ${asNum(_offer!['multiplier'])} ${_offer!['name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      ),
                    if (pv?.capped == true) const Text('Capped at your max per bill', style: TextStyle(fontSize: 13, color: VP.amberText)),
                  ]),
                ),
                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text('+${pts(pv?.points ?? 0)}', style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: VP.green)),
                  Text('points = ${rupees((pv?.points ?? 0) * pointValue)}', style: const TextStyle(fontSize: 13, color: VP.green, fontWeight: FontWeight.w600)),
                ]),
              ]),
            ),
          const SizedBox(height: 14),
          TextField(controller: _invoice, decoration: const InputDecoration(labelText: 'Invoice no. (stops double entry)')),
          const SizedBox(height: 10),
          if (_cfg != null)
            InfoNote('Minimum bill ${rupees(asNum(_cfg!['minBillRupees']))}${_cfg!['maxPointsPerBill'] != null ? ' · Max ${pts(asNum(_cfg!['maxPointsPerBill']))} points per bill' : ''} · Same invoice no. can\'t be used twice'),
        ] else ...[
          const Text('Points to add', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
          const SizedBox(height: 6),
          TextField(
            controller: _manualPts,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
            onChanged: (_) => setState(() {}),
          ),
          Text('= ${rupees((int.tryParse(_manualPts.text) ?? 0) * pointValue)}', style: const TextStyle(color: VP.muted)),
          const SizedBox(height: 16),
          const Text('Reason', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
          const SizedBox(height: 8),
          ChoiceChips<String>(
            options: const {'festival_bonus': 'Festival bonus', 'referral': 'Referral', 'missed_bill': 'Missed bill', 'correction': 'Correction', 'other': 'Other'},
            selected: {_reason},
            onTap: (r) => setState(() => _reason = r),
          ),
          const SizedBox(height: 14),
          TextField(controller: _remarks, decoration: const InputDecoration(labelText: 'Remarks')),
          const SizedBox(height: 12),
          InfoNote(
            shop.isOwner ? 'Manual entries are logged with your name.' : 'Manual entries are logged with your name and shown to the owner. You have a daily limit.',
            icon: Icons.shield_outlined, color: VP.amberText, bg: VP.amberSoft,
          ),
        ],
      ]),
      bottomNavigationBar: BottomAction(
        child: BusyButton(
          label: _mode == 0 ? (pv == null ? 'Add points' : 'Add ${pts(pv.points)} points') : 'Add ${_manualPts.text.isEmpty ? '' : '${_manualPts.text} '}points',
          onPressed: _submit,
        ),
      ),
    );
  }
}

class _CustomerBar extends StatelessWidget {
  const _CustomerBar({required this.customer, required this.balance});
  final Map<String, dynamic> customer;
  final int balance;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: VP.ground, borderRadius: BorderRadius.circular(16)),
        child: Row(children: [
          Initials('${customer['name']}'),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${customer['name'] ?? 'Customer'}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              Text('${professions[customer['profession']] ?? ''} · ${prettyMobile(customer['mobile'] as String?)}', style: const TextStyle(fontSize: 14, color: VP.muted)),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(pts(balance), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: VP.blue)),
            const Text('balance here', style: TextStyle(fontSize: 12, color: VP.muted)),
          ]),
        ]),
      );
}
