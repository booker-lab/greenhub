import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type IndexOrder = 'ASCENDING' | 'DESCENDING' | 'CONTAINS';

type IndexField = {
  fieldPath: string;
  order?: IndexOrder;
  arrayConfig?: 'CONTAINS';
};

type FirestoreIndex = {
  collectionGroup: string;
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP';
  fields: IndexField[];
};

type QueryContract = {
  id: string;
  sourceFile: string;
  sourcePatterns: string[];
  collectionGroup: string;
  queryScope: FirestoreIndex['queryScope'];
  fields: IndexField[];
};

const ROOT = resolve(__dirname, '../../../..');

const QUERY_CONTRACTS: QueryContract[] = [
  {
    id: 'admin-users-by-role-created-at',
    sourceFile: 'apps/api/src/admin/admin.service.ts',
    sourcePatterns: [
      'async getUsers()',
      ".collection('users')",
      ".where('role', '==', 'consumer')",
      ".orderBy('createdAt', 'desc')",
    ],
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'role', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    id: 'admin-orders-by-store-created-at',
    sourceFile: 'apps/api/src/admin/admin.service.ts',
    sourcePatterns: [
      'async getOrders(dto: QueryAdminOrdersDto)',
      "query.where('storeId', '==', dto.storeId)",
      "query.orderBy('createdAt', 'desc')",
    ],
    collectionGroup: 'orders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    id: 'admin-orders-by-status-created-at',
    sourceFile: 'apps/api/src/admin/admin.service.ts',
    sourcePatterns: [
      'async getOrders(dto: QueryAdminOrdersDto)',
      "query.where('status', '==', dto.status)",
      "query.orderBy('createdAt', 'desc')",
    ],
    collectionGroup: 'orders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    id: 'seller-orders-by-store-created-at',
    sourceFile: 'apps/api/src/orders/orders-query.service.ts',
    sourcePatterns: [
      'async getOrders(',
      ".collection('orders').where('storeId', '==', storeId)",
      "ref.orderBy('createdAt', 'desc')",
    ],
    collectionGroup: 'orders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    id: 'pending-orders-by-created-at',
    sourceFile: 'apps/api/src/payments/payments.service.ts',
    sourcePatterns: [
      'async cleanupPendingOrders()',
      ".collection('orders')",
      ".where('status', '==', 'PENDING')",
      ".where('createdAt', '<'",
    ],
    collectionGroup: 'orders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    id: 'driver-api-orders-by-prepared-at',
    sourceFile: 'apps/api/src/driver/driver.service.ts',
    sourcePatterns: [
      ".collection('orders')",
      ".where('status', 'in', requestedStatuses)",
      ".orderBy('preparedAt', 'asc')",
    ],
    collectionGroup: 'orders',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'preparedAt', order: 'ASCENDING' },
    ],
  },
  {
    id: 'daily-caps-by-store-date',
    sourceFile: 'apps/api/src/products/products.service.ts',
    sourcePatterns: [
      ".collection('dailyCaps')",
      ".where('storeId', '==', storeId)",
      ".where('date', '>=', fromDate)",
      ".where('date', '<=', toDate)",
    ],
    collectionGroup: 'dailyCaps',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'date', order: 'ASCENDING' },
    ],
  },
  {
    id: 'settlements-by-store-date-desc',
    sourceFile: 'apps/api/src/settlements/settlements.service.ts',
    sourcePatterns: [
      'async getSettlements(',
      ".where('storeId', '==', storeId)",
      ".orderBy('settledAt', 'desc')",
    ],
    collectionGroup: 'settlements',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'settledAt', order: 'DESCENDING' },
    ],
  },
  {
    id: 'settlements-by-store-status-date-desc',
    sourceFile: 'apps/api/src/settlements/settlements.service.ts',
    sourcePatterns: ["ref.where('status', '==', dto.status)", ".orderBy('settledAt', 'desc')"],
    collectionGroup: 'settlements',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'settledAt', order: 'DESCENDING' },
    ],
  },
  {
    id: 'settlement-summary-by-store-date',
    sourceFile: 'apps/api/src/settlements/settlements.service.ts',
    sourcePatterns: [
      'async getSummary(',
      ".where('storeId', '==', storeId)",
      ".where('settledAt', '>=',",
      ".where('settledAt', '<',",
    ],
    collectionGroup: 'settlements',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'settledAt', order: 'ASCENDING' },
    ],
  },
  {
    id: 'pending-settlements-by-date',
    sourceFile: 'apps/api/src/settlements/settlements.service.ts',
    sourcePatterns: [
      'async confirmDueSettlements()',
      ".where('status', '==', 'pending')",
      ".where('settledAt', '<',",
    ],
    collectionGroup: 'settlements',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'settledAt', order: 'ASCENDING' },
    ],
  },
  {
    id: 'hubs-by-store-created-at',
    sourceFile: 'apps/api/src/hubs/hubs.service.ts',
    sourcePatterns: [
      ".collection('hubs')",
      ".where('storeId', '==', storeId)",
      ".orderBy('createdAt', 'asc')",
    ],
    collectionGroup: 'hubs',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'storeId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
    ],
  },
  {
    id: 'group-deadlines-by-processed-at',
    sourceFile: 'apps/api/src/notifications/notifications.service.ts',
    sourcePatterns: [
      ".collection('groupProductConfig')",
      ".where('recruitDeadline', '<=',",
      ".where('isProcessed', '==', false)",
    ],
    collectionGroup: 'groupProductConfig',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'isProcessed', order: 'ASCENDING' },
      { fieldPath: 'recruitDeadline', order: 'ASCENDING' },
    ],
  },
  {
    id: 'varieties-by-name',
    sourceFile: 'apps/api/src/varieties/varieties.service.ts',
    sourcePatterns: ["ref.orderBy('subCategory').orderBy('name')"],
    collectionGroup: 'varieties',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'subCategory', order: 'ASCENDING' },
      { fieldPath: 'name', order: 'ASCENDING' },
    ],
  },
  {
    id: 'varieties-by-category-name',
    sourceFile: 'apps/api/src/varieties/varieties.service.ts',
    sourcePatterns: [
      "ref.where('category', '==', category)",
      "ref.orderBy('subCategory').orderBy('name')",
    ],
    collectionGroup: 'varieties',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'category', order: 'ASCENDING' },
      { fieldPath: 'subCategory', order: 'ASCENDING' },
      { fieldPath: 'name', order: 'ASCENDING' },
    ],
  },
];

