import {
  PublicKey,
  SmartContract,
  state,
  State,
  UInt64,
  Field,
  method,
  Provable,
} from 'o1js';
import { LiquidationResults, VaultState } from './types.js';
/**
 * @title   zkUSD Collateral Vault contact
 * @notice  This contract tracks the state of a user's vault. It is installed on the token account of the engine.
 *          All interaction with the vault is done through the engine.
 * @notice  The vaults track users deposits of collateral in the form of MINA and debt in the form of zkUSD.
 *          The stablecoins peg is maintained by ensuring the vault always has more than 150% collateralization ratio. If the vault is undercollateralized,
 *          then anyone can liquidate the vault by repaying the debt within it. The liquidator will receive the collateral in return.
 *
 */

// Errors
export const ZkUsdVaultErrors = {
  AMOUNT_ZERO: 'Transaction amount must be greater than zero',
  HEALTH_FACTOR_TOO_LOW:
    'Vault would become undercollateralized (health factor < 100). Add more collateral or reduce debt first',
  HEALTH_FACTOR_TOO_HIGH:
    'Cannot liquidate: Vault is sufficiently collateralized (health factor > 100)',
  AMOUNT_EXCEEDS_DEBT:
    'Cannot repay more than the current outstanding debt amount',
  INVALID_ORACLE_SIG: 'Invalid price feed signature from oracle',
  ORACLE_EXPIRED:
    'Price feed data has expired - please use current oracle data',
  INSUFFICIENT_BALANCE: 'Requested amount exceeds the vaults zkUSD balance',
  INSUFFICIENT_COLLATERAL:
    'Requested amount exceeds the deposited collateral in the vault ',
};

export class ZkUsdVault extends SmartContract {
  @state(UInt64) collateralAmount = State<UInt64>(); // The amount of collateral in the vault
  @state(UInt64) debtAmount = State<UInt64>(); // The current amount of zkUSD that has been minted by this vault
  @state(PublicKey) owner = State<PublicKey>(); // The owner of the vault

  static COLLATERAL_RATIO = Field.from(150); // The collateral ratio is the minimum ratio of collateral to debt that the vault must maintain
  static COLLATERAL_RATIO_PRECISION = Field.from(100); // The precision of the collateral ratio
  static PROTOCOL_FEE_PRECISION = UInt64.from(100); // The precision of the protocol fee
  static UNIT_PRECISION = Field.from(1e9); // The precision of the unit - Mina has 9 decimal places
  static MIN_HEALTH_FACTOR = UInt64.from(100); // The minimum health factor that the vault must maintain when adjusted
  static LIQUIDATION_BONUS_RATIO = Field.from(110); // The value ratio of the liquidation

  /**
   * @notice  This method is used to update the owner of the vault
   * @param   newOwner - The new owner of the vault
   * @param   owner - The current owner of the vault
   */
  @method public async updateOwner(newOwner: PublicKey, owner: PublicKey) {
    //Preconditions
    let vaultOwner = this.owner.getAndRequireEquals();

    //Assert the owner is correct
    vaultOwner.assertEquals(owner);

    //Update the owner
    this.owner.set(newOwner);
  }

  /**
   * @notice  This method is used to deposit collateral into the vault
   * @param   amount - The amount of collateral to deposit
   * @param   secret - The secret of the owner of the vault
   */
  @method.returns(VaultState)
  public async depositCollateral(
    amount: UInt64,
    owner: PublicKey
  ): Promise<VaultState> {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let vaultOwner = this.owner.getAndRequireEquals();

    //Assert the owner is correct
    vaultOwner.assertEquals(owner);

    //assert amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Update the collateral amount
    this.collateralAmount.set(collateralAmount.add(amount));

    return new VaultState({
      collateralAmount: collateralAmount.add(amount),
      debtAmount: debtAmount,
      owner: owner,
    });
  }

