import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Step 1: shop pays (UPI app / cash / gift) and taps "I've paid".
/// Step 2: wait for the customer to tap Received in their app (polled), or enter the SMS OTP
/// if their phone is offline. Only then is the redemption valid.
class PayScreen extends StatefulWidget {
  const PayScreen({super.key, required this.redemptionId, this.created});
  final String redemptionId;
  final Map<String, dynamic>? created; // response of POST redemptions (has upiIntent)
  @override
  State<PayScreen> createState() => _PayScreenState();
}

class _PayScreenState extends State<PayScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _r;
  Object? _error;
  Timer? _poll;
  final _otp = TextEditingController();
  final _ref = TextEditingController();
  String? _devOtp;

  ApiClient get _api => context.read<ApiClient>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_r?['status'] == 'paid' || _r?['status'] == 'disputed') _load(quiet: true);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // Coming back from the UPI app: refresh straight away.
    if (s == AppLifecycleState.resumed) _load(quiet: true);
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!mounted) return;
    try {
      final r = await _api.sget('redemptions/${widget.redemptionId}') as Map<String, dynamic>;
      if (!mounted) return;
      final was = _r?['status'];
      setState(() {
        _r = r;
        _error = null;
      });
      if (r['status'] == 'confirmed' && was != 'confirmed') {
        HapticFeedback.heavyImpact();
        _poll?.cancel();
        Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => RedeemDoneScreen(r: r)));
      }
    } catch (e) {
      if (!quiet && mounted) setState(() => _error = e);
    }
  }

  Future<void> _openUpi() async {
    final r = _r!;
    final intent = widget.created?['upiIntent'] as String? ??
        'upi://pay?pa=${Uri.encodeComponent('${r['upi_id']}')}&pn=${Uri.encodeComponent('${r['customer_name'] ?? ''}')}&am=${asNum(r['value_rupees']).toStringAsFixed(2)}&cu=INR&tn=${r['id']}';
    final ok = await launchUrl(Uri.parse(intent), mode: LaunchMode.externalApplication);
    if (!ok) throw ApiException(0, 'NO_UPI_APP', 'No UPI app found. Pay from any UPI app to ${r['upi_id']} and tap "I\'ve paid".');
  }

  Future<void> _markPaid() async {
    final res = await _api.spost('redemptions/${widget.redemptionId}/paid', {if (_ref.text.trim().isNotEmpty) 'paymentRef': _ref.text.trim()}) as Map<String, dynamic>;
    _devOtp = res['devOtp'] as String?;
    await _load();
  }

  Future<void> _verifyOtp() async {
    if (_otp.text.length != 4) throw ApiException(400, 'OTP', 'Enter the 4-digit code from the customer\'s SMS');
    await _api.spost('redemptions/${widget.redemptionId}/verify-otp', {'code': _otp.text});
    await _load();
  }

  Future<void> _cancel() async {
    await _api.spost('redemptions/${widget.redemptionId}/cancel');
    if (mounted) {
      showOk(context, 'Cancelled. Points are back with the customer.');
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_r == null) {
      return Scaffold(appBar: AppBar(), body: _error != null ? ErrorRetry(error: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()));
    }
    final r = _r!;
    final status = '${r['status']}';
    final method = '${r['method']}';
    final name = '${r['customer_name'] ?? 'Customer'}';
    final first = name.split(' ').first;
    final amount = rupees(asNum(r['value_rupees']));
    final paid = status != 'held';

    if (status == 'cancelled') {
      return Scaffold(appBar: AppBar(), body: const Center(child: Text('This redemption was cancelled. Points are back with the customer.', textAlign: TextAlign.center)));
    }

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(method == 'gift' ? 'Hand over gift' : 'Pay $first')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // ------------------------------------------------ step 1
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(border: Border.all(color: VP.line), borderRadius: BorderRadius.circular(18)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              _StepDot(n: 1, done: paid),
              const SizedBox(width: 10),
              Expanded(child: Text(method == 'gift' ? 'Step 1 · Give ${r['gift_name']}' : 'Step 1 · Pay $amount', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
              if (paid) const Text('Paid', style: TextStyle(color: VP.green, fontWeight: FontWeight.w700)),
            ]),
            if (!paid) ...[
              const SizedBox(height: 12),
              Center(child: Text(method == 'gift' ? '${r['points']} points' : amount, style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800))),
              if (method == 'upi') Center(child: Text('to ${r['upi_id']}', style: const TextStyle(color: VP.muted))),
              const SizedBox(height: 12),
              if (method == 'upi') ...[
                BusyButton(label: 'Pay by UPI app', icon: Icons.open_in_new, onPressed: _openUpi),
                const SizedBox(height: 4),
                const Text('Opens PhonePe / GPay / Paytm with the UPI ID and amount filled in', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: VP.muted)),
                const SizedBox(height: 10),
                TextField(controller: _ref, decoration: const InputDecoration(labelText: 'UPI reference no. (optional, helps in disputes)')),
                const SizedBox(height: 10),
              ],
              BusyButton(
                label: method == 'cash' ? 'I\'ve given $amount cash' : method == 'gift' ? 'Gift handed over' : 'I\'ve paid $amount',
                color: VP.green,
                onPressed: _markPaid,
              ),
              TextButton(onPressed: () => _confirmCancel(context), child: const Text('Cancel request', style: TextStyle(color: VP.red))),
            ],
          ]),
        ),
        const SizedBox(height: 12),
        // ------------------------------------------------ step 2
        Opacity(
          opacity: paid ? 1 : 0.45,
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: status == 'disputed' ? VP.redSoft : VP.ground, borderRadius: BorderRadius.circular(18)),
            child: Column(children: [
              Row(children: [
                const _StepDot(n: 2, done: false),
                const SizedBox(width: 10),
                Expanded(child: Text('Step 2 · $first confirms', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
                if (paid) Text(status == 'disputed' ? 'Says not received' : 'Waiting', style: TextStyle(fontWeight: FontWeight.w700, color: status == 'disputed' ? VP.red : VP.amberText)),
              ]),
              if (paid && status == 'paid') ...[
                const SizedBox(height: 18),
                const SizedBox(width: 90, height: 90, child: CircularProgressIndicator(strokeWidth: 8, color: VP.blue, backgroundColor: Color(0xFFDCE5EF))),
                const SizedBox(height: 16),
                Text.rich(
                  TextSpan(style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700), children: [
                    TextSpan(text: 'Ask $first to tap '),
                    const TextSpan(text: 'Received', style: TextStyle(color: VP.green)),
                    const TextSpan(text: '\non his phone'),
                  ]),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 6),
                Text('Valid only after he confirms. ${pts(asNum(r['points']))} points are on hold till then.', textAlign: TextAlign.center, style: const TextStyle(color: VP.muted)),
              ],
              if (status == 'disputed') ...[
                const SizedBox(height: 10),
                Text('${r['dispute_note'] ?? 'Customer says not received'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 10),
                TextField(controller: _ref, decoration: const InputDecoration(labelText: 'UPI reference / proof')),
                const SizedBox(height: 10),
                BusyButton(label: 'Send again with proof', onPressed: _markPaid),
              ],
            ]),
          ),
        ),
        if (paid && status == 'paid') ...[
          const SizedBox(height: 16),
          const Text('No internet on his phone? Enter the OTP from his SMS:', style: TextStyle(color: Color(0xFF3C4856))),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _otp,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 8),
                decoration: InputDecoration(hintText: _devOtp == null ? '4-digit OTP' : 'dev: $_devOtp'),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(width: 110, child: BusyButton(label: 'Verify', onPressed: _verifyOtp)),
          ]),
          TextButton(onPressed: _markPaid, child: const Text('Resend SMS')),
          const Text('Not confirmed in 24 hrs? It goes to Mere Points support to check.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: VP.muted)),
        ],
      ]),
    );
  }

  Future<void> _confirmCancel(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this redemption?'),
        content: const Text('Points go back to the customer.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: VP.red, minimumSize: const Size(0, 44)), onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel it')),
        ],
      ),
    );
    if (ok == true) {
      try {
        await _cancel();
      } catch (e) {
        if (context.mounted) showError(context, e);
      }
    }
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({required this.n, required this.done});
  final int n;
  final bool done;
  @override
  Widget build(BuildContext context) => Container(
        width: 30,
        height: 30,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: done ? VP.green : VP.blue, shape: BoxShape.circle),
        child: done ? const Icon(Icons.check, size: 18, color: Colors.white) : Text('$n', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
      );
}

