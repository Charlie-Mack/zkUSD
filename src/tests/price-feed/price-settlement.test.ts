import { Mina, UInt32, UInt64 } from 'o1js';
import { TestAmounts, TestHelper } from '../test-helper.js';
import { ZkUsdEngine } from '../../zkusd-engine.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Price Feed Oracle Price Settlement Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice']);
  });

  it('should settle the correct price', async () => {
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_25_CENT);

    const price = await testHelper.engine.contract.getMinaPrice();

    assert.strictEqual(price.toString(), TestAmounts.PRICE_25_CENT.toString());
  });

  it('should emit the price update event', async () => {
    const contractEvents = await testHelper.engine.contract.fetchEvents();
    const latestEvent = contractEvents[0];

    assert.strictEqual(latestEvent.type, 'PriceUpdate');
    assert.deepStrictEqual(
      // @ts-ignore
      latestEvent.event.data.newPrice,
      TestAmounts.PRICE_25_CENT
    );
  });

  it('should eventually settle odd price, 3 blocks later, if we are on an odd block', async () => {
    testHelper.Local.setBlockchainLength(UInt32.from(1));
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_50_CENT);

    const oddPrice = await testHelper.engine.contract.minaPriceOddBlock.fetch();

    assert.strictEqual(
      oddPrice?.toString(),
      TestAmounts.PRICE_50_CENT.toString()
    );
  });

  it('should eventually settle even price, 3 blocks later, if we are on an even block', async () => {
    testHelper.Local.setBlockchainLength(UInt32.from(2));
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_52_CENT);

    const evenPrice = await testHelper.engine.contract.minaPriceEvenBlock.fetch();

    assert.strictEqual(
      evenPrice?.toString(),
      TestAmounts.PRICE_52_CENT.toString()
    );
  });

  it('should use the fallback price if oracles havent submitted the price', async () => {
    await testHelper.transaction(testHelper.deployer, async () => {
      await testHelper.engine.contract.settlePriceUpdate();
    });

    await testHelper.transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_2_USD
        );
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );

    //Move the block forward
    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    await testHelper.transaction(testHelper.deployer, async () => {
      await testHelper.engine.contract.settlePriceUpdate();
    });

    //Move the block forward
    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    const price = await testHelper.engine.contract.getMinaPrice();

    assert.strictEqual(price.toString(), TestAmounts.PRICE_2_USD.toString());
  });

  it('should calculate correct median', async () => {
    const prices = [
      TestAmounts.PRICE_48_CENT,
      TestAmounts.PRICE_50_CENT,
      TestAmounts.PRICE_52_CENT,
      TestAmounts.PRICE_2_USD,
      TestAmounts.PRICE_1_USD,
      TestAmounts.PRICE_50_CENT,
      TestAmounts.PRICE_52_CENT,
      TestAmounts.PRICE_52_CENT,
    ];

    for (let i = 0; i < prices.length; i++) {
      const oracleName = Array.from(testHelper.whitelistedOracles.keys())[i];
      await testHelper.transaction(testHelper.oracles[oracleName], async () => {
        await testHelper.engine.contract.submitPrice(
          prices[i],
          testHelper.whitelist
        );
      });
    }

    //what should the median price be?
    const sortedPrices = [...prices].sort(
      (a, b) => Number(a.toString()) - Number(b.toString())
    );

    // For an even number of prices (8), take average of middle two values
    const middleIndex = Math.floor(sortedPrices.length / 2);
    const medianPrice = sortedPrices[middleIndex - 1]
      .add(sortedPrices[middleIndex])
      .div(2);

    //move the blockchain forward
    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    await testHelper.transaction(testHelper.deployer, async () => {
      await testHelper.engine.contract.settlePriceUpdate();
    });

    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    const price = await testHelper.engine.contract.getMinaPrice();
    // Should return middle price (50 cents)
    assert.strictEqual(price.toString(), medianPrice.toString());
  });

  it('should calculate correct median with 4 prices submitted', async () => {
    await testHelper.transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateOracleWhitelist(
          testHelper.whitelist
        );
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );

    const prices = [
      TestAmounts.PRICE_48_CENT,
      TestAmounts.PRICE_49_CENT,
      TestAmounts.PRICE_51_CENT,
      TestAmounts.PRICE_52_CENT,
    ];

    for (let i = 0; i < 4; i++) {
      const oracleName = Array.from(testHelper.whitelistedOracles.keys())[i];
      await testHelper.transaction(testHelper.oracles[oracleName], async () => {
        await testHelper.engine.contract.submitPrice(
          prices[i],
          testHelper.whitelist
        );
      });
    }

    //update fallback price
    await testHelper.transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateFallbackPrice(
          TestAmounts.PRICE_2_USD
        );
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );

    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    await testHelper.transaction(testHelper.deployer, async () => {
      await testHelper.engine.contract.settlePriceUpdate();
    });

    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    const priceBeforeSettlement = await testHelper.engine.contract.getMinaPrice();
    assert.strictEqual(
      priceBeforeSettlement.toString(),
      TestAmounts.PRICE_52_CENT.add(TestAmounts.PRICE_2_USD)
        .div(UInt64.from(2))
        .toString()
    );
  });

  it('should handle maximum number of prices correctly', async () => {
    await testHelper.transaction(
      testHelper.deployer,
      async () => {
        await testHelper.engine.contract.updateOracleWhitelist(
          testHelper.whitelist
        );
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );

    for (let i = 0; i < ZkUsdEngine.MAX_PARTICIPANTS; i++) {
      const oracleName = Array.from(testHelper.whitelistedOracles.keys())[i];
      const price = UInt64.from((0.48 + i * 0.01) * 1e9); // Prices from 0.48 to 0.57 USD
      const oracle = testHelper.oracles[oracleName];
      const tx = await Mina.transaction(
        {
          sender: oracle.publicKey,
        },
        async () => {
          await testHelper.engine.contract.submitPrice(
            price,
            testHelper.whitelist
          );
        }
      )
        .prove()
        .sign([oracle.privateKey])
        .send();
    }

    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    await testHelper.transaction(testHelper.deployer, async () => {
      await testHelper.engine.contract.settlePriceUpdate();
    });

    testHelper.Local.setBlockchainLength(
      testHelper.Local.getNetworkState().blockchainLength.add(1)
    );

    const price = await testHelper.engine.contract.getMinaPrice();
    const expectedMedian = UInt64.from(0.515 * 1e9); // 0.515 USD
    assert.strictEqual(price.toString(), expectedMedian.toString());
  });
});
