import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/theme.dart';

enum _Cam { checking, granted, denied, blocked }

/// Camera QR scanner with its own permission step.
/// Asks for the camera when it opens, explains in plain words if the answer was No,
/// and sends the person to the phone's settings if they chose "Don't ask again".
class QrScannerView extends StatefulWidget {
  const QrScannerView({super.key, required this.title, required this.hint, required this.onCode, this.busy = false, this.onBack});
  final String title;
  final String hint;
  final ValueChanged<String> onCode;
  final bool busy;
  final VoidCallback? onBack;

  @override
  State<QrScannerView> createState() => _QrScannerViewState();
}

class _QrScannerViewState extends State<QrScannerView> with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  final _ctl = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates, formats: const [BarcodeFormat.qrCode]);
  late final _line = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat(reverse: true);
  _Cam _cam = _Cam.checking;
  bool _torch = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _askPermission();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _line.dispose();
    _ctl.dispose();
    super.dispose();
  }

  /// Back from the phone's settings: pick up a permission that was just switched on.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && (_cam == _Cam.denied || _cam == _Cam.blocked)) _askPermission(promptIfNeeded: false);
  }

  Future<void> _askPermission({bool promptIfNeeded = true}) async {
    var s = await Permission.camera.status;
    if (!s.isGranted && promptIfNeeded && !s.isPermanentlyDenied) s = await Permission.camera.request();
    if (!mounted) return;
    setState(() => _cam = s.isGranted ? _Cam.granted : (s.isPermanentlyDenied || s.isRestricted) ? _Cam.blocked : _Cam.denied);
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF10161D),
      child: Stack(fit: StackFit.expand, children: [
        if (_cam == _Cam.granted) _camera() else _permissionCard(),
        // Top bar: back, title, torch. Own gradient so the title stays readable on any picture.
        Positioned(
          top: 0, left: 0, right: 0,
          child: Container(
            decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xCC000000), Color(0x00000000)])),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 6, 8, 14),
                child: Row(children: [
                  IconButton.filledTonal(onPressed: widget.onBack ?? () => Navigator.maybePop(context), icon: const Icon(Icons.arrow_back), tooltip: 'Back'),
                  const SizedBox(width: 10),
                  Expanded(child: Text(widget.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700))),
                  if (_cam == _Cam.granted)
                    IconButton.filledTonal(
                      tooltip: 'Torch',
                      onPressed: () {
                        _ctl.toggleTorch();
                        setState(() => _torch = !_torch);
                      },
                      icon: Icon(_torch ? Icons.flash_on : Icons.flash_off),
                    )
                  else
                    const SizedBox(width: 48),
                ]),
              ),
            ),
          ),
        ),
        if (widget.busy) const Center(child: CircularProgressIndicator(color: Colors.white)),
      ]),
    );
  }

  Widget _camera() {
    return LayoutBuilder(builder: (context, box) {
      final side = (box.biggest.shortestSide * 0.62).clamp(160.0, 280.0).toDouble();
      final frame = Rect.fromCenter(center: Offset(box.maxWidth / 2, box.maxHeight / 2 + 6), width: side, height: side);
      return Stack(fit: StackFit.expand, children: [
        MobileScanner(
          controller: _ctl,
          onDetect: (cap) {
            final v = cap.barcodes.firstOrNull?.rawValue;
            if (v != null && v.startsWith('VP1.') && !widget.busy) widget.onCode(v);
          },
          errorBuilder: (context, error, child) => _permissionCard(message: 'We could not start the camera. Close other apps that use it and try again.', retry: true),
        ),
        CustomPaint(painter: _FramePainter(frame)),
        AnimatedBuilder(
          animation: _line,
          builder: (_, __) => Positioned.fromRect(
            rect: Rect.fromLTWH(frame.left + 14, frame.top + 10 + (frame.height - 24) * _line.value, frame.width - 28, 3),
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(2),
                gradient: const LinearGradient(colors: [Color(0x00F4AA04), Color(0xFFF4AA04), Color(0x00F4AA04)]),
              ),
            ),
          ),
        ),
        Positioned(
          top: frame.bottom + 18, left: 24, right: 24,
          child: Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(color: const Color(0x99000000), borderRadius: BorderRadius.circular(20)),
              child: Text(widget.hint, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 14)),
            ),
          ),
        ),
      ]);
    });
  }

  Widget _permissionCard({String? message, bool retry = false}) {
    final blocked = _cam == _Cam.blocked;
    final checking = _cam == _Cam.checking && message == null;
    final text = message ??
        (checking
            ? 'Asking for camera access…'
            : blocked
                ? 'Camera is switched off for Mere Points. Open Settings › Permissions › Camera and allow it.'
                : 'Mere Points needs the camera to scan your customer\'s QR code.');
    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(28, 70, 28, 20),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 64, height: 64,
            decoration: const BoxDecoration(color: Color(0x22F4AA04), shape: BoxShape.circle),
            child: const Icon(Icons.photo_camera_outlined, color: Color(0xFFF4AA04), size: 32),
          ),
          const SizedBox(height: 14),
          Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 15, height: 1.4)),
          if (!checking) ...[
            const SizedBox(height: 14),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(190, 46), backgroundColor: const Color(0xFFF4AA04), foregroundColor: VP.ink, textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              onPressed: () {
                if (blocked && !retry) {
                  openAppSettings();
                } else if (retry) {
                  _ctl.start();
                } else {
                  _askPermission();
                }
              },
              child: Text(blocked && !retry ? 'Open settings' : retry ? 'Try again' : 'Allow camera'),
            ),
            const SizedBox(height: 8),
            const Text('You can also search by mobile number below.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFFC3CCD6), fontSize: 13)),
          ],
        ]),
      ),
    );
  }
}

/// Dark scrim with a clear square and four gold corners.
class _FramePainter extends CustomPainter {
  _FramePainter(this.frame);
  final Rect frame;

  @override
  void paint(Canvas canvas, Size size) {
    final hole = RRect.fromRectAndRadius(frame, const Radius.circular(22));
    final scrim = Path()
      ..addRect(Offset.zero & size)
      ..addRRect(hole)
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(scrim, Paint()..color = const Color(0x99000000));
    final p = Paint()
      ..color = const Color(0xFFF4AA04)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    const len = 30.0, r = 22.0;
    final l = frame.left, t = frame.top, rt = frame.right, b = frame.bottom;
    canvas.drawPath(Path()..moveTo(l, t + len)..lineTo(l, t + r)..arcToPoint(Offset(l + r, t), radius: const Radius.circular(r))..lineTo(l + len, t), p);
    canvas.drawPath(Path()..moveTo(rt - len, t)..lineTo(rt - r, t)..arcToPoint(Offset(rt, t + r), radius: const Radius.circular(r))..lineTo(rt, t + len), p);
    canvas.drawPath(Path()..moveTo(l, b - len)..lineTo(l, b - r)..arcToPoint(Offset(l + r, b), radius: const Radius.circular(r), clockwise: false)..lineTo(l + len, b), p);
    canvas.drawPath(Path()..moveTo(rt - len, b)..lineTo(rt - r, b)..arcToPoint(Offset(rt, b - r), radius: const Radius.circular(r), clockwise: false)..lineTo(rt, b - len), p);
  }

  @override
  bool shouldRepaint(_FramePainter old) => old.frame != frame;
}
