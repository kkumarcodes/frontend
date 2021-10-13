import { Component, OnDestroy, OnInit } from '@angular/core';
import { TerrajsService } from '../../services/terrajs.service';
import { Subscription } from 'rxjs';
import { CONFIG } from '../../consts/config';
import { InfoService } from '../../services/info.service';
import { GoogleAnalyticsService } from 'ngx-google-analytics';
import {div, roundSixDecimal} from 'src/app/libs/math';
import {LpBalancePipe} from '../../pipes/lp-balance.pipe';
import {PercentPipe} from '@angular/common';

interface TxHistory {
  desc: string;
  txhash: string;
  timestamp: Date;
  action: 'Farm' | 'Trade' | 'Gov';
  id: number;
}

const numberRegExp = /\d+/;
const alphabetRegExp = /[A-z]+/;

@Component({
  selector: 'app-tx-history',
  templateUrl: './tx-history.component.html',
  styleUrls: ['./tx-history.component.scss'],
  providers: [PercentPipe]

})
export class TxHistoryComponent implements OnInit, OnDestroy {

  private connected: Subscription;
  loading = true;

  currentTxOffset = 0;
  offsetTxLimit = 100;
  txHistoryList: TxHistory[] = [];
  previousTxHistoryLength = 0;

  constructor(
    public info: InfoService,
    public terrajs: TerrajsService,
    protected $gaService: GoogleAnalyticsService,
    private percentPipe: PercentPipe
  ) { }

  async ngOnInit() {
    this.$gaService.event('OPEN_TX_HISTORY_PAGE');
    this.connected = this.terrajs.connected
      .subscribe(async connected => {
        if (connected) {
          this.loading = true;
          if (this.txHistoryList.length === 0) {
            await this.info.ensureCoinInfos();
            await this.populateTxHistory();
          }
          this.loading = false;
        }
      });
  }

  ngOnDestroy() {
    this.connected.unsubscribe();
  }

  async loadMore() {
    if (this.loading) {
      return;
    }
    this.loading = true;
    await this.populateTxHistory();
    this.loading = false;
  }

  async populateTxHistory() {
    if (this.currentTxOffset === undefined) {
      return; // end of pagination txsRes.next is undefined
    }
    const queryParams: Record<string, string> = {
      offset: this.currentTxOffset.toString(),
      limit: this.offsetTxLimit.toString(),
      account: this.terrajs.address,
      chainId: this.terrajs.network.chainID
    };
    const txsRes = await this.terrajs.getFCD('v1/txs', queryParams);
    console.log(txsRes);
    for (const item of txsRes.txs) {
      if (item.code) {
        continue;
      }
      const txHistory = await this.processTxItem(item);
      if (txHistory) {
        this.txHistoryList.push(txHistory);
      }
    }
    this.currentTxOffset = txsRes.next;
    if (this.previousTxHistoryLength === this.txHistoryList.length) {
      await this.populateTxHistory();
    } else {
      this.previousTxHistoryLength = this.txHistoryList.length;
    }
  }

  ensureBase64toObject(executeMsg: any){
    const base64regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    try {
      if (typeof executeMsg === 'string' && base64regex.test(executeMsg)){
        return JSON.parse(atob(executeMsg));
      } else if (typeof executeMsg === 'object'){
        return executeMsg;
      } else {
        return {};
      }
    } catch (e){
      console.error(e);
      return {};
    }
  }

