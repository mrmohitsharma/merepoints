import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// OAuth *web* client ID from Google Cloud, passed at build time: --dart-define=GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
const String kGoogleWebClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');

Future<void> _finish(BuildContext context, Map<String, dynamic> data) async {
  await context.read<Session>().signedIn(data);
  if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
}

final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$');

String? _passwordProblem(String p) {
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (!RegExp(r'[A-Za-z]').hasMatch(p)) return 'Password needs at least one letter';
  if (!RegExp(r'\d').hasMatch(p)) return 'Password needs at least one number';
  return null;
}

/// Login for customers, shop owners and staff: mobile OTP, email + password, or Google.
/// Google (and email sign-up) still verify the mobile once, because points and SMS run on it.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.linkToken, this.googleName});

  /// Set when coming back from Google sign-in for a new account: only the mobile step is shown.
  final String? linkToken;
  final String? googleName;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  int _tab = 0; // 0 mobile OTP, 1 email

  @override
  void dispose() {
    _mobile.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _getOtp() async {
    final m = _mobile.text.replaceAll(RegExp(r'\D'), '');
    if (m.length != 10) throw ApiException(400, 'BAD_MOBILE', 'Enter your 10-digit mobile number');
    final r = await context.read<ApiClient>().post('auth/otp', {'mobile': m}) as Map<String, dynamic>;
    if (!mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => OtpScreen(mobile: m, devCode: r['devCode'] as String?, linkToken: widget.linkToken)));
  }

  Future<void> _emailLogin() async {
    final email = _email.text.trim();
    if (!_emailRe.hasMatch(email)) throw ApiException(400, 'BAD_EMAIL', 'Enter a valid email address');
    if (_password.text.isEmpty) throw ApiException(400, 'NO_PASSWORD', 'Enter your password');
    final r = await context.read<ApiClient>().post('auth/email/login', {'email': email, 'password': _password.text}) as Map<String, dynamic>;
    if (mounted) await _finish(context, r);
  }

  Future<void> _google() async {
    if (kGoogleWebClientId.isEmpty) {
      throw ApiException(400, 'GOOGLE_SETUP', 'Google sign-in is not switched on in this build yet. Please use mobile OTP or email.');
    }
    final api = context.read<ApiClient>();
    final g = GoogleSignIn(scopes: const ['email'], serverClientId: kGoogleWebClientId);
    String? idToken;
    try {
      await g.signOut(); // always show the account picker
      final account = await g.signIn();
      if (account == null) return; // closed the picker
      idToken = (await account.authentication).idToken;
    } on PlatformException {
      throw ApiException(400, 'GOOGLE_FAILED', 'Google sign-in did not complete. Please try again.');
    }
    if (idToken == null) throw ApiException(400, 'GOOGLE_FAILED', 'Google did not return a sign-in token. Please try again.');
    final r = await api.post('auth/google', {'idToken': idToken}) as Map<String, dynamic>;
    if (!mounted) return;
    if (r['needsMobile'] == true) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => LoginScreen(linkToken: r['linkToken'] as String?, googleName: r['name'] as String?)));
    } else {
      await _finish(context, r);
    }
  }

  @override
  Widget build(BuildContext context) {
    final linking = widget.linkToken != null;
    return Scaffold(
      backgroundColor: VP.blue,
      body: LayoutBuilder(builder: (context, box) {
        return SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: box.maxHeight),
            child: IntrinsicHeight(
             child: Column(children: [
              // Brand block: logo centred, then a short line. Sits on the app colour; the form is a white sheet below.
              Padding(
                padding: EdgeInsets.fromLTRB(28, MediaQuery.of(context).padding.top + (linking ? 16 : 34), 28, 28),
                child: Column(children: [
                  if (linking)
                    Align(alignment: Alignment.centerLeft, child: IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.arrow_back, color: Colors.white))),
                  Image.asset('assets/brand/logo-light.png', height: 64, semanticLabel: 'Mere Points'),
                  const SizedBox(height: 14),
                  Text(
                    linking ? 'Hi${widget.googleName != null ? ', ${widget.googleName!.split(' ').first}' : ''}!' : 'Har bill pe points',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    linking ? 'Verify your mobile number once to finish.' : 'Shops reward regular customers.\nCollect points at every shop.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFFD5E3F2), fontSize: 15, height: 1.4),
                  ),
                ]),
              ),
              Expanded(
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
                  decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(30))),
                  child: SafeArea(
                    top: false,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      if (!linking) ...[
                        Segmented(labels: const ['Mobile OTP', 'Email'], index: _tab, onChanged: (i) => setState(() => _tab = i)),
                        const SizedBox(height: 22),
                      ],
                      if (linking || _tab == 0) ..._mobileForm() else ..._emailForm(),
                      if (!linking) ...[
                        const SizedBox(height: 20),
                        const Row(children: [Expanded(child: Divider()), Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or continue with', style: TextStyle(color: VP.muted, fontSize: 13))), Expanded(child: Divider())]),
                        const SizedBox(height: 16),
                        _GoogleButton(label: context.t('google'), onPressed: _google),
                      ],
                      const SizedBox(height: 22),
                      const Text('New here? Just continue, we will set you up.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF3C4856))),
                      const SizedBox(height: 6),
                      const Text('By continuing you agree to the Terms and Privacy Policy', textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: VP.muted)),
                    ]),
                  ),
                ),
              ),
             ]),
            ),
          ),
        );
      }),
    );
  }

  List<Widget> _mobileForm() => [
        Text(context.t('mobile'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
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
      ];

  List<Widget> _emailForm() => [
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          autofillHints: const [AutofillHints.email],
          decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
        ),
        const SizedBox(height: 12),
        PasswordField(controller: _password, label: 'Password', onSubmitted: _emailLogin),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ForgotPasswordScreen(email: _email.text.trim()))),
            child: const Text('Forgot password?', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ),
        BusyButton(label: 'Log in', onPressed: _emailLogin),
        const SizedBox(height: 6),
        TextButton(
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => EmailSignupScreen(email: _email.text.trim()))),
          child: const Text('New here? Create account with email', style: TextStyle(fontWeight: FontWeight.w700)),
        ),
      ];
}

