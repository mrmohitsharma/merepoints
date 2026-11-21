import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// First-time profile, one question at a time: name, work (up to 3), where you work.
class CustomerSignupScreen extends StatefulWidget {
  const CustomerSignupScreen({super.key});
  @override
  State<CustomerSignupScreen> createState() => _CustomerSignupScreenState();
}

class _CustomerSignupScreenState extends State<CustomerSignupScreen> {
  static const _steps = 3;
  static const _maxWork = 3;

  late final _name = TextEditingController(text: context.read<Session>().name ?? '');
  final _city = TextEditingController();
  final _area = TextEditingController();
  final _work = <String>[]; // order picked = first is the main one
  int _step = 0;
  bool _locating = false;
  String? _state, _pincode, _detected;
  double? _lat, _lng;

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _area.dispose();
    super.dispose();
  }

  void _toggle(String code) {
    setState(() {
      if (_work.contains(code)) {
        _work.remove(code);
      } else if (_work.length >= _maxWork) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(const SnackBar(content: Text('You can pick up to 3. Tap one to remove it first.')));
      } else {
        _work.add(code);
      }
    });
  }

  /// GPS, then the phone's own geocoder turns it into city and area. Nothing is sent anywhere until the last step.
  Future<void> _locate() async {
    setState(() => _locating = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw ApiException(0, 'LOC', 'Turn on location in your phone, or type your city below.');
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
      if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
        throw ApiException(0, 'LOC', 'Location is off for Mere Points. Allow it in phone Settings, or type your city below.');
      }
      final pos = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high).timeout(const Duration(seconds: 20));
      _lat = pos.latitude;
      _lng = pos.longitude;
      try {
        final m = (await placemarkFromCoordinates(pos.latitude, pos.longitude)).firstOrNull;
        if (m != null) {
          final city = (m.locality?.isNotEmpty == true ? m.locality : m.subAdministrativeArea) ?? '';
          final area = m.subLocality ?? '';
          if (city.isNotEmpty) _city.text = city;
          if (area.isNotEmpty) _area.text = area;
          _state = m.administrativeArea?.isNotEmpty == true ? m.administrativeArea : null;
          _pincode = RegExp(r'^\d{6}$').hasMatch(m.postalCode ?? '') ? m.postalCode : null;
          _detected = [area, city, _state].where((e) => e != null && e.isNotEmpty).join(', ');
        }
      } catch (_) {
        _detected = 'Location saved. Type your city below.';
      }
      if (mounted) setState(() {});
    } on TimeoutException {
      if (mounted) showError(context, 'Could not get your location. Move near a window or type your city.');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  String? get _problem {
    switch (_step) {
      case 0:
        return _name.text.trim().length < 2 ? 'Please type your name' : null;
      case 1:
        return _work.isEmpty ? 'Pick at least one' : null;
      default:
        return _city.text.trim().length < 2 ? 'Please type your city, or tap Use my location' : null;
    }
  }

  Future<void> _next() async {
    final problem = _problem;
    if (problem != null) throw ApiException(400, 'STEP', problem);
    FocusScope.of(context).unfocus();
    if (_step < _steps - 1) {
      setState(() => _step++);
      return;
    }
    final api = context.read<ApiClient>();
    final session = context.read<Session>();
    await api.post('me/customer', {
      'name': _name.text.trim(),
      'professions': _work,
      'city': _city.text.trim(),
      if (_area.text.trim().isNotEmpty) 'area': _area.text.trim(),
      if (_state != null) 'state': _state,
      if (_pincode != null) 'pincode': _pincode,
      if (_lat != null) ...{'lat': _lat, 'lng': _lng},
      'language': session.language,
    });
    await session.refresh();
    await session.switchTo(const ActiveRole.customer());
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  void _back() {
    if (_step == 0) {
      Navigator.maybePop(context);
    } else {
      setState(() => _step--);
    }
  }

  @override
  Widget build(BuildContext context) {
    final titles = ['What is your name?', 'What work do you do?', 'Where do you work?'];
    final subs = ['So shops can greet you properly.', 'Pick up to 3. Shops send offers made for your work.', 'We show you shops and offers near you.'];
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 20, 0),
              child: Row(children: [
                IconButton(onPressed: _back, icon: const Icon(Icons.arrow_back)),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: TweenAnimationBuilder<double>(
                      tween: Tween(end: (_step + 1) / _steps),
                      duration: const Duration(milliseconds: 300),
                      builder: (_, v, __) => LinearProgressIndicator(value: v, minHeight: 8, backgroundColor: VP.blueSoft, color: VP.amber),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text('${_step + 1}/$_steps', style: const TextStyle(color: VP.muted, fontWeight: FontWeight.w700)),
              ]),
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                transitionBuilder: (c, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0.06, 0), end: Offset.zero).animate(a), child: c)),
                child: SingleChildScrollView(
                  key: ValueKey(_step),
                  padding: const EdgeInsets.fromLTRB(24, 22, 24, 24),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(titles[_step], style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, height: 1.15)),
                    const SizedBox(height: 6),
                    Text(subs[_step], style: const TextStyle(fontSize: 15.5, color: VP.muted, height: 1.35)),
                    const SizedBox(height: 24),
                    if (_step == 0) _nameStep() else if (_step == 1) _workStep() else _whereStep(),
                  ]),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
              child: BusyButton(label: _step == _steps - 1 ? 'Start collecting points' : 'Next', icon: _step == _steps - 1 ? Icons.check : Icons.arrow_forward, onPressed: _next),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _nameStep() => TextField(
        controller: _name,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        textInputAction: TextInputAction.next,
        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
        decoration: const InputDecoration(hintText: 'e.g. Ramesh Kumar'),
        onSubmitted: (_) async {
          try {
            await _next();
          } catch (e) {
            if (mounted) showError(context, e);
          }
        },
      );

  Widget _workStep() {
    final entries = professions.entries.toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      GridView.count(
        crossAxisCount: 3,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 0.92,
        children: [
          for (final e in entries)
            _WorkTile(
              icon: professionIcons[e.key] ?? '🛠️',
              label: e.value,
              order: _work.indexOf(e.key) + 1, // 0 = not picked
              onTap: () => _toggle(e.key),
            ),
        ],
      ),
      const SizedBox(height: 14),
      Center(child: Text('${_work.length} of $_maxWork picked', style: TextStyle(color: _work.isEmpty ? VP.muted : VP.green, fontWeight: FontWeight.w700))),
    ]);
  }

  Widget _whereStep() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        OutlinedButton.icon(
          onPressed: _locating ? null : _locate,
          icon: _locating ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Icon(Icons.my_location),
          label: Text(_locating ? 'Finding you…' : _lat == null ? 'Use my current location' : 'Update my location'),
        ),
        if (_detected != null && _detected!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(children: [
              const Icon(Icons.place, size: 18, color: VP.green),
              const SizedBox(width: 6),
              Expanded(child: Text(_detected!, style: const TextStyle(color: VP.green, fontWeight: FontWeight.w700))),
            ]),
          ),
        const SizedBox(height: 18),
        TextField(controller: _city, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'City', prefixIcon: Icon(Icons.location_city_outlined)), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        TextField(controller: _area, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Area / locality (optional)', prefixIcon: Icon(Icons.map_outlined))),
        const SizedBox(height: 14),
        const InfoNote('Your exact location is used only to show shops near you. You can change it any time in Profile.'),
      ]);
}

