import {
  Bool,
  method,
  Provable,
  SmartContract,
  state,
  State,
  Struct,
  UInt32,
  UInt64,
} from 'o1js';

/**
 * @title   zkUSD Master Oracle contract
 * @notice  This contract is used to manage the fallback price of the zkUSD system.
 *          It is installed on the token account of the engine. The fallback price is used
 *          as a protocol safety net incase there is an issue with the oracle submissions.
 *
 */

// Errors
export const ZkUsdMasterOracleErrors = {
  AMOUNT_ZERO: 'Amount must be greater than zero',
};

export class ZkUsdMasterOracle extends SmartContract {
  @state(UInt64) fallbackPriceEvenBlock = State<UInt64>();
  @state(UInt64) fallbackPriceOddBlock = State<UInt64>();

  /**
   * @notice  Updates the fallback price which is used if we don't have enough oracle submissions to calculate a median
   * @param   price The new fallback price
   */
  @method async updateFallbackPrice(price: UInt64) {
    //Preconditions
    const currentPrices = this.getAndRequireCurrentFallbackPrices();
    const { isOddBlock } = this.getBlockInfo();

    //Ensure price is greater than zero
    price
      .greaterThan(UInt64.zero)
      .assertTrue(ZkUsdMasterOracleErrors.AMOUNT_ZERO);

    //Update the fallback price based on the current block
    const { evenPrice, oddPrice } = this.updateBlockMinaPrices(
      isOddBlock,
      price,
      currentPrices
    );

    //Set the new fallback price
    this.fallbackPriceEvenBlock.set(evenPrice);
    this.fallbackPriceOddBlock.set(oddPrice);
  }

  /**
   * @notice  Returns the current fallback price
   * @returns The fallback price based on the current block
   */
  @method.returns(UInt64)
  async getFallbackPrice() {
    //Preconditions
    const { isOddBlock } = this.getBlockInfo();
    const prices = this.getCurrentFallbackPrices();

    this.fallbackPriceOddBlock.requireEqualsIf(isOddBlock, prices.odd);
    this.fallbackPriceEvenBlock.requireEqualsIf(isOddBlock.not(), prices.even);

    return Provable.if(isOddBlock, prices.odd, prices.even);
  }

  /**
   * @notice  Returns the current block info to be used to set the isOddBlock flag
   * @returns The current block length and the isOddBlock flag
   */
  private getBlockInfo(): { blockchainLength: UInt32; isOddBlock: Bool } {
    const blockchainLength =
      this.network.blockchainLength.getAndRequireEquals();
    const isOddBlock = blockchainLength.mod(2).equals(UInt32.from(1));
    return { blockchainLength, isOddBlock };
  }

  /**
   * @notice  Helper function to return the current fallback prices
   * @returns The current fallback prices
   */
  private getCurrentFallbackPrices(): { even: UInt64; odd: UInt64 } {
    return {
      even: this.fallbackPriceEvenBlock.get(),
      odd: this.fallbackPriceOddBlock.get(),
    };
  }

  /**
   * @notice  Helper function to return the current fallback prices and set the preconditions
   * @returns The current fallback prices
   */
  private getAndRequireCurrentFallbackPrices(): {
    even: UInt64;
    odd: UInt64;
  } {
    return {
      even: this.fallbackPriceEvenBlock.getAndRequireEquals(),
      odd: this.fallbackPriceOddBlock.getAndRequireEquals(),
    };
  }

  /**
   * @notice  Updates the price based on the current block, if we are on an odd block, we update the even price, otherwise we update the odd price
   * @param   isOddBlock The isOddBlock flag
   * @param   newPrice The new price
   * @param   currentPrices The current prices
   * @returns The updated prices
   */
  private updateBlockMinaPrices(
    isOddBlock: Bool,
    newPrice: UInt64,
    currentPrices: { even: UInt64; odd: UInt64 }
  ) {
    const evenPrice = Provable.if(isOddBlock, newPrice, currentPrices.even);
    const oddPrice = Provable.if(isOddBlock.not(), newPrice, currentPrices.odd);
    return { evenPrice, oddPrice };
  }
}