/// Password box with a show / hide eye.
class PasswordField extends StatefulWidget {
  const PasswordField({super.key, required this.controller, required this.label, this.onSubmitted, this.hint});
  final TextEditingController controller;
  final String label;
  final String? hint;
  final Future<void> Function()? onSubmitted;
  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _hide = true;
  @override
  Widget build(BuildContext context) => TextField(
        controller: widget.controller,
        obscureText: _hide,
        autocorrect: false,
        enableSuggestions: false,
        autofillHints: const [AutofillHints.password],
        textInputAction: widget.onSubmitted == null ? TextInputAction.next : TextInputAction.done,
        onSubmitted: widget.onSubmitted == null
            ? null
            : (_) async {
                try {
                  await widget.onSubmitted!();
                } catch (e) {
                  if (mounted) showError(context, e);
                }
              },
        decoration: InputDecoration(
          labelText: widget.label,
          hintText: widget.hint,
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined), tooltip: _hide ? 'Show' : 'Hide', onPressed: () => setState(() => _hide = !_hide)),
        ),
      );
}

class _GoogleButton extends StatefulWidget {
  const _GoogleButton({required this.label, required this.onPressed});
  final String label;
  final Future<void> Function() onPressed;
  @override
  State<_GoogleButton> createState() => _GoogleButtonState();
}

class _GoogleButtonState extends State<_GoogleButton> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) => OutlinedButton(
        onPressed: _busy
            ? null
            : () async {
                setState(() => _busy = true);
                try {
                  await widget.onPressed();
                } catch (e) {
                  if (mounted) showError(context, e);
                } finally {
                  if (mounted) setState(() => _busy = false);
                }
              },
        child: _busy
            ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
            : Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Container(
                  width: 26, height: 26, alignment: Alignment.center,
                  decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: const Color(0xFFDADCE0))),
                  child: const Text('G', style: TextStyle(color: Color(0xFF4285F4), fontWeight: FontWeight.w900, fontSize: 16, height: 1.1)),
                ),
                const SizedBox(width: 10),
                Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
              ]),
      );
}

/// Create an account with email + password. The mobile is verified by OTP once.
class EmailSignupScreen extends StatefulWidget {
  const EmailSignupScreen({super.key, this.email = ''});
  final String email;
  @override
  State<EmailSignupScreen> createState() => _EmailSignupScreenState();
}

class _EmailSignupScreenState extends State<EmailSignupScreen> {
  late final _email = TextEditingController(text: widget.email);
  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _otpSent = false;

  String get _m => _mobile.text.replaceAll(RegExp(r'\D'), '');

  void _checkFields() {
    if (_name.text.trim().length < 2) throw ApiException(400, 'NAME', 'Enter your full name');
    if (!_emailRe.hasMatch(_email.text.trim())) throw ApiException(400, 'BAD_EMAIL', 'Enter a valid email address');
    final pw = _passwordProblem(_password.text);
    if (pw != null) throw ApiException(400, 'WEAK_PASSWORD', pw);
    if (_m.length != 10) throw ApiException(400, 'BAD_MOBILE', 'Enter your 10-digit mobile number');
  }

  Future<void> _sendOtp() async {
    _checkFields();
    final r = await context.read<ApiClient>().post('auth/otp', {'mobile': _m}) as Map<String, dynamic>;
    if (!mounted) return;
    setState(() {
      _otpSent = true;
      if (r['devCode'] != null) _code.text = '${r['devCode']}';
    });
    showOk(context, 'OTP sent to +91 $_m');
  }

