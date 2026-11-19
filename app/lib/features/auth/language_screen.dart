import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';

/// First screen. English and Hindi on top (large), regional languages below.
class LanguageScreen extends StatefulWidget {
  const LanguageScreen({super.key, this.popOnDone = false});
  final bool popOnDone; // when opened from Profile
  @override
  State<LanguageScreen> createState() => _LanguageScreenState();
}

class _LanguageScreenState extends State<LanguageScreen> {
  late String _code = context.read<Session>().language;

  Widget _tile((String, String, String) l, {bool big = false}) {
    final on = _code == l.$1;
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: () => setState(() => _code = l.$1),
      child: Container(
        height: big ? 78 : 64,
        decoration: BoxDecoration(
          color: on ? VP.blueSoft : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: on ? VP.blue : const Color(0xFFCBD3DC), width: on ? 3 : 1),
        ),
        child: Stack(children: [
          Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(l.$2, style: TextStyle(fontSize: big ? 23 : 19, fontWeight: FontWeight.w800, color: on ? VP.blue : VP.ink)),
              Text(l.$3, style: const TextStyle(fontSize: 12, color: VP.muted)),
            ]),
          ),
          if (on) const Positioned(top: 8, right: 8, child: Icon(Icons.check_circle, color: VP.blue, size: 22)),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: ListView(padding: const EdgeInsets.all(20), children: [
              const SizedBox(height: 24),
              Center(
                child: Container(
                  width: 64, height: 64, alignment: Alignment.center,
                  decoration: BoxDecoration(color: VP.blue, borderRadius: BorderRadius.circular(20)),
                  child: const Text('M', style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: Colors.white)),
                ),
              ),
              const SizedBox(height: 12),
              const Center(child: Text('Mere Points', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800))),
              const Center(child: Text('Choose your language · अपनी भाषा चुनें', style: TextStyle(fontSize: 17, color: Color(0xFF3C4856)))),
              const SizedBox(height: 20),
              Row(children: [Expanded(child: _tile(languages[0], big: true)), const SizedBox(width: 10), Expanded(child: _tile(languages[1], big: true))]),
              const SizedBox(height: 16),
              const Text('Regional languages', style: TextStyle(color: VP.muted, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              GridView.count(
                crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 2.6,
                children: languages.skip(2).map((l) => _tile(l)).toList(),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: FilledButton(
              onPressed: () async {
                await context.read<Session>().setLanguage(_code);
                if (widget.popOnDone && context.mounted) Navigator.pop(context);
              },
              child: Text(tr(_code, 'continue')),
            ),
          ),
        ]),
      ),
    );
  }
}
