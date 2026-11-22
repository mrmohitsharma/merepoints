import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_cashfree_pg_sdk/api/cferrorresponse/cferrorresponse.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpayment/cfwebcheckoutpayment.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpaymentgateway/cfpaymentgatewayservice.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfsession/cfsession.dart';
import 'package:flutter_cashfree_pg_sdk/utils/cfenums.dart';
import 'package:provider/provider.dart';

import 'api.dart';
import 'format.dart';

/// Pays for a package or extra pack inside the app.
/// 1) the server creates the order, 2) Cashfree's checkout opens (UPI apps, cards, netbanking),
/// 3) the server asks Cashfree whether it was really paid and switches the package on.
/// Returns the receipt map when paid, or null if the owner closed the payment. Throws on errors.
Future<Map<String, dynamic>?> payInApp(BuildContext context, Map<String, dynamic> body) async {
  final api = context.read<ApiClient>();
  final order = await api.spost('billing/orders', body) as Map<String, dynamic>;
  final orderId = '${order['orderId']}';

  if (order['testMode'] == true) {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Test mode'),
        content: Text('No real money. Pay ${rupees(asNum(order['amountPaise']) / 100)} for ${order['description']}?'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Pay'))],
      ),
    );
    if (ok != true) return null;
    return await api.spost('billing/verify', {'orderId': orderId, 'paymentId': 'pay_test_${DateTime.now().millisecondsSinceEpoch}', 'signature': 'test'}) as Map<String, dynamic>;
  }

  final sessionId = order['paymentSessionId'];
  if (sessionId == null) throw StateError('Could not start the payment. Please try again.');
  final done = Completer<String?>(); // null = paid, text = failure or cancelled
  final service = CFPaymentGatewayService();
  service.setCallback((String id) {
    if (!done.isCompleted) done.complete(null);
  }, (CFErrorResponse e, String id) {
    if (!done.isCompleted) done.complete(e.getMessage() ?? 'Payment failed or was cancelled');
  });
  final session = CFSessionBuilder()
      .setEnvironment(order['cashfreeEnv'] == 'sandbox' ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION)
      .setOrderId(orderId)
      .setPaymentSessionId('$sessionId')
      .build();
  service.doPayment(CFWebCheckoutPaymentBuilder().setSession(session).build());
  final failure = await done.future;
  if (failure != null) {
    // The owner may have paid and then closed the window: check once before giving up.
    try {
      return await api.spost('billing/verify', {'orderId': orderId}) as Map<String, dynamic>;
    } catch (_) {
      throw StateError(failure);
    }
  }
  return await api.spost('billing/verify', {'orderId': orderId}) as Map<String, dynamic>;
}
