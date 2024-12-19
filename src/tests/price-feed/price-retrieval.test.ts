import { UInt32 } from 'o1js';
import { TestAmounts, TestHelper } from '../test-helper.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('zkUSD Price Feed Oracle Price Retrieval Test Suite', () => {
  const testHelper = new TestHelper();

  before(async () => {
    await testHelper.initChain();
    await testHelper.deployTokenContracts();
    testHelper.createAgents(['alice']);
  });

  it('should retrieve the even price if we are on an even block', async () => {
    testHelper.Local.setBlockchainLength(UInt32.from(2));
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_52_CENT);
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_48_CENT);

    //odd should be 52 cent, even should be 48 cent

    testHelper.Local.setBlockchainLength(UInt32.from(4));

    const price = await testHelper.engine.contract.getMinaPrice();

    assert.strictEqual(price.toString(), TestAmounts.PRICE_48_CENT.toString());
  });

  it('should retrieve the odd price if we are on an odd block', async () => {
    testHelper.Local.setBlockchainLength(UInt32.from(2));
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_52_CENT);
    await testHelper.updateOracleMinaPrice(TestAmounts.PRICE_48_CENT);

    //odd should be 52 cent, even should be 48 cent

    testHelper.Local.setBlockchainLength(UInt32.from(4));

    const price = await testHelper.engine.contract.getMinaPrice();

    assert.strictEqual(price.toString(), TestAmounts.PRICE_48_CENT.toString());
  });
});
