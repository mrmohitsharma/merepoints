import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';

/// Loads data with a spinner, friendly error + retry, and pull-to-refresh.
class AsyncView<T> extends StatefulWidget {
  const AsyncView({super.key, required this.load, required this.builder, this.refreshable = true});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final bool refreshable;

  @override
  State<AsyncView<T>> createState() => AsyncViewState<T>();
}

class AsyncViewState<T> extends State<AsyncView<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    setState(() {
      _loading = _data == null;
      _error = null;
    });
    try {
      final d = await widget.load();
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const Center(child: CircularProgressIndicator());
    if (_error != null && _data == null) return ErrorRetry(error: _error!, onRetry: reload);
    final child = widget.builder(context, _data as T, reload);
    return widget.refreshable ? RefreshIndicator(onRefresh: reload, child: child) : child;
  }
}

class ErrorRetry extends StatelessWidget {
  const ErrorRetry({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(error is ApiException && (error as ApiException).isNetwork ? Icons.wifi_off_rounded : Icons.error_outline, size: 48, color: VP.muted),
            const SizedBox(height: 12),
            Text('$error', textAlign: TextAlign.center, style: const TextStyle(fontSize: 16)),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
          ]),
        ),
      );
}

void showError(BuildContext context, Object e) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'), backgroundColor: VP.red));
}

void showOk(BuildContext context, String msg) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: VP.green));
}

/// Button that runs an async action, shows a spinner, and reports API errors.
class BusyButton extends StatefulWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.color, this.textColor, this.icon, this.outlined = false});
  final String label;
  final Future<void> Function()? onPressed;
  final Color? color;
  final Color? textColor;
  final IconData? icon;
  final bool outlined;
  @override
  State<BusyButton> createState() => _BusyButtonState();
}

class _BusyButtonState extends State<BusyButton> {
  bool _busy = false;
  Future<void> _run() async {
    if (_busy || widget.onPressed == null) return;
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final child = _busy
        ? SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: widget.outlined ? VP.blue : (widget.textColor ?? Colors.white)))
        : Row(mainAxisSize: MainAxisSize.min, children: [
            if (widget.icon != null) ...[Icon(widget.icon, size: 22), const SizedBox(width: 8)],
            Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
          ]);
    if (widget.outlined) return OutlinedButton(onPressed: widget.onPressed == null ? null : _run, child: child);
    return FilledButton(
      style: FilledButton.styleFrom(backgroundColor: widget.color ?? VP.blue, foregroundColor: widget.textColor ?? Colors.white),
      onPressed: widget.onPressed == null ? null : _run,
      child: child,
    );
  }
}

class Initials extends StatelessWidget {
  const Initials(this.name, {super.key, this.size = 44, this.bg = VP.blueSoft, this.fg = VP.blue, this.square = false});
  final String? name;
  final double size;
  final Color bg;
  final Color fg;
  final bool square;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(square ? size * 0.27 : size / 2)),
        child: Text(initials(name), style: TextStyle(color: fg, fontWeight: FontWeight.w800, fontSize: size * 0.34)),
      );
}

/// Shop logo if it has one, otherwise initials on a tinted square.
class ShopLogo extends StatelessWidget {
  const ShopLogo({super.key, required this.name, this.url, this.size = 46});
  final String name;
  final String? url;
  final double size;
  static const _tints = [(Color(0xFFFDE8D7), Color(0xFF8A3B00)), (Color(0xFFE0F0FA), Color(0xFF0B5A80)), (Color(0xFFE9E4F7), Color(0xFF4B3A8C)), (Color(0xFFE8F5EF), Color(0xFF0B5A40))];
  @override
  Widget build(BuildContext context) {
    final tint = _tints[name.hashCode.abs() % _tints.length];
    if (url != null && url!.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.27),
        child: Image.network(url!, width: size, height: size, fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => Initials(name, size: size, bg: tint.$1, fg: tint.$2, square: true)),
      );
    }
    return Initials(name, size: size, bg: tint.$1, fg: tint.$2, square: true);
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Row(children: [Expanded(child: Text(text, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), if (trailing != null) trailing!]),
      );
}

