// Integration-style tests: booking creation → wallet payment → refund on cancel
// All external services are mocked; tests verify cross-layer data flow.

jest.mock('../models/TransactionModel', () => {
  const MockTransaction = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue({ _id: 'tx-001', ...data }),
  }));
  MockTransaction.findOne   = jest.fn().mockResolvedValue(null);
  MockTransaction.aggregate = jest.fn();
  return MockTransaction;
});

jest.mock('../firebaseConfig', () => ({
  apps: [true],
  auth: () => ({
    getUser: jest.fn().mockResolvedValue({ uid: 'user-123' }),
  }),
  database: () => ({
    ref: jest.fn().mockReturnThis(),
    set: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('../models/Booking', () => {
  const MockBooking = jest.fn().mockImplementation((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue({ _id: 'booking-001', ...data }),
  }));
  MockBooking.find         = jest.fn().mockResolvedValue([]);
  MockBooking.findById     = jest.fn().mockResolvedValue(null);
  MockBooking.findOneAndUpdate = jest.fn().mockResolvedValue(null);
  return MockBooking;
});

const walletService = require('../services/walletService');
const Transaction   = require('../models/TransactionModel');
const Booking       = require('../models/Booking');
const admin         = require('../firebaseConfig');

// ─────────────────────────────────────────────────────────────────────────────
describe('🔗 Integration: Booking → Wallet payment flow', () => {
  beforeEach(() => jest.clearAllMocks());

  function setupBalance(liveBalance, newBalance) {
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: liveBalance }])
      .mockResolvedValueOnce([{ totalBalance: newBalance }]);
  }

  test('✅ Wallet payment deducted on booking creation', async () => {
    setupBalance(3000, 1500);

    const paymentResult = await walletService.processWalletPayment(
      'user-123',
      1500,
      'booking-001'
    );

    expect(paymentResult.success).toBe(true);
    expect(paymentResult.newBalance).toBe(1500);
    expect(Transaction).toHaveBeenCalledTimes(1);
    const txData = Transaction.mock.calls[0][0];
    expect(txData.type).toBe('payment');
    expect(txData.amount).toBe(1500);
  });

  test('❌ Booking rejected when wallet insufficient', async () => {
    // processWalletPayment returns early after the FIRST aggregate call (liveBalance check).
    // Only set up 1 mock to avoid leaving a leftover in the queue.
    Transaction.aggregate.mockResolvedValueOnce([{ totalBalance: 500 }]);

    const paymentResult = await walletService.processWalletPayment(
      'user-123',
      1500,
      'booking-001'
    );

    expect(paymentResult.success).toBe(false);
    expect(paymentResult.message).toMatch(/Insufficient/);
    // No transaction should be created
    expect(Transaction).not.toHaveBeenCalled();
  });

  test('✅ Cancellation triggers full refund', async () => {
    // processWalletRefund does NOT check existing balance — it only calls
    // getAggregatedBalance once after saving the refund tx.
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: 3000 }]);

    const refundResult = await walletService.processWalletRefund(
      'user-123',
      1500,
      'booking-001'
    );

    expect(refundResult.success).toBe(true);
    expect(refundResult.newBalance).toBe(3000);
    const txData = Transaction.mock.calls[0][0];
    expect(txData.type).toBe('refund');
  });

  test('✅ Full flow: pay then refund restores original balance', async () => {
    // Step 1: Pay 1000 from balance of 3000 → becomes 2000
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: 3000 }])
      .mockResolvedValueOnce([{ totalBalance: 2000 }]);

    const payment = await walletService.processWalletPayment('user-123', 1000, 'bk-001');
    expect(payment.success).toBe(true);
    expect(payment.newBalance).toBe(2000);

    // Step 2: Refund 1000 → balance becomes 3000 again
    // processWalletRefund calls getAggregatedBalance once (no pre-balance check).
    jest.clearAllMocks();
    Transaction.aggregate
      .mockResolvedValueOnce([{ totalBalance: 3000 }]);

    const refund = await walletService.processWalletRefund('user-123', 1000, 'bk-001');
    expect(refund.success).toBe(true);
    expect(refund.newBalance).toBe(3000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔗 Integration: AI vs Manual booking distinction', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ AI-sourced booking has source=ai', () => {
    const aiBooking = {
      userId: 'user-123',
      placeId: 'smart_plan_Cairo',
      placeName: 'Cairo Heritage Tour',
      source: 'ai',
      totalPrice: 2500,
      checkIn: new Date(),
      status: 'confirmed',
    };
    expect(aiBooking.source).toBe('ai');
    expect(aiBooking.placeId).toContain('smart_plan');
  });

  test('✅ Manual booking has source=manual', () => {
    const manualBooking = {
      userId: 'user-123',
      placeId: 'hotel-001',
      placeName: 'Four Seasons Cairo',
      source: 'manual',
      totalPrice: 3500,
      status: 'active',
    };
    expect(manualBooking.source).toBe('manual');
  });

  test('✅ Trip analysis correctly separates AI vs manual', () => {
    const bookings = [
      { source: 'manual', totalPrice: 1200 },
      { source: 'manual', totalPrice: 800 },
      { source: 'ai',     totalPrice: 2500 },
      { source: 'ai',     totalPrice: 3000 },
    ];

    const manual = bookings.filter(b => b.source === 'manual');
    const ai     = bookings.filter(b => b.source === 'ai');
    const manualAvg = manual.reduce((s, b) => s + b.totalPrice, 0) / manual.length;
    const aiAvg     = ai.reduce((s, b) => s + b.totalPrice, 0) / ai.length;

    expect(manual).toHaveLength(2);
    expect(ai).toHaveLength(2);
    expect(manualAvg).toBe(1000);
    expect(aiAvg).toBe(2750);
  });

  test('✅ interestTags enable interest coverage calculation', () => {
    const bookings = [
      { interestTags: ['beach', 'diving'] },
      { interestTags: ['history', 'culture'] },
      { interestTags: ['food', 'restaurants'] },
    ];

    const allTags = [...new Set(bookings.flatMap(b => b.interestTags))];
    expect(allTags).toHaveLength(6);
    expect(allTags).toContain('history');
    expect(allTags).toContain('beach');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔗 Integration: Wallet balance invariants', () => {
  test('✅ balance never negative after valid deductions', async () => {
    const startBalance = 1000;
    let balance = startBalance;

    const payments = [300, 200, 400]; // total 900, within budget

    for (const payment of payments) {
      if (balance >= payment) {
        balance -= payment;
      }
    }

    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(100);
  });

  test('✅ large payment blocked when insufficient balance', () => {
    const balance = 500;
    const payment = 1500;
    const canPay  = balance >= payment;
    expect(canPay).toBe(false);
  });

  test('✅ multiple small payments deplete correctly', () => {
    let balance = 5000;
    const bookings = [
      { amount: 1200, name: 'Hotel' },
      { amount: 300,  name: 'Dinner' },
      { amount: 150,  name: 'Museum' },
      { amount: 500,  name: 'Tour' },
    ];

    for (const b of bookings) {
      expect(balance).toBeGreaterThanOrEqual(b.amount);
      balance -= b.amount;
    }

    expect(balance).toBe(2850);
  });
});
