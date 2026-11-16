import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';

/// Celebration when the customer crosses an admin-defined milestone.
class LevelUpScreen extends StatelessWidget {
  const LevelUpScreen({super.key, required this.level, this.next, required this.basis});
  final Map<String, dynamic> level;
  final Map<String, dynamic>? next;
  final String basis; // 'points' | 'rupees'

  Color _hex(String? h) => Color(int.parse('FF${(h ?? '#E0A800').replaceAll('#', '')}', radix: 16));

  @override
  Widget build(BuildContext context) {
    final name = '${level['name']}';
    final first = (context.read<Session>().name ?? '').split(' ').first;
    final perks = (level['perks'] as List? ?? []).cast<String>();
    final unit = basis == 'rupees' ? '₹' : '';
    return Scaffold(
      backgroundColor: VP.navy,
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: ListView(padding: const EdgeInsets.all(24), children: [
              const SizedBox(height: 24),
              const Center(child: Text('NEW LEVEL UNLOCKED', style: TextStyle(color: Color(0xFFF2C14E), fontWeight: FontWeight.w700, letterSpacing: 1.5))),
              const SizedBox(height: 16),
              Center(
                child: Container(
                  width: 150, height: 150,
                  decoration: BoxDecoration(color: _hex(level['color'] as String?), shape: BoxShape.circle, border: Border.all(color: const Color(0x59FFE7A3), width: 10)),
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    const Icon(Icons.emoji_events, size: 54, color: Color(0xFF4A3200)),
                    Text(name.toUpperCase(), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Color(0xFF4A3200), letterSpacing: 1)),
                  ]),
                ),
              ),
              const SizedBox(height: 18),
              Text('Shabaash${first.isEmpty ? '' : ' $first'}!', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
              if (level['threshold'] != null)
                Text('You crossed $unit${pts(asNum(level['threshold']))}${basis == 'rupees' ? ' earned' : ' points'}', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
              Text('You\'re now a $name member on Vyapar Point', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, fontSize: 16)),
              if (perks.isNotEmpty) ...[
                const SizedBox(height: 22),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(18)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('What $name gets you', style: const TextStyle(color: Color(0xFFF2C14E), fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    for (final p in perks)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(children: [
                          const Icon(Icons.check, color: Color(0xFF6FE0B5), size: 18),
                          const SizedBox(width: 8),
                          Expanded(child: Text(p, style: const TextStyle(color: Colors.white, fontSize: 15))),
                        ]),
                      ),
                  ]),
                ),
              ],
              if (next != null) ...[
                const SizedBox(height: 16),
                Row(children: [
                  const Text('Next:', style: TextStyle(color: Colors.white70)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(value: asNum(next!['progress']).toDouble(), minHeight: 8, color: VP.amber, backgroundColor: Colors.white24),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('${next!['name']} at $unit${pts(asNum(next!['threshold']))}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                ]),
              ],
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: Column(children: [
              FilledButton(style: FilledButton.styleFrom(backgroundColor: VP.amber, foregroundColor: VP.ink), onPressed: () => Navigator.pop(context), child: const Text('Awesome!')),
              const SizedBox(height: 10),
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54, width: 2)),
                onPressed: () => Share.share('I just reached $name on Vyapar Point! Collect points at shops near you: https://vyp.in/app'),
                child: const Text('Share with friends'),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}
