/// Mirrors the server formula (api/src/points/rate.ts + points.service.ts) so the counter screen shows
/// the exact points before the owner taps Add. The server is still the source of truth.
///
///   % = the shop's flat %, or the % of the slab the bill falls in (applies to the whole bill)
///   base   = floor(billPaise × %bps / 1,000,000)
///   points = floor(base × multiplier×100 / 100), then capped at maxPointsPerBill

/// One range: bills from [fromRupees] up to the next range earn [percent] on the whole bill.
class RewardSlab {
  RewardSlab(this.fromRupees, this.percent);
  double fromRupees;
  double percent;

  Map<String, dynamic> toJson() => {'fromRupees': fromRupees, 'percent': percent};

  static List<RewardSlab>? listFrom(dynamic v) {
    if (v is! List || v.isEmpty) return null;
    return [for (final s in v) RewardSlab((s['fromRupees'] as num).toDouble(), (s['percent'] as num).toDouble())];
  }
}

/// The % for a bill of [amountRupees].
double rateFor(double amountRupees, num flatPercent, List<RewardSlab>? slabs) {
  if (slabs == null || slabs.isEmpty) return flatPercent.toDouble();
  final paise = (amountRupees * 100).round();
  var p = slabs.first.percent;
  for (final s in slabs) {
    if (paise >= (s.fromRupees * 100).round()) p = s.percent;
  }
  return p;
}

/// Problem with the ranges, in words for the owner, or null if they are fine.
String? slabError(List<RewardSlab> slabs) {
  if (slabs.length < 2) return 'Add at least two ranges, or use one % for all bills';
  if (slabs.first.fromRupees != 0) return 'The first range must start at ₹0';
  for (var i = 1; i < slabs.length; i++) {
    if (slabs[i].fromRupees <= slabs[i - 1].fromRupees) return 'Range ${i + 1} must start above ₹${slabs[i - 1].fromRupees.round()}';
  }
  for (final s in slabs) {
    if (s.percent <= 0 || s.percent > 50) return 'Each % must be between 0.01 and 50';
  }
  return null;
}

({int base, int points, bool capped, double percent}) previewPoints({
  required double amountRupees,
  required num rewardPercent,
  List<RewardSlab>? slabs,
  num multiplier = 1,
  int? maxPointsPerBill,
}) {
  final pct = rateFor(amountRupees, rewardPercent, slabs);
  final paise = (amountRupees * 100).round();
  final bps = (pct * 100).round();
  final base = (paise * bps) ~/ 1000000;
  final multX100 = (multiplier * 100).round();
  var points = multX100 > 100 ? (base * multX100) ~/ 100 : base;
  final capped = maxPointsPerBill != null && points > maxPointsPerBill;
  if (capped) points = maxPointsPerBill;
  return (base: base, points: points, capped: capped, percent: pct);
}

String _pct(double p) => p == p.roundToDouble() ? '${p.round()}' : '$p';

/// "5%" for a flat rate, "2–7%" when the shop uses ranges. [m] has rewardPercent and rewardSlabs.
String rateText(Map m) {
  final slabs = RewardSlab.listFrom(m['rewardSlabs']);
  if (slabs == null) return '${_pct((m['rewardPercent'] as num).toDouble())}%';
  final ps = slabs.map((s) => s.percent).toList()..sort();
  return '${_pct(ps.first)}–${_pct(ps.last)}%';
}