function fieldMode(field: IndexField): string {
  return field.order ?? field.arrayConfig ?? '';
}

function indexKey(index: FirestoreIndex): string {
  const fields = index.fields.map((field) => `${field.fieldPath}:${fieldMode(field)}`).join(',');
  return `${index.collectionGroup}|${index.queryScope}|${fields}`;
}

function validateIndexes(indexes: FirestoreIndex[], contracts: QueryContract[]): string[] {
  const errors: string[] = [];
  const counts = new Map<string, number>();
  for (const index of indexes) {
    const key = indexKey(index);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count > 1) errors.push(`중복 인덱스: ${key}`);
  }

  const required = new Map(contracts.map((contract) => [indexKey(contract), contract]));
  for (const [expectedKey, contract] of required) {
    if (counts.has(expectedKey)) continue;
    const sameCollection = indexes.filter(
      (index) => index.collectionGroup === contract.collectionGroup,
    );
    if (sameCollection.length === 0) {
      errors.push(`${contract.id}: 필요한 복합 인덱스 없음`);
      continue;
    }
    const sameFields = sameCollection.find(
      (index) =>
        index.fields.length === contract.fields.length &&
        index.fields.every((field, index) => field.fieldPath === contract.fields[index].fieldPath),
    );
    if (sameFields && sameFields.queryScope !== contract.queryScope) {
      errors.push(
        `${contract.id}: queryScope 불일치 (${sameFields.queryScope} != ${contract.queryScope})`,
      );
      continue;
    }
    if (sameFields) {
      errors.push(`${contract.id}: 정렬 방향 불일치`);
      continue;
    }
    const missingField = contract.fields.find(
      (expected) =>
        !sameCollection.some((index) =>
          index.fields.some((field) => field.fieldPath === expected.fieldPath),
        ),
    );
    if (missingField) {
      errors.push(`${contract.id}: 필드 누락 (${missingField.fieldPath})`);
      continue;
    }
    errors.push(`${contract.id}: 필요한 복합 인덱스 없음`);
  }
  return errors;
}

describe('Firestore 실제 쿼리 복합 인덱스 계약', () => {
  it.each(QUERY_CONTRACTS)('$id 쿼리 호출부가 계약과 일치한다', (contract) => {
    const source = readFileSync(resolve(ROOT, contract.sourceFile), 'utf8');
    for (const pattern of contract.sourcePatterns) {
      expect(source).toContain(pattern);
    }
  });

  it('실제 쿼리에 필요한 복합 인덱스가 정확히 존재한다', () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, 'firestore.indexes.json'), 'utf8')) as {
      indexes: FirestoreIndex[];
    };
    expect(validateIndexes(config.indexes, QUERY_CONTRACTS)).toEqual([]);
  });

  it('필요한 복합 인덱스 누락을 검출한다', () => {
    expect(validateIndexes([], [QUERY_CONTRACTS[0]])).toContain(
      'admin-users-by-role-created-at: 필요한 복합 인덱스 없음',
    );
  });

  it('필드 하나가 빠진 인덱스를 검출한다', () => {
    const contract = QUERY_CONTRACTS.find(({ id }) => id === 'driver-api-orders-by-prepared-at')!;
    const incomplete: FirestoreIndex = {
      collectionGroup: 'orders',
      queryScope: 'COLLECTION',
      fields: contract.fields.slice(0, -1),
    };
    expect(validateIndexes([incomplete], [contract])).toContain(
      'driver-api-orders-by-prepared-at: 필드 누락 (preparedAt)',
    );
  });

  it('정렬 방향이 다른 인덱스를 검출한다', () => {
    const contract = QUERY_CONTRACTS[0];
    const wrongDirection: FirestoreIndex = {
      collectionGroup: contract.collectionGroup,
      queryScope: contract.queryScope,
      fields: contract.fields.map((field, index) =>
        index === 1 ? { ...field, order: 'ASCENDING' } : field,
      ),
    };
    expect(validateIndexes([wrongDirection], [contract])).toContain(
      'admin-users-by-role-created-at: 정렬 방향 불일치',
    );
  });

  it('collection과 collectionGroup 범위 불일치를 검출한다', () => {
    const contract = QUERY_CONTRACTS[0];
    const wrongScope: FirestoreIndex = {
      collectionGroup: contract.collectionGroup,
      queryScope: 'COLLECTION_GROUP',
      fields: contract.fields,
    };
    expect(validateIndexes([wrongScope], [contract])).toContain(
      'admin-users-by-role-created-at: queryScope 불일치 (COLLECTION_GROUP != COLLECTION)',
    );
  });

  it('같은 정의의 중복 인덱스를 검출한다', () => {
    const contract = QUERY_CONTRACTS[0];
    const index: FirestoreIndex = {
      collectionGroup: contract.collectionGroup,
      queryScope: contract.queryScope,
      fields: contract.fields,
    };
    expect(validateIndexes([index, index], [contract])).toContain(
      `중복 인덱스: ${indexKey(index)}`,
    );
  });
});
