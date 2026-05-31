import { describe, it, expect } from 'vitest';
import { calculateFinancials } from '../services/calculator_service.js';
import { initiateStripeTransfer } from '../services/payment_service.js';

describe('Corporate Service Schema Assertions & Types', () => {
  describe('Tax & Financial Calculator Service', () => {
    it('should correctly calculate net margins and taxes for normal calculations', () => {
      const result = calculateFinancials(10000, 3000, 0.1);
      expect(result.revenue).toBe(10000);
      expect(result.expenses).toBe(3000);
      expect(result.taxAmount).toBeGreaterThan(0);
      expect(result.netProfit).toBeLessThan(7000); // revenue - expenses - tax
      expect(result.marginPercentage).toContain('%');
    });

    it('should throw an error if inputs are not valid numbers', () => {
      expect(() => calculateFinancials('10000' as any, 3000, 0.1)).toThrow();
      expect(() => calculateFinancials(10000, '3000' as any, 0.1)).toThrow();
    });

    it('should handle division-by-zero risk gracefully under normal discount values', () => {
      const result = calculateFinancials(10000, 3000, 0.0); // 0% discount
      expect(result.netProfit).toBeDefined();
    });

    it('should throw explicit division-by-zero exception on 1.0 discount rate', () => {
      expect(() => calculateFinancials(10000, 3000, 1.0)).toThrow(/discountFactor/);
    });
  });

  describe('Payment Processing Gateway Service', () => {
    it('should successfully execute valid stripe mock transfers', () => {
      const result = initiateStripeTransfer('global-outpost-logistics', 250, 'USD');
      expect(result.success).toBe(true);
      expect(result.amount).toBe(250);
      expect(result.recipient).toBe('global-outpost-logistics');
      expect(result.status).toBe('PROCESSED');
      expect(result.transactionId).toContain('ch_');
    });

    it('should reject transfers with zero or negative amounts', () => {
      expect(() => initiateStripeTransfer('recipient', 0)).toThrow();
      expect(() => initiateStripeTransfer('recipient', -100)).toThrow();
    });
  });
});
