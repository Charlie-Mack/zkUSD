import {
  DeployArgs,
  PublicKey,
  SmartContract,
  state,
  State,
  UInt64,
  Permissions,
  Field,
  Poseidon,
  method,
  AccountUpdate,
  Bool,
  Provable,
  Struct,
} from 'o1js';
import { ZkUsdPriceFeedOracle } from './zkusd-price-feed-oracle';
import { ZkUsdToken } from './zkusd-token';
import { ZkUsdProtocolVault } from './zkusd-protocol-vault';

/**
 * @title   zkUSD Collateral Vault contact
 * @notice  This contract is used to govern the rules of interaction with the zkUSD system.
 *          It allows users to deposit collateral in the form of MINA and mint zkUSD that is pegged to the dollar.
 *          The peg is maintained by ensuring the vault always has more than 150% collateralization ratio. If the vault is undercollateralized,
 *          then anyone can liquidate the vault by repaying the debt within it. The liquidator will receive the collateral in return.
 * @notice  Each vault is deployed and owned by a user. zkUSD can only be minted when sufficent proofs have been generated by an instance of this contract.
 *
 */

// Errors
export const ZkUsdVaultErrors = {
  AMOUNT_ZERO: 'Transaction amount must be greater than zero',
  BALANCE_ZERO: 'Vault balance must be greater than zero',
  HEALTH_FACTOR_TOO_LOW:
    'Vault would become undercollateralized (health factor < 100). Add more collateral or reduce debt first',
  HEALTH_FACTOR_TOO_HIGH:
    'Cannot liquidate: Vault is sufficiently collateralized (health factor > 100)',
  AMOUNT_EXCEEDS_DEBT:
    'Cannot repay more than the current outstanding debt amount',
  INVALID_SECRET: 'Access denied: Invalid ownership secret provided',
  INVALID_ORACLE_SIG: 'Invalid price feed signature from oracle',
  ORACLE_EXPIRED:
    'Price feed data has expired - please use current oracle data',
  INSUFFICIENT_BALANCE: 'Requested amount exceeds the vaults zkUSD balance',
  INSUFFICIENT_COLLATERAL:
    'Requested amount exceeds the deposited collateral in the vault ',
};

// Events
export class NewVaultEvent extends Struct({
  vaultAddress: PublicKey,
}) {}

export class DepositCollateralEvent extends Struct({
  vaultAddress: PublicKey,
  amountDeposited: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
}) {}

export class RedeemCollateralEvent extends Struct({
  vaultAddress: PublicKey,
  amountRedeemed: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
}) {}

export class MintZkUsdEvent extends Struct({
  vaultAddress: PublicKey,
  amountMinted: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
}) {}

export class BurnZkUsdEvent extends Struct({
  vaultAddress: PublicKey,
  amountBurned: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
}) {}

export class LiquidateEvent extends Struct({
  vaultAddress: PublicKey,
  liquidator: PublicKey,
  vaultCollateralLiquidated: UInt64,
  vaultDebtRepaid: UInt64,
  price: UInt64,
}) {}

export class ZkUsdVault extends SmartContract {
  @state(UInt64) collateralAmount = State<UInt64>(); // The amount of collateral in the vault
  @state(UInt64) debtAmount = State<UInt64>(); // The current amount of zkUSD that has been minted by this vault
  @state(Field) ownershipHash = State<Field>(); // The hash of the ownership secret of the vault - this is so that anyone with the secret can interact with the vault
  @state(Bool) interactionFlag = State<Bool>(Bool(false)); // This flag is used to ensure that only zkUSD vault contracts can interact with the zkUSD token contract

  static COLLATERAL_RATIO = Field.from(150); // The collateral ratio is the minimum ratio of collateral to debt that the vault must maintain
  static COLLATERAL_RATIO_PRECISION = Field.from(100); // The precision of the collateral ratio
  static PROTOCOL_FEE_PRECISION = UInt64.from(100); // The precision of the protocol fee
  static UNIT_PRECISION = Field.from(1e9); // The precision of the unit - Mina has 9 decimal places
  static MIN_HEALTH_FACTOR = UInt64.from(100); // The minimum health factor that the vault must maintain when adjusted

  //The public keys of our main contracts are hard coded so we dont have to hold them in the contract state
  static ORACLE_PUBLIC_KEY = PublicKey.fromBase58(
    'B62qkwLvZ6e5NzRgQwkTaA9m88fTUZLHmpwvmCQEqbp5KcAAfqFAaf9'
  );
  static ZKUSD_TOKEN_ADDRESS = PublicKey.fromBase58(
    'B62qry2wngUSGZqQn9erfnA9rZPn4cMbDG1XPasGdK1EtKQAxmgjDtt'
  );
  static PROTOCOL_VAULT_ADDRESS = PublicKey.fromBase58(
    'B62qkJvkDUiw1c7kKn3PBa9YjNFiBgSA6nbXUJiVuSU128mKH4DiSih'
  );

