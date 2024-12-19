import { Struct, PublicKey, UInt64, Field } from 'o1js';

export class VaultOwnerUpdatedEvent extends Struct({
  vaultAddress: PublicKey,
  previousOwner: PublicKey,
  newOwner: PublicKey,
}) {}

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
  minaPrice: UInt64,
}) {}

export class MintZkUsdEvent extends Struct({
  vaultAddress: PublicKey,
  amountMinted: UInt64,
  vaultCollateralAmount: UInt64,
  vaultDebtAmount: UInt64,
  minaPrice: UInt64,
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
  minaPrice: UInt64,
}) {}

export class MinaPriceUpdateEvent extends Struct({
  newPrice: UInt64,
}) {}

export class FallbackMinaPriceUpdateEvent extends Struct({
  newPrice: UInt64,
}) {}

export class MinaPriceSubmissionEvent extends Struct({
  submitter: PublicKey,
  price: UInt64,
  oracleFee: UInt64,
}) {}

export class EmergencyStopEvent extends Struct({}) {}

export class EmergencyResumeEvent extends Struct({}) {}

export class AdminUpdatedEvent extends Struct({
  previousAdmin: PublicKey,
  newAdmin: PublicKey,
}) {}

export class VerificationKeyUpdatedEvent extends Struct({}) {}

export class OracleWhitelistUpdatedEvent extends Struct({
  previousHash: Field,
  newHash: Field,
}) {}

export class OracleFeeUpdated extends Struct({
  previousFee: UInt64,
  newFee: UInt64,
}) {}

export class OracleFundsDepositedEvent extends Struct({
  amount: UInt64,
}) {}
