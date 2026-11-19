import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import 'api.dart';

/// Pick a photo (camera or gallery), ask the API for an upload slot, PUT the bytes, return the public URL.
/// Photos are resized on the phone so they stay under the 2 MB limit on slow networks.
Future<String?> pickAndUploadPhoto(BuildContext context, ApiClient api, {required String purpose, double maxWidth = 1200}) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take photo'), onTap: () => Navigator.pop(ctx, ImageSource.camera)),
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.pop(ctx, ImageSource.gallery)),
      ]),
    ),
  );
  if (source == null) return null;
  final file = await ImagePicker().pickImage(source: source, maxWidth: maxWidth, imageQuality: 80);
  if (file == null) return null;
  final bytes = await file.readAsBytes();
  final name = file.name.toLowerCase();
  final type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  if (bytes.length > 2 * 1024 * 1024) throw ApiException(400, 'FILE_TOO_BIG', 'Photo must be under 2 MB. Try another photo.');

  final slot = await api.post('uploads', {'purpose': purpose, 'contentType': type, 'size': bytes.length}) as Map<String, dynamic>;
  final headers = (slot['headers'] as Map).map((k, v) => MapEntry('$k', '$v'));
  http.Response r;
  try {
    r = await http.put(Uri.parse('${slot['uploadUrl']}'), headers: headers, body: bytes).timeout(const Duration(seconds: 60));
  } catch (_) {
    throw ApiException(0, 'NETWORK', 'Photo upload failed. Check internet and try again.');
  }
  if (r.statusCode >= 300) throw ApiException(r.statusCode, 'UPLOAD_FAILED', 'Photo upload failed. Please try again.');
  return '${slot['url']}';
}