  /**
   * @notice  This method is used to issue zkUSD to the vault
   * @param   amount - The amount of zkUSD to mint
   * @param   owner - The vault owner
   * @param   minaPrice - The MINA/USD price
   */
  @method.returns(VaultState)
  public async mintZkUsd(
    amount: UInt64,
    owner: PublicKey,
    minaPrice: UInt64
  ): Promise<VaultState> {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let vaultOwner = this.owner.getAndRequireEquals();

    //Assert the amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Assert the owner is correct
    vaultOwner.assertEquals(owner);

    //Calculate the health factor
    const healthFactor = this.calculateHealthFactor(
      collateralAmount,
      debtAmount.add(amount), // Add the amount they want to mint to the debt
      minaPrice
    );

    //Assert the health factor is greater than the minimum health factor
    healthFactor.assertGreaterThanOrEqual(
      ZkUsdVault.MIN_HEALTH_FACTOR,
      ZkUsdVaultErrors.HEALTH_FACTOR_TOO_LOW
    );

    //Update the debt amount
    this.debtAmount.set(debtAmount.add(amount));

    return new VaultState({
      collateralAmount: collateralAmount,
      debtAmount: debtAmount.add(amount),
      owner: owner,
    });
  }

  /**
   * @notice  This method is used to redeem collateral from the vault
   * @param   amount - The amount of zkUSD to mint
   * @param   owner - The vault owner
   * @param   minaPrice - The MINA/USD price
   */
  @method.returns(VaultState)
  public async redeemCollateral(
    amount: UInt64,
    owner: PublicKey,
    minaPrice: UInt64
  ) {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let vaultOwner = this.owner.getAndRequireEquals();

    //Assert the owner is correct
    vaultOwner.assertEquals(owner);

    //Assert the amount is less than or equal to the collateral amount
    amount.assertLessThanOrEqual(
      collateralAmount,
      ZkUsdVaultErrors.INSUFFICIENT_COLLATERAL
    );

    //assert amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Calculate the USD value of the collateral after redemption
    const remainingCollateral = collateralAmount.sub(amount);

    //Calculate the health factor
    const healthFactor = this.calculateHealthFactor(
      remainingCollateral,
      debtAmount,
      minaPrice
    );

    //Assert the health factor is greater than the minimum health factor
    healthFactor.assertGreaterThanOrEqual(
      ZkUsdVault.MIN_HEALTH_FACTOR,
      ZkUsdVaultErrors.HEALTH_FACTOR_TOO_LOW
    );

    //Update the collateral amount
    this.collateralAmount.set(remainingCollateral);

    return new VaultState({
      collateralAmount: remainingCollateral,
      debtAmount: debtAmount,
      owner: owner,
    });
  }

  /**
   * @notice  This method is used to burn zkUSD by the vault
   * @param   amount - The amount of zkUSD to burn
   * @param   owner - The owner of the vault
   */
  @method.returns(VaultState)
  public async burnZkUsd(amount: UInt64, owner: PublicKey) {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let vaultOwner = this.owner.getAndRequireEquals();

    //Assert the amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Assert the owner is correct
    vaultOwner.assertEquals(owner);

    //Assert the amount is less than the debt amount
    debtAmount.assertGreaterThanOrEqual(
      amount,
      ZkUsdVaultErrors.AMOUNT_EXCEEDS_DEBT
    );

    //Update the debt amount
    this.debtAmount.set(debtAmount.sub(amount));

    return new VaultState({
      collateralAmount: collateralAmount,
      debtAmount: debtAmount.sub(amount),
      owner: owner,
    });
  }

