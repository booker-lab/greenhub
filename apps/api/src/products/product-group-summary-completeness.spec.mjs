import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

// Execute production bodies in memory. Only imports and Nest's class decorator
// are removed; Node transforms TS (including constructor parameter properties).
// No dependencies, generated files, SDK initialization, or network access.
function loadSource(name) {
  const source = readFileSync(new URL(name, import.meta.url), 'utf8')
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^@Injectable\(\)\s*/m, '');
  return stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^export\s+/gm, '');
}
const ProductsService = new Function(
  `${loadSource('./product-visibility.ts')}\n${loadSource('./products.service.ts')}\nreturn ProductsService;`,
)();

function fakeFirestore(products, configs) {
  const reads = [];
  const collections = { products, groupProductConfig: configs };
  function query(name, conditions = []) {
    return {
      where(field, operator, value) {
        assert.ok(['==', 'in'].includes(operator), `unsupported operator: ${operator}`);
        if (operator === 'in') {
          assert.ok(Array.isArray(value) && value.length > 0 && value.length <= 30);
        }
        return query(name, [...conditions, { field, operator, value }]);
      },
      async get() {
        reads.push({ name, conditions });
        const rows = collections[name].filter((row) => conditions.every(
          ({ field, operator, value }) => Object.hasOwn(row, field)
            && (operator === '==' ? row[field] === value : value.includes(row[field])),
        ));
        return { docs: rows.map((row) => ({ data: () => structuredClone(row) })) };
      },
    };
  }
  return {
    reads,
    collection(name) {
      assert.ok(Object.hasOwn(collections, name), `unexpected collection: ${name}`);
      return query(name);
    },
  };
}

function product(id, overrides = {}) {
  return {
    id, storeId: 'store-a', name: id, price: 100, category: 'flower',
    saleType: 'group', isActive: true, images: ['first', 'second'],
    selection: { colors: ['red'] }, createdAt: { seconds: 1 },
    sellerNote: 'private', sellerOverride: true, testOnly: false,
    content: { headline: 'title', description: 'text', isEditedByUser: true },
    ...overrides,
  };
}

function config(productId, quantity = 7) {
  return {
    productId, currentQuantity: quantity, minQuantity: 2, targetQuantity: 100,
    recruitDeadline: { seconds: 1800000000 }, isProcessed: true,
    sellerOverride: true, privateConfig: 'secret',
  };
}

function assertSummary(item, quantity) {
  assert.deepEqual(item.groupSummary, {
    currentQuantity: quantity, minQuantity: 2, targetQuantity: 100,
    recruitDeadline: '2027-01-15T08:00:00.000Z',
  });
}

function assertPublicShape(item, publicList, hasSummary) {
  const keys = ['id', 'name', 'price', 'images', 'category', 'colors', 'saleType', 'isActive'];
  if (publicList) keys.push('storeId');
  if (hasSummary) keys.push('groupSummary');
  assert.deepEqual(Object.keys(item).sort(), keys.sort());
  assert.deepEqual(item.images, ['first']);
}

function assertConfigReads(fake, expectedIds) {
  const reads = fake.reads.filter(({ name }) => name === 'groupProductConfig');
  assert.equal(reads.length, Math.ceil(expectedIds.length / 30));
  const requested = reads.flatMap(({ conditions }) => {
    assert.equal(conditions.length, 1);
    const [{ field, operator, value }] = conditions;
    assert.equal(field, 'productId');
    assert.equal(operator, 'in');
    assert.ok(value.length > 0 && value.length <= 30);
    return value;
  });
  assert.deepEqual(requested.toSorted(), expectedIds.toSorted());
}

