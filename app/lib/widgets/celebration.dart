import 'dart:math';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/format.dart';
import '../core/theme.dart';

/// Short chime + a double haptic tap. Never throws: a phone on silent or without audio just skips the sound.
Future<void> playCelebration() async {
  HapticFeedback.mediumImpact();
  Future.delayed(const Duration(milliseconds: 160), HapticFeedback.heavyImpact);
  try {
    final p = AudioPlayer();
    p.onPlayerComplete.listen((_) => p.dispose());
    await p.play(AssetSource('sounds/celebrate.wav'), volume: 0.9);
  } catch (_) {}
}

/// Full-screen "points received" moment: dark backdrop, confetti, ribbon that unrolls, coin that pops,
/// points that count up, and a chime. Returns when the person taps the button.
Future<void> showCelebration(
  BuildContext context, {
  required int points,
  String ribbon = 'Congratulations!',
  String? line,
  String button = 'Great!',
}) {
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: false,
    barrierColor: const Color(0xE6082033),
    transitionDuration: const Duration(milliseconds: 250),
    transitionBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
    pageBuilder: (ctx, _, __) => _CelebrationPage(points: points, ribbon: ribbon, line: line, button: button),
  );
}

class _CelebrationPage extends StatelessWidget {
  const _CelebrationPage({required this.points, required this.ribbon, required this.line, required this.button});
  final int points;
  final String ribbon;
  final String? line;
  final String button;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Stack(fit: StackFit.expand, children: [
        const IgnorePointer(child: ConfettiBurst()),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              CelebrationHeader(points: points, ribbon: ribbon, dark: true),
              if (line != null) ...[
                const SizedBox(height: 14),
                Text(line!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 17, height: 1.35)),
              ],
              const SizedBox(height: 36),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: const Color(0xFFF4AA04), foregroundColor: VP.ink),
                onPressed: () => Navigator.pop(context),
                child: Text(button),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// Ribbon + coin + counting number. Plays the chime once when it appears.
class CelebrationHeader extends StatefulWidget {
  const CelebrationHeader({super.key, required this.points, this.ribbon = 'Congratulations!', this.dark = false, this.sound = true});
  final int points;
  final String ribbon;
  final bool dark; // on a dark backdrop the number is white
  final bool sound;
  @override
  State<CelebrationHeader> createState() => _CelebrationHeaderState();
}

class _CelebrationHeaderState extends State<CelebrationHeader> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))..forward();

  @override
  void initState() {
    super.initState();
    if (widget.sound) playCelebration();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        final coin = Curves.elasticOut.transform(const Interval(0.0, 0.45).transform(_c.value));
        final ribbonT = Curves.easeOutBack.transform(const Interval(0.25, 0.6).transform(_c.value));
        final count = Curves.easeOutCubic.transform(const Interval(0.3, 0.9).transform(_c.value));
        final glow = 0.5 + 0.5 * sin(_c.value * pi * 6);
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Transform.scale(
            scale: coin,
            child: Container(
              width: 120, height: 120,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const RadialGradient(colors: [Color(0xFFFFD866), Color(0xFFF4AA04)]),
                border: Border.all(color: const Color(0xFFFFE9A8), width: 6),
                boxShadow: [BoxShadow(color: const Color(0xFFF4AA04).withValues(alpha: 0.35 + 0.25 * glow), blurRadius: 30 + 14 * glow, spreadRadius: 4)],
              ),
              child: const Icon(Icons.star_rounded, size: 64, color: Colors.white),
            ),
          ),
          const SizedBox(height: 18),
          Opacity(
            opacity: ribbonT.clamp(0.0, 1.0).toDouble(),
            child: Transform.scale(scaleX: ribbonT.clamp(0.0, 1.2).toDouble(), scaleY: 1.0, child: _Ribbon(text: widget.ribbon)),
          ),
          const SizedBox(height: 14),
          Text(
            '+${pts((widget.points * count).round())}',
            style: TextStyle(fontSize: 58, fontWeight: FontWeight.w900, color: widget.dark ? Colors.white : VP.green, height: 1.05),
          ),
          Text('points', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: widget.dark ? const Color(0xFFFFD866) : VP.muted)),
        ]);
      },
    );
  }
}