  /**
   * @notice  This method is used to liquidate the vault. It doesn't require the secret and can be called by anyone
   *          as long as the health factor is less than the minimum health factor. The liquidator receives the collateral in return.
   */
  @method.returns(LiquidationResults)
  public async liquidate(minaPrice: UInt64) {
    //Preconditions
    const collateralAmount = this.collateralAmount.getAndRequireEquals();
    const debtAmount = this.debtAmount.getAndRequireEquals();

    //Calculate the health factor
    const healthFactor = this.calculateHealthFactor(
      collateralAmount,
      debtAmount,
      minaPrice
    );

    //Assert the health factor is less than the minimum health factor
    healthFactor.assertLessThanOrEqual(
      ZkUsdVault.MIN_HEALTH_FACTOR,
      ZkUsdVaultErrors.HEALTH_FACTOR_TOO_HIGH
    );

    //Update the collateral amount
    this.collateralAmount.set(UInt64.zero);

    //Update the debt amount
    this.debtAmount.set(UInt64.zero);

    // compute the collateral to be sent to the liquidator and the vault owner
    const { liquidatorCollateral, vaultOwnerCollateral } =
      await this.computeLiquidationAmounts({
        collateralAmount: collateralAmount.value,
        liquidatedDebt: debtAmount.value,
        minaPrice: minaPrice.value,
      });

    //Return the vault state before liquidation
    const oldVaultState = {
      collateralAmount: collateralAmount,
      debtAmount: debtAmount,
      owner: this.owner.getAndRequireEquals(),
    };

    return new LiquidationResults({
      oldVaultState,
      liquidatorCollateral: UInt64.Unsafe.fromField(liquidatorCollateral), // are we okay being usafe here? whats the policy on Field vs UInt64
      vaultOwnerCollateral: UInt64.Unsafe.fromField(vaultOwnerCollateral),
    });
  }

  /**
   * @notice  This method is used to get the health factor of the vault
   * @param   minaPrice - MINA/USD price
   * @returns The health factor of the vault
   */
  @method.returns(UInt64)
  public async getHealthFactor(minaPrice: UInt64): Promise<UInt64> {
    const collateralAmount = this.collateralAmount.getAndRequireEquals();
    const debtAmount = this.debtAmount.getAndRequireEquals();
    return this.calculateHealthFactor(collateralAmount, debtAmount, minaPrice);
  }

  /**
   * @notice  This method is used to calculate the health factor of the vault.
   *          We calculate the health factor by dividing the maximum allowed debt by the debt amount.
   *          The health factor is a normalised mesaure of the "healthiness" of the vault.
   *
   *          A health factor > 100 is over collateralised
   *          A health factor < 100 is under collateralised and will be liquidated
   *
   * @param   collateralAmount - The amount of collateral
   * @param   debtAmount - The amount of debt
   * @param   minaPrice - MINA/USD price
   * @returns The health factor of the vault
   */
  public calculateHealthFactor(
    collateralAmount: UInt64,
    debtAmount: UInt64,
    minaPrice: UInt64
  ): UInt64 {
    const collateralValue = this.calculateUsdValue(
      collateralAmount.value,
      minaPrice.value
    );
    const maxAllowedDebt = this.calculateMaxAllowedDebt(collateralValue);
    const debtInFields = debtAmount.toFields()[0];
    return UInt64.fromFields([this.safeDiv(maxAllowedDebt, debtInFields)]);
  }

  /**
   * @notice  This method is used to calculate the USD value of the collateral
   * @param   amount - The amount of collateral
   * @param   minaPrice - MINA/USD price
   * @returns The USD value of the collateral
   */
  private calculateUsdValue(amount: Field, minaPrice: Field): Field {
    return this.fieldIntegerDiv(
      amount.mul(minaPrice),
      ZkUsdVault.UNIT_PRECISION
    );
  }

  /**
   * @notice  Calculates the equivalent MINA value for a given USD amount based on the current USD price.
   * @param   usdValue - The USD amount to be converted.
   * @param   minaPrice - The current MINA/USD price.
   * @returns The calculated MINA value corresponding to the provided USD amount.
   */
  private calculateMinaValue(usdValue: Field, minaPrice: Field): Field {
    return this.fieldIntegerDiv(
      usdValue.mul(ZkUsdVault.UNIT_PRECISION),
      minaPrice
    );
  }

