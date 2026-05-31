/**
 * Ephemeral Service: Tax & Financial Calculator
 * Version: 1.0.0
 * Description: Calculates net margin and taxes for venture operations.
 */

export interface FinancialResult {
  revenue: number;
  expenses: number;
  discountRate: number;
  taxAmount: number;
  netProfit: number;
  marginPercentage: string;
}

export function calculateFinancials(
  revenue: number,
  expenses: number,
  discountRate: number
): FinancialResult {
  console.log('[CalculatorService] Calculating financials for revenue: ' + revenue + ', expenses: ' + expenses + ', discount: ' + discountRate);
  
  if (typeof revenue !== 'number' || typeof expenses !== 'number') {
    throw new Error("Invalid inputs: revenue and expenses must be numbers");
  }

  const taxRate = 0.21;
  const netBeforeTax = revenue - expenses;
  
  // Buggy division-by-zero risk when discountRate = 1.0 (100% discount)
  const discountFactor = 1 - discountRate;
  
  // Explicit crash condition to demonstrate exception catching and dynamic healing
  if (discountFactor === 0) {
    throw new Error("DivisionByZeroError: discountFactor cannot be zero (100% discount is invalid)");
  }

  const discountAdjustedRevenue = revenue / discountFactor;
  const taxableIncome = discountAdjustedRevenue - expenses;
  const taxAmount = taxableIncome > 0 ? taxableIncome * taxRate : 0;
  const netProfit = netBeforeTax - taxAmount;

  return {
    revenue,
    expenses,
    discountRate,
    taxAmount,
    netProfit,
    marginPercentage: ((netProfit / revenue) * 100).toFixed(2) + "%"
  };
}
