import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  UInt8,
  Bool,
  Field,
  UInt64,
  UInt32,
} from 'o1js';
import { OracleWhitelist } from '../types.js';
import { ZkUsdEngine, ZkUsdEngineDeployProps } from '../zkusd-engine.js';
import { ZkUsdVault } from '../zkusd-vault.js';
import { FungibleTokenContract } from '@minatokens/token';
import { ZkUsdMasterOracle } from '../zkusd-master-oracle.js';
import { ZkUsdPriceTracker } from '../zkusd-price-tracker.js';

interface TransactionOptions {
  printTx?: boolean;
  extraSigners?: PrivateKey[];
  fee?: number;
  printAccountUpdates?: boolean;
}

interface ContractInstance<T> {
  contract: T extends new (...args: any[]) => infer R ? R : T;
  publicKey: PublicKey;
  privateKey: PrivateKey;
}
interface Agent {
  account: Mina.TestPublicKey;
  vault?: {
    contract: ZkUsdVault;
    publicKey: PublicKey;
    privateKey: PrivateKey;
  };
}

export class TestAmounts {
  //ZERO
  static ZERO = UInt64.from(0);

  // Collateral amounts
  static COLLATERAL_900_MINA = UInt64.from(900e9); // 900 Mina
  static COLLATERAL_200_MINA = UInt64.from(200e9); // 200 Mina
  static COLLATERAL_105_MINA = UInt64.from(105e9); // 105 Mina
  static COLLATERAL_100_MINA = UInt64.from(100e9); // 100 Mina
  static COLLATERAL_50_MINA = UInt64.from(50e9); // 50 Mina
  static COLLATERAL_2_MINA = UInt64.from(2e9); // 2 Mina
  static COLLATERAL_1_MINA = UInt64.from(1e9); // 1 Mina

  // zkUSD amounts
  static DEBT_100_ZKUSD = UInt64.from(100e9); // 100 zkUSD
  static DEBT_50_ZKUSD = UInt64.from(50e9); // 50 zkUSD
  static DEBT_40_ZKUSD = UInt64.from(40e9); // 40 zkUSD
  static DEBT_30_ZKUSD = UInt64.from(30e9); // 30 zkUSD
  static DEBT_10_ZKUSD = UInt64.from(10e9); // 10 zkUSD
  static DEBT_5_ZKUSD = UInt64.from(5e9); // 5 zkUSD
  static DEBT_4_ZKUSD = UInt64.from(4e9); // 4 zkUSD
  static DEBT_1_ZKUSD = UInt64.from(1e9); // 1 zkUSD
  static DEBT_50_CENT_ZKUSD = UInt64.from(5e8); // 0.5 zkUSD
  static DEBT_10_CENT_ZKUSD = UInt64.from(1e8); // 0.1 zkUSD

  // Price amounts
  static PRICE_0_USD = UInt64.from(0); // 0 USD
  static PRICE_25_CENT = UInt64.from(0.25e9); // 0.25 USD
  static PRICE_40_CENT = UInt64.from(0.4e9); // 0.40 USD
  static PRICE_48_CENT = UInt64.from(0.48e9); // 0.48 USD
  static PRICE_49_CENT = UInt64.from(0.49e9); // 0.49 USD
  static PRICE_50_CENT = UInt64.from(0.5e9); // 0.50 USD
  static PRICE_51_CENT = UInt64.from(0.51e9); // 0.51 USD
  static PRICE_52_CENT = UInt64.from(0.52e9); // 0.52 USD
  static PRICE_1_USD = UInt64.from(1e9); // 1 USD
  static PRICE_2_USD = UInt64.from(2e9); // 2 USD
  static PRICE_10_USD = UInt64.from(1e10); // 10 USD
}

interface KeyPair {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

export class TestHelper {
  deployer: Mina.TestPublicKey;
  agents: Record<string, Agent> = {};
  oracles: Record<string, KeyPair> = {};
  token: ContractInstance<ReturnType<typeof FungibleTokenContract>>;
  engine: ContractInstance<ZkUsdEngine>;
  masterOracle: ContractInstance<ZkUsdMasterOracle>;
  vaultVerificationKeyHash?: Field;
  whitelist: OracleWhitelist;
  whitelistedOracles: Map<string, number> = new Map();
  currentAccountIndex: number = 0;
  Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;