/// Gold ribbon with swallow-tail ends and darker folds.
class _Ribbon extends StatelessWidget {
  const _Ribbon({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _RibbonPainter(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 46, vertical: 12),
        child: Text(text, style: const TextStyle(color: Color(0xFF3B2700), fontSize: 20, fontWeight: FontWeight.w900, letterSpacing: 0.3)),
      ),
    );
  }
}

class _RibbonPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    const tail = 26.0, drop = 8.0;
    final w = size.width, h = size.height;
    final dark = Paint()..color = const Color(0xFFB47A00);
    final main = Paint()..shader = const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFFFD866), Color(0xFFF4AA04)]).createShader(Offset.zero & size);
    // tails (behind), notched
    canvas.drawPath(Path()..moveTo(0, drop)..lineTo(tail + 6, drop)..lineTo(tail + 6, h + drop)..lineTo(0, h + drop)..lineTo(12, h / 2 + drop)..close(), dark);
    canvas.drawPath(Path()..moveTo(w, drop)..lineTo(w - tail - 6, drop)..lineTo(w - tail - 6, h + drop)..lineTo(w, h + drop)..lineTo(w - 12, h / 2 + drop)..close(), dark);
    // folds
    canvas.drawPath(Path()..moveTo(tail, h)..lineTo(tail + 6, h)..lineTo(tail + 6, h + drop)..close(), Paint()..color = const Color(0xFF7A5000));
    canvas.drawPath(Path()..moveTo(w - tail, h)..lineTo(w - tail - 6, h)..lineTo(w - tail - 6, h + drop)..close(), Paint()..color = const Color(0xFF7A5000));
    // band
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(tail, 0, w - tail * 2, h), const Radius.circular(4)), main);
  }

  @override
  bool shouldRepaint(_) => false;
}

/// Colourful paper falling from the top for about three seconds.
class ConfettiBurst extends StatefulWidget {
  const ConfettiBurst({super.key, this.count = 70});
  final int count;
  @override
  State<ConfettiBurst> createState() => _ConfettiBurstState();
}

class _Bit {
  _Bit(Random r)
      : x = r.nextDouble(),
        delay = r.nextDouble() * 0.35,
        speed = 0.55 + r.nextDouble() * 0.6,
        drift = (r.nextDouble() - 0.5) * 0.25,
        spin = (r.nextDouble() - 0.5) * 12,
        size = 6 + r.nextDouble() * 7,
        round = r.nextBool(),
        color = _colors[r.nextInt(_colors.length)];
  final double x, delay, speed, drift, spin, size;
  final bool round;
  final Color color;
  static const _colors = [Color(0xFFF4AA04), Color(0xFFFFD866), Color(0xFF2E5E3A), Color(0xFF12805C), Color(0xFFE5484D), Color(0xFF3E8EDE), Colors.white];
}

class _ConfettiBurstState extends State<ConfettiBurst> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 3600))..forward();
  late final _bits = () {
    final r = Random();
    return [for (var i = 0; i < widget.count; i++) _Bit(r)];
  }();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: _c, builder: (_, __) => CustomPaint(painter: _ConfettiPainter(_bits, _c.value), size: Size.infinite));
}

class _ConfettiPainter extends CustomPainter {
  _ConfettiPainter(this.bits, this.t);
  final List<_Bit> bits;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    for (final b in bits) {
      final p = ((t - b.delay) / (1 - b.delay)).clamp(0.0, 1.0).toDouble();
      if (p <= 0) continue;
      final y = -20 + (size.height + 40) * pow(p, 1.4).toDouble() * b.speed;
      final x = size.width * (b.x + b.drift * p) + sin(p * 9 + b.x * 10) * 14;
      final paint = Paint()..color = b.color.withValues(alpha: p > 0.85 ? (1 - p) / 0.15 : 1.0);
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(b.spin * p);
      if (b.round) {
        canvas.drawCircle(Offset.zero, b.size / 2, paint);
      } else {
        canvas.drawRect(Rect.fromCenter(center: Offset.zero, width: b.size, height: b.size * 0.55), paint);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_ConfettiPainter old) => old.t != t;
}
