import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class CustomerSignupScreen extends StatefulWidget {
  const CustomerSignupScreen({super.key});
  @override
  State<CustomerSignupScreen> createState() => _CustomerSignupScreenState();
}

class _CustomerSignupScreenState extends State<CustomerSignupScreen> {
  late final _name = TextEditingController(text: context.read<Session>().name ?? '');
  final _city = TextEditingController();
  final _upi = TextEditingController();
  String _profession = 'carpenter';

  Future<void> _submit() async {
    final api = context.read<ApiClient>();
    final session = context.read<Session>();
    if (_name.text.trim().length < 2) throw ApiException(400, 'NAME', 'Enter your full name');
    final upi = _upi.text.trim();
    if (upi.isNotEmpty && !RegExp(r'^[\w.\-]{2,256}@[a-zA-Z]{2,64}$').hasMatch(upi)) {
      throw ApiException(400, 'BAD_UPI', 'Enter a valid UPI ID, like name@bank');
    }
    await api.post('me/customer', {
      'name': _name.text.trim(),
      'profession': _profession,
      if (_city.text.trim().isNotEmpty) 'city': _city.text.trim(),
      if (upi.isNotEmpty) 'upiId': upi,
      'language': session.language,
    });
    await session.refresh();
    await session.switchTo(const ActiveRole.customer());
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final mobile = context.read<Session>().mobile;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(actions: [
        Padding(padding: const EdgeInsets.only(right: 16), child: Center(child: Text('+91 ${prettyMobile(mobile)} ✓', style: const TextStyle(color: VP.green, fontWeight: FontWeight.w700)))),
      ]),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), children: [
        const Text('Create your account', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800)),
        const Text('One account for points at every shop', style: TextStyle(fontSize: 15, color: VP.muted)),
        const SizedBox(height: 20),
        TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name')),
        const SizedBox(height: 16),
        const Text('I am a', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
        const SizedBox(height: 8),
        ChoiceChips<String>(options: professions, selected: {_profession}, onTap: (p) => setState(() => _profession = p)),
        const SizedBox(height: 16),
        TextField(controller: _city, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'City')),
        const SizedBox(height: 16),
        TextField(
          controller: _upi,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: const InputDecoration(labelText: 'Your UPI ID (shops pay your points here)', hintText: 'name@ybl'),
        ),
        const SizedBox(height: 6),
        const InfoNote('You can add it later in Profile. Without UPI, shops pay you in cash or gifts.'),
        const SizedBox(height: 24),
        BusyButton(label: 'Start collecting points', onPressed: _submit),
      ]),
    );
  }
}