  static proofsEnabled = false;

  static protocolAdminKeyPair = {
    privateKey: PrivateKey.fromBase58(
      'EKFUUqHJ4d7Q78c6UYHrdNL5j4xr7QnQFtxWWSM7f1idttzJ5TPH'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qpQzmXmB3euvH3U5sfckNicA6zm7dDYSajXJEEVk5NMAtXzeefgu'
    ),
  };

  static masterOracleKeyPair = {
    privateKey: PrivateKey.fromBase58(
      'EKEvEeJQqe1e6TFVYsvMpGeJAXtSPNmCrHDWSWHS1Swum8iuTnq9'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qmApLja1zB4GwBLB9Xm1c6Fjc1PxgfCNa9z12wQorHUqZbaiKnym'
    ),
  };

  static tokenKeyPair = {
    privateKey: PrivateKey.fromBase58(
      'EKDveJ7bFB2SEFU52rgob94xa9NV5fVwarpDKGSQ6TPkmtb9MNd9'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qry2wngUSGZqQn9erfnA9rZPn4cMbDG1XPasGdK1EtKQAxmgjDtt'
    ),
  };

  static engineKeyPair = {
    privateKey: PrivateKey.fromBase58(
      'EKEfFkTEhZZi1UrPHKAmSZadmxx16rP8aopMm5XHbyDM96M9kXzD'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qkwLvZ6e5NzRgQwkTaA9m88fTUZLHmpwvmCQEqbp5KcAAfqFAaf9'
    ),
  };

  static evenOraclePriceTrackerKeyPair = {
    privateKey: PrivateKey.fromBase58(
      'EKEhjKoJgTKZ22ovXXvt9dT3zbLVDoKDwvHtPaDQdWzPCu6uBd1b'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qk5VcEhiXeUCzR7a6aPH7A3YLm86jeP4ffMarPt8Q6pMbGjCZDLU'
    ),
  };

  static oddOraclePriceTrackerKeyPair = {
    privateKey: PrivateKey.fromBase58(
      'EKF3K7jmFwKdjnpSr4bQ9rYQ3Bc4yV53wr5Gz8v7YLqXArokT97Q'
    ),
    publicKey: PublicKey.fromBase58(
      'B62qqpWYnkG8AgYTDvtvxSJhAoJemHZJGPcVrTgGNKT5Kz9pQjMoysm'
    ),
  };

  createVaultKeyPair(): { publicKey: PublicKey; privateKey: PrivateKey } {
    return PrivateKey.randomKeypair();
  }

  async initChain() {
    this.Local = await Mina.LocalBlockchain({
      proofsEnabled: TestHelper.proofsEnabled,
    });
    Mina.setActiveInstance(this.Local);
    this.deployer = this.Local.testAccounts[this.currentAccountIndex];
    this.currentAccountIndex++;
    this.whitelist = new OracleWhitelist({
      addresses: Array(ZkUsdEngine.MAX_PARTICIPANTS).fill(PublicKey.empty()),
    });
  }

  createAgents(names: string[]) {
    if (this.currentAccountIndex >= 10) {
      throw new Error('Max number of agents reached');
    }

    names.forEach((name) => {
      this.agents[name] = {
        account: this.Local.testAccounts[this.currentAccountIndex],
      };
      this.currentAccountIndex++;
    });
  }