for (const publicList of [false, true]) {
  const method = publicList ? 'getPublicProducts' : 'getProducts';
  const invoke = (service, query = {}) => publicList
    ? service.getPublicProducts(query) : service.getProducts('store-a', query);

  for (const count of [0, 30, 31, 61]) {
    test(`${method}: all ${count} group products receive their own summary`, async () => {
      const products = Array.from({ length: count }, (_, index) => product(`g-${index}`, {
        price: index + 1, createdAt: { seconds: index + 1 },
      }));
      // Reverse config order to ensure merging uses identity, not response order.
      const configs = products.map((p, i) => config(p.id, i)).reverse();
      configs.push(config('unrelated'));
      const fake = fakeFirestore(products, configs);
      const result = await invoke(new ProductsService(fake));
      assert.equal(result.total, count);
      assert.deepEqual(Object.keys(result).sort(), ['items', 'total']);
      assert.deepEqual(result.items.map((p) => p.id), products.map((p) => p.id).reverse());
      for (const item of result.items) {
        assertSummary(item, Number(item.id.slice(2)));
        assertPublicShape(item, publicList, true);
      }
      assertConfigReads(fake, products.map((p) => p.id));
    });
  }

  test(`${method}: mixed products, missing settings, visibility, store and sort boundaries`, async () => {
    const products = [
      product('configured', { price: 30, createdAt: { seconds: 3 } }),
      product('missing', { price: 10, createdAt: { seconds: 2 } }),
      product('normal', { saleType: 'normal', price: 20, createdAt: { seconds: 1 } }),
      product('foreign', { storeId: 'store-b', price: 40, createdAt: { seconds: 4 } }),
      product('inactive', { isActive: false }),
      product('test', { testOnly: true }),
      product('truthy-active', { isActive: 1 }),
      product('absent-active', { isActive: undefined }),
    ];
    for (const [sort, localIds] of [
      ['latest', ['configured', 'missing', 'normal']],
      ['price_asc', ['missing', 'normal', 'configured']],
      ['price_desc', ['configured', 'normal', 'missing']],
    ]) {
      const fake = fakeFirestore(products, products.filter((p) => p.id !== 'missing').map((p) => config(p.id)));
      const result = await invoke(new ProductsService(fake), { sort, isActive: false });
      const ids = publicList
        ? (sort === 'price_asc' ? [...localIds, 'foreign'] : ['foreign', ...localIds]) : localIds;
      assert.deepEqual(result.items.map((p) => p.id), ids);
      assert.equal(result.total, ids.length);
      for (const item of result.items) {
        const hasSummary = ['configured', 'foreign'].includes(item.id);
        assertPublicShape(item, publicList, hasSummary);
        if (hasSummary) assertSummary(item, 7);
        else assert.equal(Object.hasOwn(item, 'groupSummary'), false);
        if (publicList) assert.equal(item.storeId, item.id === 'foreign' ? 'store-b' : 'store-a');
      }
      assertConfigReads(fake, publicList ? ['configured', 'missing', 'foreign'] : ['configured', 'missing']);
    }
  });

  test(`${method}: category, sale type, and modern/legacy color filters precede summary reads`, async () => {
    const products = [
      product('modern'),
      product('legacy', { selection: undefined, colors: ['red'] }),
      product('other-color', { selection: { colors: ['blue'] } }),
      product('other-category', { category: 'other' }),
      product('normal', { saleType: 'normal' }),
    ];
    for (const colors of ['red,green', ['red', 'green']]) {
      const fake = fakeFirestore(products, products.map((p) => config(p.id)));
      const result = await invoke(new ProductsService(fake), { category: 'flower', saleType: 'group', colors });
      assert.deepEqual(result.items.map((p) => p.id), ['modern', 'legacy']);
      assert.equal(result.total, 2);
      for (const item of result.items) {
        assertSummary(item, 7);
        assert.deepEqual(item.colors, ['red']);
      }
      assertConfigReads(fake, ['modern', 'legacy']);
    }
    const fake = fakeFirestore(products, products.map((p) => config(p.id)));
    const result = await invoke(new ProductsService(fake), { saleType: 'normal' });
    assert.deepEqual(result.items.map((p) => p.id), ['normal']);
    assert.equal(result.total, 1);
    assertPublicShape(result.items[0], publicList, false);
    assertConfigReads(fake, []);
  });
}
