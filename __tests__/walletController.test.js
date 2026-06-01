const walletController = require('../controllers/walletController');

// ── Module-level mocks ────────────────────────────────────────────────────────
jest.mock('../models/TransactionModel', () =>
  jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue({ _id: 'tx-mock-001' }),
  }))
);

jest.mock('../services/walletService', () => ({
  verifyUserId:         jest.fn(),
  getAggregatedBalance: jest.fn(),
  syncToFirebase:       jest.fn(),
  processWalletPayment: jest.fn(),
  processWalletRefund:  jest.fn(),
}));

const walletService = require('../services/walletService');

// ── Helper ────────────────────────────────────────────────────────────────────
function mockRes() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('💰 walletController.topUp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walletService.verifyUserId.mockResolvedValue({ valid: true, source: 'mongo' });
    walletService.getAggregatedBalance.mockResolvedValue(1500);
    walletService.syncToFirebase.mockResolvedValue();
  });

  test('✅ valid topup returns 200 with new balance', async () => {
    const req = { body: { userId: 'user-123', amount: 500 } };
    const res = mockRes();

    await walletController.topUp(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.balance).toBe(1500);
  });

  test('❌ missing userId returns 401', async () => {
    const req = { body: { amount: 500 }, headers: {} };
    const res = mockRes();

    await walletController.topUp(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('❌ invalid amount (zero) returns 400', async () => {
    const req = { body: { userId: 'user-123', amount: 0 } };
    const res = mockRes();

    await walletController.topUp(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ negative amount returns 400', async () => {
    const req = { body: { userId: 'user-123', amount: -100 } };
    const res = mockRes();

    await walletController.topUp(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ user not found returns 404', async () => {
    walletService.verifyUserId.mockResolvedValue({ valid: false });
    const req = { body: { userId: 'ghost-user', amount: 200 } };
    const res = mockRes();

    await walletController.topUp(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('✅ userId accepted from headers', async () => {
    const req = { body: { amount: 300 }, headers: { userid: 'header-user' } };
    const res = mockRes();

    await walletController.topUp(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('💸 walletController.payment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walletService.processWalletPayment.mockResolvedValue({ success: true, newBalance: 700, data: {} });
  });

  test('✅ valid payment returns 200', async () => {
    const req = { body: { userId: 'user-123', amount: 300 } };
    const res = mockRes();

    await walletController.payment(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].balance).toBe(700);
  });

  test('❌ insufficient balance returns 400', async () => {
    walletService.processWalletPayment.mockResolvedValue({
      success: false,
      message: 'Insufficient balance',
    });
    const req = { body: { userId: 'user-123', amount: 99999 } };
    const res = mockRes();

    await walletController.payment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Insufficient/);
  });

  test('❌ missing userId returns 401', async () => {
    const req = { body: { amount: 100 }, headers: {} };
    const res = mockRes();

    await walletController.payment(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('❌ non-numeric amount returns 400', async () => {
    const req = { body: { userId: 'user-123', amount: 'abc' } };
    const res = mockRes();

    await walletController.payment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🏧 walletController.withdraw', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walletService.verifyUserId.mockResolvedValue({ valid: true });
    walletService.getAggregatedBalance.mockResolvedValue(2000);
    walletService.syncToFirebase.mockResolvedValue();
  });

  test('✅ valid withdraw with sufficient balance returns 200', async () => {
    const req = { body: { userId: 'user-123', amount: 500 } };
    const res = mockRes();

    await walletController.withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.message).toBe('Withdrawal successful');
  });

  test('❌ withdraw exceeding balance returns 400', async () => {
    walletService.getAggregatedBalance.mockResolvedValue(100);
    const req = { body: { userId: 'user-123', amount: 500 } };
    const res = mockRes();

    await walletController.withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Insufficient/);
  });

  test('❌ user not found returns 404', async () => {
    walletService.verifyUserId.mockResolvedValue({ valid: false });
    const req = { body: { userId: 'ghost', amount: 100 } };
    const res = mockRes();

    await walletController.withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('❌ missing userId returns 401', async () => {
    const req = { body: { amount: 100 }, headers: {} };
    const res = mockRes();

    await walletController.withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('💼 walletController.getBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walletService.getAggregatedBalance.mockResolvedValue(3500);
  });

  test('✅ returns balance for valid userId', async () => {
    const req = { params: { userId: 'user-123' }, query: {}, headers: {} };
    const res = mockRes();

    await walletController.getBalance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].balance).toBe(3500);
  });

  test('❌ missing userId returns 401', async () => {
    const req = { params: {}, query: {}, headers: {} };
    const res = mockRes();

    await walletController.getBalance(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🔄 walletController.refundWallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walletService.processWalletRefund.mockResolvedValue({ success: true, newBalance: 1300 });
  });

  test('✅ valid refund returns 200 with new balance', async () => {
    const req = { body: { userId: 'user-123', amount: 300, bookingId: 'booking-001' } };
    const res = mockRes();

    await walletController.refundWallet(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].balance).toBe(1300);
  });

  test('❌ missing userId returns 401', async () => {
    const req = { body: { amount: 300 } };
    const res = mockRes();

    await walletController.refundWallet(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('❌ refund service failure returns 400', async () => {
    walletService.processWalletRefund.mockResolvedValue({
      success: false,
      message: 'Transaction not found',
    });
    const req = { body: { userId: 'user-123', amount: 300, bookingId: 'bad-id' } };
    const res = mockRes();

    await walletController.refundWallet(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