class RedeemDoneScreen extends StatelessWidget {
  const RedeemDoneScreen({super.key, required this.r});
  final Map<String, dynamic> r;
  @override
  Widget build(BuildContext context) {
    final first = '${r['customer_name'] ?? 'Customer'}'.split(' ').first;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 40),
          const Center(child: SuccessBadge()),
          const SizedBox(height: 14),
          Center(child: Text('$first confirmed Received', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700))),
          Center(child: Text(r['method'] == 'gift' ? '${r['gift_name']}' : rupees(asNum(r['value_rupees'])), style: const TextStyle(fontSize: 44, fontWeight: FontWeight.w800))),
          Center(child: Text('Redemption complete · ${pts(asNum(r['points']))} points deducted', style: const TextStyle(color: VP.muted))),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(border: Border.all(color: VP.line), borderRadius: BorderRadius.circular(18)),
            child: Column(children: [
              _kv('Redemption ID', '${r['id']}'),
              _kv('Paid by', r['method'] == 'upi' ? 'UPI to ${r['upi_id']}' : r['method'] == 'cash' ? 'Cash' : 'Gift'),
              _kv('Paid at', shortDate(r['paid_at'])),
              _kv('Received confirmed', '${shortDate(r['closed_at'])} · ${r['confirm_channel'] == 'sms_otp' ? 'SMS OTP' : 'in app'}'),
              const Divider(height: 22),
              _kv('Balance left at your shop', pts(asNum(r['balance_left'])), bold: true),
            ]),
          ),
        ]),
      ),
      bottomNavigationBar: BottomAction(note: 'Receipt sent to customer by SMS', child: FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Done'))),
    );
  }

  Widget _kv(String k, String v, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(k, style: TextStyle(color: bold ? VP.ink : VP.muted, fontWeight: bold ? FontWeight.w700 : FontWeight.w400))),
          Flexible(child: Text(v, textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w700, fontSize: bold ? 20 : 15, color: bold ? VP.blue : VP.ink))),
        ]),
      );
}