  async processTxItem(item: any): Promise<TxHistory> {
    if (!item.tx?.value?.msg) {
      return;
    }

    const lastIndex = item.tx.value.msg.length - 1;
    if (item.tx.value.msg[lastIndex]?.type !== 'wasm/MsgExecuteContract') {
      return;
    }

    const lastExecuteMsg = this.ensureBase64toObject(item.tx.value.msg[lastIndex]?.value?.execute_msg);
    if (lastExecuteMsg.swap && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.specPool) {
      const ustOffer = +item.tx.value.msg[lastIndex]?.value?.coins[0].amount / CONFIG.UNIT;
      const return_amount = +item.logs[lastIndex].events.find(o => o.type === 'from_contract').attributes.find(o => o.key === 'return_amount').value / CONFIG.UNIT;
      const price = roundSixDecimal(ustOffer / return_amount);
      return {
        desc: `Bought ${return_amount} SPEC for ${ustOffer} UST at price ${price} UST`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Trade',
        id: item.id
      };
    } else if (lastExecuteMsg.send?.msg && lastExecuteMsg.send?.msg?.execute_swap_operations?.operations[1]?.terra_swap?.ask_asset_info?.token?.contract_addr === this.terrajs.settings.specToken) {
      const return_amount_list = item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.filter(o => o.key === 'return_amount');
      const offer_amount = +lastExecuteMsg.send?.msg?.execute_swap_operations.offer_amount / CONFIG.UNIT ?? 0;
      let offer_token;
      const offer_asset_info_token_contract = lastExecuteMsg.send?.msg?.execute_swap_operations?.operations[0]?.terra_swap?.offer_asset_info?.token?.contract_addr;
      if (offer_asset_info_token_contract) {
        await this.info.ensureCw20tokensWhitelist();
        offer_token = this.info.cw20tokensWhitelist[this.terrajs?.network?.name ?? 'mainnet'][offer_asset_info_token_contract]?.symbol ?? offer_asset_info_token_contract;
      }
      const return_amount = return_amount_list[return_amount_list.length - 1]?.value / CONFIG.UNIT ?? 0;
      const price = roundSixDecimal(offer_amount / return_amount);
      return {
        desc: `Bought ${return_amount} SPEC for ${offer_amount} ${offer_token} at price ${price} ${offer_token}`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Trade',
        id: item.id
      };
    } else if (lastExecuteMsg.execute_swap_operations?.operations[1].terra_swap?.ask_asset_info?.token?.contract_addr === this.terrajs.settings.specToken) {
      const offer_denom = lastExecuteMsg.execute_swap_operations?.operations[0]?.native_swap?.offer_denom;
      const offer_amount = +lastExecuteMsg.execute_swap_operations.offer_amount / CONFIG.UNIT ?? 0;
      const return_amount_list = item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.filter(o => o.key === 'return_amount');
      const return_amount = return_amount_list[return_amount_list.length - 1]?.value / CONFIG.UNIT ?? 0;
      const price = roundSixDecimal(offer_amount / return_amount);
      return {
        desc: `Bought ${return_amount} SPEC for ${offer_amount} ${offer_denom} at price ${price} ${offer_denom}`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Trade',
        id: item.id
      };
    } else if (lastExecuteMsg.send?.msg && this.ensureBase64toObject(lastExecuteMsg.send?.msg)?.swap && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.specToken) {
      const offer_amount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'offer_amount')?.value / CONFIG.UNIT ?? 0;
      const return_amount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'return_amount')?.value / CONFIG.UNIT ?? 0;
      const price = roundSixDecimal(return_amount / offer_amount);
      return {
        desc: `Sold ${offer_amount} SPEC for ${return_amount} UST at price ${price} UST`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Trade',
        id: item.id
      };
    } else if (lastExecuteMsg.send?.msg && lastExecuteMsg.send?.msg?.execute_swap_operations && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.specToken) {
      const return_amount_list = item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.filter(o => o.key === 'return_amount');
      const ask_asset_list = item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.filter(o => o.key === 'ask_asset');
      const offer_amount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'offer_amount')?.value / CONFIG.UNIT ?? 0;
      let return_amount = +return_amount_list[return_amount_list.length - 1].value / CONFIG.UNIT ?? 0;
      await this.info.ensureCw20tokensWhitelist();
      let last_ask_asset = this.info.cw20tokensWhitelist[this.terrajs?.network?.name ?? 'mainnet'][ask_asset_list[ask_asset_list.length - 1].value]?.symbol ?? ask_asset_list[ask_asset_list.length - 1].value;
      if (!last_ask_asset) {
        const swap_coin = item.logs[lastIndex].events?.find(o => o.type === 'swap')?.attributes?.find(o => o.key === 'swap_coin');
        last_ask_asset = swap_coin.value.match(alphabetRegExp)[0];
        return_amount = +(swap_coin.value.match(numberRegExp)[0]) / CONFIG.UNIT ?? 0;
      }
      const price = roundSixDecimal(return_amount / offer_amount);
      return {
        desc: `Sold ${offer_amount} SPEC for ${return_amount} ${last_ask_asset} at price ${price} ${last_ask_asset}`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Trade',
        id: item.id
      };
    } else if (lastExecuteMsg.withdraw && this.info.farmInfos.find(o => o.farmContract === item.tx.value.msg[lastIndex]?.value?.contract)) {
      let descAppend = '';
      for (let index = 0; index < item.tx.value.msg.length; index++) {
        const farmInfo = this.info.farmInfos.find(it => it.farmContract === item.tx.value.msg[index].value?.contract);
        if (!farmInfo) {
          continue;
        }
        const execute_msg = this.ensureBase64toObject(item.tx.value.msg[index].value.execute_msg);
        const asset_token = this.info.coinInfos[execute_msg.withdraw.asset_token];
        let poolName: string;
        if (asset_token) {
          poolName = asset_token + '-UST pool';
        } else if (farmInfo.tokenSymbol === 'MIR') {
          poolName = 'all pools';
        } else {
          poolName = farmInfo.tokenSymbol + '-UST pool';
        }
        if (farmInfo.tokenSymbol !== 'SPEC') {
          const farm_amount = +item.logs[index].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'farm_amount')?.value / CONFIG.UNIT ?? 0;
          const spec_amount = +item.logs[index].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'spec_amount')?.value / CONFIG.UNIT ?? 0;
          descAppend = descAppend + `Unstaked rewards from ${farmInfo?.farm} farm, ${poolName}, ${farm_amount} ${farmInfo.tokenSymbol}, ${spec_amount} SPEC <br>`;
        } else {
          const spec_amount = +item.logs[index].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'amount')?.value / CONFIG.UNIT ?? 0;
          descAppend = descAppend + `Unstaked rewards from ${farmInfo?.farm} farm, ${poolName}, ${spec_amount} SPEC <br>`;
        }
      }

      return {
        desc: descAppend,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    } else if (lastExecuteMsg.send && this.ensureBase64toObject(lastExecuteMsg.send.msg).bond && this.info.farmInfos.find(o => o.farmContract === lastExecuteMsg.send.contract)) {
      const foundFarmContract = this.info.farmInfos.find(o => o.farmContract === lastExecuteMsg.send.contract);
      const lpAmount = +lastExecuteMsg.send.amount / CONFIG.UNIT ?? 0;
      const send_msg = this.ensureBase64toObject(lastExecuteMsg.send.msg);
      const token_symbol = this.info.coinInfos[send_msg.bond.asset_token];
      let autoCompoundDesc = '';
      if (send_msg.bond.compound_rate === '1') {
        autoCompoundDesc = 'auto-compound mode';
      } else if (!send_msg.bond.compound_rate || send_msg.bond.compound_rate === '0' || send_msg.bond.compound_rate === '') {
        autoCompoundDesc = 'auto-stake mode';
      } else if (+send_msg.bond.compound_rate < 1 && +send_msg.bond.compound_rate > 0) {
        const compoundPercentage = +send_msg.bond.compound_rate * 100;
        autoCompoundDesc = `auto-compound ${compoundPercentage}% mode`;
      }
      return {
        desc: `Deposited ${lpAmount} ${token_symbol}-UST LP ${autoCompoundDesc} to ${foundFarmContract?.farm} farm`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    } else if (lastExecuteMsg.bond && this.info.farmInfos.find(o => o.farmContract === lastExecuteMsg.bond.contract)) {
      const lp = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'share')?.value / CONFIG.UNIT ?? 0;
      const taxAmount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'tax_amount')?.value ?? 0;
      const foundFarmContract = this.info.farmInfos.find(o => o.farmContract === lastExecuteMsg.bond.contract);
      let native_token_symbol = '';
      let native_token_amount = 0;
      let token_symbol = '';
      let token_amount = 0;
      if (lastExecuteMsg.bond?.assets) {
        for (const asset of lastExecuteMsg.bond?.assets) {
          if (asset.info?.native_token?.denom === 'uusd') {
            native_token_symbol = 'UST';
            native_token_amount = (+asset.amount - +taxAmount) / CONFIG.UNIT;
          } else if (asset.info?.token) {
            token_symbol = this.info.coinInfos[asset.info?.token.contract_addr];
            token_amount = (+asset.amount) / CONFIG.UNIT;
          }
        }
      }
      let autoCompoundDesc = '';
      if (lastExecuteMsg.bond.compound_rate === '1') {
        autoCompoundDesc = 'auto-compound mode';
      } else if (!lastExecuteMsg.bond.compound_rate || lastExecuteMsg.bond.compound_rate === '0' || lastExecuteMsg.bond.compound_rate === '') {
        autoCompoundDesc = 'auto-stake mode';
      } else if (+lastExecuteMsg.bond.compound_rate < 1 && +lastExecuteMsg.bond.compound_rate > 0) {
        const compoundPercentage = +lastExecuteMsg.bond.compound_rate * 100;
        autoCompoundDesc = `auto-compound ${compoundPercentage}% mode`;
      }
      const lpAmount = token_symbol === 'SPEC' ? `(${lp} LP)` : `(${lp} LP before deposit fee)`;
      return {
        desc: `Deposited ${token_amount} ${token_symbol} + ${native_token_amount} ${native_token_symbol} ${autoCompoundDesc} ${lpAmount} to ${foundFarmContract?.farm} farm`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    } else if (lastExecuteMsg.zap_to_bond){
      const provide_amount_UST = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'provide_amount')?.value / CONFIG.UNIT ?? 0;
      const offer_amount =  +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'offer_amount')?.value / CONFIG.UNIT ?? 0;
      const return_amount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'return_amount')?.value / CONFIG.UNIT ?? 0;
      const lp_amount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'share')?.value / CONFIG.UNIT ?? 0;
      const tax_amount = +item.logs[lastIndex].events?.find(o => o.type === 'from_contract')?.attributes?.find(o => o.key === 'tax_amount')?.value / CONFIG.UNIT ?? 0;
      const foundFarmContract = this.info.farmInfos.find(o => o.farmContract === lastExecuteMsg.zap_to_bond.contract);
      const price = roundSixDecimal(offer_amount / return_amount);
      const token_symbol = this.info.coinInfos[lastExecuteMsg.zap_to_bond.pair_asset.token.contract_addr];
      const lpAmountDesc = token_symbol === 'SPEC' ? `${lp_amount} ${token_symbol}-UST LP` : `${lp_amount} ${token_symbol}-UST LP (before deposit fee)`;
      let autoCompoundDesc = '';
      if (lastExecuteMsg.zap_to_bond.compound_rate === '1') {
        autoCompoundDesc = 'auto-compound mode';
      } else if (!lastExecuteMsg.zap_to_bond.compound_rate || lastExecuteMsg.zap_to_bond.compound_rate === '0' || lastExecuteMsg.zap_to_bond.compound_rate === '') {
        autoCompoundDesc = 'auto-stake mode';
      } else if (+lastExecuteMsg.zap_to_bond.compound_rate < 1 && +lastExecuteMsg.zap_to_bond.compound_rate > 0) {
        const compoundPercentage = +lastExecuteMsg.zap_to_bond.compound_rate * 100;
        autoCompoundDesc = `auto-compound ${compoundPercentage}% mode`;
      }
      return {
        desc: `Deposited ${provide_amount_UST} UST for ${lpAmountDesc} which bought ${return_amount} ${token_symbol} at price ${price} UST, ${autoCompoundDesc} to ${foundFarmContract?.farm} farm`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    } else if (lastExecuteMsg.unbond && this.info.farmInfos.find(o => o.farmContract === item.tx.value.msg[lastIndex]?.value?.contract) ) {
      const symbol = this.info.coinInfos[lastExecuteMsg.unbond.asset_token];
      const foundFarmContract = this.info.farmInfos.find(o => o.farmContract === item.tx.value.msg[lastIndex]?.value?.contract);
      return {
        desc: `Withdrawn ${(+lastExecuteMsg.unbond.amount / CONFIG.UNIT)} ${symbol}-UST LP from ${foundFarmContract?.farm} farm`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    } else if (lastExecuteMsg.update_bond){
      const symbol = this.info.coinInfos[lastExecuteMsg.update_bond.asset_token];
      const totalLP = +lastExecuteMsg.update_bond.amount_to_auto + +lastExecuteMsg.update_bond.amount_to_stake;
      const amount_to_auto = +lastExecuteMsg.update_bond.amount_to_auto;
      const amount_to_stake = +lastExecuteMsg.update_bond.amount_to_stake;
      const amount_to_auto_percent = this.percentPipe.transform(div(amount_to_auto, totalLP));
      const amount_to_stake_percent = this.percentPipe.transform(div(amount_to_stake, totalLP));
      return {
        desc: `Reallocated deposited ${symbol}-UST LP to auto-compound ${amount_to_auto_percent}, auto-stake ${amount_to_stake_percent} (${amount_to_auto / CONFIG.UNIT} LP, ${amount_to_stake / CONFIG.UNIT} LP)`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    }
    else if (this.ensureBase64toObject(lastExecuteMsg.send?.msg)?.withdraw_liquidity && this.info.farmInfos.find(o => o.farmContract === item.tx.value.msg[lastIndex - 1]?.value?.contract)) {
      const penultimateExecutionMsg = this.ensureBase64toObject(item.tx.value.msg[lastIndex - 1]?.value?.execute_msg);
      const symbol = this.info.coinInfos[penultimateExecutionMsg.unbond.asset_token];
      const foundFarmContract = this.info.farmInfos.find(o => o.farmContract === item.tx.value.msg[lastIndex - 1]?.value?.contract);
      const refund_assets = item.logs[lastIndex].events.find(o => o.type === 'from_contract').attributes.find(o => o.key === 'refund_assets');
      const splitted: string[] = refund_assets.value?.split(',');
      const first = splitted ? +splitted[0].match(numberRegExp)[0] / CONFIG.UNIT : 0;
      const second = splitted ? +splitted[1].match(numberRegExp)[0] / CONFIG.UNIT : 0;
      const [uusdAmount, tokenAmount] = splitted[0].match(alphabetRegExp)[0] === 'uusd'
        ? [first, second]
        : [second, first];
      return {
        desc: `Withdrawn ${tokenAmount} ${symbol}, ${uusdAmount} UST (${(+lastExecuteMsg.send.amount / CONFIG.UNIT)} ${symbol}-UST LP)  from ${foundFarmContract?.farm} farm`,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    } else if (lastExecuteMsg.send?.msg === btoa('{"stake_tokens":{}}') && lastExecuteMsg.send?.contract === this.terrajs.settings.gov) {
      return {
        desc: 'Staked to Gov ' + (+lastExecuteMsg.send.amount / CONFIG.UNIT) + ' SPEC',
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Gov',
        id: item.id
      };
    } else if (lastExecuteMsg.poll_vote && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.gov) {
      return {
        desc: 'Voted Poll ' + lastExecuteMsg.poll_vote.poll_id,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Gov',
        id: item.id
      };
    } else if (lastExecuteMsg.poll_execute && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.gov) {
      return {
        desc: 'Executed Poll ' + lastExecuteMsg.poll_execute.poll_id,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Gov',
        id: item.id
      };
    } else if (lastExecuteMsg.withdraw && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.gov) {
      const executeMsgLvl2 = this.ensureBase64toObject(item.tx.value.msg[lastIndex]?.value.execute_msg);
      return {
        desc: 'Unstaked from Gov ' + (+executeMsgLvl2.withdraw.amount / CONFIG.UNIT) + ' SPEC',
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Gov',
        id: item.id
      };
    } else if (lastExecuteMsg.send && lastExecuteMsg.send.msg.poll_start && lastExecuteMsg.send?.contract === this.terrajs.settings.gov) {
      const poll_start = this.ensureBase64toObject(this.ensureBase64toObject(item.tx.value.msg[lastIndex]?.value?.execute_msg)?.send?.msg)?.poll_start;
      return {
        desc: 'Created Poll ' + poll_start.title,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Gov',
        id: item.id
      };
    } else if (lastExecuteMsg.poll_end && item.tx.value.msg[lastIndex]?.value?.contract === this.terrajs.settings.gov) {
      return {
        desc: 'Ended Poll ' + lastExecuteMsg.poll_end.poll_id,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Gov',
        id: item.id
      };
    } else if (item.tx.value.msg.length >= 3
      && lastExecuteMsg.send
      && this.ensureBase64toObject(item.tx.value.msg[0]?.value?.execute_msg)?.mint
      && item.tx.value.msg[0]?.value?.contract === this.terrajs.settings.gov
      && this.ensureBase64toObject(item.tx.value.msg[1]?.value?.execute_msg)?.withdraw
    ) {
      let descTemp = '';
      for (let i = 1; i <= lastIndex; i++) {
        const executeMsg = this.ensureBase64toObject(item.tx.value.msg[i]?.value?.execute_msg);
        if (executeMsg.withdraw) {
          const matchFarmInfo = this.info.farmInfos.find(farmInfo => farmInfo.farmContract === item.tx.value.msg[i]?.value?.contract);
          if (matchFarmInfo) {
            descTemp += `From ${matchFarmInfo.farm} vault`;
            if (executeMsg.withdraw?.asset_token) {
              descTemp += `, pool ${this.info.coinInfos[executeMsg.withdraw?.asset_token]}-UST`;
            } else {
              descTemp += `, all pools`;
            }
            descTemp += `<br>`;
          }
        }
        else if (executeMsg?.send?.amount) {
          const executeMsgForCompare = JSON.parse(JSON.stringify(executeMsg)); // hack way to clone object without referencing
          executeMsgForCompare.send.amount = '0';
          const matchFarmInfo = this.info.farmInfos.find(farmInfo => JSON.stringify(farmInfo.getStakeGovMsg('0').execute_msg) === JSON.stringify(executeMsgForCompare));
          if (matchFarmInfo) {
            descTemp += `Move auto-staked ${executeMsg.send.amount / CONFIG.UNIT} ${matchFarmInfo.tokenSymbol} to ${matchFarmInfo.farm} Gov<br>`;
          }
        }
      }
      return {
        desc: descTemp,
        txhash: item.txhash,
        timestamp: new Date(item.timestamp),
        action: 'Farm',
        id: item.id
      };
    }
  }

}