  Future<void> _create() async {
    _checkFields();
    if (_code.text.length != 6) throw ApiException(400, 'OTP', 'Enter the 6-digit OTP');
    final r = await context.read<ApiClient>().post('auth/email/signup', {
      'email': _email.text.trim(), 'password': _password.text, 'mobile': _m, 'code': _code.text, 'name': _name.text.trim(),
    }) as Map<String, dynamic>;
    if (mounted) await _finish(context, r);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(),
      body: ListView(padding: const EdgeInsets.fromLTRB(24, 0, 24, 24), children: [
        const Text('Create your account', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        const Text('Log in later with email and password.', style: TextStyle(color: VP.muted, fontSize: 15)),
        const SizedBox(height: 20),
        TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(Icons.person_outline))),
        const SizedBox(height: 12),
        TextField(controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline))),
        const SizedBox(height: 12),
        PasswordField(controller: _password, label: 'Create password', hint: '8+ characters, a letter and a number'),
        const SizedBox(height: 12),
        TextField(
          controller: _mobile,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
          enabled: !_otpSent,
          decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91  ', prefixIcon: Icon(Icons.phone_outlined)),
        ),
        const SizedBox(height: 6),
        const Text('Your points and SMS updates come on this number. We verify it with an OTP.', style: TextStyle(color: VP.muted, fontSize: 13)),
        if (_otpSent) ...[
          const SizedBox(height: 14),
          TextField(
            controller: _code,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 12),
            decoration: const InputDecoration(hintText: '••••••', labelText: 'OTP'),
          ),
          Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => setState(() => _otpSent = false), child: const Text('Change number'))),
        ],
        const SizedBox(height: 14),
        BusyButton(label: _otpSent ? 'Create account' : 'Get OTP', onPressed: _otpSent ? _create : _sendOtp),
      ]),
    );
  }
}

/// Forgot password: the reset code is sent by SMS to the mobile on the account.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key, this.email = ''});
  final String email;
  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  late final _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _sent = false;

  Future<void> _send() async {
    if (!_emailRe.hasMatch(_email.text.trim())) throw ApiException(400, 'BAD_EMAIL', 'Enter the email you signed up with');
    final r = await context.read<ApiClient>().post('auth/password/forgot', {'email': _email.text.trim()}) as Map<String, dynamic>;
    if (!mounted) return;
    setState(() {
      _sent = true;
      if (r['devCode'] != null) _code.text = '${r['devCode']}';
    });
  }

  Future<void> _reset() async {
    if (_code.text.length != 6) throw ApiException(400, 'OTP', 'Enter the 6-digit code');
    final pw = _passwordProblem(_password.text);
    if (pw != null) throw ApiException(400, 'WEAK_PASSWORD', pw);
    final r = await context.read<ApiClient>().post('auth/password/reset', {'email': _email.text.trim(), 'code': _code.text, 'password': _password.text}) as Map<String, dynamic>;
    if (!mounted) return;
    showOk(context, 'Password changed. You are logged in.');
    await _finish(context, r);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(),
      body: ListView(padding: const EdgeInsets.fromLTRB(24, 0, 24, 24), children: [
        const Text('Forgot password?', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(_sent ? 'If this email has an account, a 6-digit code was sent by SMS to its mobile number.' : 'Enter your email. We will SMS a code to the mobile number on your account.',
            style: const TextStyle(color: VP.muted, fontSize: 15, height: 1.35)),
        const SizedBox(height: 20),
        TextField(controller: _email, enabled: !_sent, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline))),
        if (_sent) ...[
          const SizedBox(height: 14),
          TextField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 12),
            decoration: const InputDecoration(hintText: '••••••', labelText: 'SMS code'),
          ),
          const SizedBox(height: 12),
          PasswordField(controller: _password, label: 'New password', hint: '8+ characters, a letter and a number', onSubmitted: _reset),
          Align(alignment: Alignment.centerRight, child: TextButton(onPressed: _send, child: const Text('Send code again'))),
        ],
        const SizedBox(height: 14),
        BusyButton(label: _sent ? 'Set new password' : 'Send code', onPressed: _sent ? _reset : _send),
      ]),
    );
  }
}

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.mobile, this.devCode, this.linkToken});
  final String mobile;
  final String? devCode;
  final String? linkToken; // Google account waiting to be linked to this mobile
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
    final r = await context.read<ApiClient>().post('auth/verify', {
      'mobile': widget.mobile, 'code': _code.text, if (widget.linkToken != null) 'linkToken': widget.linkToken,
    }) as Map<String, dynamic>;
    if (mounted) await _finish(context, r);
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
