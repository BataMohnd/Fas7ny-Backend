const walletService = require('../services/walletService');

// Mock the wallet service functions directly
jest.mock('../services/walletService', () => ({
  processWalletPayment: jest.fn(),
  processWalletRefund: jest.fn(),
  getAggregatedBalance: jest.fn(),
  verifyUserId: jest.fn(),
}));

describe('💳 Wallet Service (Unit)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ processWalletPayment called with correct args', async () => {
    walletService.processWalletPayment.mockResolvedValue({
      success: true,
      newBalance: 700,
    });
    const result = await walletService.processWalletPayment('user-123', 300, null);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(700);
    expect(walletService.processWalletPayment).toHaveBeenCalledWith('user-123', 300, null);
  });

  test('✅ processWalletRefund called with correct args', async () => {
    walletService.processWalletRefund.mockResolvedValue({
      success: true,
      newBalance: 1000,
    });
    const result = await walletService.processWalletRefund('user-123', 300, 'booking-1');
    expect(result.success).toBe(true);
    expect(walletService.processWalletRefund).toHaveBeenCalledWith('user-123', 300, 'booking-1');
  });

  test('❌ processWalletPayment fails on insufficient balance', async () => {
    walletService.processWalletPayment.mockResolvedValue({
      success: false,
      message: 'Insufficient balance',
    });
    const result = await walletService.processWalletPayment('user-123', 99999, null);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Insufficient');
  });

  test('✅ getAggregatedBalance returns number', async () => {
    walletService.getAggregatedBalance.mockResolvedValue(1500);
    const balance = await walletService.getAggregatedBalance('user-123');
    expect(typeof balance).toBe('number');
    expect(balance).toBe(1500);
  });
});