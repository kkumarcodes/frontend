import { PoolItem as SpecPoolItem } from '../api/spec_farm/pools_response';
import { PoolItem as MirrorPoolItem } from '../api/mirror_farm/pools_response';
import { PoolItem as nAssetPsiPoolItem } from '../api/nexus_nassets_psi_farm/pools_response';
import { RewardInfoResponseItem as MirrorRewardInfoResponseItem } from '../api/mirror_farm/reward_info_response';
import { RewardInfoResponseItem as SpecRewardInfoResponseItem } from '../api/spec_farm/reward_info_response';
import { InjectionToken } from '@angular/core';
import {MsgExecuteContract} from '@terra-money/terra.js';
import { PoolResponse } from '../api/terraswap_pair/pool_response';

export type PoolItem = SpecPoolItem | MirrorPoolItem | nAssetPsiPoolItem;
export type PoolInfo = PoolItem & { farm: string; token_symbol: string; farmTokenContract: string; farmContract: string; denomSymbol: string; denomContract: string};
export type RewardInfoResponseItem = MirrorRewardInfoResponseItem | SpecRewardInfoResponseItem;

export interface PairStat {
  tvl: string;
  poolApr: number;
  poolApy: number;
  farmApr: number;
  multiplier: number;
  vaultFee: number;
  specApr?: number;
  dpr?: number;
}

export const FARM_INFO_SERVICE = new InjectionToken('FARM_INFO_SERVICE');

export type denomSymbol = string;
export type denomContract = string;

export interface FarmInfoService {
  farm: string;
  tokenSymbol: string;
  readonly farmContract: string;
  readonly farmTokenContract: string;
  readonly farmGovContract: string;
  readonly autoCompound: boolean;
  readonly autoStake: boolean;
  readonly auditWarning?: boolean;
  readonly farmColor: string;

  queryPoolItems(): Promise<PoolItem[]>;
  queryPairStats(poolInfos: Record<string, PoolInfo>, poolResponses: Record<string, PoolResponse>): Promise<Record<string, PairStat>>;
  queryRewards(): Promise<RewardInfoResponseItem[]>;
  getStakeGovMsg(amount: string, additionalData?: object): MsgExecuteContract;
  getDenom(baseTokenAddr?: string): [denomSymbol, denomContract];
}
