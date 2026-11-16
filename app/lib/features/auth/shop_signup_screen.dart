import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// 4 steps: shop details → what you sell → GPS location (required) → loyalty rules.
class ShopSignupScreen extends StatefulWidget {
  const ShopSignupScreen({super.key});
  @override
  State<ShopSignupScreen> createState() => _ShopSignupScreenState();
}

class _ShopSignupScreenState extends State<ShopSignupScreen> {
  int _step = 0;

  // step 1
  final _shopName = TextEditingController();
  late final _ownerName = TextEditingController(text: context.read<Session>().name ?? '');
  final _email = TextEditingController();
  final _gst = TextEditingController();
  // step 2
  final Set<String> _cats = {};
  final _brands = TextEditingController();
  List<Map<String, dynamic>>? _allCats;
  // step 3
  Position? _pos;
  bool _locating = false;
  String? _gpsError;
  final _address = TextEditingController();
  final _landmark = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  // step 4
  double _percent = 5;
  double _pointValue = 1;
  int _minRedeem = 500;

  static const _maxAccuracyM = 100.0;

  @override
  void initState() {
    super.initState();
    context.read<ApiClient>().get('shops/categories').then((r) {
      if (mounted) setState(() => _allCats = (r as List).cast<Map<String, dynamic>>());
    }).catchError((_) {});
  }

