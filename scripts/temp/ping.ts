import { ethers } from "ethers";

const rpcUrl = "https://testnet.dev.svcs.ferrumnetwork.io" // testnet

// Create a provider
const provider = new ethers.JsonRpcProvider(rpcUrl);
const privateKey = process.env.QP_DEPLOYER_KEY!;
const wallet = new ethers.Wallet(privateKey, provider);

const erc20abi = [
    {
      "inputs": [],
      "name": "ping",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
  ]


async function sendTransaction() {
  const contractAddress = "0x99d3Fa0Cf0a5C748F357028De4AdF50072098e72"
    const contract = new ethers.Contract(contractAddress, erc20abi, wallet);
    const txResponse = await contract.ping()

    console.log("Transaction sent! Hash:", txResponse.hash);

    // Wait for the transaction to be mined
    const receipt = await txResponse.wait();
    console.log("Transaction confirmed in block:", receipt!.blockNumber);
}

sendTransaction();