class WhiteCard extends StatelessWidget {
  const WhiteCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.margin = const EdgeInsets.symmetric(horizontal: 16), this.color = Colors.white, this.onTap});
  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;
  final Color color;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Padding(
        padding: margin,
        child: Material(
          color: color,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(borderRadius: BorderRadius.circular(16), onTap: onTap, child: Padding(padding: padding, child: child)),
        ),
      );
}

/// Pill-style choice row (used for categories, professions, quick amounts).
class ChoiceChips<T> extends StatelessWidget {
  const ChoiceChips({super.key, required this.options, required this.selected, required this.onTap, this.multi = false});
  final Map<T, String> options;
  final Set<T> selected;
  final void Function(T) onTap;
  final bool multi;
  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        runSpacing: 8,
        children: options.entries.map((e) {
          final on = selected.contains(e.key);
          return ChoiceChip(
            label: Text(e.value),
            selected: on,
            showCheckmark: multi,
            selectedColor: VP.blueSoft,
            labelStyle: TextStyle(color: on ? VP.blue : VP.ink, fontWeight: on ? FontWeight.w700 : FontWeight.w500),
            side: BorderSide(color: on ? VP.blue : const Color(0xFFCBD3DC), width: on ? 2 : 1),
            onSelected: (_) => onTap(e.key),
          );
        }).toList(),
      );
}

class Segmented extends StatelessWidget {
  const Segmented({super.key, required this.labels, required this.index, required this.onChanged});
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(color: const Color(0xFFE3E8EF), borderRadius: BorderRadius.circular(14)),
        child: Row(
          children: [
            for (var i = 0; i < labels.length; i++)
              Expanded(
                child: GestureDetector(
                  onTap: () => onChanged(i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: i == index ? Colors.white : Colors.transparent, borderRadius: BorderRadius.circular(11)),
                    child: Text(labels[i], style: TextStyle(fontSize: 16, color: i == index ? VP.blue : const Color(0xFF3C4856), fontWeight: i == index ? FontWeight.w700 : FontWeight.w500)),
                  ),
                ),
              ),
          ],
        ),
      );
}

class InfoNote extends StatelessWidget {
  const InfoNote(this.text, {super.key, this.icon = Icons.info_outline, this.color = VP.muted, this.bg});
  final String text;
  final IconData icon;
  final Color color;
  final Color? bg;
  @override
  Widget build(BuildContext context) => Container(
        padding: bg == null ? EdgeInsets.zero : const EdgeInsets.all(12),
        decoration: bg == null ? null : BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(fontSize: 14, color: color == VP.muted ? VP.muted : color, height: 1.35))),
        ]),
      );
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.valueColor = VP.ink, this.bg = Colors.white, this.extra});
  final String label;
  final String value;
  final Color valueColor;
  final Color bg;
  final String? extra;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 13, color: VP.muted)),
          const SizedBox(height: 2),
          FittedBox(fit: BoxFit.scaleDown, child: Text(value, style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: valueColor))),
          if (extra != null) Text(extra!, style: const TextStyle(fontSize: 12, color: VP.green, fontWeight: FontWeight.w700)),
        ]),
      );
}

/// Full-width primary action pinned to the bottom of a screen.
class BottomAction extends StatelessWidget {
  const BottomAction({super.key, required this.child, this.note});
  final Widget child;
  final String? note;
  @override
  Widget build(BuildContext context) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            child,
            if (note != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(note!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: VP.muted))),
          ]),
        ),
      );
}

/// Big round success tick used on confirmation screens.
class SuccessBadge extends StatelessWidget {
  const SuccessBadge({super.key, this.size = 110});
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: VP.green, shape: BoxShape.circle, border: Border.all(color: const Color(0xFFD7F0E5), width: 10)),
        child: Icon(Icons.check_rounded, color: Colors.white, size: size * 0.5),
      );
}