  Future<void> _locate() async {
    setState(() {
      _locating = true;
      _gpsError = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw 'Turn on location (GPS) in your phone settings';
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        throw 'Allow location access so customers can find your shop';
      }
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 25)));
      setState(() => _pos = p);
    } catch (e) {
      setState(() => _gpsError = '$e');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  String? _validate() {
    switch (_step) {
      case 0:
        if (_shopName.text.trim().length < 2) return 'Enter the shop name';
        if (_ownerName.text.trim().length < 2) return 'Enter the owner name';
        final gst = _gst.text.trim().toUpperCase();
        if (gst.isNotEmpty && !RegExp(r'^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$').hasMatch(gst)) return 'GST number looks wrong. Leave it empty if unsure.';
        return null;
      case 1:
        return _cats.isEmpty ? 'Pick at least one thing you sell' : null;
      case 2:
        if (_pos == null) return 'Capture your shop location. It is required.';
        if (_pos!.accuracy > _maxAccuracyM) return 'GPS is not accurate yet (${_pos!.accuracy.round()} m). Stand inside the shop and tap Refresh.';
        if (_address.text.trim().length < 3) return 'Enter shop no. and street';
        if (_city.text.trim().isEmpty || _state.text.trim().isEmpty) return 'Enter city and state';
        if (!RegExp(r'^\d{6}$').hasMatch(_pincode.text.trim())) return 'Enter a 6-digit pincode';
        return null;
      default:
        return null;
    }
  }

  Future<void> _next() async {
    final err = _validate();
    if (err != null) throw ApiException(400, 'FORM', err);
    if (_step < 3) {
      setState(() => _step++);
      if (_step == 2 && _pos == null) _locate();
      return;
    }
    final api = context.read<ApiClient>();
    final session = context.read<Session>();
    final r = await api.post('shops', {
      'name': _shopName.text.trim(),
      'ownerName': _ownerName.text.trim(),
      if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
      if (_gst.text.trim().isNotEmpty) 'gstNumber': _gst.text.trim().toUpperCase(),
      'categories': _cats.toList(),
      if (_brands.text.trim().isNotEmpty) 'brandsNote': _brands.text.trim(),
      'location': {'lat': _pos!.latitude, 'lng': _pos!.longitude, 'accuracyM': _pos!.accuracy},
      'address': {
        'line': _address.text.trim(),
        if (_landmark.text.trim().isNotEmpty) 'landmark': _landmark.text.trim(),
        'city': _city.text.trim(),
        'state': _state.text.trim(),
        'pincode': _pincode.text.trim(),
      },
      'loyalty': {'rewardPercent': _percent, 'pointValueRupees': _pointValue, 'minRedeemPoints': _minRedeem, 'maxPointsPerBill': null, 'maxRedeemPoints': null, 'expiryDays': 365},
    }) as Map<String, dynamic>;
    await session.refresh();
    await session.switchTo(ActiveRole.shop(r['id'] as int));
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  Widget _stepBody() {
    switch (_step) {
      case 0:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const InfoNote('Customers see your logo on their points card. You can add it later in Settings.'),
          const SizedBox(height: 16),
          TextField(controller: _shopName, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Shop name')),
          const SizedBox(height: 14),
          TextField(controller: _ownerName, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Owner name')),
          const SizedBox(height: 14),
          InputDecorator(
            decoration: const InputDecoration(labelText: 'Mobile'),
            child: Text('+91 ${prettyMobile(context.read<Session>().mobile)}   ✓ verified', style: const TextStyle(fontSize: 16)),
          ),
          const SizedBox(height: 14),
          TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email (for reports)')),
          const SizedBox(height: 14),
          TextField(
            controller: _gst,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [LengthLimitingTextInputFormatter(15)],
            decoration: const InputDecoration(labelText: 'GST number (optional)', hintText: '06ABCDE1234F1Z5'),
          ),
        ]);
      case 1:
        if (_allCats == null) return const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()));
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Pick all that apply. Customers find you by these.', style: TextStyle(color: VP.muted)),
          const SizedBox(height: 14),
          ChoiceChips<String>(
            multi: true,
            options: {for (final c in _allCats!) '${c['code']}': '${c['name']}'},
            selected: _cats,
            onTap: (c) => setState(() => _cats.contains(c) ? _cats.remove(c) : _cats.add(c)),
          ),
          const SizedBox(height: 18),
          TextField(controller: _brands, decoration: const InputDecoration(labelText: 'Main brands you stock (optional)')),
        ]);
      case 2:
        final ok = _pos != null && _pos!.accuracy <= _maxAccuracyM;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: ok ? VP.greenSoft : VP.ground, borderRadius: BorderRadius.circular(16), border: Border.all(color: ok ? VP.green : VP.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(ok ? Icons.gps_fixed : Icons.gps_not_fixed, color: ok ? VP.green : VP.muted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _locating ? 'Getting your location…' : _pos == null ? (_gpsError ?? 'Location not captured yet') : ok ? 'GPS location captured · accurate to ${_pos!.accuracy.round()} m' : 'Accuracy ${_pos!.accuracy.round()} m — need ${_maxAccuracyM.round()} m or better',
                    style: TextStyle(fontWeight: FontWeight.w700, color: ok ? VP.green : VP.ink),
                  ),
                ),
              ]),
              if (_pos != null) ...[
                const SizedBox(height: 6),
                Text('${_pos!.latitude.toStringAsFixed(6)}, ${_pos!.longitude.toStringAsFixed(6)}', style: const TextStyle(color: VP.muted)),
                TextButton.icon(
                  onPressed: () => launchUrl(Uri.parse('https://maps.google.com/?q=${_pos!.latitude},${_pos!.longitude}'), mode: LaunchMode.externalApplication),
                  icon: const Icon(Icons.map_outlined),
                  label: const Text('Check on map'),
                ),
              ],
              const SizedBox(height: 4),
              OutlinedButton.icon(
                onPressed: _locating ? null : _locate,
                icon: const Icon(Icons.my_location),
                label: Text(_pos == null ? 'Use my current location' : 'Refresh location'),
              ),
            ]),
          ),
          const SizedBox(height: 6),
          const InfoNote('Stand inside your shop when you do this. We check it before approval.'),
          const SizedBox(height: 16),
          TextField(controller: _address, decoration: const InputDecoration(labelText: 'Shop no. & street')),
          const SizedBox(height: 12),
          TextField(controller: _landmark, decoration: const InputDecoration(labelText: 'Landmark')),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _city, decoration: const InputDecoration(labelText: 'City'))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _state, decoration: const InputDecoration(labelText: 'State'))),
          ]),
          const SizedBox(height: 12),
          TextField(controller: _pincode, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)], decoration: const InputDecoration(labelText: 'Pincode')),
        ]);
      default:
        return LoyaltyRulesEditor(
          percent: _percent,
          pointValue: _pointValue,
          minRedeem: _minRedeem,
          onChanged: (p, v, m) => setState(() {
            _percent = p;
            _pointValue = v;
            _minRedeem = m;
          }),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    const titles = ['Shop details', 'What do you sell?', 'Shop location', 'Your loyalty rules'];
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) setState(() => _step--);
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          title: const Text('Register your shop'),
          actions: [Padding(padding: const EdgeInsets.only(right: 16), child: Center(child: Text('Step ${_step + 1} of 4', style: const TextStyle(color: VP.muted))))],
        ),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(children: [
              for (var i = 0; i < 4; i++)
                Expanded(child: Container(height: 5, margin: EdgeInsets.only(right: i < 3 ? 6 : 0), decoration: BoxDecoration(color: i <= _step ? VP.blue : VP.line, borderRadius: BorderRadius.circular(3)))),
            ]),
          ),
          Expanded(
            child: ListView(padding: const EdgeInsets.all(20), children: [
              Row(children: [
                Text(titles[_step], style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                if (_step == 2) const Padding(padding: EdgeInsets.only(left: 8), child: Text('Required', style: TextStyle(color: VP.red, fontWeight: FontWeight.w700))),
              ]),
              const SizedBox(height: 12),
              _stepBody(),
            ]),
          ),
          BottomAction(
            note: _step == 3 ? 'More rules (max per bill, expiry) in Settings later' : null,
            child: BusyButton(label: ['Next: what do you sell?', 'Next: shop location', 'Next: loyalty rules', 'Submit for approval'][_step], onPressed: _next),
          ),
        ]),
      ),
    );
  }
}

