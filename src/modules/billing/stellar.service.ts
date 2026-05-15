import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from '@stellar/stellar-sdk';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: SorobanRpc.Server;
  private readonly signer: Keypair;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;

  constructor(private config: ConfigService) {
    const rpcUrl = config.get<string>('stellar.rpcUrl')!;
    const network = config.get<string>('stellar.network')!;
    const contractId = config.get<string>('stellar.contractId')!;
    const signerSecret = config.get<string>('stellar.signerSecret')!;

    this.server = new SorobanRpc.Server(rpcUrl);
    this.signer = Keypair.fromSecret(signerSecret);
    this.contract = new Contract(contractId);
    this.networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  }

  async invokeContract(method: string, args: xdr.ScVal[]): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const account = await this.server.getAccount(this.signer.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(this.signer);

    const sendResult = await this.server.sendTransaction(prepared);
    if (sendResult.status === 'ERROR') {
      throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    // Poll for result
    let result: SorobanRpc.Api.GetTransactionResponse;
    do {
      await new Promise((r) => setTimeout(r, 1000));
      result = await this.server.getTransaction(sendResult.hash);
    } while (result.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

    if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Transaction failed with status: ${result.status}`);
    }
    return result;
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
