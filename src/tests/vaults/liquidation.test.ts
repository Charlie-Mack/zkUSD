import { TestHelper, TestAmounts } from '../test-helper.js';
import { AccountUpdate, Field, Mina, Permissions, UInt64 } from 'o1js';
import { ZkUsdVault, ZkUsdVaultErrors } from '../../zkusd-vault.js';
import { ZkUsdEngineErrors } from '../../zkusd-engine.js';
import { ProtocolData } from '../../types.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Vault Liquidation Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice', 'bob', 'charlie', 'dave', 'rewards']);

    //Deploy a fresh vault
    await testHelper.createVaults(['alice', 'bob', 'charlie', 'dave']);

    // Alice deposits 100 Mina
    await testHelper.transaction(testHelper.agents.alice.account, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });

    // Bob deposits 900 Mina
    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.bob.vault!.publicKey,
        TestAmounts.COLLATERAL_900_MINA
      );
    });

    // Alice mint 30 zkUSD
    await testHelper.transaction(testHelper.agents.alice.account, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_30_ZKUSD
      );
    });

    //Bob mint 100 zkUSD
    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.bob.vault!.publicKey,
        TestAmounts.DEBT_100_ZKUSD
      );
    });
  });

  it('should fail if vault is sufficiently collateralized', async () => {
    await assert.rejects(
      async () => {
        await testHelper.transaction(
          testHelper.agents.bob.account,
          async () => {
            await testHelper.engine.contract.liquidate(
              testHelper.agents.alice.vault!.publicKey
            );
          }
        );
      },
      {
        message: ZkUsdVaultErrors.HEALTH_FACTOR_TOO_HIGH,
      }
    );
  });

  it('should fail liquidation if liquidator does not have sufficent zkUsd', async () => {
    //Price drops to 0.25
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_25_CENT);

    //Bob transfers 1 zkUSD to Charlie
    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      await testHelper.token.contract.transfer(
        testHelper.agents.bob.account,
        testHelper.agents.charlie.account,
        TestAmounts.DEBT_1_ZKUSD
      );
    });

    await assert.rejects(async () => {
      await testHelper.transaction(
        testHelper.agents.charlie.account,
        async () => {
          await testHelper.engine.contract.liquidate(
            testHelper.agents.alice.vault!.publicKey
          );
        }
      );
    }, /Overflow/i);
  });

  it('should fail liquidation if liquidator does not have receive permissions', async () => {
    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      let au = AccountUpdate.create(testHelper.agents.bob.account);
      let permissions = Permissions.default();
      permissions.receive = Permissions.impossible();
      au.account.permissions.set(permissions);
      AccountUpdate.attachToTransaction(au);
      au.requireSignature();
    });

    await assert.rejects(async () => {
      await testHelper.transaction(testHelper.agents.bob.account, async () => {
        await testHelper.engine.contract.liquidate(
          testHelper.agents.alice.vault!.publicKey
        );
      });
    }, /Update_not_permitted_balance/i);
  });

  it('should allow liquidation of vault if it is undercollateralized', async () => {
    //Price raises to 0.4
    const price = TestAmounts.PRICE_40_CENT;
    await testHelper.updateOracleMinaPrice(price);
    // But the alice vault is still undercollateralized

    //Reset bobs permissions
    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      let au = AccountUpdate.create(testHelper.agents.bob.account);
      let permissions = Permissions.default();
      au.account.permissions.set(permissions);
      AccountUpdate.attachToTransaction(au);
      au.requireSignature();
    });

    const aliceVaultCollateralPreLiq =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    const aliceVaultDebtPreLiq =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();
    const bobZkUsdBalancePreLiq = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.bob.account
    );
    const bobMinaBalancePreLiq = Mina.getBalance(testHelper.agents.bob.account);
    const aliceZkUsdBalancePreLiq =
      await testHelper.token.contract.getBalanceOf(
        testHelper.agents.alice.account
      );
    const aliceMinaBalancePreLiq = Mina.getBalance(
      testHelper.agents.alice.account
    );

    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      await testHelper.engine.contract.liquidate(
        testHelper.agents.alice.vault!.publicKey
      );
    });

    const aliceVaultCollateralPostLiq =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    const aliceVaultDebtPostLiq =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();
    const bobZkUsdBalancePostLiq = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.bob.account
    );
    const bobMinaBalancePostLiq = Mina.getBalance(
      testHelper.agents.bob.account
    );
    const aliceZkUsdBalancePostLiq =
      await testHelper.token.contract.getBalanceOf(
        testHelper.agents.alice.account
      );
    const aliceMinaBalancePostLiq = Mina.getBalance(
      testHelper.agents.alice.account
    );

    assert.equal(
      ZkUsdVault.LIQUIDATION_BONUS_RATIO.equals(Field.from(110)).toBoolean(),
      true
    );

    assert.deepStrictEqual(
      aliceVaultCollateralPostLiq,
      TestAmounts.ZERO,
      "Alice vault's collateral should be 0 after liquidation"
    );
    assert.deepStrictEqual(
      aliceVaultDebtPostLiq,
      TestAmounts.ZERO,
      "Alice vault's debt should be 0 after liquidation"
    );

    const bobdiff = bobMinaBalancePostLiq.sub(bobMinaBalancePreLiq);
    const aliceDiff = aliceMinaBalancePostLiq.sub(aliceMinaBalancePreLiq);

    // total collateral returned should be equal to the collateral in the vault preliq
    assert.deepStrictEqual(
      bobdiff.add(aliceDiff),
      aliceVaultCollateralPreLiq,
      'Total collateral returned should be equal to the collateral in the vault preliq'
    );

    const ratio = UInt64.Unsafe.fromField(ZkUsdVault.LIQUIDATION_BONUS_RATIO);

    // bob collateral should be equal to the debt value of collateral + liquidation bonus,
    // which is defined by ratio, e.g. ratio 110 is 10% bonus
    const collateralValue = aliceVaultDebtPreLiq!.value
      .mul(Field.from(1e9))
      .div(price.value);
    const valueWithLiquidationBonus = UInt64.Unsafe.fromField(
      collateralValue.mul(ratio.value).div(Field.from(100))
    );

    assert.deepStrictEqual(
      bobZkUsdBalancePostLiq,
      bobZkUsdBalancePreLiq.sub(aliceVaultDebtPreLiq!),
      'Bob should have the paid debt removed from his zkUSD balance'
    );
    assert.deepStrictEqual(
      bobMinaBalancePostLiq,
      bobMinaBalancePreLiq.add(valueWithLiquidationBonus),
      'Bob should have received bought collateral plus the liquidation bonus'
    );
    assert.deepStrictEqual(
      aliceZkUsdBalancePostLiq,
      aliceZkUsdBalancePreLiq,
      'Alice private zkUSD should not have changed.'
    );
    // Add check for Alice's remaining collateral
    assert.deepStrictEqual(
      aliceMinaBalancePostLiq,
      aliceMinaBalancePreLiq.add(
        aliceVaultCollateralPreLiq!.sub(valueWithLiquidationBonus)
      ),
      'Alice should have received the remaining collateral after liquidation bonus'
    );
  });

  it('should emit the Liquidate event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'Liquidate');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      testHelper.agents.alice.vault?.publicKey
    );
    assert.strictEqual(
      // @ts-ignore
      latestEvent.event.data.liquidator.toBase58(),
      testHelper.agents.bob.account.toBase58()
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralLiquidated,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtRepaid,
      TestAmounts.DEBT_30_ZKUSD
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.minaPrice,
      TestAmounts.PRICE_40_CENT
    );
  });

  it('should give all collateral to liquidator when debt value exceeds collateral + liquidation bonus', async () => {
    //Price starts at $1
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_1_USD);

    // Setup: Dave deposits 100 MINA and mints 50 zkUSD
    await testHelper.transaction(testHelper.agents.dave.account, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.dave.vault!.publicKey,
        TestAmounts.COLLATERAL_105_MINA
      );
    });

    await testHelper.transaction(testHelper.agents.dave.account, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.dave.vault!.publicKey,
        TestAmounts.DEBT_50_ZKUSD
      );
    });

    // Price drops to 0.50, making the vault eligible for liquidation
    // At this price:
    // - 100 MINA collateral = $50
    // - 50 zkUSD debt = $50 worth of MINA (100 MINA)
    // - With 10% bonus, liquidator should get 110 MINA
    // - Since only 105 MINA exists, liquidator gets all of it
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_50_CENT);

    const daveVaultCollateralPreLiq =
      await testHelper.agents.dave.vault?.contract.collateralAmount.fetch();
    const daveVaultDebtPreLiq =
      await testHelper.agents.dave.vault?.contract.debtAmount.fetch();
    const bobZkUsdBalancePreLiq = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.bob.account
    );
    const bobMinaBalancePreLiq = Mina.getBalance(testHelper.agents.bob.account);
    const daveMinaBalancePreLiq = Mina.getBalance(
      testHelper.agents.dave.account
    );

    // Bob liquidates Dave's vault
    await testHelper.transaction(testHelper.agents.bob.account, async () => {
      await testHelper.engine.contract.liquidate(
        testHelper.agents.dave.vault!.publicKey
      );
    });

    const daveVaultCollateralPostLiq =
      await testHelper.agents.dave.vault?.contract.collateralAmount.fetch();
    const daveVaultDebtPostLiq =
      await testHelper.agents.dave.vault?.contract.debtAmount.fetch();
    const bobZkUsdBalancePostLiq = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.bob.account
    );
    const bobMinaBalancePostLiq = Mina.getBalance(
      testHelper.agents.bob.account
    );
    const daveMinaBalancePostLiq = Mina.getBalance(
      testHelper.agents.dave.account
    );

    // Verify vault is cleared
    assert.deepStrictEqual(
      daveVaultCollateralPostLiq,
      TestAmounts.ZERO,
      "Dave's vault collateral should be 0 after liquidation"
    );
    assert.deepStrictEqual(
      daveVaultDebtPostLiq,
      TestAmounts.ZERO,
      "Dave's vault debt should be 0 after liquidation"
    );

    // Verify Bob (liquidator) received all collateral
    const bobMinaDiff = bobMinaBalancePostLiq.sub(bobMinaBalancePreLiq);
    assert.deepStrictEqual(
      bobMinaDiff,
      daveVaultCollateralPreLiq,
      'Liquidator should receive all collateral when debt value exceeds collateral'
    );
    assert.deepStrictEqual(
      bobZkUsdBalancePostLiq,
      bobZkUsdBalancePreLiq.sub(daveVaultDebtPreLiq!),
      'Liquidator should have paid the debt amount in zkUSD'
    );

    // Verify Dave (owner) received nothing
    const daveMinaDiff = daveMinaBalancePostLiq.sub(daveMinaBalancePreLiq);
    assert.deepStrictEqual(
      daveMinaDiff,
      TestAmounts.ZERO,
      'Vault owner should receive nothing when debt value exceeds collateral'
    );
  });

  it('Should fail if the price feed is in emergency mode', async () => {
    // Drop price to make vault eligible for liquidation
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_2_USD);

    // Set up Alice's vault with collateral and debt
    await testHelper.transaction(
      testHelper.agents.charlie.account,
      async () => {
        await testHelper.engine.contract.depositCollateral(
          testHelper.agents.charlie.vault!.publicKey,
          TestAmounts.COLLATERAL_1_MINA
        );
      }
    );

    await testHelper.transaction(
      testHelper.agents.charlie.account,
      async () => {
        await testHelper.engine.contract.mintZkUsd(
          testHelper.agents.charlie.vault!.publicKey,
          TestAmounts.DEBT_50_CENT_ZKUSD
        );
      }
    );

    // Drop price to make vault eligible for liquidation
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_25_CENT);

    await testHelper.stopTheProtocol();

    const protocolDataPacked =
      await testHelper.engine.contract.protocolDataPacked.fetch();
    const protocolData = ProtocolData.unpack(protocolDataPacked!);

    await assert.rejects(async () => {
      await testHelper.transaction(testHelper.agents.bob.account, async () => {
        await testHelper.engine.contract.liquidate(
          testHelper.agents.charlie.vault!.publicKey
        );
      });
    }, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
  });
});
