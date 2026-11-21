import 'dart:typed_data';

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import 'api.dart';

/// Pick a photo (camera or gallery), ask the API for an upload slot, PUT the bytes, return the public URL.
/// Photos are resized on the phone so they stay under the 2 MB limit on slow networks.
Future<String?> pickAndUploadPhoto(BuildContext context, ApiClient api, {required String purpose, double maxWidth = 1200, int maxBytes = 2 * 1024 * 1024, bool shrink = false}) async {
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
  XFile? file;
  try {
    file = await ImagePicker().pickImage(source: source, maxWidth: maxWidth, maxHeight: maxWidth, imageQuality: 80);
  } on PlatformException {
    throw ApiException(0, 'PHOTO_PERMISSION', source == ImageSource.camera
        ? 'Camera is switched off for Mere Points. Allow Camera in phone Settings, or choose from gallery.'
        : 'Could not open the gallery. Allow Photos access in phone Settings.');
  }
  if (file == null) return null;
  var bytes = await file.readAsBytes();
  final name = file.name.toLowerCase();
  var type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  if (shrink && bytes.length > maxBytes) {
    // Compress on the phone so slow networks and storage stay light.
    bytes = await compute(shrinkToJpeg, (bytes, maxBytes));
    type = 'image/jpeg';
  }
  if (bytes.length > maxBytes) throw ApiException(400, 'FILE_TOO_BIG', 'Photo must be under ${maxBytes >= 1024 * 1024 ? '${maxBytes ~/ (1024 * 1024)} MB' : '${maxBytes ~/ 1024} KB'}. Try another photo.');

  final slot = await api.post('uploads', {'purpose': purpose, 'contentType': type, 'size': bytes.length}) as Map<String, dynamic>;
  final headers = (slot['headers'] as Map).map((k, v) => MapEntry('$k', '$v'));
  // Development API hands out a link with its own idea of its address (localhost). The phone must use the address it already reaches.
  var uploadUrl = '${slot['uploadUrl']}';
  final local = uploadUrl.indexOf('/uploads/local/');
  if (local >= 0) uploadUrl = '$kApiUrl${uploadUrl.substring(local)}';
  http.Response r;
  try {
    r = await http.put(Uri.parse(uploadUrl), headers: headers, body: bytes).timeout(const Duration(seconds: 60));
  } catch (_) {
    throw ApiException(0, 'NETWORK', 'Photo upload failed. Check internet and try again.');
  }
  if (r.statusCode >= 300) throw ApiException(r.statusCode, 'UPLOAD_FAILED', 'Photo upload failed (${r.statusCode}). Please try again.');
  var url = '${slot['url']}';
  if (local >= 0 && url.contains('/files/')) url = '$kApiUrl${url.substring(url.indexOf('/files/'))}';
  return url;
}

/// Re-encodes a photo as JPEG, stepping quality and size down until it fits [args.$2] bytes. Runs in an isolate.
Uint8List shrinkToJpeg((Uint8List, int) args) {
  final (bytes, limit) = args;
  final decoded = img.decodeImage(bytes);
  if (decoded == null) return bytes;
  final upright = img.bakeOrientation(decoded);
  Uint8List out = bytes;
  for (final side in const [1600, 1400, 1200, 1000, 800, 640]) {
    final img.Image scaled = upright.width >= upright.height
        ? (upright.width > side ? img.copyResize(upright, width: side) : upright)
        : (upright.height > side ? img.copyResize(upright, height: side) : upright);
    for (final q in const [80, 70, 60, 50, 40]) {
      out = Uint8List.fromList(img.encodeJpg(scaled, quality: q));
      if (out.length <= limit) return out;
    }
  }
  return out;
}
