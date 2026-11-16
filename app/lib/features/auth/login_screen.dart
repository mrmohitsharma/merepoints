import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Mobile + OTP for everyone (customers, shop owners, staff). Google is offered too;
/// the server still asks to verify the mobile once, because points and SMS run on it.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();

  Future<void> _getOtp() async {
    final m = _mobile.text.replaceAll(RegExp(r'\D'), '');
    if (m.length != 10) throw ApiException(400, 'BAD_MOBILE', 'Enter your 10-digit mobile number');
    final r = await context.read<ApiClient>().post('auth/otp', {'mobile': m}) as Map<String, dynamic>;
    if (!mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => OtpScreen(mobile: m, devCode: r['devCode'] as String?)));
  }

  Future<void> _google() async {
    // Wire google_sign_in here: get idToken, POST auth/google. If the response has needsMobile,
    // continue with mobile OTP and pass linkToken to auth/verify.
    throw ApiException(400, 'GOOGLE_SOON', 'Google sign-in will be switched on soon. Please use your mobile number.');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: ListView(padding: EdgeInsets.zero, children: [
        Container(
          padding: EdgeInsets.fromLTRB(24, MediaQuery.of(context).padding.top + 48, 24, 32),
          decoration: const BoxDecoration(color: VP.blue, borderRadius: BorderRadius.vertical(bottom: Radius.circular(28))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 60, height: 60, alignment: Alignment.center,
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
              child: const Text('V', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: VP.blue)),
            ),
            const SizedBox(height: 14),
            const Text('Vyapar Point', style: TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w800)),
            const Text('Shops reward their regular customers.\nCustomers collect points everywhere.', style: TextStyle(color: Colors.white, fontSize: 16, height: 1.35)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(context.t('mobile'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
              style: const TextStyle(fontSize: 21),
              decoration: const InputDecoration(prefixText: '+91  ', hintText: '98765 43210'),
            ),
            const SizedBox(height: 14),
            BusyButton(label: context.t('get_otp'), onPressed: _getOtp),
            const SizedBox(height: 18),
            const Row(children: [Expanded(child: Divider()), Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: VP.muted))), Expanded(child: Divider())]),
            const SizedBox(height: 18),
            BusyButton(label: context.t('google'), icon: Icons.account_circle_outlined, outlined: true, onPressed: _google),
            const SizedBox(height: 28),
            const Text('New here? Same button. We\'ll set you up.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF3C4856))),
            const SizedBox(height: 6),
            const Text('By continuing you agree to the Terms and Privacy Policy', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: VP.muted)),
          ]),
        ),
      ]),
    );
  }
}

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.mobile, this.devCode});
  final String mobile;
  final String? devCode;
  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  late final _code = TextEditingController(text: widget.devCode ?? '');
  int _resendIn = 30;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    _resendIn = 30;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn = (_resendIn - 1).clamp(0, 30));
      if (_resendIn == 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_code.text.length != 6) throw ApiException(400, 'OTP', 'Enter the 6-digit OTP');
    final api = context.read<ApiClient>();
    final session = context.read<Session>();
    final r = await api.post('auth/verify', {'mobile': widget.mobile, 'code': _code.text}) as Map<String, dynamic>;
    await session.signedIn(r);
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      backgroundColor: Colors.white,
      body: ListView(padding: const EdgeInsets.all(24), children: [
        Text(context.t('enter_otp'), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text('Sent by SMS to +91 ${widget.mobile}', style: const TextStyle(fontSize: 16, color: VP.muted)),
        const SizedBox(height: 24),
        TextField(
          controller: _code,
          autofocus: true,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: 14),
          decoration: const InputDecoration(hintText: '••••••'),
        ),
        const SizedBox(height: 12),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Auto-reading SMS…', style: TextStyle(color: VP.muted)),
          _resendIn > 0
              ? Text('Resend in 0:${_resendIn.toString().padLeft(2, '0')}', style: const TextStyle(color: VP.muted))
              : TextButton(
                  onPressed: () async {
                    try {
                      await context.read<ApiClient>().post('auth/otp', {'mobile': widget.mobile});
                      setState(_startTimer);
                    } catch (e) {
                      if (context.mounted) showError(context, e);
                    }
                  },
                  child: const Text('Resend OTP'),
                ),
        ]),
        const SizedBox(height: 24),
        BusyButton(label: context.t('verify'), onPressed: _verify),
      ]),
    );
  }
}