  static ZkUsdProtocolVaultContract: new (...args: any) => ZkUsdProtocolVault =
    ZkUsdProtocolVault;

  readonly events = {
    NewVault: NewVaultEvent,
    DepositCollateral: DepositCollateralEvent,
    RedeemCollateral: RedeemCollateralEvent,
    MintZkUsd: MintZkUsdEvent,
    BurnZkUsd: BurnZkUsdEvent,
    Liquidate: LiquidateEvent,
  };

  /**
   * @notice  This method is used to deploy the vault contract
   * @param   secret - The secret set by the owner of the vault. Whoever has the secret can interact with the vault.
   */
  async deploy(args: DeployArgs & { secret: Field }) {
    await super.deploy(args);
    // Set permissions to prevent unauthorized updates
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
      send: Permissions.proof(),
    });

    this.collateralAmount.set(UInt64.from(0));
    this.debtAmount.set(UInt64.from(0));

    const ownershipHash = Poseidon.hash(args.secret.toFields());
    this.ownershipHash.set(ownershipHash);

    //Emit the NewVault event
    this.emitEvent(
      'NewVault',
      new NewVaultEvent({
        vaultAddress: this.address,
      })
    );
  }

  /**
   * @notice  This method is used to deposit collateral into the vault
   * @param   amount - The amount of collateral to deposit
   * @param   secret - The secret of the owner of the vault
   */
  @method public async depositCollateral(amount: UInt64, secret: Field) {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let ownershipHash = this.ownershipHash.getAndRequireEquals();

    //assert amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Assert the ownership secret is correct
    ownershipHash.assertEquals(
      Poseidon.hash(secret.toFields()),
      ZkUsdVaultErrors.INVALID_SECRET
    );

    //Create the account update for the collateral deposit
    const collateralDeposit = AccountUpdate.createSigned(
      this.sender.getAndRequireSignatureV2()
    );

    collateralDeposit.send({
      to: this.address,
      amount: amount,
    });

    //Update the collateral amount
    this.collateralAmount.set(collateralAmount.add(amount));

    //Emit the DepositCollateral event
    this.emitEvent(
      'DepositCollateral',
      new DepositCollateralEvent({
        vaultAddress: this.address,
        amountDeposited: amount,
        vaultCollateralAmount: collateralAmount,
        vaultDebtAmount: debtAmount,
      })
    );
  }

  /**
   * @notice  This method is used to redeem collateral from the vault
   * @param   amount - The amount of collateral to redeem
   * @param   secret - The secret of the owner of the vault
   */
  @method public async redeemCollateral(amount: UInt64, secret: Field) {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let ownershipHash = this.ownershipHash.getAndRequireEquals();
    let balance = this.account.balance.getAndRequireEquals();

    //Get the current price from the oracle
    const oracle = new ZkUsdPriceFeedOracle(ZkUsdVault.ORACLE_PUBLIC_KEY);
    const price = await oracle.getPrice();

    //Get the protocol vault
    const protocolVault = new ZkUsdProtocolVault(
      ZkUsdVault.PROTOCOL_VAULT_ADDRESS
    );

    //assert balance is greater than 0
    balance.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.BALANCE_ZERO);

    //Assert the ownership secret is correct
    ownershipHash.assertEquals(
      Poseidon.hash(secret.toFields()),
      ZkUsdVaultErrors.INVALID_SECRET
    );

    //Assert the amount is less than or equal to the collateral amount
    amount.assertLessThanOrEqual(
      collateralAmount,
      ZkUsdVaultErrors.INSUFFICIENT_COLLATERAL
    );

    //Calculate the USD value of the collateral after redemption
    const remainingCollateral = collateralAmount.sub(amount);

    //Calculate the health factor
    const healthFactor = this.calculateHealthFactor(
      remainingCollateral,
      debtAmount,
      price
    );

    //Assert the health factor is greater than the minimum health factor
    healthFactor.assertGreaterThanOrEqual(
      ZkUsdVault.MIN_HEALTH_FACTOR,
      ZkUsdVaultErrors.HEALTH_FACTOR_TOO_LOW
    );

    //Check if there are any staking rewards: Whatever the balance is above the collateral amount is the staking rewards
    const stakingRewards = balance.sub(collateralAmount);

    //Get the protocol fee from the protocol vault
    const currentProtocolFee = await protocolVault.getProtocolFee();

    //Calculate the protocol fee from the staking rewards
    const protocolFee = stakingRewards
      .mul(currentProtocolFee)
      .div(ZkUsdVault.PROTOCOL_FEE_PRECISION);

    //If there are staking rewards, send the protocol fee to the protocol vault
    let protocolFeeUpdate = AccountUpdate.createIf(
      protocolFee.greaterThan(UInt64.from(0)),
      ZkUsdVault.PROTOCOL_VAULT_ADDRESS
    );

    protocolFeeUpdate.balance.addInPlace(protocolFee);
    this.balance.subInPlace(protocolFee);

    //Send the remaining staking rewards to the owner
    const stakingRewardsDividend = stakingRewards.sub(protocolFee);

    //Send the collateral back to the sender including the staking rewards
    this.send({
      to: this.sender.getAndRequireSignatureV2(),
      amount: amount.add(stakingRewardsDividend),
    });

    //Update the collateral amount
    this.collateralAmount.set(remainingCollateral);

    //Emit the WithdrawZkUsd event
    this.emitEvent(
      'RedeemCollateral',
      new RedeemCollateralEvent({
        vaultAddress: this.address,
        amountRedeemed: amount,
        vaultCollateralAmount: collateralAmount,
        vaultDebtAmount: debtAmount,
      })
    );
  }

  /**
   * @notice  This method is used to mint zkUSD by the vault
   * @param   recipient - The recipient of the zkUSD
   * @param   amount - The amount of zkUSD to mint
   * @param   secret - The secret of the owner of the vault
   */
  @method public async mintZkUsd(
    recipient: PublicKey,
    amount: UInt64,
    secret: Field
  ) {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let ownershipHash = this.ownershipHash.getAndRequireEquals();

    //Get the current price from the oracle
    const oracle = new ZkUsdPriceFeedOracle(ZkUsdVault.ORACLE_PUBLIC_KEY);
    const price = await oracle.getPrice();

    //Get the zkUSD token contract
    const zkUSD = new ZkUsdToken(ZkUsdVault.ZKUSD_TOKEN_ADDRESS);

    //Assert the amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Assert the ownership secret is correct
    ownershipHash.assertEquals(
      Poseidon.hash(secret.toFields()),
      ZkUsdVaultErrors.INVALID_SECRET
    );

    //Calculate the health factor
    const healthFactor = this.calculateHealthFactor(
      collateralAmount,
      debtAmount.add(amount), // Add the amount they want to mint to the debt
      price
    );

    //Assert the health factor is greater than the minimum health factor
    healthFactor.assertGreaterThanOrEqual(
      ZkUsdVault.MIN_HEALTH_FACTOR,
      ZkUsdVaultErrors.HEALTH_FACTOR_TOO_LOW
    );

    //Mint the zkUSD for the recipient
    await zkUSD.mint(recipient, amount, this.self);

    //Update the debt amount
    this.debtAmount.set(debtAmount.add(amount));

    //Set the interaction flag so that the zkUSD token contract knows it is being called from the vault
    this.interactionFlag.set(Bool(true));

    //Emit the MintZkUsd event
    this.emitEvent(
      'MintZkUsd',
      new MintZkUsdEvent({
        vaultAddress: this.address,
        amountMinted: amount,
        vaultCollateralAmount: collateralAmount,
        vaultDebtAmount: debtAmount,
      })
    );
  }

  /**
   * @notice  This method is used to burn zkUSD by the vault
   * @param   amount - The amount of zkUSD to burn
   * @param   secret - The secret of the owner of the vault
   */
  @method public async burnZkUsd(amount: UInt64, secret: Field) {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();
    let ownershipHash = this.ownershipHash.getAndRequireEquals();

    //Get the zkUSD token
    const zkUsd = new ZkUsdToken(ZkUsdVault.ZKUSD_TOKEN_ADDRESS);

    //Assert the amount is greater than 0
    amount.assertGreaterThan(UInt64.zero, ZkUsdVaultErrors.AMOUNT_ZERO);

    //Assert the ownership secret is correct
    ownershipHash.assertEquals(
      Poseidon.hash(secret.toFields()),
      ZkUsdVaultErrors.INVALID_SECRET
    );

    //Assert the amount is less than the debt amount
    debtAmount.assertGreaterThanOrEqual(
      amount,
      ZkUsdVaultErrors.AMOUNT_EXCEEDS_DEBT
    );

    //Update the debt amount
    this.debtAmount.set(debtAmount.sub(amount));

    //Burn the zkUsd
    await zkUsd.burn(this.sender.getAndRequireSignatureV2(), amount);

    //Emit the BurnZkUsd event
    this.emitEvent(
      'BurnZkUsd',
      new BurnZkUsdEvent({
        vaultAddress: this.address,
        amountBurned: amount,
        vaultCollateralAmount: collateralAmount,
        vaultDebtAmount: debtAmount,
      })
    );
  }

  /**
   * @notice  This method is used to liquidate the vault. It doesn't require the secret and can be called by anyone
   *          as long as the health factor is less than the minimum health factor. The liquidator receives the collateral in return.
   */
  @method public async liquidate() {
    //Preconditions
    let collateralAmount = this.collateralAmount.getAndRequireEquals();
    let debtAmount = this.debtAmount.getAndRequireEquals();

    //Get the current price from the oracle
    const oracle = new ZkUsdPriceFeedOracle(ZkUsdVault.ORACLE_PUBLIC_KEY);
    const price = await oracle.getPrice();

    //Get the zkUSD token
    const zkUSD = new ZkUsdToken(ZkUsdVault.ZKUSD_TOKEN_ADDRESS);

    //Calculate the health factor
    const healthFactor = this.calculateHealthFactor(
      collateralAmount,
      debtAmount,
      price
    );

    //Assert the health factor is less than the minimum health factor
    healthFactor.assertLessThanOrEqual(
      ZkUsdVault.MIN_HEALTH_FACTOR,
      ZkUsdVaultErrors.HEALTH_FACTOR_TOO_HIGH
    );

    //Send the collateral to the liquidator
    this.send({
      to: this.sender.getAndRequireSignatureV2(),
      amount: collateralAmount,
    });

    //Update the collateral amount
    this.collateralAmount.set(UInt64.zero);

    //Burn the zkUSD - we already have the signature from the liquidator
    await zkUSD.burn(this.sender.getUnconstrainedV2(), debtAmount);

    //Update the debt amount
    this.debtAmount.set(UInt64.zero);

    //Emit the Liquidate event
    this.emitEvent(
      'Liquidate',
      new LiquidateEvent({
        vaultAddress: this.address,
        liquidator: this.sender.getUnconstrainedV2(),
        vaultCollateralLiquidated: collateralAmount,
        vaultDebtRepaid: debtAmount,
        price: price,
      })
    );
  }

  /**
   * @notice  This method is used to get the health factor of the vault
   * @returns The health factor of the vault
   */
  @method.returns(UInt64)
  public async getHealthFactor() {
    //Get the current price from the oracle
    const oracle = new ZkUsdPriceFeedOracle(ZkUsdVault.ORACLE_PUBLIC_KEY);
    const price = await oracle.getPrice();

    return this.calculateHealthFactor(
      this.collateralAmount.getAndRequireEquals(),
      this.debtAmount.getAndRequireEquals(),
      price
    );
  }

  /**
   * @notice  This method is used to assert the interaction flag, this is used to ensure that the zkUSD token contract knows it is being called from the vault
   * @returns True if the flag is set
   */
  @method.returns(Bool)
  public async assertInteractionFlag() {
    this.interactionFlag.requireEquals(Bool(true));
    this.interactionFlag.set(Bool(false));
    return Bool(true);
  }

  /**
   * @notice  This method is used to calculate the health factor of the vault.
   *          We calculate the health factor by dividing the maximum allowed debt by the debt amount.
   *          The health factor is a normalised mesaure of the "healthyness" of the vault.
   *
   *          A health factor > 100 is over collateralised
   *          A health factor < 100 is under collateralised and will be liquidated
   *
   * @param   collateralAmount - The amount of collateral
   * @param   debtAmount - The amount of debt
   * @param   price - The price of the collateral
   * @returns The health factor of the vault
   */
  public calculateHealthFactor(
    collateralAmount: UInt64,
    debtAmount: UInt64,
    price: UInt64
  ): UInt64 {
    const collateralValue = this.calculateUsdValue(collateralAmount, price);
    const maxAllowedDebt = this.calculateMaxAllowedDebt(collateralValue);
    const debtInFields = debtAmount.toFields()[0];
    return UInt64.fromFields([this.safeDiv(maxAllowedDebt, debtInFields)]);
  }

  /**
   * @notice  This method is used to calculate the USD value of the collateral
   * @param   amount - The amount of collateral
   * @param   price - The price of the collateral
   * @returns The USD value of the collateral
   */
  private calculateUsdValue(amount: UInt64, price: UInt64): Field {
    const numCollateralValue = amount.toFields()[0].mul(price.toFields()[0]);
    return this.fieldIntegerDiv(numCollateralValue, ZkUsdVault.UNIT_PRECISION);
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
