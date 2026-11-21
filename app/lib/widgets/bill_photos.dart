import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/theme.dart';
import '../core/upload.dart';
import 'common.dart';

/// Up to 3 bill photos. Each photo is shrunk on the phone to under 500 KB before it is uploaded.
class BillPhotosField extends StatefulWidget {
  const BillPhotosField({super.key, required this.urls, required this.onChanged, this.max = 3, this.title = 'Bill photos'});
  final List<String> urls;
  final ValueChanged<List<String>> onChanged;
  final int max;
  final String title;
  @override
  State<BillPhotosField> createState() => _BillPhotosFieldState();
}

class _BillPhotosFieldState extends State<BillPhotosField> {
  bool _busy = false;

  Future<void> _add() async {
    setState(() => _busy = true);
    try {
      final url = await pickAndUploadPhoto(context, context.read<ApiClient>(), purpose: 'bill', maxWidth: 1600, maxBytes: 500 * 1024, shrink: true);
      if (url != null && mounted) widget.onChanged([...widget.urls, url]);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final urls = widget.urls;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        const SizedBox(width: 8),
        Text('optional · ${urls.length}/${widget.max}', style: const TextStyle(color: VP.muted, fontSize: 13)),
      ]),
      const SizedBox(height: 8),
      SizedBox(
        height: 92,
        child: ListView(scrollDirection: Axis.horizontal, children: [
          for (var i = 0; i < urls.length; i++)
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: Stack(children: [
                GestureDetector(
                  onTap: () => showDialog<void>(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.network(urls[i])))),
                  child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.network(urls[i], width: 92, height: 92, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(width: 92, height: 92, color: VP.ground, child: const Icon(Icons.broken_image_outlined)))),
                ),
                Positioned(
                  right: 2,
                  top: 2,
                  child: InkWell(
                    onTap: () => widget.onChanged([...urls]..removeAt(i)),
                    child: const CircleAvatar(radius: 12, backgroundColor: Colors.white, child: Icon(Icons.close, size: 16, color: VP.ink)),
                  ),
                ),
              ]),
            ),
          if (urls.length < widget.max)
            InkWell(
              onTap: _busy ? null : _add,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: 92,
                height: 92,
                decoration: BoxDecoration(color: VP.blueSoft, borderRadius: BorderRadius.circular(12), border: Border.all(color: VP.blue.withValues(alpha: 0.4))),
                child: _busy
                    ? const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))
                    : const Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.add_a_photo_outlined, color: VP.blue), SizedBox(height: 4), Text('Add photo', style: TextStyle(color: VP.blue, fontSize: 12, fontWeight: FontWeight.w700))]),
              ),
            ),
        ]),
      ),
    ]);
  }
}
