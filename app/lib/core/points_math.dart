/// Mirrors the server formula (api/src/points/points.service.ts) so the counter screen can show
/// the exact points before the owner taps Add. The server is still the source of truth.
///
///   base   = floor(billPaise × rewardBps / 1,000,000)
///   points = floor(base × multiplier×100 / 100), then capped at maxPointsPerBill
({int base, int points, bool capped}) previewPoints({
  required double amountRupees,
  required num rewardPercent,
  num multiplier = 1,
  int? maxPointsPerBill,
}) {
  final paise = (amountRupees * 100).round();
  final bps = (rewardPercent * 100).round();
  final base = (paise * bps) ~/ 1000000;
  final multX100 = (multiplier * 100).round();
  var points = multX100 > 100 ? (base * multX100) ~/ 100 : base;
  final capped = maxPointsPerBill != null && points > maxPointsPerBill;
  if (capped) points = maxPointsPerBill;
  return (base: base, points: points, capped: capped);
}