/// Used in sign-up step 4 and in Settings: % per bill, value of 1 point, minimum to redeem.
class LoyaltyRulesEditor extends StatelessWidget {
  const LoyaltyRulesEditor({super.key, required this.percent, required this.pointValue, required this.minRedeem, required this.onChanged});
  final double percent;
  final double pointValue;
  final int minRedeem;
  final void Function(double percent, double pointValue, int minRedeem) onChanged;

  static const _steps = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 7.5, 8.0, 10.0, 12.0, 15.0, 20.0];

  @override
  Widget build(BuildContext context) {
    final i = _steps.indexWhere((s) => s >= percent);
    final points = (10000 * percent / 100).floor();
    String pct(double p) => p == p.roundToDouble() ? '${p.round()}%' : '$p%';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('1. Points per bill', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      Row(children: [
        _RoundBtn(icon: Icons.remove, onTap: i > 0 ? () => onChanged(_steps[i - 1], pointValue, minRedeem) : null),
        Expanded(child: Center(child: Text(pct(percent), style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w800, color: VP.blue)))),
        _RoundBtn(icon: Icons.add, filled: true, onTap: i >= 0 && i < _steps.length - 1 ? () => onChanged(_steps[i + 1], pointValue, minRedeem) : null),
      ]),
      const Center(child: Text('of the bill amount, given as points', style: TextStyle(color: VP.muted))),
      const SizedBox(height: 18),
      const Text('2. Value of 1 point at your shop', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      ChoiceChips<double>(options: const {0.25: '₹0.25', 0.5: '₹0.50', 1.0: '₹1'}, selected: {pointValue}, onTap: (v) => onChanged(percent, v, minRedeem)),
      const SizedBox(height: 18),
      const Text('3. Minimum points to redeem', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      ChoiceChips<int>(options: const {200: '200', 500: '500', 1000: '1,000', 2000: '2,000'}, selected: {minRedeem}, onTap: (m) => onChanged(percent, pointValue, m)),
      const SizedBox(height: 18),
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: VP.greenSoft, borderRadius: BorderRadius.circular(16)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('What your customer gets', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
          const SizedBox(height: 4),
          Text.rich(TextSpan(style: const TextStyle(fontSize: 17, height: 1.35), children: [
            const TextSpan(text: 'Buys for '),
            const TextSpan(text: '₹10,000', style: TextStyle(fontWeight: FontWeight.w800)),
            const TextSpan(text: ' → gets '),
            TextSpan(text: '${pts(points)} points', style: const TextStyle(fontWeight: FontWeight.w800, color: VP.green)),
            const TextSpan(text: ' worth '),
            TextSpan(text: rupees(points * pointValue), style: const TextStyle(fontWeight: FontWeight.w800, color: VP.green)),
          ])),
          const SizedBox(height: 4),
          Text('Your real cost: ${pct(percent * pointValue)} of sales · cash out from ${pts(minRedeem)} points (${rupees(minRedeem * pointValue)})', style: const TextStyle(fontSize: 14, color: Color(0xFF3C4856))),
        ]),
      ),
    ]);
  }
}

class _RoundBtn extends StatelessWidget {
  const _RoundBtn({required this.icon, required this.onTap, this.filled = false});
  final IconData icon;
  final VoidCallback? onTap;
  final bool filled;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 52,
        height: 52,
        child: filled
            ? FilledButton(style: FilledButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(52, 52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))), onPressed: onTap, child: Icon(icon))
            : OutlinedButton(style: OutlinedButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(52, 52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))), onPressed: onTap, child: Icon(icon)),
      );
}
