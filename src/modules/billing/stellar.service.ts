import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/** Mirrors the contract's PaymentOutcome enum. */
export enum PaymentOutcome {
  PAID = 'Paid',
  RETRYING = 'Retrying',
  FAILED = 'Failed',
}

/** How long to wait for a submitted transaction before giving up. */
const CONFIRMATION_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const TX_TIMEOUT_SECONDS = 30;

export class ContractCallError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'ContractCallError';
  }
}

@Injectable()
export class StellarService implements OnModuleInit {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: SorobanRpc.Server;
  private readonly signer: Keypair;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('stellar.billingEnabled') ?? true;

    const rpcUrl = config.getOrThrow<string>('stellar.rpcUrl');
    const network = config.getOrThrow<string>('stellar.network');
    const contractId = config.get<string>('stellar.contractId') ?? '';
    const signerSecret = config.get<string>('stellar.signerSecret') ?? '';

    this.server = new SorobanRpc.Server(rpcUrl);
    this.networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    // Constructing these with empty strings used to throw from inside the
    // constructor, taking down the whole container at DI time with an opaque
    // error. Validation now happens at boot in validateEnv, and a disabled
    // keeper is allowed to run with placeholders it never uses.
    if (this.enabled) {
      this.signer = Keypair.fromSecret(signerSecret);
      this.contract = new Contract(contractId);
    } else {
      this.signer = Keypair.random();
      this.contract = null as unknown as Contract;
      this.logger.warn('Billing is disabled; contract calls will be refused');
    }
  }

  async onModuleInit() {
    if (!this.enabled) return;
    try {
      const account = await this.server.getAccount(this.signer.publicKey());
      this.logger.log(
        `Keeper ${this.signer.publicKey()} ready (sequence ${account.sequenceNumber()})`,
      );
    } catch {
      // Worth surfacing loudly: an unfunded keeper cannot submit anything, and
      // the failure would otherwise appear once per due subscription.
      this.logger.error(
        `Keeper account ${this.signer.publicKey()} is not funded or unreachable — ` +
          'billing will fail until it is provisioned',
      );
    }
  }

  /**
   * Simulate a contract call without submitting it.
   *
   * Read-only queries such as `is_billable` must never cost a fee, and
   * simulating a write first tells us whether it would fail before we pay to
   * find out.
   */
  async simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
    this.assertEnabled();
    const account = await this.server.getAccount(this.signer.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const sim = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new ContractCallError(`${method} simulation failed: ${sim.error}`, true);
    }
    return sim.result?.retval ? (scValToNative(sim.result.retval) as unknown) : undefined;
  }

  /**
   * Submit a contract call and wait for confirmation.
   *
   * Returns the decoded return value so callers can act on the contract's
   * `PaymentOutcome` rather than inferring success from the absence of a throw.
   */
  async invokeContract(method: string, args: xdr.ScVal[]): Promise<unknown> {
    this.assertEnabled();

    const account = await this.server.getAccount(this.signer.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(this.signer);

    const sendResult = await this.server.sendTransaction(prepared);
    if (sendResult.status === 'ERROR') {
      throw new ContractCallError(
        `${method} rejected: ${JSON.stringify(sendResult.errorResult)}`,
        true,
      );
    }

    return this.awaitConfirmation(method, sendResult.hash);
  }

  /**
   * Poll until the transaction resolves.
   *
   * The previous loop was `do { sleep(1s) } while (NOT_FOUND)` with no bound,
   * so a transaction the network never saw would spin forever inside a cron
   * tick, and the next tick would start another one alongside it.
   */
  private async awaitConfirmation(method: string, hash: string): Promise<unknown> {
    const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const result = await this.server.getTransaction(hash);

      if (result.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) continue;

      if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return result.returnValue ? (scValToNative(result.returnValue) as unknown) : undefined;
      }

      throw new ContractCallError(`${method} failed on-chain: ${result.status}`, true);
    }

    // Transient: the transaction may still land, so the caller must not treat
    // this as a definitive failure and must not re-bill blindly.
    throw new ContractCallError(
      `${method} not confirmed within ${CONFIRMATION_TIMEOUT_MS}ms (hash ${hash})`,
      false,
    );
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ContractCallError('Billing is disabled in this process', true);
    }
  }

  addressToScVal(address: string): xdr.ScVal {
    return new Address(address).toScVal();
  }

  u64ToScVal(value: bigint): xdr.ScVal {
    return nativeToScVal(value, { type: 'u64' });
  }

  i128ToScVal(value: bigint): xdr.ScVal {
    return nativeToScVal(value, { type: 'i128' });
  }

  symbolToScVal(value: string): xdr.ScVal {
    return nativeToScVal(value, { type: 'symbol' });
  }
}
