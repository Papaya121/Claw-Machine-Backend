import { BadRequestException, Injectable } from '@nestjs/common';
import type { Wallet } from '../common/domain.types';
import { getEnvInt } from '../common/env';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';

@Injectable()
export class WalletService {
  private readonly initialTickets = getEnvInt('DEFAULT_TICKETS', 5);

  constructor(private readonly db: InMemoryDatabaseService) {}

  getOrCreateWallet(userId: string): Wallet {
    const existing = this.db.wallets.get(userId);
    if (existing) {
      return existing;
    }

    const wallet: Wallet = {
      userId,
      tickets: this.initialTickets,
      coins: 0,
      version: 1,
    };

    this.db.wallets.set(userId, wallet);
    return wallet;
  }

  debitTicket(userId: string): Wallet {
    const wallet = this.getOrCreateWallet(userId);
    if (wallet.tickets < 1) {
      throw new BadRequestException('Not enough tickets');
    }

    const nextWallet: Wallet = {
      ...wallet,
      tickets: wallet.tickets - 1,
      version: wallet.version + 1,
    };

    this.db.wallets.set(userId, nextWallet);
    return nextWallet;
  }

  creditCoins(userId: string, amount: number): Wallet {
    const wallet = this.getOrCreateWallet(userId);
    const nextWallet: Wallet = {
      ...wallet,
      coins: wallet.coins + amount,
      version: wallet.version + 1,
    };

    this.db.wallets.set(userId, nextWallet);
    return nextWallet;
  }
}