  /**
   * @notice  This method is used to calculate the maximum allowed debt based on the collateral value
   * @param   collateralValue - The USD value of the collateral
   * @returns The maximum allowed debt based on our collateral ratio - which is 150%
   */
  private calculateMaxAllowedDebt(collateralValue: Field): Field {
    const numCollateralValue = collateralValue.mul(
      ZkUsdVault.COLLATERAL_RATIO_PRECISION
    );

    const maxAllowedDebt = this.fieldIntegerDiv(
      numCollateralValue,
      ZkUsdVault.COLLATERAL_RATIO
    ).mul(ZkUsdVault.COLLATERAL_RATIO_PRECISION);

    return maxAllowedDebt;
  }

  /**
   * @notice  Computes the amounts of collateral to be sent to the liquidator and the vault owner
   *          during a liquidation process.
   * @param   args - An object containing the following properties:
   *           - collateralAmount: The total amount of collateral in the vault (UInt64).
   *           - liquidatedDebt: The amount of debt to be liquidated from the vault (UInt64).
   *           - minaPrice: The USD price of the collateral (UInt64).
   * @returns A promise that resolves to an object containing:
   *           - liquidatorCollateral: The amount of collateral to be sent to the liquidator.
   *           - ownerCollateral: The remaining collateral to be returned to the vault owner.
   */
  private async computeLiquidationAmounts(args: {
    collateralAmount: Field;
    liquidatedDebt: Field;
    minaPrice: Field;
  }) {
    // TODO verify rounding and precision
    const { collateralAmount, liquidatedDebt, minaPrice } = args;

    // Calculate the USD value of the collateral
    const liquidatedDebtMina = this.calculateMinaValue(
      liquidatedDebt,
      minaPrice
    );

    const liquidatorMaxCollateral = this.fieldIntegerDiv(
      liquidatedDebtMina.mul(ZkUsdVault.LIQUIDATION_BONUS_RATIO),
      Field(100)
    );

    // Calculate the USD value of the collateral that the liquidator will get
    const liquidatorCollateral = Provable.if(
      collateralAmount.greaterThanOrEqual(liquidatorMaxCollateral),
      liquidatorMaxCollateral,
      collateralAmount
    );

    // Calculate the collateral amount that the vault owner will get
    const vaultOwnerCollateral = collateralAmount.sub(liquidatorCollateral);

    return { liquidatorCollateral, vaultOwnerCollateral };
  }

  /**
   * @notice  This method is used to perform integer division on fields
   * @param   x - The numerator
   * @param   y - The denominator
   * @returns The quotient of the division
   */
  private fieldIntegerDiv(x: Field, y: Field): Field {
    // Ensure y is not zero to avoid division by zero
    y.assertNotEquals(Field(0), 'Division by zero');

    // Witness the quotient q = floor(x / y)
    const q = Provable.witness(Field, () => {
      const xn = x.toBigInt();
      const yn = y.toBigInt();
      const qn = xn / yn; // Integer division
      return Field(qn);
    });

    // Compute the remainder r = x - q * y
    const r = x.sub(q.mul(y));

    // Add constraints to ensure x = q * y + r, and 0 ≤ r < y
    r.assertGreaterThanOrEqual(Field(0));
    r.assertLessThan(y);

    // Enforce the relation x = q * y + r
    x.assertEquals(q.mul(y).add(r));

    // Return the quotient q
    return q;
  }

  /**
   * @notice  This method is used to safely divide two fields (incase we have a zero denominator)
   * @param   numerator - The numerator
   * @param   denominator - The denominator
   * @returns The quotient of the division
   */
  private safeDiv(numerator: Field, denominator: Field): Field {
    const isDenominatorZero = denominator.equals(Field(0));
    const safeDenominator = Provable.if(
      isDenominatorZero,
      Field(1),
      denominator
    );

    const divisionResult = this.fieldIntegerDiv(numerator, safeDenominator);

    return Provable.if(
      isDenominatorZero,
      UInt64.MAXINT().toFields()[0],
      divisionResult
    );
  }
}