  async transaction(
    sender: Mina.TestPublicKey | KeyPair,
    callback: () => Promise<void>,
    options: TransactionOptions = {}
  ) {
    const {
      printTx = false,
      extraSigners = [],
      fee,
      printAccountUpdates = false,
    } = options;

    const tx = await Mina.transaction(
      {
        sender: 'key' in sender ? sender : sender.publicKey,
        ...(fee && { fee }),
      },
      callback
    );

    if (printTx) {
      console.log(tx.toPretty());
    }

    if (printAccountUpdates) {
      const auCount: { publicKey: PublicKey; tokenId: Field; count: number }[] =
        [];
      let proofAuthorizationCount = 0;
      for (const au of tx.transaction.accountUpdates) {
        const { publicKey, tokenId, authorizationKind } = au.body;
        if (au.authorization.proof) {
          proofAuthorizationCount++;
          if (authorizationKind.isProved.toBoolean() === false)
            console.error('Proof authorization exists but isProved is false');
        } else if (authorizationKind.isProved.toBoolean() === true)
          console.error('isProved is true but no proof authorization');
        const index = auCount.findIndex(
          (item) =>
            item.publicKey.equals(publicKey).toBoolean() &&
            item.tokenId.equals(tokenId).toBoolean()
        );
        if (index === -1) auCount.push({ publicKey, tokenId, count: 1 });
        else auCount[index].count++;
      }
      console.log(
        `Account updates for tx: ${auCount.length}, proof authorizations: ${proofAuthorizationCount}`
      );
      for (const au of auCount) {
        if (au.count > 1) {
          console.log(
            `DUPLICATE AU: ${au.publicKey.toBase58()} tokenId: ${au.tokenId.toString()} count: ${
              au.count
            }`
          );
        }
      }
      console.log(tx.transaction.accountUpdates);
    }

    await tx.prove();
    tx.sign([
      ('key' in sender ? sender.key : sender.privateKey) as PrivateKey,
      ...extraSigners,
    ]);
    const sentTx = await tx.send();
    const txResult = await sentTx.wait();
    if (txResult.status !== 'included') {
      console.log('Transaction failed with status', txResult.toPretty());
      throw new Error(`Transaction failed with status ${txResult.status}`);
    }

    return txResult;
  }

  async compileContracts() {
    const FungibleToken = FungibleTokenContract(ZkUsdEngine);
    await FungibleToken.compile();
    await ZkUsdEngine.compile();
  }