/// One work type: big emoji, name, and a numbered badge when picked (1 = main work).
class _WorkTile extends StatelessWidget {
  const _WorkTile({required this.icon, required this.label, required this.order, required this.onTap});
  final String icon;
  final String label;
  final int order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final on = order > 0;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        decoration: BoxDecoration(
          color: on ? VP.blueSoft : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: on ? VP.blue : const Color(0xFFCBD3DC), width: on ? 2.5 : 1),
        ),
        child: Stack(children: [
          Center(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 10, 6, 8),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                AnimatedScale(scale: on ? 1.12 : 1, duration: const Duration(milliseconds: 180), child: Text(icon, style: const TextStyle(fontSize: 34, height: 1.1))),
                const SizedBox(height: 8),
                Text(label, textAlign: TextAlign.center, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, height: 1.15, fontWeight: on ? FontWeight.w800 : FontWeight.w600, color: on ? VP.blue : VP.ink)),
              ]),
            ),
          ),
          if (on)
            Positioned(
              top: 6, right: 6,
              child: Container(
                width: 22, height: 22, alignment: Alignment.center,
                decoration: const BoxDecoration(color: VP.blue, shape: BoxShape.circle),
                child: Text('$order', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800)),
              ),
            ),
        ]),
      ),
    );
  }
}
