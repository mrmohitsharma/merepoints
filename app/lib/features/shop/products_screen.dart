import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/upload.dart';
import '../../widgets/common.dart';
import '../../widgets/products.dart';

/// Owner: products in two tabs. Redeem = gifts customers take for points. Earn more = bonus points when bought.
class ShopProductsScreen extends StatefulWidget {
  const ShopProductsScreen({super.key});
  @override
  State<ShopProductsScreen> createState() => _ShopProductsScreenState();
}

class _ShopProductsScreenState extends State<ShopProductsScreen> {
  String _kind = 'redeem';
  final _key = GlobalKey<AsyncViewState<List<dynamic>>>();

  Future<void> _edit(Map<String, dynamic>? p) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ProductFormScreen(kind: p?['kind'] as String? ?? _kind, product: p)));
    if (saved == true) _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    return Scaffold(
      appBar: AppBar(title: const Text('Products')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: _kind == 'earn' ? VP.green : VP.blue,
        foregroundColor: Colors.white,
        onPressed: () => _edit(null),
        icon: const Icon(Icons.add),
        label: Text(_kind == 'earn' ? 'Add bonus product' : 'Add gift'),
      ),
      body: AsyncView<List<dynamic>>(
        key: _key,
        load: () async => await api.sget('products') as List,
        builder: (context, all, reload) {
          final items = all.cast<Map<String, dynamic>>();
          final redeem = items.where((p) => p['kind'] == 'redeem').toList();
          final earn = items.where((p) => p['kind'] == 'earn').toList();
          final list = _kind == 'redeem' ? redeem : earn;
          return ListView(padding: const EdgeInsets.only(top: 12, bottom: 110), children: [
            KindTabs(kind: _kind, redeemCount: redeem.length, earnCount: earn.length, onChanged: (k) => setState(() => _kind = k)),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
              child: InfoNote(_kind == 'redeem'
                  ? 'Gifts customers take for points. They see them on Home and your shop card, with how many points they still need.'
                  : 'Products you give extra points for. Tick them at the counter when adding a bill. Bonus is fixed: offers and the per-bill cap do not change it.'),
            ),
            if (list.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Text(_kind == 'redeem' ? 'No gifts yet. A tool bag at 500 points works well.' : 'No bonus products yet. Example: Century ply 18mm, +40 points per sheet.',
                    textAlign: TextAlign.center, style: const TextStyle(color: VP.muted)),
              ),
            for (final p in list)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: WhiteCard(
                  padding: const EdgeInsets.all(10),
                  onTap: () => _edit(p),
                  child: Row(children: [
                    SizedBox(width: 62, height: 62, child: ProductPhoto(url: p['photo_url'] as String?, kind: '${p['kind']}', radius: 10, iconSize: 24)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${p['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)),
                        Text([p['brand'], p['category'], if (p['mrp_rupees'] != null) 'MRP ${rupees(asNum(p['mrp_rupees']))}'].where((x) => x != null).join(' · '),
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: VP.muted)),
                        const SizedBox(height: 2),
                        if (p['kind'] == 'redeem')
                          Text('${pts(asNum(p['stock']))} in stock · ${pts(asNum(p['given_count']))} given',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: asNum(p['stock']) == 0 ? VP.red : asNum(p['stock']) <= 3 ? VP.amberText : VP.green))
                        else
                          Text('${pts(asNum(p['units_sold_with_bonus']))} ${p['unit'] ?? 'piece'}s sold with bonus',
                              style: const TextStyle(fontSize: 13, color: VP.muted, fontWeight: FontWeight.w600)),
                        if (p['visible'] == false) const Text('Hidden from customers', style: TextStyle(fontSize: 12, color: VP.red, fontWeight: FontWeight.w600)),
                      ]),
                    ),
                    Text(p['kind'] == 'redeem' ? '${pts(asNum(p['points_cost']))}\npts' : '+${pts(asNum(p['bonus_points']))}\n/${p['unit'] ?? 'pc'}',
                        textAlign: TextAlign.right,
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: p['kind'] == 'redeem' ? VP.blue : VP.green, height: 1.1)),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}

/// Add / edit one product. Fields change with the kind (S21 gift, S22 earn more).
class ProductFormScreen extends StatefulWidget {
  const ProductFormScreen({super.key, required this.kind, this.product});
  final String kind;
  final Map<String, dynamic>? product;
  @override
  State<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _ProductFormScreenState extends State<ProductFormScreen> {
  late final p = widget.product;
  late final bool _redeem = widget.kind == 'redeem';
  late final _name = TextEditingController(text: p?['name'] as String?);
  late final _brand = TextEditingController(text: p?['brand'] as String?);
  late final _category = TextEditingController(text: p?['category'] as String?);
  late final _mrp = TextEditingController(text: p?['mrp_rupees'] == null ? '' : '${asNum(p!['mrp_rupees'])}');
  late final _points = TextEditingController(text: p?['points_cost']?.toString() ?? '');
  late final _stock = TextEditingController(text: p?['stock']?.toString() ?? '');
  late final _bonus = TextEditingController(text: p?['bonus_points']?.toString() ?? '');
  late String _unit = p?['unit'] as String? ?? 'piece';
  late String? _photo = p?['photo_url'] as String?;
  late bool _visible = p?['visible'] != false;
  late String? _until = p?['available_until'] == null ? null : '${p!['available_until']}'.substring(0, 10);
  bool _uploading = false;
  Map<String, dynamic>? _cfg;

  static const _units = ['piece', 'sheet', 'tin', 'bucket', 'pair', 'box', 'bag', 'kg', 'litre', 'metre'];
  static const _cats = ['Tools', 'Home', 'Safety', 'Plywood', 'Hardware', 'Adhesives', 'Paint', 'Electrical', 'Sanitary', 'Tiles'];

  @override
  void initState() {
    super.initState();
    _points.addListener(() => setState(() {}));
    context.read<ApiClient>().sget('config').then((c) {
      if (mounted) setState(() => _cfg = c as Map<String, dynamic>);
    }).catchError((_) {});
  }

  Future<void> _pickPhoto() async {
    setState(() => _uploading = true);
    try {
      final url = await pickAndUploadPhoto(context, context.read<ApiClient>(), purpose: 'product');
      if (url != null && mounted) setState(() => _photo = url);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save({bool remove = false}) async {
    final body = <String, dynamic>{
      if (p != null) 'id': p!['id'],
      'kind': widget.kind,
      'name': _name.text.trim(),
      'brand': _brand.text.trim().isEmpty ? null : _brand.text.trim(),
      'category': _category.text.trim().isEmpty ? null : _category.text.trim(),
      'photoUrl': _photo,
      'mrpRupees': double.tryParse(_mrp.text),
      'availableUntil': _until,
      'visible': _visible,
      if (remove) 'active': false,
      if (_redeem) ...{'pointsCost': int.tryParse(_points.text), 'stock': int.tryParse(_stock.text)} else ...{'bonusPoints': int.tryParse(_bonus.text), 'unit': _unit},
    };
    await context.read<ApiClient>().spost('products', body);
    if (mounted) Navigator.pop(context, true);
  }

  /// "About ₹X of shopping to earn this" at the shop's (lowest) rate, so the owner can judge the price.
  String? _worthHint() {
    final pts = int.tryParse(_points.text);
    final c = _cfg;
    if (pts == null || pts <= 0 || c == null) return null;
    final slabs = (c['rewardSlabs'] as List?)?.map((s) => asNum((s as Map)['percent'])).toList();
    final pct = slabs != null && slabs.isNotEmpty ? slabs.reduce((a, b) => a < b ? a : b) : asNum(c['rewardPercent']);
    if (pct <= 0) return null;
    final value = pts * asNum(c['pointValueRupees']);
    return 'Worth ${rupees(value)} to you · a customer earns it with about ${rupees((pts * 100 / pct / 100).ceil() * 100)} of shopping';
  }

  @override
  Widget build(BuildContext context) {
    final hint = _redeem ? _worthHint() : null;
    return Scaffold(
      appBar: AppBar(title: Text(p == null ? (_redeem ? 'Add gift' : 'Add bonus product') : 'Edit product')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        GestureDetector(
          onTap: _uploading ? null : _pickPhoto,
          child: AspectRatio(
            aspectRatio: 1.6,
            child: Container(
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: VP.line)),
              child: _uploading
                  ? const Center(child: CircularProgressIndicator())
                  : _photo == null
                      ? const Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                          Icon(Icons.add_a_photo_outlined, size: 36, color: VP.blue),
                          SizedBox(height: 6),
                          Text('Add photo', style: TextStyle(fontWeight: FontWeight.w700, color: VP.blue)),
                          Text('Clear photo on a plain background', style: TextStyle(fontSize: 12, color: VP.muted)),
                        ])
                      : Stack(fit: StackFit.expand, children: [
                          ProductPhoto(url: _photo, kind: widget.kind, radius: 16),
                          const Positioned(right: 8, bottom: 8, child: CircleAvatar(backgroundColor: Colors.white, child: Icon(Icons.edit, color: VP.blue))),
                        ]),
            ),
          ),
        ),
        const SizedBox(height: 14),
        TextField(controller: _name, textCapitalization: TextCapitalization.sentences, decoration: InputDecoration(labelText: 'Product name', hintText: _redeem ? 'e.g. Bosch drill machine' : 'e.g. Century ply 18mm')),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: TextField(controller: _brand, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Brand'))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _mrp, keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))], decoration: const InputDecoration(labelText: 'MRP', prefixText: '₹ '))),
        ]),
        const SizedBox(height: 10),
        TextField(controller: _category, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Category')),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final c in _cats) ActionChip(label: Text(c), onPressed: () => setState(() => _category.text = c)),
        ]),
        const SizedBox(height: 16),
        if (_redeem) ...[
          Row(children: [
            Expanded(child: TextField(controller: _points, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800), decoration: const InputDecoration(labelText: 'Points needed', suffixText: 'pts'))),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _stock, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800), decoration: const InputDecoration(labelText: 'In stock'))),
          ]),
          if (hint != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(hint, style: const TextStyle(fontSize: 13, color: VP.muted))),
        ] else ...[
          TextField(controller: _bonus, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: VP.green), decoration: InputDecoration(labelText: 'Bonus points per $_unit', prefixText: '+ ')),
          const SizedBox(height: 10),
          const Text('Counted per', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF3C4856))),
          const SizedBox(height: 6),
          ChoiceChips<String>(options: {for (final u in _units) u: u}, selected: {_unit}, onTap: (u) => setState(() => _unit = u)),
        ],
        const SizedBox(height: 14),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.event_outlined),
          title: Text(_until == null ? 'No end date' : 'Available till ${dayMonth(_until)}'),
          trailing: _until == null ? const Text('Set', style: TextStyle(color: VP.blue, fontWeight: FontWeight.w700)) : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _until = null)),
          onTap: () async {
            final d = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: DateTime.now().add(const Duration(days: 30)));
            if (d != null) setState(() => _until = '${d.year}-${'${d.month}'.padLeft(2, '0')}-${'${d.day}'.padLeft(2, '0')}');
          },
        ),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Show to customers'), value: _visible, onChanged: (v) => setState(() => _visible = v)),
        if (p != null)
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: VP.red),
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Remove this product?'),
                  content: const Text('Customers will not see it any more. Past bills and redemptions stay.'),
                  actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remove'))],
                ),
              );
              if (ok == true) {
                try {
                  await _save(remove: true);
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              }
            },
            icon: const Icon(Icons.delete_outline),
            label: const Text('Remove product'),
          ),
      ]),
      bottomNavigationBar: BottomAction(child: BusyButton(label: 'Save', color: _redeem ? VP.blue : VP.green, onPressed: _save)),
    );
  }
}
