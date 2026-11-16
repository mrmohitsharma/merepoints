import 'package:flutter/material.dart';

/// Brand colours from the approved screen designs.
class VP {
  static const blue = Color(0xFF0F4C81);
  static const navy = Color(0xFF0A3560);
  static const amber = Color(0xFFF2A007);
  static const amberSoft = Color(0xFFFFF3D6);
  static const amberText = Color(0xFF7A4B00);
  static const gold = Color(0xFFE0A800);
  static const green = Color(0xFF12805C);
  static const greenSoft = Color(0xFFE8F5EF);
  static const red = Color(0xFFB03224);
  static const redSoft = Color(0xFFFDEDEB);
  static const blueSoft = Color(0xFFE3ECF6);
  static const ink = Color(0xFF14202E);
  static const muted = Color(0xFF5A6675);
  static const line = Color(0xFFE1E6EC);
  static const ground = Color(0xFFF4F6F9);
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: VP.blue, primary: VP.blue, secondary: VP.amber, surface: Colors.white),
    scaffoldBackgroundColor: VP.ground,
    // fontFamily: 'Mukta', // enable after adding the font files (see pubspec.yaml)
  );
  final text = base.textTheme.apply(bodyColor: VP.ink, displayColor: VP.ink);
  return base.copyWith(
    textTheme: text.copyWith(
      headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 17),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 15),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white, foregroundColor: VP.ink, elevation: 0, centerTitle: false, surfaceTintColor: Colors.white,
      titleTextStyle: TextStyle(color: VP.ink, fontSize: 20, fontWeight: FontWeight.w700),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        side: const BorderSide(color: Color(0xFFCBD3DC)),
        foregroundColor: VP.ink,
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCBD3DC))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCBD3DC))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: VP.blue, width: 2)),
      labelStyle: const TextStyle(color: Color(0xFF3C4856), fontWeight: FontWeight.w600),
    ),
    chipTheme: base.chipTheme.copyWith(
      labelStyle: const TextStyle(fontSize: 15),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