  async deployTokenContracts() {
    const FungibleToken = FungibleTokenContract(ZkUsdEngine);

    this.token = {
      contract: new FungibleToken(TestHelper.tokenKeyPair.publicKey),
      publicKey: TestHelper.tokenKeyPair.publicKey,
      privateKey: TestHelper.tokenKeyPair.privateKey,
    };
    this.engine = {
      contract: new ZkUsdEngine(TestHelper.engineKeyPair.publicKey),
      publicKey: TestHelper.engineKeyPair.publicKey,
      privateKey: TestHelper.engineKeyPair.privateKey,
    };

    if (TestHelper.proofsEnabled) {
      await this.compileContracts();
    }

    const vaultVerification = await ZkUsdVault.compile();
    this.vaultVerificationKeyHash = vaultVerification.verificationKey.hash;

    await ZkUsdMasterOracle.compile();
    await ZkUsdPriceTracker.compile();

    //Create the protocol admin
    await this.transaction(
      this.deployer,
      async () => {
        AccountUpdate.fundNewAccount(this.deployer, 1);
        AccountUpdate.createSigned(TestHelper.protocolAdminKeyPair.publicKey);
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );

    // Deploying zkUSD Token and Admin contracts

    //Create deploy props for the engine
    const engineDeployProps: ZkUsdEngineDeployProps = {
      initialPrice: TestAmounts.PRICE_1_USD,
      admin: TestHelper.protocolAdminKeyPair.publicKey,
      oracleFlatFee: TestAmounts.COLLATERAL_1_MINA,
      emergencyStop: Bool(false),
      vaultVerificationKeyHash: this.vaultVerificationKeyHash!,
    };

    await this.transaction(
      this.deployer,
      async () => {
        AccountUpdate.fundNewAccount(this.deployer, 3);
        await this.token.contract.deploy({
          symbol: 'zkUSD',
          src: 'TBD',
        });
        await this.token.contract.initialize(
          this.engine.publicKey,
          UInt8.from(9),
          Bool(false)
        );
        await this.engine.contract.deploy(engineDeployProps);
      },
      {
        extraSigners: [
          this.token.privateKey,
          this.engine.privateKey,
          TestHelper.protocolAdminKeyPair.privateKey,
          TestHelper.masterOracleKeyPair.privateKey,
        ],
      }
    );

    this.Local.setBlockchainLength(UInt32.from(1000));

    await this.transaction(
      this.deployer,
      async () => {
        AccountUpdate.fundNewAccount(this.deployer, 4);
        await this.engine.contract.initialize();
      },
      {
        extraSigners: [
          TestHelper.protocolAdminKeyPair.privateKey,
          this.engine.privateKey,
          TestHelper.masterOracleKeyPair.privateKey,
          TestHelper.evenOraclePriceTrackerKeyPair.privateKey,
          TestHelper.oddOraclePriceTrackerKeyPair.privateKey,
        ],
      }
    );

    this.masterOracle = {
      contract: new ZkUsdMasterOracle(
        TestHelper.masterOracleKeyPair.publicKey,
        this.engine.contract.deriveTokenId()
      ),
      publicKey: TestHelper.masterOracleKeyPair.publicKey,
      privateKey: TestHelper.masterOracleKeyPair.privateKey,
    };

    for (let i = 0; i < ZkUsdEngine.MAX_PARTICIPANTS; i++) {
      const oracleName = 'oracle' + (i + 1);
      this.oracles[oracleName] = PrivateKey.randomKeypair();
      this.whitelist.addresses[i] = this.oracles[oracleName].publicKey;
      this.whitelistedOracles.set(oracleName, i);
    }

    await this.transaction(this.deployer, async () => {
      AccountUpdate.fundNewAccount(this.deployer, 8);
      const au = AccountUpdate.createSigned(this.deployer);
      for (const [_name, oracle] of Object.entries(this.oracles)) {
        au.send({
          to: oracle.publicKey,
          amount: TestAmounts.COLLATERAL_50_MINA,
        });
      }
    });

    await this.transaction(
      this.deployer,
      async () => {
        await this.engine.contract.updateOracleWhitelist(this.whitelist);
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );

    //Transfer Mina to the price feed oracle to pay the oracle fee
    await this.transaction(this.deployer, async () => {
      await this.engine.contract.depositOracleFunds(
        TestAmounts.COLLATERAL_100_MINA
      );
    });
  }

  async createVaults(names: string[]) {
    for (const name of names) {
      if (!this.agents[name]) {
        throw new Error(`Agent ${name} not found`);
      }

      const vaultKeyPair = this.createVaultKeyPair();

      this.agents[name].vault = {
        contract: new ZkUsdVault(
          vaultKeyPair.publicKey,
          this.engine.contract.deriveTokenId()
        ),
        publicKey: vaultKeyPair.publicKey,
        privateKey: vaultKeyPair.privateKey,
      };

      await this.transaction(
        this.agents[name].account,
        async () => {
          AccountUpdate.fundNewAccount(this.agents[name].account, 2);
          await this.engine.contract.createVault(
            this.agents[name].vault!.publicKey
          );
        },
        {
          extraSigners: [this.agents[name].vault!.privateKey],
        }
      );
    }
  }

  async updateOracleMinaPrice(price: UInt64) {
    // Use the map to iterate over whitelisted oracles
    for (const [oracleName] of this.whitelistedOracles) {
      await this.transaction(this.oracles[oracleName], async () => {
        await this.engine.contract.submitPrice(price, this.whitelist);
      });
    }

    //Move the blockchain forward
    this.Local.setBlockchainLength(
      this.Local.getNetworkState().blockchainLength.add(1)
    );

    await this.transaction(this.deployer, async () => {
      await this.engine.contract.settlePriceUpdate();
    });

    //Move the blockchain forward
    this.Local.setBlockchainLength(
      this.Local.getNetworkState().blockchainLength.add(1)
    );
  }

  async stopTheProtocol() {
    await this.transaction(
      this.deployer,
      async () => {
        await this.engine.contract.stopTheProtocol();
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );
  }

  async resumeTheProtocol() {
    await this.transaction(
      this.deployer,
      async () => {
        await this.engine.contract.resumeTheProtocol();
      },
      {
        extraSigners: [TestHelper.protocolAdminKeyPair.privateKey],
      }
    );
  }
}
