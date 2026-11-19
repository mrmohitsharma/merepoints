import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:vyapar_point/core/api.dart';
import 'package:vyapar_point/core/format.dart';
import 'package:vyapar_point/core/points_math.dart';
import 'package:vyapar_point/core/session.dart';
import 'package:vyapar_point/features/auth/language_screen.dart';

void main() {
  group('points formula matches the server', () {
    test('₹10,000 at 5% = 500', () {
      expect(previewPoints(amountRupees: 10000, rewardPercent: 5).points, 500);
    });
    test('1.5x offer: 500 -> 750', () {
      final p = previewPoints(amountRupees: 10000, rewardPercent: 5, multiplier: 1.5);
      expect((p.base, p.points, p.capped), (500, 750, false));
    });
    test('cap per bill', () {
      final p = previewPoints(amountRupees: 100000, rewardPercent: 5, maxPointsPerBill: 2000);
      expect((p.points, p.capped), (2000, true));
    });
    test('floors, never rounds up', () {
      expect(previewPoints(amountRupees: 999, rewardPercent: 5).points, 49);
      expect(previewPoints(amountRupees: 7000, rewardPercent: 10, multiplier: 1.25).points, 875);
    });
  });

  group('slabs by bill amount (same as server)', () {
    final slabs = [RewardSlab(0, 2), RewardSlab(10000, 5), RewardSlab(20000, 7)];
    int p(double amt, {num mult = 1, int? cap}) => previewPoints(amountRupees: amt, rewardPercent: 2, slabs: slabs, multiplier: mult, maxPointsPerBill: cap).points;
    test('the range sets the % for the whole bill', () {
      expect([p(5000), p(9999), p(10000), p(15000), p(20000), p(50000)], [100, 199, 500, 750, 1400, 3500]);
    });
    test('offer and cap on top', () {
      expect(p(15000, mult: 2), 1500);
      expect(p(20000, mult: 2, cap: 2000), 2000);
    });
    test('range errors in words', () {
      expect(slabError([RewardSlab(500, 2), RewardSlab(10000, 5)]), 'The first range must start at ₹0');
      expect(slabError([RewardSlab(0, 2), RewardSlab(10000, 5), RewardSlab(8000, 7)]), contains('must start above'));
      expect(slabError(slabs), isNull);
    });
    test('rate label', () {
      expect(rateText({'rewardPercent': 2, 'rewardSlabs': [{'fromRupees': 0, 'percent': 2}, {'fromRupees': 10000, 'percent': 7.5}]}), '2–7.5%');
      expect(rateText({'rewardPercent': 5, 'rewardSlabs': null}), '5%');
    });
  });

  group('Indian formatting', () {
    test('lakh grouping', () {
      expect(pts(175000), '1,75,000');
      expect(rupees(1750), '₹1,750');
      expect(rupees(0.5), '₹0.5');
      expect(prettyMobile('919876543210'), '98765 43210');
      expect(initials('Ramesh Kumar'), 'RK');
    });
  });

  test('role switch round-trips', () {
    expect(ActiveRole.decode(const ActiveRole.shop(42).encode())!.shopId, 42);
    expect(ActiveRole.decode('customer')!.isShop, false);
    expect(ActiveRole.decode('nonsense'), isNull);
  });

  testWidgets('language screen lists English, Hindi and 6 regional languages', (tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<Session>(
        create: (_) => Session(ApiClient()),
        child: const MaterialApp(home: LanguageScreen()),
      ),
    );
    for (final l in ['English', 'हिंदी', 'தமிழ்', 'বাংলা', 'ಕನ್ನಡ', 'മലയാളം', 'ગુજરાતી', 'ਪੰਜਾਬੀ']) {
      expect(find.text(l), findsWidgets);
    }
  });
}
