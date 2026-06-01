describe('⚙️ Value Score Algorithm', () => {
  function calcValueScore(rating, price, maxPrice = 5000) {
    const ratingScore = (rating / 5.0) * 60;
    const priceScore = (1 - Math.min(price / maxPrice, 1)) * 40;
    return Math.round((ratingScore + priceScore) * 10) / 10;
  }

  test('✅ perfect rating + free = 100', () => {
    expect(calcValueScore(5.0, 0)).toBe(100);
  });

  test('✅ zero rating + max price = 0', () => {
    expect(calcValueScore(0, 5000)).toBe(0);
  });

  test('✅ mid values ≈ 50', () => {
    const score = calcValueScore(2.5, 2500);
    expect(score).toBeCloseTo(50, 0);
  });

  test('✅ score always 0-100', () => {
    [
      calcValueScore(4.5, 1200),
      calcValueScore(3.0, 800),
      calcValueScore(5.0, 100),
      calcValueScore(1.0, 4500),
    ].forEach(score => {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });
});

describe('💳 Wallet Aggregation Algorithm', () => {
  function calcBalance(transactions) {
    return transactions.reduce((sum, t) => {
      const sign = ['topup', 'refund'].includes(t.type) ? 1 : -1;
      return sum + (t.amount * sign);
    }, 0);
  }

  test('✅ topup increases balance', () => {
    expect(calcBalance([{ type: 'topup', amount: 1000 }])).toBe(1000);
  });

  test('✅ payment decreases balance', () => {
    expect(calcBalance([
      { type: 'topup', amount: 1000 },
      { type: 'payment', amount: 300 },
    ])).toBe(700);
  });

  test('✅ refund restores balance', () => {
    expect(calcBalance([
      { type: 'topup', amount: 1000 },
      { type: 'payment', amount: 300 },
      { type: 'refund', amount: 300 },
    ])).toBe(1000);
  });

  test('✅ withdraw decreases balance', () => {
    expect(calcBalance([
      { type: 'topup', amount: 2000 },
      { type: 'withdraw', amount: 500 },
    ])).toBe(1500);
  });

  test('✅ complex scenario', () => {
    expect(calcBalance([
      { type: 'topup',    amount: 5000 },
      { type: 'payment',  amount: 1200 },
      { type: 'topup',    amount: 2000 },
      { type: 'withdraw', amount: 500  },
      { type: 'refund',   amount: 300  },
    ])).toBe(5600);
  });

  test('✅ empty transactions = zero', () => {
    expect(calcBalance([])).toBe(0);
  });
});

describe('🗓️ Greedy Planner Budget Allocation', () => {
  function allocateBudget(totalBudget, days) {
    const perDay = totalBudget / days;
    return {
      perDay: Math.round(perDay),
      breakfast: Math.round(perDay * 0.15),
      morningActivity: Math.round(perDay * 0.35),
      lunch: Math.round(perDay * 0.25),
      eveningActivity: Math.round(perDay * 0.25),
    };
  }

  test('✅ budget splits correctly for 3 days', () => {
    const result = allocateBudget(3000, 3);
    expect(result.perDay).toBe(1000);
    expect(result.breakfast).toBe(150);
  });

  test('✅ slot allocations sum to ~100% of daily budget', () => {
    const result = allocateBudget(4000, 4);
    const total = result.breakfast + result.morningActivity +
                  result.lunch + result.eveningActivity;
    expect(total).toBeCloseTo(result.perDay, -1);
  });

  test('✅ single day uses full budget', () => {
    const result = allocateBudget(1000, 1);
    expect(result.perDay).toBe(1000);
  });
});

describe('📍 Proactive Suggestions Score', () => {
  function calcDestinationScore(dest, userInterests, bookedCities) {
    const hasInterests = userInterests.length > 0;
    const matchCount = hasInterests
      ? dest.tags.filter(tag =>
          userInterests.some(ui => ui.includes(tag) || tag.includes(ui))
        ).length
      : 0;
    const interestScore = hasInterests
      ? Math.min(40, matchCount * (40 / Math.max(dest.tags.length, 1)))
      : 20;
    const historyBoost = bookedCities.includes(dest.city) ? 20 : 0;
    const varietyBoost = !bookedCities.includes(dest.city) ? 15 : 0;
    return Math.round(dest.baseScore + interestScore + historyBoost + varietyBoost);
  }

  const luxor = {
    city: 'Luxor',
    baseScore: 25,
    tags: ['history', 'culture', 'temples', 'nile'],
  };

  test('✅ history lover gets high score for Luxor', () => {
    const score = calcDestinationScore(luxor, ['history', 'culture'], []);
    expect(score).toBeGreaterThan(55); // base(25) + interestScore(20) + variety(15) = 60
  });

  test('✅ already visited city gets history boost not variety', () => {
    const visited = calcDestinationScore(luxor, [], ['Luxor']);
    const notVisited = calcDestinationScore(luxor, [], []);
    expect(visited).toBeGreaterThan(notVisited);
  });

  test('✅ no interests gives default score', () => {
    const score = calcDestinationScore(luxor, [], []);
    expect(score).toBe(luxor.baseScore + 20 + 15); // base + default interest + variety
  });
});