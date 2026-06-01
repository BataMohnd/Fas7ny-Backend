// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../models/TransactionModel', () => {
  const MockTransaction = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue({ _id: 'tx-001', ...data }),
  }));
  MockTransaction.findOne   = jest.fn();
  MockTransaction.aggregate = jest.fn();
  return MockTransaction;
});

// Use a shared mockGetUser so tests can configure it per-call.
// auth: () => ({...}) would create a new jest.fn() on every admin.auth() call,
// making individual mockRejectedValue/mockResolvedValue setups ineffective.
jest.mock('../firebaseConfig', () => {
  const mockGetUser = jest.fn().mockResolvedValue({ uid: 'user-123', email: 'test@test.com' });
  return {
    apps: [true],
    auth: () => ({ getUser: mockGetUser }),
    database: () => ({
      ref: jest.fn().mockReturnThis(),
      set: jest.fn().mockResolvedValue({}),
    }),
  };
});

const walletService = require('../services/walletService');
const Transaction   = require('../models/TransactionModel');
const admin         = require('../firebaseConfig');

// ─────────────────────────────────────────────────────────────────────────────
describe('🔐 walletService.verifyUserId — 3-tier verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset shared Firebase mock to default success so each test starts clean
    admin.auth().getUser.mockResolvedValue({ uid: 'user-123' });
    Transaction.findOne.mockResolvedValue(null);
  });

  test('✅ Tier 1: Firebase Auth success → valid', async () => {
    admin.auth().getUser.mockResolvedValue({ uid: 'user-123' });

    const result = await walletService.verifyUserId('user-123');

    expect(result.valid).toBe(true);
    expect(result.source).toBe('firebase_auth');
  });

  test('✅ Tier 2: Firebase fails, transaction exists → valid', async () => {
    admin.auth().getUser.mockRejectedValue(new Error('user-not-found'));
    Transaction.findOne.mockResolvedValue({ userId: 'user-456', amount: 100 });

    const result = await walletService.verifyUserId('user-456');

    expect(result.valid).toBe(true);
    expect(result.source).toBe('transaction_history');
  });

  test('✅ Tier 3: Firebase + transaction fail, valid UID format → valid', async () => {
    admin.auth().getUser.mockRejectedValue(new Error('user-not-found'));
    Transaction.findOne.mockResolvedValue(null);

    // Firebase UID: 20+ alphanumeric chars
    const result = await walletService.verifyUserId('abcdefghijklmnopqrstu');

    expect(result.valid).toBe(true);
    expect(result.source).toBe('format_validation');
  });

  test('❌ All tiers fail: short/invalid ID → invalid', async () => {
    admin.auth().getUser.mockRejectedValue(new Error('user-not-found'));
    Transaction.findOne.mockResolvedValue(null);

    const result = await walletService.verifyUserId('short');

    expect(result.valid).toBe(false);
    expect(result.source).toBe('none');
  });

  test('❌ Empty string userId → invalid', async () => {
    admin.auth().getUser.mockRejectedValue(new Error('user-not-found'));
    Transaction.findOne.mockResolvedValue(null);

    const result = await walletService.verifyUserId('');

    expect(result.valid).toBe(false);
  });

  test('✅ Tier 3 format: exactly 20 chars passes', async () => {
    admin.auth().getUser.mockRejectedValue(new Error('user-not-found'));
    Transaction.findOne.mockResolvedValue(null);

    const result = await walletService.verifyUserId('abcdefghijklmnopqrst'); // exactly 20

    expect(result.valid).toBe(true);
    expect(result.source).toBe('format_validation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('💰 walletService.getAggregatedBalance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ returns aggregated balance from transactions', async () => {
    Transaction.aggregate.mockResolvedValue([{ totalBalance: 2500 }]);

    const balance = await walletService.getAggregatedBalance('user-123');

    expect(balance).toBe(2500);
    expect(Transaction.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ $match: { userId: 'user-123', status: 'success' } })
      ])
    );
  });

  test('✅ returns 0 when no transactions', async () => {
    Transaction.aggregate.mockResolvedValue([]);

    const balance = await walletService.getAggregatedBalance('new-user');

    expect(balance).toBe(0);
  });

  test('✅ userId is coerced to string in query', async () => {
    Transaction.aggregate.mockResolvedValue([{ totalBalance: 100 }]);

    await walletService.getAggregatedBalance(12345); // number

    const [pipeline] = Transaction.aggregate.mock.calls[0];
    expect(pipeline[0].$match.userId).toBe('12345');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('💳 walletService.processWalletPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    admin.auth().getUser.mockResolvedValue({ uid: 'user-123' });
    Transaction.aggregate.mockResolvedValue([{ totalBalance: 1000 }]);
  });

  test('✅ sufficient balance → deducts and returns new balance', async () => {
    // First aggregate call: check live balance (1000)
    // After save, second aggregate call: new balance (700)
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: 1000 }])
      .mockResolvedValueOnce([{ totalBalance: 700 }]);

    const result = await walletService.processWalletPayment('user-123', 300, 'booking-001');

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(700);
    expect(Transaction).toHaveBeenCalled();
  });

  test('❌ insufficient balance → returns error without deducting', async () => {
    Transaction.aggregate.mockResolvedValue([{ totalBalance: 100 }]);

    const result = await walletService.processWalletPayment('user-123', 500);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Insufficient/);
    // Transaction constructor should NOT have been called
    expect(Transaction.mock.instances.length).toBe(0);
  });

  test('❌ user not found → returns error', async () => {
    admin.auth().getUser.mockRejectedValue(new Error('not-found'));
    Transaction.findOne.mockResolvedValue(null);

    const result = await walletService.processWalletPayment('invalid-short', 100);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  test('✅ creates payment transaction with correct type', async () => {
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: 1000 }])
      .mockResolvedValueOnce([{ totalBalance: 700 }]);

    await walletService.processWalletPayment('user-123', 300, 'bk-001');

    const [constructorCall] = Transaction.mock.calls;
    expect(constructorCall[0].type).toBe('payment');
    expect(constructorCall[0].amount).toBe(300);
    expect(constructorCall[0].status).toBe('success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔄 walletService.processWalletRefund', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // processWalletRefund does NOT check existing balance — it only calls
    // getAggregatedBalance once (after saving the refund transaction).
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: 1000 }]);
  });

  test('✅ creates refund transaction and returns new balance', async () => {
    const result = await walletService.processWalletRefund('user-123', 300, 'booking-001');

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(1000);
  });

  test('✅ refund transaction type is "refund"', async () => {
    await walletService.processWalletRefund('user-123', 300, 'booking-001');

    const [constructorCall] = Transaction.mock.calls;
    expect(constructorCall[0].type).toBe('refund');
    expect(constructorCall[0].amount).toBe(300);
  });

  test('✅ description includes bookingId', async () => {
    await walletService.processWalletRefund('user-123', 300, 'booking-XYZ');

    const [constructorCall] = Transaction.mock.calls;
    expect(constructorCall[0].description).toContain('booking-XYZ');
  });
});
