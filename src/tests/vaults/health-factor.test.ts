import { TestHelper } from '../test-helper.js';
import { UInt64 } from 'o1js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Vault Health Factor Calculations Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice', 'bob']);
    await testHelper.createVaults(['alice', 'bob']);
  });

  describe('Health Factor Calculations', () => {
    it('should calculate health factor of 66 for 1:1 collateral to debt ratio at $1 price', () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 1 MINA * $1 = $1 collateral value
      // $1 collateral / ($1 debt * 150%) = 0.66 = 66 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 66n);
    });

    it('should calculate health factor of 133 for 2:1 collateral to debt ratio at $1 price', () => {
      const collateral = UInt64.from(2e9); // 2 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 2 MINA * $1 = $2 collateral value
      // $2 collateral / ($1 debt * 150%) = 1.33 = 133 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 133n);
    });

    it('should calculate health factor of 33 for 1:2 collateral to debt ratio at $1 price', () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(2e9); // 2 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 1 MINA * $1 = $1 collateral value
      // $1 collateral / ($2 debt * 150%) = 0.33 = 33 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 33n);
    });

    it('should calculate health factor of 133 for 1:1 collateral to debt ratio at $2 price', () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD
      const price = UInt64.from(2e9); // $2 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 1 MINA * $2 = $2 collateral value
      // $2 collateral / ($1 debt * 150%) = 1.33 = 133 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 133n);
    });

    it('should calculate health factor of 33 for 1:1 collateral to debt ratio at $0.50 price', () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(1e9); // 1 zkUSD
      const price = UInt64.from(0.5e9); // $0.50 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 1 MINA * $0.50 = $0.50 collateral value
      // $0.50 collateral / ($1 debt * 150%) = 0.33 = 33 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 33n);
    });

    it('should return max UInt64 value when debt is zero', () => {
      const collateral = UInt64.from(1e9); // 1 MINA
      const debt = UInt64.from(0); // 0 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      assert.strictEqual(healthFactor?.toBigInt(), UInt64.MAXINT().toBigInt());
    });

    it('should calculate health factor of 666 for large numbers', () => {
      const collateral = UInt64.from(1000e9); // 1000 MINA
      const debt = UInt64.from(100e9); // 100 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 1000 MINA * $1 = $1000 collateral value
      // $1000 collateral / ($100 debt * 150%) = 6.66 = 666 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 666n);
    });

    it('should calculate health factor of 66 for small numbers', () => {
      const collateral = UInt64.from(0.1e9); // 0.1 MINA
      const debt = UInt64.from(0.1e9); // 0.1 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 0.1 MINA * $1 = $0.1 collateral value
      // $0.1 collateral / ($0.1 debt * 150%) = 0.66 = 66 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 66n);
    });

    it('should calculate consistent health factors across different decimal places', () => {
      // Test case 1: 1 MINA : 1 zkUSD
      const hf1 = testHelper.agents.alice.vault?.contract.calculateHealthFactor(
        UInt64.from(1e9),
        UInt64.from(1e9),
        UInt64.from(1e9)
      );

      // Test case 2: 0.1 MINA : 0.1 zkUSD (same ratio)
      const hf2 = testHelper.agents.alice.vault?.contract.calculateHealthFactor(
        UInt64.from(0.1e9),
        UInt64.from(0.1e9),
        UInt64.from(1e9)
      );

      // Test case 3: 10 MINA : 10 zkUSD (same ratio)
      const hf3 = testHelper.agents.alice.vault?.contract.calculateHealthFactor(
        UInt64.from(10e9),
        UInt64.from(10e9),
        UInt64.from(1e9)
      );

      // All should be 66 as they have the same ratio
      assert.strictEqual(hf1?.toBigInt(), 66n);
      assert.strictEqual(hf2?.toBigInt(), 66n);
      assert.strictEqual(hf3?.toBigInt(), 66n);
    });

    it('should calculate health factor of 100 at exactly 150% collateralization', () => {
      const collateral = UInt64.from(150e9); // 1.5 MINA
      const debt = UInt64.from(100e9); // 1 zkUSD
      const price = UInt64.from(1e9); // $1 USD

      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral,
          debt,
          price
        );

      // 1.5 MINA * $1 = $1.5 collateral value
      // $1.5 collateral / ($1 debt * 150%) = 1.00 = 100 (after scaling)
      assert.strictEqual(healthFactor?.toBigInt(), 100n);
    });

    it('should return the correct health factor for the vault', async () => {
      const collateral =
        await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
      const debt =
        await testHelper.agents.alice.vault?.contract.debtAmount.fetch();
      const price = await testHelper.engine.contract.getMinaPrice();

      const healthFactor =
        await testHelper.engine.contract.getVaultHealthFactor(
          testHelper.agents.alice.vault!.publicKey
        );

      const rawHealthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          collateral!,
          debt!,
          price
        );
      assert.strictEqual(healthFactor?.toBigInt(), rawHealthFactor?.toBigInt());
    });

    it('should return UInt64.MAXINT() when vault has no debt', async () => {
      const healthFactor =
        await testHelper.engine.contract.getVaultHealthFactor(
          testHelper.agents.bob.vault!.publicKey
        );
      assert.strictEqual(healthFactor.toBigInt(), UInt64.MAXINT().toBigInt());
    });
  });
});
