import { TestHelper, TestAmounts } from '../test-helper.js';
import { AccountUpdate, Mina, PrivateKey, PublicKey, UInt64 } from 'o1js';
import { ZkUsdVault, ZkUsdVaultErrors } from '../../zkusd-vault.js';
import { ZkUsdEngineErrors } from '../../zkusd-engine.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Vault Mint Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice', 'bob']);

    //deploy alice's vault
    await testHelper.createVaults(['alice']);

    //Alice deposits 100 Mina
    await testHelper.transaction(testHelper.agents.alice.account, async () => {
      await testHelper.engine.contract.depositCollateral(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.COLLATERAL_100_MINA
      );
    });
  });

  it('should allow alice to mint zkUSD', async () => {
    await testHelper.transaction(testHelper.agents.alice.account, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_5_ZKUSD
      );
    });

    const aliceBalance = await testHelper.token.contract.getBalanceOf(
      testHelper.agents.alice.account
    );

    const debtAmount =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    assert.deepStrictEqual(debtAmount, TestAmounts.DEBT_5_ZKUSD);
    assert.deepStrictEqual(aliceBalance, TestAmounts.DEBT_5_ZKUSD);
  });

  it('should emit the MintZkUsd event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'MintZkUsd');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultAddress,
      testHelper.agents.alice.vault?.publicKey
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.amountMinted,
      TestAmounts.DEBT_5_ZKUSD
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultCollateralAmount,
      TestAmounts.COLLATERAL_100_MINA
    );
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.vaultDebtAmount,
      TestAmounts.DEBT_5_ZKUSD
    );
  });

  it('should track total debt correctly across multiple mint operations', async () => {
    const initialDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    // Perform multiple small mints
    for (let i = 0; i < 3; i++) {
      await testHelper.transaction(
        testHelper.agents.alice.account,
        async () => {
          await testHelper.engine.contract.mintZkUsd(
            testHelper.agents.alice.vault!.publicKey,
            TestAmounts.DEBT_1_ZKUSD
          );
        }
      );
    }

    const finalDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();
    assert.deepStrictEqual(
      finalDebt,
      initialDebt?.add(TestAmounts.DEBT_1_ZKUSD.mul(3))
    );
  });

  it('should fail if mint amount is zero', async () => {
    await assert.rejects(
      async () => {
        await testHelper.transaction(
          testHelper.agents.alice.account,
          async () => {
            await testHelper.engine.contract.mintZkUsd(
              testHelper.agents.alice.vault!.publicKey,
              TestAmounts.ZERO
            );
          }
        );
      },
      {
        message: ZkUsdVaultErrors.AMOUNT_ZERO,
      }
    );
  });

  it('should fail if mint amount is negative', async () => {
    await assert.rejects(async () => {
      await testHelper.transaction(
        testHelper.agents.alice.account,
        async () => {
          await testHelper.engine.contract.mintZkUsd(
            testHelper.agents.alice.vault!.publicKey,
            UInt64.from(-1)
          );
        }
      );
    });
  });

  it('should fail if the minter is not the owner of the vault', async () => {
    await assert.rejects(
      async () => {
        await testHelper.transaction(
          testHelper.agents.bob.account,
          async () => {
            await testHelper.engine.contract.mintZkUsd(
              testHelper.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_5_ZKUSD
            );
          }
        );
      },
      (err: any) => {
        assert.match(err.message, /Field.assertEquals()/i);
        return true;
      }
    );
  });

  it('should fail if the health factor is too low', async () => {
    const LARGE_ZKUSD_AMOUNT = UInt64.from(1000e9); // Very large amount to ensure health factor violation

    await assert.rejects(
      async () => {
        await testHelper.transaction(
          testHelper.agents.alice.account,
          async () => {
            await testHelper.engine.contract.mintZkUsd(
              testHelper.agents.alice.vault!.publicKey,
              LARGE_ZKUSD_AMOUNT
            );
          }
        );
      },
      {
        message: ZkUsdVaultErrors.HEALTH_FACTOR_TOO_LOW,
      }
    );
  });

  it('should maintain correct health factor after multiple mint operations', async () => {
    const initialCollateral =
      await testHelper.agents.alice.vault?.contract.collateralAmount.fetch();
    let currentDebt =
      await testHelper.agents.alice.vault?.contract.debtAmount.fetch();

    // Mint multiple times while checking health factor
    for (let i = 0; i < 3; i++) {
      const healthFactor =
        testHelper.agents.alice.vault?.contract.calculateHealthFactor(
          initialCollateral!,
          currentDebt!.add(TestAmounts.DEBT_1_ZKUSD),
          await testHelper.engine.contract.getMinaPrice()
        );

      // Only mint if health factor would remain above minimum
      if (healthFactor!.greaterThanOrEqual(ZkUsdVault.MIN_HEALTH_FACTOR)) {
        await testHelper.transaction(
          testHelper.agents.alice.account,
          async () => {
            await testHelper.engine.contract.mintZkUsd(
              testHelper.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_1_ZKUSD
            );
          }
        );
        currentDebt = currentDebt?.add(TestAmounts.DEBT_1_ZKUSD);
      }
    }

    const finalHealthFactor =
      testHelper.agents.alice.vault?.contract.calculateHealthFactor(
        initialCollateral!,
        currentDebt!,
        await testHelper.engine.contract.getMinaPrice()
      );

    assert.strictEqual(
      finalHealthFactor!
        .greaterThanOrEqual(ZkUsdVault.MIN_HEALTH_FACTOR)
        .toBoolean(),
      true
    );
  });

  it('should not allow minting from calling the token contract directly', async () => {
    await assert.rejects(
      async () => {
        await testHelper.transaction(
          testHelper.agents.alice.account,
          async () => {
            await testHelper.token.contract.mint(
              testHelper.agents.alice.account,
              TestAmounts.DEBT_5_ZKUSD
            );
          }
        );
      },
      (err: any) => {
        assert.match(
          err.message,
          /Account_app_state_precondition_unsatisfied/i
        );
        return true;
      }
    );
  });

  it('Should fail if the engine is halted', async () => {
    await testHelper.stopTheProtocol();

    await assert.rejects(
      async () => {
        await testHelper.transaction(
          testHelper.agents.alice.account,
          async () => {
            await testHelper.engine.contract.mintZkUsd(
              testHelper.agents.alice.vault!.publicKey,
              TestAmounts.DEBT_5_ZKUSD
            );
          }
        );
      },
      (err: any) => {
        assert.match(err.message, new RegExp(ZkUsdEngineErrors.EMERGENCY_HALT));
        return true;
      }
    );
  });

  it('Should allow minting if the price feed is resumed', async () => {
    await testHelper.resumeTheProtocol();

    await testHelper.transaction(testHelper.agents.alice.account, async () => {
      await testHelper.engine.contract.mintZkUsd(
        testHelper.agents.alice.vault!.publicKey,
        TestAmounts.DEBT_5_ZKUSD
      );
    });
  });
});
